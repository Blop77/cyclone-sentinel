/*
 * CycloneSentinel — impact model.
 *
 * Pipeline:  track → hourly interpolation → ensemble perturbation (forecast
 * uncertainty) → hazard at each asset (wind, storm surge, rainfall flood) →
 * fragility curves (damage probability) → power-dependency cascade (service
 * disruption) → impact summary and ranked response actions.
 *
 * Every model here is a documented parametric approximation chosen to run in
 * the browser in well under a second. See docs/METHODOLOGY.md.
 */
(function (root) {
  "use strict";

  const DEG = Math.PI / 180;
  const EARTH_KM = 6371;

  // IMD intensity classes (max sustained wind, km/h).
  const IMD_CLASSES = [
    { min: 222, code: "SuCS", label: "Super Cyclonic Storm" },
    { min: 166, code: "ESCS", label: "Extremely Severe Cyclonic Storm" },
    { min: 118, code: "VSCS", label: "Very Severe Cyclonic Storm" },
    { min: 89, code: "SCS", label: "Severe Cyclonic Storm" },
    { min: 62, code: "CS", label: "Cyclonic Storm" },
    { min: 0, code: "D", label: "Depression" },
  ];
  const imdClass = (v) => IMD_CLASSES.find((c) => v >= c.min);

  // ---------- geometry ----------
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * DEG, dLon = (lon2 - lon1) * DEG;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG);
    const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) - Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }
  function offset(lat, lon, bearingDeg, km) {
    const d = km / EARTH_KM, b = bearingDeg * DEG, p1 = lat * DEG, l1 = lon * DEG;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / DEG, l2 / DEG];
  }

  // ---------- statistics ----------
  function erf(x) { // Abramowitz & Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const lognormCdf = (x, median, beta) => (x <= 0 ? 0 : normCdf(Math.log(x / median) / beta));

  // ---------- tracks ----------
  /** Interpolate track fixes to hourly steps with heading, forward speed and land flag. */
  function interpolateTrack(fixes, landfallTime) {
    const pts = fixes.map(([t, lat, lon, v]) => ({ t: Date.parse(t), lat, lon, v }));
    const lf = Date.parse(landfallTime);
    const out = [];
    for (let t = pts[0].t; t <= pts[pts.length - 1].t; t += 3600e3) {
      let i = 0;
      while (i < pts.length - 2 && pts[i + 1].t < t) i++;
      const a = pts[i], b = pts[i + 1];
      const f = (t - a.t) / (b.t - a.t);
      out.push({ t, lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon), v: a.v + f * (b.v - a.v), overLand: t > lf });
    }
    for (let i = 0; i < out.length; i++) {
      const p = out[Math.max(0, i - 1)], n = out[Math.min(out.length - 1, i + 1)];
      out[i].heading = bearing(p.lat, p.lon, n.lat, n.lon);
      out[i].speed = haversine(p.lat, p.lon, n.lat, n.lon) / ((n.t - p.t) / 3600e3 || 1);
    }
    return out;
  }

  /**
   * Build a synthetic "what-if" track that makes landfall at (lat, lon) with the
   * given intensity, approaching on `heading` at `speed` km/h. Over-land decay
   * follows Kaplan & DeMaria (1995), adapted to the Bay of Bengal.
   */
  function syntheticTrack({ lat, lon, vmax, heading, speed, hoursBefore = 48, hoursAfter = 24 }) {
    const fixes = [];
    const t0 = Date.UTC(2026, 9, 1, 0);
    const landfall = t0 + hoursBefore * 3600e3;
    for (let h = -hoursBefore; h <= hoursAfter; h += 6) {
      const [la, lo] = offset(lat, lon, heading, speed * h);
      let v;
      if (h <= 0) v = vmax * (0.55 + 0.45 * Math.min(1, (h + hoursBefore) / (hoursBefore - 12)));
      else v = 48 + (vmax * 0.9 - 48) * Math.exp(-0.095 * h);
      fixes.push([new Date(landfall + h * 3600e3).toISOString(), la, lo, Math.round(v)]);
    }
    return { fixes, landfallTime: new Date(landfall).toISOString() };
  }

  /** Willoughby et al. (2006) radius of maximum wind, km. */
  const rmwKm = (vKmh, lat) => Math.max(12, Math.min(80, 46.4 * Math.exp(-0.0155 * (vKmh / 3.6) + 0.0169 * Math.abs(lat))));

  /**
   * Monte-Carlo ensemble: members are the reference track with smooth cross- and
   * along-track displacement growing with lead time (σ ≈ 45 km at 24 h, in line with
   * recent IMD landfall-point errors) and a ±12 % intensity error.
   */
  function buildEnsemble(steps, { members = 40, originIndex = 0, seed = 7 } = {}) {
    const rand = (root.CIF_DATA || require("./data.js")).mulberry32(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const ensemble = [steps];
    for (let m = 1; m < members; m++) {
      const ex = gauss(), ea = gauss() * 0.6, ev = Math.max(0.7, Math.min(1.3, 1 + 0.12 * gauss()));
      ensemble.push(steps.map((s, i) => {
        const lead = Math.max(0, i - originIndex);
        const sigma = 45 * Math.pow(lead / 24, 0.9);
        let [lat, lon] = offset(s.lat, s.lon, s.heading + 90, ex * sigma);
        [lat, lon] = offset(lat, lon, s.heading, ea * sigma);
        return { ...s, lat, lon, v: lead > 0 ? s.v * (1 + (ev - 1) * Math.min(1, lead / 24)) : s.v };
      }));
    }
    return ensemble;
  }

  // ---------- hazards ----------
  /**
   * Surface wind (km/h) at distance r from centre: Holland (1980) profile,
   * translation asymmetry (stronger right of motion in the N. hemisphere),
   * and a surface-roughness reduction that grows inland.
   */
  function windAt(step, lat, lon, coastKm = 0) {
    const r = Math.max(1, haversine(step.lat, step.lon, lat, lon));
    const rmw = rmwKm(step.v, step.lat);
    const vt = Math.min(step.speed || 0, 40);
    const vSym = Math.max(0, step.v - 0.5 * vt);
    const B = Math.max(1.1, Math.min(2.2, 1 + step.v / 3.6 / 60));
    const x = Math.pow(rmw / r, B);
    const theta = (bearing(step.lat, step.lon, lat, lon) - (step.heading + 90)) * DEG;
    const asym = 0.5 * vt * Math.cos(theta) * Math.min(1, r / rmw);
    const rough = 1 - 0.15 * Math.min(1, coastKm / 30);
    return Math.max(0, (vSym * Math.sqrt(x * Math.exp(1 - x)) + asym) * rough);
  }

  /** Peak coastal surge (m) generated by a step: shallow head-of-bay shelf amplifies surge. */
  function surgeAtCoast(step, lat, lon) {
    if (step.overLand && !step.justLanded) return 0;
    const r = haversine(step.lat, step.lon, lat, lon);
    const rmw = rmwKm(step.v, step.lat);
    const shelf = 0.65 + 0.95 * Math.max(0, Math.min(1, (lat - 20.5) / 1.5));
    const s0 = shelf * (step.v / 100) ** 2;
    const theta = (bearing(step.lat, step.lon, lat, lon) - (step.heading + 90)) * DEG;
    const side = 0.7 + 0.3 * Math.cos(theta);
    return s0 * side * Math.exp(-r / (2.5 * rmw + 25));
  }

  /** Rain rate (mm/h) — R-CLIPER-like radial profile. */
  function rainRate(step, lat, lon) {
    const r = haversine(step.lat, step.lon, lat, lon);
    if (r > 500) return 0;
    const rmw = rmwKm(step.v, step.lat);
    return (6 + step.v / 22) * Math.exp(-Math.max(0, r - rmw) / 140);
  }

  function hazardForTrack(steps, asset) {
    let wind = 0, surge = 0, rain = 0, galeHours = 0, peakIdx = -1;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (Math.abs(s.lat - asset.lat) > 5 || Math.abs(s.lon - asset.lon) > 5.5) continue; // > ~500 km: no effect
      const w = windAt(s, asset.lat, asset.lon, asset.coastKm);
      if (w > wind) { wind = w; peakIdx = i; }
      if (w >= 62) galeHours++;
      const sg = surgeAtCoast(s, asset.lat, asset.lon);
      if (sg > surge) surge = sg;
      rain += rainRate(s, asset.lat, asset.lon);
    }
    const surgeDepth = Math.max(0, surge * Math.exp(-asset.coastKm / 8) + 0.5 - asset.elev);
    const rainDepth = Math.max(0, (rain - 180) / 450) * (asset.elev < 10 ? 1 : 0.35);
    return { wind, surge: surgeDepth, rain, flood: surgeDepth + rainDepth, galeHours, peakIdx };
  }

  function damageProb(type, hz) {
    const pw = lognormCdf(hz.wind, type.windMedian, type.windBeta);
    const pf = lognormCdf(hz.flood, type.floodMedian, type.floodBeta);
    return 1 - (1 - pw) * (1 - pf);
  }

  // ---------- full forecast ----------
  function markLandfall(steps) {
    let seen = false;
    for (const s of steps) {
      s.justLanded = false;
      if (s.overLand && !seen) { seen = true; s.justLanded = true; }
    }
    // allow surge from the first 3 h after landfall
    const i = steps.findIndex((s) => s.justLanded);
    for (let k = i; k >= 0 && k < Math.min(steps.length, i + 3); k++) steps[k].justLanded = true;
    return steps;
  }

  /**
   * Run the full forecast.
   * @param scenario {fixes, landfallTime}
   * @param assets   inventory from CIF_DATA.buildAssets()
   * @param types    CIF_DATA.ASSET_TYPES
   * @param opts     {members, leadHours}
   */
  function runForecast(scenario, assets, types, towns, { members = 40, leadHours = 24, seed = 7 } = {}) {
    const steps = markLandfall(interpolateTrack(scenario.fixes, scenario.landfallTime));
    const lfIdx = Math.max(0, steps.findIndex((s) => s.overLand));
    const originIndex = Math.max(0, lfIdx - leadHours);
    const ensemble = buildEnsemble(steps, { members, originIndex, seed });
    ensemble.forEach(markLandfall);

    const byId = new Map(assets.map((a) => [a.id, a]));
    const results = assets.map((a) => {
      const type = types[a.type];
      let pSum = 0, pSevere = 0;
      const winds = [];
      for (const member of ensemble) {
        const hz = hazardForTrack(member, a);
        pSum += damageProb(type, hz);
        if (hz.wind >= 118) pSevere++;
        winds.push(hz.wind);
      }
      winds.sort((x, y) => x - y);
      const ref = hazardForTrack(steps, a);
      return {
        ...a,
        hazard: ref,
        windP10: winds[Math.floor(0.1 * (winds.length - 1))],
        windP90: winds[Math.floor(0.9 * (winds.length - 1))],
        pDamage: pSum / ensemble.length,
        pSevereWind: pSevere / ensemble.length,
      };
    });

    // Power cascade: substation supply fails if the substation or its line fails.
    const res = new Map(results.map((r) => [r.id, r]));
    for (const r of results) {
      if (r.type === "substation") {
        const line = res.get(r.line);
        r.pSupplyLoss = 1 - (1 - r.pDamage) * (1 - 0.6 * (line ? line.pDamage : 0));
      }
    }
    for (const r of results) {
      const type = types[r.type];
      if (type.power) {
        const feeder = res.get(r.feeder);
        r.pGridLoss = feeder ? feeder.pSupplyLoss : 0;
        r.pDisruption = 1 - (1 - r.pDamage) * (1 - r.pGridLoss * (1 - type.backup));
      } else {
        r.pDisruption = r.type === "substation" ? r.pSupplyLoss : r.pDamage;
      }
      r.tier = riskTier(r.pDisruption);
    }

    return { steps, ensemble, originIndex, landfallIndex: lfIdx, assets: results, summary: summarise(results, types, towns, ensemble), actions: recommend(results, types, byId, res) };
  }

  function riskTier(p) {
    if (p >= 0.6) return "critical";
    if (p >= 0.35) return "serious";
    if (p >= 0.15) return "warning";
    return "good";
  }

  function summarise(results, types, towns, ensemble) {
    const byType = {};
    for (const key of Object.keys(types)) byType[key] = { count: 0, expectedDamaged: 0, expectedDisrupted: 0 };
    let loss = 0;
    for (const r of results) {
      const t = byType[r.type];
      t.count++;
      t.expectedDamaged += r.pDamage;
      t.expectedDisrupted += r.pDisruption;
      loss += types[r.type].value * r.pDamage * 0.55; // mean damage ratio given damage
    }
    // Population exposed to ≥118 km/h (VSCS-force) winds, ensemble-averaged at town centres.
    let popSevere = 0, popPowerLoss = 0;
    for (const town of towns) {
      let hits = 0;
      for (const member of ensemble) if (hazardForTrack(member, { ...town }).wind >= 118) hits++;
      popSevere += (town.pop * hits) / ensemble.length;
      const subs = results.filter((r) => r.type === "substation" && r.town === town.name);
      if (subs.length) popPowerLoss += town.pop * (subs.reduce((s, r) => s + r.pSupplyLoss, 0) / subs.length);
    }
    const hospitalsAtRisk = results.filter((r) => r.type === "hospital" && r.pDisruption >= 0.35).length;
    const peopleToEvacuate = results.filter((r) => r.type === "housing").reduce((s, r) => s + r.people * r.pDamage, 0);
    const tiers = { critical: 0, serious: 0, warning: 0, good: 0 };
    for (const r of results) tiers[r.tier]++;
    return { byType, loss, popSevere, popPowerLoss, hospitalsAtRisk, peopleToEvacuate, tiers, total: results.length };
  }

  /**
   * Rule-based response actions. Assets over the threshold are grouped by
   * (town, type) so each line is one operational decision; the group links to
   * its worst asset on the map.
   */
  function recommend(results, types, byId, res) {
    const groups = new Map();
    for (const r of results) {
      const threshold = r.type === "shelter" ? 0.15 : 0.35;
      if (r.pDisruption < threshold) continue;
      const key = r.town + "|" + r.type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const shelters = results.filter((r) => r.type === "shelter" && r.pDisruption < 0.35);
    const safeShelters = (town, lat, lon) => shelters
      .map((s) => ({ s, km: haversine(lat, lon, s.lat, s.lon) }))
      .filter((x) => x.km < 40).sort((a, b) => a.km - b.km).slice(0, 3);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    const acts = [];
    for (const list of groups.values()) {
      list.sort((a, b) => b.pDisruption - a.pDisruption);
      const worst = list[0], n = list.length, town = worst.town;
      const people = list.reduce((s, r) => s + r.people * (r.type === "housing" ? r.pDamage : 1), 0);
      let kind, text;
      switch (worst.type) {
        case "housing": {
          const dest = safeShelters(town, worst.lat, worst.lon);
          kind = "Evacuate";
          text = `Evacuate ~${Math.round(people / 100) * 100 > 0 ? (Math.round(people / 100) * 100).toLocaleString("en-IN") : Math.round(people)} residents of low-lying ${town} (${plural(n, "settlement", "settlements")})` +
            (dest.length ? ` to ${dest.map((d) => d.s.name.replace(" Cyclone shelter", " shelter")).join(", ")}` : " to inland shelters — no safe shelter within 40 km");
          break;
        }
        case "hospital": {
          const structural = list.filter((r) => r.pDamage >= 0.35);
          kind = "Protect";
          text = structural.length
            ? `Shift critical patients out of ${structural.map((r) => r.name).join(", ")} — building at risk`
            : `Pre-position DG sets + 72 h fuel at ${plural(n, "hospital", "hospitals")} in ${town} — grid feeder likely to trip`;
          break;
        }
        case "substation": kind = "Restore"; text = `Stage restoration crews & mobile transformers for ${plural(n, "substation", "substations")} in ${town}`; break;
        case "transmission": kind = "Restore"; text = `Pre-stage tower-repair gangs for ${plural(n, "line span", "line spans")} near ${town}`; break;
        case "telecom": kind = "Connect"; text = `Deploy cell-on-wheels & satellite phones in ${town} (${plural(n, "tower", "towers")} at risk)`; break;
        case "water": kind = "Supply"; text = `Stockpile drinking water & chlorine for ${town}; treatment plant may stop`; break;
        case "bridge": kind = "Access"; text = `Pre-position road-clearing equipment at ${plural(n, "bridge", "bridges")} around ${town}`; break;
        case "port": kind = "Secure"; text = `Suspend operations and secure vessels at ${worst.name}`; break;
        case "shelter": kind = "Redirect"; text = `${worst.name} is itself exposed — open an inland overflow shelter`; break;
      }
      const reach = people || 5000 * n;
      acts.push({ id: worst.id, kind, text, p: Math.round(worst.pDisruption * 100), tier: worst.tier, town, score: worst.pDisruption * types[worst.type].weight * Math.log10(10 + reach) });
    }
    acts.sort((a, b) => b.score - a.score);
    return acts.slice(0, 14);
  }

  /** Deterministic max-wind swath on a lat/lon grid (for the map). */
  function windSwath(steps, bounds = { s: 14.5, n: 25.5, w: 80, e: 92.5 }, res = 0.15) {
    const cells = [];
    for (let lat = bounds.s; lat < bounds.n; lat += res) {
      for (let lon = bounds.w; lon < bounds.e; lon += res) {
        const c = { lat: lat + res / 2, lon: lon + res / 2 };
        let w = 0;
        for (const s of steps) {
          if (Math.abs(s.lat - c.lat) > 3.5 || Math.abs(s.lon - c.lon) > 3.5) continue;
          const v = windAt(s, c.lat, c.lon, 0);
          if (v > w) w = v;
        }
        if (w >= 62) cells.push({ lat, lon, res, wind: w });
      }
    }
    return cells;
  }

  /** Radius (km) at which the step's symmetric wind drops below `threshold`. */
  function windRadius(step, threshold) {
    if (step.v < threshold) return 0;
    const rmw = rmwKm(step.v, step.lat);
    let r = rmw;
    while (r < 600) {
      const [la, lo] = offset(step.lat, step.lon, 0, r);
      if (windAt({ ...step, speed: 0 }, la, lo, 0) < threshold) break;
      r += 5;
    }
    return r;
  }

  const API = {
    IMD_CLASSES, imdClass, haversine, bearing, offset, normCdf, lognormCdf,
    interpolateTrack, syntheticTrack, rmwKm, buildEnsemble, windAt, surgeAtCoast, rainRate,
    hazardForTrack, damageProb, runForecast, riskTier, windSwath, windRadius,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CIF_MODEL = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
