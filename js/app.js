/* CycloneSentinel — UI */
(function () {
  "use strict";

  const { CYCLONES, TOWNS, ASSET_TYPES, buildAssets } = window.CIF_DATA;
  const M = window.CIF_MODEL;
  const $ = (id) => document.getElementById(id);

  const TIERS = [
    { key: "critical", label: "Critical  (≥ 60 %)", color: "#d03b3b" },
    { key: "serious", label: "Serious  (35–60 %)", color: "#ec835a" },
    { key: "warning", label: "Elevated  (15–35 %)", color: "#fab219" },
    { key: "good", label: "Low  (< 15 %)", color: "#0ca30c" },
  ];
  const TIER = Object.fromEntries(TIERS.map((t) => [t.key, t]));
  const WIND_BINS = [
    { min: 222, code: "SuCS", label: "≥ 222 km/h · Super cyclonic", color: "#cde2fb" },
    { min: 166, code: "ESCS", label: "166–221 · Extremely severe", color: "#86b6ef" },
    { min: 118, code: "VSCS", label: "118–165 · Very severe", color: "#3987e5" },
    { min: 89, code: "SCS", label: "89–117 · Severe", color: "#256abf" },
    { min: 62, code: "CS", label: "62–88 · Cyclonic storm", color: "#184f95" },
  ];
  const binFor = (w) => WIND_BINS.find((b) => w >= b.min);

  const OBSERVED = {
    "fani-2019": "About 1.2 million people were evacuated in Odisha ahead of landfall. Puri's power-distribution network was largely destroyed and Puri, Bhubaneswar and Cuttack saw prolonged outages. The model flags the same Puri–Konark–Bhubaneswar grid corridor.",
    "amphan-2020": "Landfall near the Sundarbans. Around 5 lakh people were evacuated in West Bengal, and South 24 Parganas and Kolkata suffered extensive power, telecom and tree-fall damage. The model concentrates risk on Sagar Island, Namkhana and Kakdwip.",
    "phailin-2013": "Around 1 million people were evacuated across Odisha and Andhra Pradesh — one of India's largest pre-emptive evacuations — keeping fatalities low despite heavy damage around Gopalpur and Berhampur (Ganjam district).",
    "hudhud-2014": "Direct hit on Visakhapatnam. The city's power and telecom networks collapsed for days, and the Andhra Pradesh government estimated losses of about ₹21,900 crore. The model ranks Visakhapatnam and Bheemunipatnam highest.",
  };

  const assets = buildAssets();
  const state = { result: null, swath: [], enabledTypes: new Set(Object.keys(ASSET_TYPES)), revealAll: true, idx: 0, playing: null, scenarioId: null };

  // ---------------- map ----------------
  const map = L.map("map", { zoomControl: true, preferCanvas: true, minZoom: 4 }).setView([19.6, 86.2], 6);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxZoom: 16,
  }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const layers = {
    swath: L.layerGroup().addTo(map),
    ens: L.layerGroup().addTo(map),
    track: L.layerGroup().addTo(map),
    assets: L.layerGroup().addTo(map),
    storm: L.layerGroup().addTo(map),
  };
  const LABEL_TOWNS = ["Visakhapatnam", "Kakinada", "Gopalpur", "Puri", "Bhubaneswar", "Paradip", "Balasore", "Digha", "Sagar Island", "Kolkata", "Haldia"];
  for (const t of TOWNS.filter((t) => LABEL_TOWNS.includes(t.name))) {
    L.tooltip({ permanent: true, direction: "right", className: "town-label", offset: [6, 0] }).setLatLng([t.lat, t.lon]).setContent(t.name).addTo(map);
  }

  // ---------------- controls ----------------
  const scenarioSel = $("scenario");
  for (const c of CYCLONES) scenarioSel.add(new Option(c.name, c.id));
  scenarioSel.add(new Option("Custom “what-if” storm…", "custom"));

  const townSel = $("c-town");
  for (const t of TOWNS.filter((t) => t.coastKm <= 3)) townSel.add(new Option(`${t.name}, ${t.state}`, t.name));
  townSel.value = "Paradip";

  const compass = (deg) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  function syncOutputs() {
    const v = +$("c-vmax").value;
    $("c-vmax-out").textContent = `${v} km/h · ${M.imdClass(v).code}`;
    const h = +$("c-heading").value % 360;
    $("c-heading-out").textContent = `${h}° (towards ${compass(h)})`;
    $("c-speed-out").textContent = `${$("c-speed").value} km/h`;
  }
  ["c-vmax", "c-heading", "c-speed"].forEach((id) => $(id).addEventListener("input", syncOutputs));
  syncOutputs();

  function onScenarioChange() {
    const id = scenarioSel.value;
    $("custom-fields").hidden = id !== "custom";
    const c = CYCLONES.find((c) => c.id === id);
    $("scenario-info").textContent = c ? `${c.category}. Landfall: ${c.landfall}.` : "Design a hypothetical storm: pick a landfall point, intensity and approach.";
  }
  scenarioSel.addEventListener("change", onScenarioChange);
  onScenarioChange();

  // legend
  $("legend-wind").innerHTML = WIND_BINS.map((b) => `<li><span class="swatch" style="background:${b.color}"></span>${b.label}</li>`).join("");
  $("legend-risk").innerHTML = TIERS.map((t) => `<li><span class="dot" style="background:${t.color}"></span>${t.label}</li>`).join("");

  // type filter chips
  $("type-filter").innerHTML = Object.entries(ASSET_TYPES).map(([k, t]) => `<button type="button" class="chip" data-type="${k}" aria-pressed="true">${t.short}</button>`).join("");
  $("type-filter").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", on);
    on ? state.enabledTypes.add(b.dataset.type) : state.enabledTypes.delete(b.dataset.type);
    styleAssets();
  });

  for (const [id, layer] of [["l-swath", "swath"], ["l-ens", "ens"], ["l-assets", "assets"]]) {
    $(id).addEventListener("change", (e) => (e.target.checked ? layers[layer].addTo(map) : layers[layer].remove()));
  }

  // ---------------- run ----------------
  function currentScenario() {
    const id = scenarioSel.value;
    if (id !== "custom") {
      const c = CYCLONES.find((c) => c.id === id);
      return { id, title: `Cyclone ${c.name}`, sub: `${c.category} · landfall ${c.landfall}`, fixes: c.track, landfallTime: c.landfallTime, historical: true };
    }
    const town = TOWNS.find((t) => t.name === townSel.value);
    const vmax = +$("c-vmax").value, heading = +$("c-heading").value % 360, speed = +$("c-speed").value;
    const syn = M.syntheticTrack({ lat: town.lat - 0.05, lon: town.lon + 0.05, vmax, heading, speed });
    return { id: "custom", title: `What-if: ${M.imdClass(vmax).code} at ${town.name}`, sub: `${vmax} km/h landfall, moving ${compass(heading)} at ${speed} km/h`, ...syn, historical: false };
  }

  function run() {
    stopPlay();
    const sc = currentScenario();
    const lead = +$("lead").value, members = +$("members").value;
    $("run").disabled = true;
    $("busy").hidden = false;
    $("status").textContent = `Simulating ${members} ensemble tracks × ${assets.length} assets…`;
    setTimeout(() => {
      const t0 = performance.now();
      const result = M.runForecast(sc, assets, ASSET_TYPES, TOWNS, { members, leadHours: lead });
      state.swath = M.windSwath(result.steps, undefined, 0.1);
      state.result = result;
      state.scenario = sc;
      state.lead = lead;
      const ms = Math.round(performance.now() - t0);
      $("status").textContent = `Done in ${ms} ms · ${members} members · ${assets.length} assets · ${result.steps.length} hourly steps`;
      $("run").disabled = false;
      $("busy").hidden = true;
      render(sc, result);
    }, 30);
  }
  $("run").addEventListener("click", run);

  // ---------------- render ----------------
  function render(sc, r) {
    // swath
    layers.swath.clearLayers();
    for (const c of state.swath) {
      const b = binFor(c.wind);
      L.rectangle([[c.lat, c.lon], [c.lat + c.res, c.lon + c.res]], { renderer: canvas, stroke: false, fillColor: b.color, fillOpacity: 0.42, interactive: false }).addTo(layers.swath);
    }

    // ensemble spread + reference track
    layers.ens.clearLayers();
    for (const member of r.ensemble.slice(1)) {
      L.polyline(member.slice(r.originIndex).map((s) => [s.lat, s.lon]), { renderer: canvas, color: "#ffffff", opacity: 0.13, weight: 1, interactive: false }).addTo(layers.ens);
    }
    layers.track.clearLayers();
    const past = r.steps.slice(0, r.originIndex + 1).map((s) => [s.lat, s.lon]);
    const fut = r.steps.slice(r.originIndex).map((s) => [s.lat, s.lon]);
    L.polyline(past, { color: "#ffffff", weight: 2.5, opacity: 0.9 }).addTo(layers.track);
    L.polyline(fut, { color: "#ffffff", weight: 2.5, opacity: 0.9, dashArray: "6 6" }).addTo(layers.track);
    const o = r.steps[r.originIndex];
    L.circleMarker([o.lat, o.lon], { radius: 5, color: "#fff", weight: 2, fillColor: "#3987e5", fillOpacity: 1 })
      .bindTooltip(`Forecast issued here (T−${state.lead} h). Dashed = forecast track; faint lines = ensemble members.`)
      .addTo(layers.track);
    const lf = r.steps[r.landfallIndex];
    L.circleMarker([lf.lat, lf.lon], { radius: 4, color: "#fff", weight: 2, fillColor: "#0d0d0d", fillOpacity: 1 }).bindTooltip("Landfall").addTo(layers.track);

    // assets
    layers.assets.clearLayers();
    state.markers = r.assets
      .slice()
      .sort((a, b) => a.pDisruption - b.pDisruption) // draw worst on top
      .map((a) => {
        const m = L.circleMarker([a.lat, a.lon], { renderer: canvas, weight: 1.5, color: "#1a1a19" });
        m.asset = a;
        m.bindTooltip(() => `<b>${a.name}</b><br>${Math.round(a.pDisruption * 100)} % disruption risk`, { direction: "top", offset: [0, -4] });
        m.bindPopup(() => popupHtml(a), { maxWidth: 320 });
        m.addTo(layers.assets);
        return m;
      });

    // timeline
    const slider = $("t-slider");
    slider.max = r.steps.length - 1;
    state.revealAll = true;
    setStep(r.landfallIndex);

    // panels
    $("impact-title").textContent = sc.title;
    $("impact-sub").textContent = `${sc.sub}. Forecast issued ${state.lead} h before landfall.`;
    renderKpis(r.summary);
    renderTypeChart(r.summary);
    renderActions(r.actions);
    renderTable(r.assets);
    $("observed-card").hidden = !OBSERVED[sc.id];
    $("observed").textContent = OBSERVED[sc.id] || "";

    // fit view to the impacted area
    const hot = r.assets.filter((a) => a.pDisruption >= 0.15).map((a) => [a.lat, a.lon]);
    const pts = hot.length ? hot.concat([[lf.lat, lf.lon], [o.lat, o.lon]]) : r.steps.map((s) => [s.lat, s.lon]);
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 8, paddingBottomRight: [0, 70] });
  }

  function styleAssets() {
    if (!state.markers) return;
    for (const m of state.markers) {
      const a = m.asset;
      if (!state.enabledTypes.has(a.type)) { m.setStyle({ opacity: 0, fillOpacity: 0 }); m.setRadius(0); continue; }
      const hit = state.revealAll || (a.hazard.peakIdx >= 0 && a.hazard.peakIdx <= state.idx);
      if (!hit) { m.setStyle({ opacity: 0.4, fillOpacity: 0.35, fillColor: "#5a5a56" }); m.setRadius(3); continue; }
      const t = TIER[a.tier];
      m.setStyle({ opacity: 1, fillOpacity: a.tier === "good" ? 0.55 : 0.95, fillColor: t.color });
      m.setRadius({ critical: 7.5, serious: 6.5, warning: 5, good: 3.5 }[a.tier]);
    }
  }

  // ---------------- timeline ----------------
  function setStep(i) {
    const r = state.result;
    if (!r) return;
    state.idx = i;
    $("t-slider").value = i;
    const s = r.steps[i];
    const dh = i - r.landfallIndex;
    const rel = dh === 0 ? "Landfall" : `T${dh < 0 ? "−" : "+"}${Math.abs(dh)} h`;
    const when = state.scenario.historical ? new Date(s.t).toISOString().slice(0, 16).replace("T", " ") + " UTC · " : "";
    $("t-label").textContent = `${when}${rel}${i < r.originIndex ? " · observed" : " · forecast"}`;
    $("t-storm").textContent = `${M.imdClass(s.v).code} · ${Math.round(s.v)} km/h · ${s.lat.toFixed(1)}°N ${s.lon.toFixed(1)}°E`;

    layers.storm.clearLayers();
    const r62 = M.windRadius(s, 62), r118 = M.windRadius(s, 118);
    if (r62) L.circle([s.lat, s.lon], { radius: r62 * 1000, color: "#86b6ef", weight: 1, fill: false, dashArray: "3 5", interactive: false }).addTo(layers.storm);
    if (r118) L.circle([s.lat, s.lon], { radius: r118 * 1000, color: "#cde2fb", weight: 1.5, fillColor: "#cde2fb", fillOpacity: 0.08, interactive: false }).addTo(layers.storm);
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "storm-icon", html: "<span>🌀</span>", iconSize: [30, 30] }), interactive: false }).addTo(layers.storm);
    styleAssets();
  }

  $("t-slider").addEventListener("input", (e) => { stopPlay(); state.revealAll = false; setStep(+e.target.value); });
  function stopPlay() {
    if (state.playing) clearInterval(state.playing);
    state.playing = null;
    $("play").textContent = "▶";
    $("play").setAttribute("aria-label", "Play storm animation");
  }
  $("play").addEventListener("click", () => {
    if (!state.result) return;
    if (state.playing) return stopPlay();
    state.revealAll = false;
    const last = state.result.steps.length - 1;
    let i = state.idx >= last ? 0 : state.idx;
    if (i === state.result.landfallIndex) i = Math.max(0, state.result.originIndex - 12);
    $("play").textContent = "❚❚";
    $("play").setAttribute("aria-label", "Pause");
    state.playing = setInterval(() => {
      setStep(i);
      if (++i > last) { stopPlay(); state.revealAll = true; styleAssets(); }
    }, 70);
  });

  // ---------------- panels ----------------
  const fmtPeople = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? Math.round(n / 1e3).toLocaleString("en-IN") + " k" : Math.round(n).toString());
  function renderKpis(s) {
    const hospitals = s.byType.hospital.count;
    const atRisk = s.tiers.critical + s.tiers.serious;
    const k = [
      { v: `₹${Math.round(s.loss).toLocaleString("en-IN")} cr`, l: "Expected direct infrastructure loss", s: "illustrative asset values" },
      { v: fmtPeople(s.popSevere), l: "People in ≥ 118 km/h winds", s: "ensemble-weighted, town centres" },
      { v: fmtPeople(s.popPowerLoss), l: "People likely to lose grid power", s: "substation + line failure cascade" },
      { v: fmtPeople(s.peopleToEvacuate), l: "Residents to evacuate", s: "kutcha housing likely damaged" },
      { v: `${s.hospitalsAtRisk} / ${hospitals}`, l: "Hospitals at serious+ disruption risk", s: "structure or power loss" },
      { v: `${atRisk}`, l: "Assets at serious or critical risk", s: `of ${s.total} modelled` },
    ];
    $("kpis").innerHTML = k.map((x) => `<div class="kpi"><div class="v">${x.v}</div><div class="l">${x.l}</div><div class="s">${x.s}</div></div>`).join("");
  }

  const tip = $("tooltip");
  function showTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px"; tip.style.top = e.clientY + 14 + "px";
  }
  const hideTip = () => (tip.hidden = true);

  function renderTypeChart(s) {
    const rows = Object.entries(s.byType).filter(([, t]) => t.count > 0).sort((a, b) => b[1].expectedDamaged - a[1].expectedDamaged);
    const max = Math.max(...rows.map(([, t]) => t.count));
    $("type-chart").innerHTML = rows.map(([k, t]) => `
      <div class="hbar-row" data-type="${k}">
        <span class="name">${ASSET_TYPES[k].short}</span>
        <div class="hbar-track" style="width:${(t.count / max) * 100}%">
          <div class="hbar-fill" style="width:${(t.expectedDamaged / t.count) * 100}%"></div>
        </div>
        <span class="val">${t.expectedDamaged.toFixed(1)}</span>
      </div>`).join("");
    $("type-chart").querySelectorAll(".hbar-row").forEach((row) => {
      const t = s.byType[row.dataset.type];
      row.addEventListener("mousemove", (e) => showTip(e, `<b>${ASSET_TYPES[row.dataset.type].label}</b><br>${t.expectedDamaged.toFixed(1)} of ${t.count} expected damaged<br>${t.expectedDisrupted.toFixed(1)} expected out of service`));
      row.addEventListener("mouseleave", hideTip);
    });
  }

  function renderActions(actions) {
    $("actions").innerHTML = actions.length
      ? actions.map((a) => `
        <li data-id="${a.id}" tabindex="0">
          <div class="action-top"><span class="kind">${a.kind}</span><span class="badge ${a.tier}"><i></i>${a.p}% · ${TIER[a.tier].label.split(" ")[0]}</span></div>
          <span class="txt">${a.text}</span>
        </li>`).join("")
      : `<li><span class="txt">No asset exceeds the 35 % disruption threshold. Maintain watch.</span></li>`;
    $("actions").querySelectorAll("li[data-id]").forEach((li) => {
      const go = () => focusAsset(li.dataset.id);
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => e.key === "Enter" && go());
    });
  }

  function focusAsset(id) {
    const m = state.markers.find((m) => m.asset.id === id);
    if (!m) return;
    state.revealAll = true; styleAssets();
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 9), { duration: 0.8 });
    setTimeout(() => m.openPopup(), 850);
  }

  function renderTable(list) {
    const pct = (p) => Math.round(p * 100) + " %";
    $("asset-table").querySelector("tbody").innerHTML = list
      .slice().sort((a, b) => b.pDisruption - a.pDisruption)
      .map((a) => `<tr><td>${a.name}</td><td>${Math.round(a.hazard.wind)}</td><td>${a.hazard.flood.toFixed(1)} m</td><td>${pct(a.pDamage)}</td><td>${pct(a.pDisruption)}</td></tr>`).join("");
  }

  // ---------------- popup ----------------
  function fragilitySvg(a) {
    const t = ASSET_TYPES[a.type];
    const W = 280, H = 96, pl = 28, pr = 8, pt = 8, pb = 20, xmax = 320;
    const x = (v) => pl + (v / xmax) * (W - pl - pr);
    const y = (p) => pt + (1 - p) * (H - pt - pb);
    let d = "";
    for (let v = 0; v <= xmax; v += 4) d += `${v ? "L" : "M"}${x(v).toFixed(1)},${y(M.lognormCdf(v, t.windMedian, t.windBeta)).toFixed(1)}`;
    const w = a.hazard.wind, pw = M.lognormCdf(w, t.windMedian, t.windBeta);
    return `<svg class="frag" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wind fragility curve">
      <rect x="${x(a.windP10)}" y="${pt}" width="${Math.max(1, x(a.windP90) - x(a.windP10))}" height="${H - pt - pb}" fill="#3987e5" opacity="0.18"/>
      <line x1="${pl}" y1="${y(0)}" x2="${W - pr}" y2="${y(0)}" stroke="#383835"/>
      <line x1="${pl}" y1="${y(0.5)}" x2="${W - pr}" y2="${y(0.5)}" stroke="#2c2c2a"/>
      <line x1="${pl}" y1="${y(1)}" x2="${W - pr}" y2="${y(1)}" stroke="#2c2c2a"/>
      <text x="${pl - 4}" y="${y(1) + 4}" fill="#898781" font-size="10" text-anchor="end">100%</text>
      <text x="${pl - 4}" y="${y(0.5) + 4}" fill="#898781" font-size="10" text-anchor="end">50%</text>
      <text x="${pl - 4}" y="${y(0) + 3}" fill="#898781" font-size="10" text-anchor="end">0</text>
      ${[0, 100, 200, 300].map((v) => `<text x="${x(v)}" y="${H - 5}" fill="#898781" font-size="10" text-anchor="middle">${v}</text>`).join("")}
      <path d="${d}" fill="none" stroke="#c3c2b7" stroke-width="2"/>
      <line x1="${x(w)}" y1="${pt}" x2="${x(w)}" y2="${y(0)}" stroke="#ffffff" stroke-dasharray="3 3"/>
      <circle cx="${x(w)}" cy="${y(pw)}" r="4.5" fill="${TIER[a.tier].color}" stroke="#1a1a19" stroke-width="2"/>
    </svg>`;
  }

  function popupHtml(a) {
    const t = ASSET_TYPES[a.type];
    const pct = (p) => Math.round(p * 100) + " %";
    const feeder = a.feeder && state.result.assets.find((x) => x.id === a.feeder);
    return `<div class="pop">
      <h4>${a.name}</h4>
      <div class="sub">${t.label} · ${a.state} · ${a.coastKm} km from coast · ${a.elev} m elevation</div>
      <span class="badge ${a.tier}"><i></i>${pct(a.pDisruption)} service disruption · ${TIER[a.tier].label.split(" ")[0]}</span>
      <dl style="margin-top:8px">
        <dt>Peak wind (P10–P90)</dt><dd>${Math.round(a.hazard.wind)} km/h (${Math.round(a.windP10)}–${Math.round(a.windP90)})</dd>
        <dt>Hours of gale-force wind</dt><dd>${a.hazard.galeHours} h</dd>
        <dt>Storm-surge inundation</dt><dd>${a.hazard.surge.toFixed(2)} m</dd>
        <dt>Storm rainfall</dt><dd>${Math.round(a.hazard.rain)} mm</dd>
        <dt>P(physical damage)</dt><dd>${pct(a.pDamage)}</dd>
        ${t.power ? `<dt>P(grid supply lost)</dt><dd>${pct(a.pGridLoss)}</dd><dt>Backup power covers</dt><dd>${Math.round(t.backup * 100)} %</dd>` : ""}
        ${a.type === "substation" ? `<dt>P(supply lost incl. line)</dt><dd>${pct(a.pSupplyLoss)}</dd>` : ""}
        ${feeder ? `<dt>Fed by</dt><dd>${feeder.name.replace(" Substation & feeders", " SS")}</dd>` : ""}
      </dl>
      ${fragilitySvg(a)}
      <div class="frag-cap">Wind fragility curve: P(damage) vs wind (km/h). Shaded = ensemble P10–P90 wind.</div>
    </div>`;
  }

  // keyboard: space toggles playback
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $("play").click(); }
  });

  // expose for scripted demos
  window.CycloneSentinel = { run, setStep, focusAsset, state, map };
  run();
})();
