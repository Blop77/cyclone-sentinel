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
