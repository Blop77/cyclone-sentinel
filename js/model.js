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
    const theta = (bearing(step.lat, step.lon, lat, lon) - (step.heading + (step.lat >= 0 ? 90 : -90))) * DEG;
    const asym = 0.5 * vt * Math.cos(theta) * Math.min(1, r / rmw);
    const rough = 1 - 0.15 * Math.min(1, coastKm / 30);
    return Math.max(0, (vSym * Math.sqrt(x * Math.exp(1 - x)) + asym) * rough);
  }

  /** Peak coastal surge (m) generated by a step: shallow head-of-bay shelf amplifies surge. */
  function surgeAtCoast(step, lat, lon) {
    if (step.overLand && !step.justLanded) return 0;
    const r = haversine(step.lat, step.lon, lat, lon);
    const rmw = rmwKm(step.v, step.lat);
    const shelf = step.shelf ? step.shelf(lat, lon) : 0.65 + 0.95 * Math.max(0, Math.min(1, (lat - 20.5) / 1.5));
    const s0 = shelf * (step.v / 100) ** 2;
    const theta = (bearing(step.lat, step.lon, lat, lon) - (step.heading + (step.lat >= 0 ? 90 : -90))) * DEG;
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
    return { wind, surge: surgeDepth, rain, rainDepth, flood: surgeDepth + rainDepth, galeHours, peakIdx };
  }

  function damageParts(type, hz) {
    const pw = lognormCdf(hz.wind, type.windMedian, type.windBeta);
    const pf = lognormCdf(hz.flood, type.floodMedian, type.floodBeta);
    return { pw, pf, p: 1 - (1 - pw) * (1 - pf) };
  }
  const damageProb = (type, hz) => damageParts(type, hz).p;

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

    const results = assets.map((a) => {
      const type = types[a.type];
      let pSum = 0, pwSum = 0, pfSum = 0, pSevere = 0;
      const winds = [];
      for (const member of ensemble) {
        const hz = hazardForTrack(member, a);
        const d = damageParts(type, hz);
        pSum += d.p; pwSum += d.pw; pfSum += d.pf;
        if (hz.wind >= 118) pSevere++;
        winds.push(hz.wind);
      }
      winds.sort((x, y) => x - y);
      const n = ensemble.length;
      return {
        ...a,
        hazard: hazardForTrack(steps, a),
        windP10: winds[Math.floor(0.1 * (n - 1))],
        windP90: winds[Math.floor(0.9 * (n - 1))],
        pDamage: pSum / n, pWind: pwSum / n, pFlood: pfSum / n,
        pSevereWind: pSevere / n,
      };
    });

    const townSevere = (town) => {
      let hits = 0;
      for (const member of ensemble) if (hazardForTrack(member, { ...town }).wind >= 118) hits++;
      return hits / ensemble.length;
    };
    const onset = new Date(steps[lfIdx].t).toISOString();
    return {
      mode: "cyclone", steps, ensemble, originIndex, landfallIndex: lfIdx,
      ...consequences(results, types, towns, townSevere, { onset, title: scenario.title || "Cyclone" }),
    };
  }

  /**
   * Real-time assessment from a gridded weather forecast (e.g. Open-Meteo): each
   * asset takes its town's forecast maximum sustained wind and 72 h rainfall.
   * weather: { [townName]: { windMax, gustMax, rain72, galeHours } }
   */
  function runLive(assets, types, towns, weather, { issued = new Date().toISOString() } = {}) {
    const wxFor = (a) => {
      const names = a.towns || [a.town];
      const ws = names.map((n) => weather[n]).filter(Boolean);
      return ws.length ? { windMax: Math.max(...ws.map((w) => w.windMax)), rain72: Math.max(...ws.map((w) => w.rain72)), galeHours: Math.max(...ws.map((w) => w.galeHours || 0)) } : { windMax: 0, rain72: 0, galeHours: 0 };
    };
    const results = assets.map((a) => {
      const w = wxFor(a);
      const wind = w.windMax * (1 - 0.15 * Math.min(1, a.coastKm / 30));
      const rainDepth = Math.max(0, (w.rain72 - 180) / 450) * (a.elev < 10 ? 1 : 0.35);
      const hazard = { wind, surge: 0, rain: w.rain72, rainDepth, flood: rainDepth, galeHours: w.galeHours, peakIdx: -1 };
      const d = damageParts(types[a.type], hazard);
      return { ...a, hazard, windP10: wind, windP90: wind, pDamage: d.p, pWind: d.pw, pFlood: d.pf, pSevereWind: wind >= 118 ? 1 : 0 };
    });
    const townSevere = (town) => ((weather[town.name] || {}).windMax >= 118 ? 1 : 0);
    return { mode: "live", ...consequences(results, types, towns, townSevere, { onset: issued, title: "Live 72 h outlook" }) };
  }

  /** Shared consequence chain: power cascade → access loss → pathways → summary, actions, advisories. */
  function consequences(results, types, towns, townSevere, meta) {
    const res = new Map(results.map((r) => [r.id, r]));
    // Power cascade: substation supply fails if the substation or its line fails.
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
      // Access loss: the facility is cut off if its arterial road is impassable.
      if (r.access) r.pIsolated = (res.get(r.access) || { pDamage: 0 }).pDamage;
      r.driver = r.pDamage < 0.05 ? "none" : r.pFlood > r.pWind ? (r.hazard.surge > r.hazard.rainDepth ? "surge" : "rain") : "wind";
      r.tier = riskTier(r.pDisruption);
    }
    for (const r of results) r.pathway = pathwayFor(r, types, res);
    const summary = summarise(results, types, towns, townSevere);
    summary.rainPathways = rainPathways(results, res);
    const actions = recommend(results, types, res);
    return { assets: results, summary, actions, advisories: buildAdvisories(results, towns, actions, meta) };
  }

  function riskTier(p) {
    if (p >= 0.6) return "critical";
    if (p >= 0.35) return "serious";
    if (p >= 0.15) return "warning";
    return "good";
  }

  function summarise(results, types, towns, townSevere) {
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
      popSevere += town.pop * townSevere(town);
      const subs = results.filter((r) => r.type === "substation" && r.town === town.name);
      if (subs.length) popPowerLoss += town.pop * (subs.reduce((s, r) => s + r.pSupplyLoss, 0) / subs.length);
    }
    const hospitalsAtRisk = results.filter((r) => r.type === "hospital" && r.pDisruption >= 0.35).length;
    const peopleToEvacuate = results.filter((r) => r.type === "housing").reduce((s, r) => s + r.people * r.pDamage, 0);
    const tiers = { critical: 0, serious: 0, warning: 0, good: 0 };
    for (const r of results) tiers[r.tier]++;
    const roadsCut = results.filter((r) => r.type === "road" && r.pDamage >= 0.35).length;
    const facilitiesCutOff = results.filter((r) => (r.type === "hospital" || r.type === "shelter") && r.pIsolated >= 0.35).length;
    return { byType, loss, popSevere, popPowerLoss, hospitalsAtRisk, peopleToEvacuate, roadsCut, facilitiesCutOff, tiers, total: results.length };
  }

  /**
   * Rule-based response actions. Assets over the threshold are grouped by
   * (town, type) so each line is one operational decision; the group links to
   * its worst asset on the map.
   */
  function recommend(results, types, res) {
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
        case "road": kind = "Access"; text = `Pre-position pumps & tree-clearing teams on ${list.map((r) => r.name).join(", ")}; plan alternate relief routes`; break;
      }
      const reach = people || 5000 * n;
      acts.push({ id: worst.id, kind, text, p: Math.round(worst.pDisruption * 100), tier: worst.tier, town, score: worst.pDisruption * types[worst.type].weight * Math.log10(10 + reach) });
    }
    // Facilities that stay standing but are cut off when their access road floods.
    const cut = new Map();
    for (const r of results) {
      if (!(r.type === "hospital" || r.type === "shelter") || !(r.pIsolated >= 0.35)) continue;
      if (!cut.has(r.town)) cut.set(r.town, []);
      cut.get(r.town).push(r);
    }
    for (const [town, list] of cut) {
      const worst = list.sort((a, b) => b.pIsolated - a.pIsolated)[0];
      const road = res.get(worst.access);
      acts.push({
        id: worst.id, kind: "Stock", p: Math.round(worst.pIsolated * 100), tier: riskTier(worst.pIsolated), town,
        text: `Pre-stock ${list.length === 1 ? worst.name : list.length + " hospitals/shelters in " + town} for 72 h of isolation — ${road ? road.name : "access road"} likely to flood`,
        score: worst.pIsolated * 1.5 * Math.log10(10 + list.reduce((s, r) => s + (r.people || 1500), 0)),
      });
    }
    acts.sort((a, b) => b.score - a.score);
    return acts;
  }

  // ---------- rainfall damage pathways ----------
  const pct = (p) => Math.round(p * 100) + " %";

  /** Ordered causal chain for one asset: hazards → physical damage → dependencies → service outcome. */
  function pathwayFor(r, types, res) {
    const h = r.hazard, steps = [];
    if (h.rain >= 50) steps.push({ kind: "rain", text: `${Math.round(h.rain)} mm storm rainfall` });
    if (h.rainDepth >= 0.05) steps.push({ kind: "rain", text: `${h.rainDepth.toFixed(2)} m surface ponding (site at ${r.elev} m)` });
    if (h.surge >= 0.05) steps.push({ kind: "surge", text: `${h.surge.toFixed(2)} m storm-surge inundation` });
    if (h.wind >= 62) steps.push({ kind: "wind", text: `${Math.round(h.wind)} km/h peak wind` });
    if (r.pDamage >= 0.05) steps.push({ kind: "damage", text: `${r.type === "road" ? "Road impassable" : "Physical damage"}: ${pct(r.pDamage)} (${r.driver}-driven)` });
    if (r.pGridLoss >= 0.05) steps.push({ kind: "power", text: `Grid feed ${res.get(r.feeder).name} lost: ${pct(r.pGridLoss)}` });
    if (r.pIsolated >= 0.05) steps.push({ kind: "access", text: `Access via ${res.get(r.access).name} cut: ${pct(r.pIsolated)}` });
    steps.push({ kind: "outcome", text: `Service disruption: ${pct(r.pDisruption)}${r.pIsolated >= 0.05 ? ` · cut off: ${pct(r.pIsolated)}` : ""}` });
    return steps;
  }

  /** Rain/surge → flooded arterial road → hospital or shelter cut off. */
  function rainPathways(results, res) {
    return results
      .filter((r) => (r.type === "hospital" || r.type === "shelter") && r.pIsolated >= 0.25)
      .map((r) => {
        const road = res.get(r.access);
        return {
          id: r.id, facility: r.name, road: road.name, p: r.pIsolated, driver: road.driver,
          chain: [
            `${Math.round(road.hazard.rain)} mm rain` + (road.hazard.surge >= 0.05 ? ` + ${road.hazard.surge.toFixed(1)} m surge` : ""),
            `${road.hazard.flood.toFixed(2)} m water on ${road.name}`,
            `road impassable (${pct(road.pDamage)})`,
            `${r.name} cut off`,
          ],
        };
      })
      .sort((a, b) => b.p - a.p)
      .slice(0, 8);
  }

  // ---------- early-warning advisories ----------
  // IMD colour-coded impact warnings: Red = take action, Orange = be prepared, Yellow = be updated.
  const LEVELS = [
    { key: "red", min: 0.6, label: "RED", verb: "Take action", cap: "Extreme" },
    { key: "orange", min: 0.35, label: "ORANGE", verb: "Be prepared", cap: "Severe" },
    { key: "yellow", min: 0.15, label: "YELLOW", verb: "Be updated", cap: "Moderate" },
  ];

  function buildAdvisories(results, towns, actions, meta) {
    const Dm = root.CIF_DATA || require("./data.js");
    const byDistrict = new Map();
    for (const r of results) {
      if (!byDistrict.has(r.district)) byDistrict.set(r.district, []);
      byDistrict.get(r.district).push(r);
    }
    const out = [];
    for (const [district, list] of byDistrict) {
      const maxP = Math.max(...list.map((r) => Math.max(r.pDisruption, r.pIsolated || 0)));
      const level = LEVELS.find((l) => maxP >= l.min);
      if (!level) continue;
      const count = (f) => list.filter(f).length;
      const dTowns = towns.filter((t) => t.district === district);
      const hot = [...new Set(list.filter((r) => r.pDisruption >= 0.15 || r.pIsolated >= 0.15).map((r) => r.town))];
      const stats = {
        people: Math.round(list.filter((r) => r.type === "housing").reduce((s, r) => s + r.people * r.pDamage, 0)),
        hospitals: count((r) => r.type === "hospital" && r.pDisruption >= 0.35),
        cutOff: count((r) => (r.type === "hospital" || r.type === "shelter") && r.pIsolated >= 0.35),
        substations: count((r) => r.type === "substation" && r.pSupplyLoss >= 0.35),
        roads: count((r) => r.type === "road" && r.pDamage >= 0.35),
        telecom: count((r) => r.type === "telecom" && r.pDisruption >= 0.35),
        wind: Math.round(Math.max(...list.map((r) => r.hazard.wind))),
        surge: +Math.max(...list.map((r) => r.hazard.surge)).toFixed(1),
        rain: Math.round(Math.max(...list.map((r) => r.hazard.rain))),
      };
      const state = dTowns[0].state;
      const recipients = [
        `District Collector & District Disaster Management Authority, ${district}`,
        ...hot.map((t) => `${t} urban local body (municipal emergency cell)`),
        (Dm.STATE_AUTHORITY || {})[state] || `${state} disaster management authority`,
      ];
      if (stats.substations) recipients.push(`${state} power distribution (DISCOM) control room`);
      if (stats.hospitals || stats.cutOff) recipients.push(`District Health Officer, ${district}`);
      const hazards = [
        stats.wind >= 62 && `winds up to ${stats.wind} km/h`,
        stats.surge >= 0.3 && `storm surge up to ${stats.surge} m above ground`,
        stats.rain >= 100 && `${stats.rain} mm rainfall`,
      ].filter(Boolean);
      const impacts = [
        stats.people >= 100 && `~${stats.people.toLocaleString("en-IN")} residents in kutcha housing at risk`,
        stats.substations && `${stats.substations} substation(s) likely to lose supply`,
        stats.hospitals && `${stats.hospitals} hospital(s) at serious disruption risk`,
        stats.cutOff && `${stats.cutOff} hospital(s)/shelter(s) may be cut off by flooded roads`,
        stats.roads && `${stats.roads} arterial road(s) likely impassable`,
        stats.telecom && `${stats.telecom} telecom tower(s) likely down`,
      ].filter(Boolean);
      const instructions = actions.filter((a) => dTowns.some((t) => t.name === a.town)).slice(0, 6).map((a) => a.text);
      const lat = dTowns.reduce((s, t) => s + t.lat, 0) / dTowns.length;
      const lon = dTowns.reduce((s, t) => s + t.lon, 0) / dTowns.length;
      out.push({
        id: `${district.replace(/\s+/g, "-").toLowerCase()}-${level.key}`,
        district, state, level: level.key, levelLabel: level.label, severity: level.cap, maxP,
        headline: `${level.label} — ${level.verb}: ${meta.title} impact on ${district} district`,
        description: `Expected ${hazards.join(", ") || "adverse weather"}. ${impacts.join("; ") || "Localised impacts possible"}.`,
        instructions, recipients, towns: hot.length ? hot : dTowns.map((t) => t.name),
        area: { lat, lon, radiusKm: Math.max(25, ...dTowns.map((t) => haversine(lat, lon, t.lat, t.lon) + 15)) },
        onset: meta.onset, stats,
      });
    }
    const rank = { red: 0, orange: 1, yellow: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level] || b.maxP - a.maxP);
  }

  const xml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** OASIS Common Alerting Protocol 1.2 — the format used by India's SACHET alert platform. */
  function toCAP(adv, { status = "Exercise", sender = "cyclonesentinel@blop77.github.io", sent = new Date() } = {}) {
    const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const expires = new Date(Math.max(new Date(adv.onset).getTime(), sent.getTime()) + 48 * 3600e3);
    return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>CS-${xml(adv.id)}-${sent.getTime()}</identifier>
  <sender>${xml(sender)}</sender>
  <sent>${iso(sent)}</sent>
  <status>${xml(status)}</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en-IN</language>
    <category>Met</category>
    <category>Infra</category>
    <event>Cyclone impact advisory</event>
    <responseType>${adv.level === "red" ? "Evacuate" : "Prepare"}</responseType>
    <urgency>Expected</urgency>
    <severity>${adv.severity}</severity>
    <certainty>${adv.maxP >= 0.6 ? "Likely" : "Possible"}</certainty>
    <onset>${iso(adv.onset)}</onset>
    <expires>${iso(expires)}</expires>
    <senderName>CycloneSentinel impact forecast</senderName>
    <headline>${xml(adv.headline)}</headline>
    <description>${xml(adv.description)}</description>
    <instruction>${xml(adv.instructions.join(" "))}</instruction>
    <parameter><valueName>AlertLevel</valueName><value>${adv.levelLabel}</value></parameter>
    <area>
      <areaDesc>${xml(adv.district + " district, " + adv.state + " (" + adv.towns.join(", ") + ")")}</areaDesc>
      <circle>${adv.area.lat.toFixed(4)},${adv.area.lon.toFixed(4)} ${adv.area.radiusKm.toFixed(0)}</circle>
    </area>
  </info>
</alert>`;
  }

  /** Plain-text advisory for SMS / WhatsApp / email bodies. */
  function advisoryText(adv) {
    return `${adv.headline}\n\n${adv.description}\n\nActions:\n${adv.instructions.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nTo: ${adv.recipients.join("; ")}\n— CycloneSentinel (model forecast; verify against IMD bulletins)`;

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
    hazardForTrack, damageProb, damageParts, runForecast, runLive, riskTier, windSwath, windRadius,
    buildAdvisories, toCAP, advisoryText, LEVELS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CIF_MODEL = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
