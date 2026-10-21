// Run with:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../js/data.js");
const M = require("../js/model.js");
const AI = require("../js/ai.js");

const c = D.CYCLONES.find((c) => c.id === "fani-2019");
const r = M.runForecast({ fixes: c.track, landfallTime: c.landfallTime, title: c.title }, D.buildAssets(), D.ASSET_TYPES, D.TOWNS, { members: 40, leadHours: 24 });
const ctx = AI.buildContext({ title: c.title, sub: c.sub }, r, D.TOWNS);
const puri = r.advisories.find((a) => a.district === "Puri");
const wind = Math.round(Math.max(...ctx.highest_risk_assets.filter((a) => a.district === "Puri").map((a) => a.wind_kmh)));
const adv = (over) => ({ advisories: [{ district: "Puri", level: puri.levelLabel, message_en: `Winds up to ${wind} km/h. Evacuate low-lying areas.`, local_language: "Odia", message_local: "…", ...over }] });

test("fact check passes text that only uses the model's districts, levels and numbers", () => {
  const fc = AI.factCheck(adv({}), ctx, r.advisories);
  assert.ok(fc.ok, JSON.stringify(fc));
});

test("fact check flags made-up numbers, unknown districts, wrong levels and houses-for-people", () => {
  assert.match(AI.factCheck(adv({ message_en: "Winds up to 290 km/h." }), ctx, r.advisories).advisories[0].issues.join(), /290/);
  assert.match(AI.factCheck(adv({ district: "Chennai" }), ctx, r.advisories).advisories[0].issues.join(), /no advisory for "Chennai"/);
  assert.match(AI.factCheck(adv({ level: puri.levelLabel === "RED" ? "YELLOW" : "RED" }), ctx, r.advisories).advisories[0].issues.join(), /differs from the model/);
  assert.match(AI.factCheck(adv({ message_en: "Over 61,000 kutcha houses at risk." }), ctx, r.advisories).advisories[0].issues.join(), /residents \(people\), not houses/);
});

test("fact check ignores dates, times and years", () => {
  const fc = AI.factCheck(adv({ message_en: `Landfall near Puri on 3 May 2019; next 24 hours critical. Winds up to ${wind} km/h.` }), ctx, r.advisories);
  assert.ok(fc.ok, JSON.stringify(fc.advisories[0].issues));
});

test("the saved Fani analysis: wind, rain and surge figures check out; the houses-for-people slip is caught", () => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/ai/fani-2019.json"), "utf8")).json;
  const fc = AI.factCheck(j, ctx, r.advisories);
  const issues = fc.advisories.flatMap((a) => a.issues).concat(fc.other);
  assert.ok(issues.length > 0 && issues.every((i) => /not houses/.test(i)), issues.join(" | "));
});
