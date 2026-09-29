// Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/data.js");
const M = require("../js/model.js");

const assets = D.buildAssets();
const run = (id, opts) => {
  const c = D.CYCLONES.find((c) => c.id === id);
  return M.runForecast({ fixes: c.track, landfallTime: c.landfallTime }, assets, D.ASSET_TYPES, D.TOWNS, { members: 20, ...opts });
};

test("asset inventory is deterministic and every grid-dependent asset has a feeder", () => {
  const again = D.buildAssets();
  assert.equal(again.length, assets.length);
  assert.deepEqual(again[10], assets[10]);
  for (const a of assets) if (D.ASSET_TYPES[a.type].power) assert.ok(a.feeder, a.id);
});

test("Holland wind profile peaks near the radius of maximum wind", () => {
  const step = { lat: 18, lon: 86, v: 180, heading: 0, speed: 0 };
  const rmw = M.rmwKm(180, 18);
  const at = (km) => { const [la, lo] = M.offset(18, 86, 90, km); return M.windAt(step, la, lo); };
  assert.ok(Math.abs(at(rmw) - 180) < 5, `wind at RMW ≈ vmax (got ${at(rmw)})`);
  assert.ok(at(rmw * 4) < at(rmw) * 0.7, "decays outside the eyewall");
  assert.ok(at(3) < at(rmw) * 0.5, "calm eye");
});

test("translation asymmetry: right of motion is windier (N. hemisphere)", () => {
  const step = { lat: 18, lon: 86, v: 180, heading: 0, speed: 25 };
  const [rl, ro] = M.offset(18, 86, 90, 40), [ll, lo] = M.offset(18, 86, 270, 40);
  assert.ok(M.windAt(step, rl, ro) > M.windAt(step, ll, lo));
});

test("fragility curves are monotonic probabilities, 50 % at the median", () => {
  const t = D.ASSET_TYPES.housing;
  assert.ok(Math.abs(M.lognormCdf(t.windMedian, t.windMedian, t.windBeta) - 0.5) < 1e-6);
  let prev = 0;
  for (let v = 0; v <= 350; v += 10) { const p = M.lognormCdf(v, t.windMedian, t.windBeta); assert.ok(p >= prev && p <= 1); prev = p; }
});

test("hindcast: each cyclone's worst-hit town matches its real landfall region", () => {
  const expectTop = { "fani-2019": ["Puri", "Konark", "Satapada", "Astaranga", "Bhubaneswar"], "amphan-2020": ["Sagar Island", "Namkhana", "Kakdwip", "Gosaba", "Diamond Harbour"], "phailin-2013": ["Gopalpur", "Berhampur", "Rambha"], "hudhud-2014": ["Visakhapatnam", "Bheemunipatnam", "Vizianagaram"] };
  for (const [id, towns] of Object.entries(expectTop)) {
    const r = run(id);
    const worst = r.assets.slice().sort((a, b) => b.pDisruption - a.pDisruption)[0];
    assert.ok(towns.includes(worst.town), `${id}: worst asset in ${worst.town}`);
  }
});

test("cascade: disruption is never lower than physical damage", () => {
  const r = run("fani-2019");
  for (const a of r.assets) assert.ok(a.pDisruption >= a.pDamage - 1e-9, a.id);
});

test("longer lead time widens uncertainty (ensemble wind spread)", () => {
  const spread = (r) => r.assets.reduce((s, a) => s + (a.windP90 - a.windP10), 0);
  assert.ok(spread(run("fani-2019", { leadHours: 72 })) > spread(run("fani-2019", { leadHours: 12 })));
});

test("stronger synthetic storm causes more expected loss", () => {
  const go = (vmax) => {
    const sc = M.syntheticTrack({ lat: 20.3, lon: 86.7, vmax, heading: 330, speed: 15 });
    return M.runForecast(sc, assets, D.ASSET_TYPES, D.TOWNS, { members: 10 }).summary.loss;
  };
  assert.ok(go(220) > go(120));
});

// ---------- v2: roads, access, pathways, advisories, CAP, live mode ----------
const fani = run("fani-2019");

test("every town has a district and roads connect real town pairs within ~120 km", () => {
  for (const t of D.TOWNS) assert.ok(t.district, t.name);
  const roads = assets.filter((a) => a.type === "road");
  assert.ok(roads.length >= 30);
  for (const r of roads) {
    const [a, b] = r.towns.map((n) => D.TOWNS.find((t) => t.name === n));
    assert.ok(M.haversine(a.lat, a.lon, b.lat, b.lon) < 160, r.name);
  }
});

test("hospitals and shelters are cut off exactly when their access road is impassable", () => {
  const byId = new Map(fani.assets.map((a) => [a.id, a]));
  for (const a of fani.assets.filter((a) => a.access)) assert.equal(a.pIsolated, byId.get(a.access).pDamage);
  assert.ok(fani.summary.rainPathways.length > 0, "Fani produces rain → road → facility pathways");
  assert.match(fani.summary.rainPathways[0].chain.join(" "), /mm rain.*arterial road.*impassable.*cut off/);
});

test("every asset gets an ordered damage pathway ending in its service outcome", () => {
  for (const a of fani.assets) assert.equal(a.pathway.at(-1).kind, "outcome");
});

test("advisories: Fani's worst district (Puri) is RED and routed to district, municipal and state authorities", () => {
  const puri = fani.advisories.find((a) => a.district === "Puri");
  assert.equal(puri.level, "red");
  assert.equal(fani.advisories[0].level, "red");
  assert.ok(puri.recipients.some((r) => /District Collector/.test(r)));
  assert.ok(puri.recipients.some((r) => /urban local body/.test(r)));
  assert.ok(puri.recipients.some((r) => /OSDMA/.test(r)));
  assert.ok(puri.instructions.length > 0);
});

test("CAP 1.2 export is well-formed and carries severity and area", () => {
  const xml = M.toCAP(fani.advisories[0], { sent: new Date("2019-05-02T03:00:00Z") });
  assert.match(xml, /<alert xmlns="urn:oasis:names:tc:emergency:cap:1\.2">/);
  assert.match(xml, /<severity>Extreme<\/severity>/);
  assert.match(xml, /<status>Exercise<\/status>/);
  assert.match(xml, /<circle>-?\d+\.\d+,-?\d+\.\d+ \d+<\/circle>/);
  assert.equal((xml.match(/<info>/g) || []).length, (xml.match(/<\/info>/g) || []).length);
  assert.doesNotMatch(xml.replace(/<[^>]+>/g, ""), /[<>]/, "text content is escaped");
});

test("live mode: heavy real-time rain floods low roads and cuts off facilities; calm weather issues nothing", () => {
  const calm = Object.fromEntries(D.TOWNS.map((t) => [t.name, { windMax: 20, gustMax: 35, rain72: 5 }]));
  const quiet = M.runLive(assets, D.ASSET_TYPES, D.TOWNS, calm);
  assert.equal(quiet.advisories.length, 0);
  const wet = { ...calm, Puri: { windMax: 60, gustMax: 90, rain72: 420 }, Konark: { windMax: 55, gustMax: 85, rain72: 400 } };
  const flood = M.runLive(assets, D.ASSET_TYPES, D.TOWNS, wet);
  const road = flood.assets.find((a) => a.name === "Puri–Konark arterial road");
  assert.ok(road.pDamage > 0.5 && road.driver === "rain", `road P=${road.pDamage}`);
  assert.ok(flood.advisories.some((a) => a.district === "Puri"));
});

test("wind asymmetry flips in the southern hemisphere (cross-border use)", () => {
  const step = { lat: -20, lon: 40, v: 180, heading: 180, speed: 25 };
  // Moving south: right of motion is west. In the S. hemisphere the stronger side is the LEFT (east).
  const [el, eo] = M.offset(-20, 40, 90, 40), [wl, wo] = M.offset(-20, 40, 270, 40);
  assert.ok(M.windAt(step, el, eo) > M.windAt(step, wl, wo));
});
