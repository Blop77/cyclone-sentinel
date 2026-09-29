/* CycloneSentinel — UI */
(function () {
  "use strict";

  const { CYCLONES, TOWNS, ASSET_TYPES, buildAssets } = window.CIF_DATA;
  const M = window.CIF_MODEL, F = window.CIF_FEEDS, AI = window.CIF_AI, DSP = window.CIF_DISPATCH;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const TIERS = [
    { key: "critical", label: "Critical  (≥ 60 %)", color: "#d03b3b" },
    { key: "serious", label: "Serious  (35–60 %)", color: "#ec835a" },
    { key: "warning", label: "Elevated  (15–35 %)", color: "#fab219" },
    { key: "good", label: "Low  (< 15 %)", color: "#0ca30c" },
  ];
  const TIER = Object.fromEntries(TIERS.map((t) => [t.key, t]));
  const LEVEL_COLOR = { red: "#d03b3b", orange: "#ec835a", yellow: "#fab219" };
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
  const state = { result: null, swath: [], enabledTypes: new Set(Object.keys(ASSET_TYPES)), revealAll: true, idx: 0, playing: null, ai: null };

  // ---------------- map ----------------
  const map = L.map("map", { zoomControl: true, preferCanvas: true, minZoom: 4 }).setView([19.6, 86.2], 6);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · Weather: Open-Meteo (CC BY 4.0)",
    maxZoom: 16,
  }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const layers = {
    sat: L.layerGroup(),
    imerg: L.layerGroup(),
    swath: L.layerGroup().addTo(map),
    ens: L.layerGroup().addTo(map),
    track: L.layerGroup().addTo(map),
    roads: L.layerGroup().addTo(map),
    assets: L.layerGroup().addTo(map),
    storm: L.layerGroup().addTo(map),
    advisory: L.layerGroup().addTo(map),
  };
  const LABEL_TOWNS = ["Visakhapatnam", "Kakinada", "Gopalpur", "Puri", "Bhubaneswar", "Paradip", "Balasore", "Digha", "Sagar Island", "Kolkata", "Haldia"];
  for (const t of TOWNS.filter((t) => LABEL_TOWNS.includes(t.name))) {
    L.tooltip({ permanent: true, direction: "right", className: "town-label", offset: [6, 0] }).setLatLng([t.lat, t.lon]).setContent(t.name).addTo(map);
  }

  // ---------------- controls ----------------
  const scenarioSel = $("scenario");
  scenarioSel.add(new Option("🔴 Live — next 72 h (real-time weather)", "live"));
  for (const c of CYCLONES) scenarioSel.add(new Option(`Replay: ${c.name}`, c.id));
  scenarioSel.add(new Option("What-if storm designer…", "custom"));
  scenarioSel.value = "fani-2019";

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
    $("forecast-settings").hidden = id === "live";
    const c = CYCLONES.find((c) => c.id === id);
    $("scenario-info").textContent = c ? `${c.category}. Landfall: ${c.landfall}.`
      : id === "live" ? "Real-time 72 h forecast for every coastal town from Open-Meteo, run through the same fragility, cascade and advisory chain."
      : "Design a hypothetical storm: pick a landfall point, intensity and approach.";
    $("run").textContent = id === "live" ? "Fetch live data & assess" : "Run impact forecast";
  }
  scenarioSel.addEventListener("change", onScenarioChange);
  onScenarioChange();

  $("legend-wind").innerHTML = WIND_BINS.map((b) => `<li><span class="swatch" style="background:${b.color}"></span>${b.label}</li>`).join("");
  $("legend-risk").innerHTML = TIERS.map((t) => `<li><span class="dot" style="background:${t.color}"></span>${t.label}</li>`).join("");

  $("type-filter").innerHTML = Object.entries(ASSET_TYPES).map(([k, t]) => `<button type="button" class="chip" data-type="${k}" aria-pressed="true">${t.short}</button>`).join("");
  $("type-filter").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", on);
    on ? state.enabledTypes.add(b.dataset.type) : state.enabledTypes.delete(b.dataset.type);
    styleAssets();
  });

  for (const [id, layer] of [["l-swath", "swath"], ["l-ens", "ens"], ["l-assets", "assets"], ["l-roads", "roads"], ["l-sat", "sat"], ["l-imerg", "imerg"]]) {
    $(id).addEventListener("change", (e) => (e.target.checked ? layers[layer].addTo(map) : layers[layer].remove()));
  }

  // tabs
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
    document.querySelectorAll(".tabpanel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  // ---------------- scenario + run ----------------
  function currentScenario() {
    const id = scenarioSel.value;
    if (id === "live") return { id, title: "Live 72 h outlook", sub: "Real-time Open-Meteo forecast", live: true };
    if (id !== "custom") {
      const c = CYCLONES.find((c) => c.id === id);
      return { id, title: `Cyclone ${c.name}`, sub: `${c.category} · landfall ${c.landfall}`, fixes: c.track, landfallTime: c.landfallTime, historical: true };
    }
    const town = TOWNS.find((t) => t.name === townSel.value);
    const vmax = +$("c-vmax").value, heading = +$("c-heading").value % 360, speed = +$("c-speed").value;
    const syn = M.syntheticTrack({ lat: town.lat - 0.05, lon: town.lon + 0.05, vmax, heading, speed });
    return { id: "custom", title: `What-if: ${M.imdClass(vmax).code} at ${town.name}`, sub: `${vmax} km/h landfall, moving ${compass(heading)} at ${speed} km/h`, ...syn, historical: false };
  }

  function busy(on, text) {
    $("busy").hidden = !on;
    $("run").disabled = on;
    if (text) $("busy-text").textContent = text;
  }

  async function run() {
    stopPlay();
    const sc = currentScenario();
    const lead = +$("lead").value, members = +$("members").value;
    state.ai = null;
    renderAI(null);
    try {
      let result;
      if (sc.live) {
        busy(true, "Fetching real-time weather for 34 towns…");
        $("status").textContent = "Contacting Open-Meteo…";
        const t0 = performance.now();
        const wx = await F.liveWeather(TOWNS);
        result = M.runLive(assets, ASSET_TYPES, TOWNS, wx.weather, { issued: new Date().toISOString() });
        state.weather = wx;
        $("status").textContent = `Live data: ${wx.source} · ${TOWNS.length} towns · ${assets.length} assets · ${Math.round(performance.now() - t0)} ms`;
      } else {
        busy(true, `Running ${members}-member ensemble…`);
        $("status").textContent = `Simulating ${members} ensemble tracks × ${assets.length} assets…`;
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        result = M.runForecast(sc, assets, ASSET_TYPES, TOWNS, { members, leadHours: lead });
        state.swath = M.windSwath(result.steps, undefined, 0.1);
        $("status").textContent = `Done in ${Math.round(performance.now() - t0)} ms · ${members} members · ${assets.length} assets · ${result.steps.length} hourly steps`;
      }
      state.result = result; state.scenario = sc; state.lead = lead;
      render(sc, result);
      const n = await DSP.autoDispatch(result.advisories, sc.id);
      if (n) $("status").textContent += ` · auto-dispatched ${n} advisories`;
    } catch (e) {
      console.error(e);
      $("status").textContent = `Failed: ${e.message}`;
    } finally {
      busy(false);
    }
  }
  $("run").addEventListener("click", run);

  // ---------------- satellite layers ----------------
  function satelliteWhen(sc, r) {
    if (sc.live) return { date: new Date(Date.now() - 24 * 3600e3), rain: new Date(Date.now() - 6 * 3600e3) };
    if (!sc.historical) return null;
    const lf = new Date(sc.landfallTime);
    // VIIRS passes ~07–08 UTC over the Bay: use the previous day if landfall happened before the pass.
    const imgDay = lf.getUTCHours() < 6 ? new Date(lf.getTime() - 24 * 3600e3) : lf;
    return { date: imgDay, rain: lf };
  }
  function updateSatellite(sc, r) {
    layers.sat.clearLayers(); layers.imerg.clearLayers();
    const w = satelliteWhen(sc, r);
    state.satWhen = w;
    $("l-sat").disabled = $("l-imerg").disabled = !w;
    if (!w) { $("sat-date").textContent = "Satellite layers are unavailable for a hypothetical storm."; return; }
    const s = F.satelliteLayers(L, w.date), rr = F.satelliteLayers(L, w.rain);
    s.trueColor.addTo(layers.sat);
    rr.imerg.addTo(layers.imerg);
    $("sat-date").textContent = `Satellite: VIIRS ${F.day(w.date)} · IMERG ${w.rain.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  // ---------------- render ----------------
  function render(sc, r) {
    const live = r.mode === "live";
    layers.swath.clearLayers(); layers.ens.clearLayers(); layers.track.clearLayers(); layers.storm.clearLayers(); layers.advisory.clearLayers();
    $("timeline").hidden = live;
    updateSatellite(sc, r);

    if (!live) {
      for (const c of state.swath) {
        const b = binFor(c.wind);
        L.rectangle([[c.lat, c.lon], [c.lat + c.res, c.lon + c.res]], { renderer: canvas, stroke: false, fillColor: b.color, fillOpacity: 0.42, interactive: false }).addTo(layers.swath);
      }
      for (const member of r.ensemble.slice(1)) {
        L.polyline(member.slice(r.originIndex).map((s) => [s.lat, s.lon]), { renderer: canvas, color: "#ffffff", opacity: 0.13, weight: 1, interactive: false }).addTo(layers.ens);
      }
      const past = r.steps.slice(0, r.originIndex + 1).map((s) => [s.lat, s.lon]);
      const fut = r.steps.slice(r.originIndex).map((s) => [s.lat, s.lon]);
      L.polyline(past, { color: "#ffffff", weight: 2.5, opacity: 0.9 }).addTo(layers.track);
      L.polyline(fut, { color: "#ffffff", weight: 2.5, opacity: 0.9, dashArray: "6 6" }).addTo(layers.track);
      const o = r.steps[r.originIndex];
      L.circleMarker([o.lat, o.lon], { radius: 5, color: "#fff", weight: 2, fillColor: "#3987e5", fillOpacity: 1 })
        .bindTooltip(`Forecast issued here (T−${state.lead} h). Dashed = forecast track; faint lines = ensemble members.`).addTo(layers.track);
      const lf = r.steps[r.landfallIndex];
      L.circleMarker([lf.lat, lf.lon], { radius: 4, color: "#fff", weight: 2, fillColor: "#0d0d0d", fillOpacity: 1 }).bindTooltip("Landfall").addTo(layers.track);
      state.center = { lat: lf.lat, lon: lf.lon };
    } else {
      state.center = { lat: 19.6, lon: 86.2 };
    }

    // roads as lines
    layers.roads.clearLayers();
    for (const a of r.assets.filter((a) => a.type === "road")) {
      L.polyline(a.path, { renderer: canvas, color: TIER[a.tier].color, weight: a.tier === "good" ? 1.5 : 3, opacity: a.tier === "good" ? 0.45 : 0.9 })
        .bindTooltip(`<b>${esc(a.name)}</b><br>${Math.round(a.pDamage * 100)} % likely impassable`, { sticky: true }).addTo(layers.roads);
    }

    layers.assets.clearLayers();
    state.markers = r.assets.slice().sort((a, b) => a.pDisruption - b.pDisruption).map((a) => {
      const m = L.circleMarker([a.lat, a.lon], { renderer: canvas, weight: 1.5, color: "#1a1a19" });
      m.asset = a;
      m.bindTooltip(() => `<b>${esc(a.name)}</b><br>${Math.round(a.pDisruption * 100)} % disruption risk${a.pIsolated != null ? ` · ${Math.round(a.pIsolated * 100)} % cut off` : ""}`, { direction: "top", offset: [0, -4] });
      m.bindPopup(() => popupHtml(a), { maxWidth: 340 });
      m.addTo(layers.assets);
      return m;
    });

    if (!live) {
      $("t-slider").max = r.steps.length - 1;
      state.revealAll = true;
      setStep(r.landfallIndex);
    } else {
      state.revealAll = true;
      styleAssets();
    }

    $("impact-eyebrow").textContent = live ? "Live impact outlook" : "Impact forecast";
    $("impact-title").textContent = sc.title;
    $("impact-sub").textContent = live ? `Issued ${new Date().toLocaleString("en-IN")} from ${state.weather.source}.` : `${sc.sub}. Forecast issued ${state.lead} h before landfall.`;
    renderKpis(r.summary);
    renderLiveConditions(live ? state.weather : null);
    renderPathways(r.summary.rainPathways);
    renderTypeChart(r.summary);
    renderActions(r.actions);
    renderTable(r.assets);
    renderAdvisories(r.advisories);
    $("observed-card").hidden = !OBSERVED[sc.id];
    $("observed").textContent = OBSERVED[sc.id] || "";
    loadCachedAI(sc.id);

    const hot = r.assets.filter((a) => a.pDisruption >= 0.15 || a.pIsolated >= 0.15).map((a) => [a.lat, a.lon]);
    const pts = hot.length ? hot.concat(live ? [] : [[state.center.lat, state.center.lon], [r.steps[r.originIndex].lat, r.steps[r.originIndex].lon]]) : TOWNS.map((t) => [t.lat, t.lon]);
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
      m.setRadius({ critical: 7.5, serious: 6.5, warning: 5, good: 3.5 }[a.tier] * (a.type === "road" ? 0.7 : 1));
    }
  }

  // ---------------- timeline ----------------
  function setStep(i) {
    const r = state.result;
    if (!r || r.mode === "live") return;
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
    if (!state.result || state.result.mode === "live") return;
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

  // ---------------- impact panels ----------------
  const fmtPeople = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? Math.round(n / 1e3).toLocaleString("en-IN") + " k" : Math.round(n).toString());
  function renderKpis(s) {
    const k = [
      { v: `₹${Math.round(s.loss).toLocaleString("en-IN")} cr`, l: "Expected direct infrastructure loss", s: "illustrative asset values" },
      { v: fmtPeople(s.popSevere), l: "People in ≥ 118 km/h winds", s: "town centres" },
      { v: fmtPeople(s.popPowerLoss), l: "People likely to lose grid power", s: "substation + line cascade" },
      { v: fmtPeople(s.peopleToEvacuate), l: "Residents to evacuate", s: "kutcha housing likely damaged" },
      { v: `${s.hospitalsAtRisk} / ${s.byType.hospital.count}`, l: "Hospitals at serious+ disruption risk", s: "structure or power loss" },
      { v: `${s.facilitiesCutOff}`, l: "Hospitals & shelters likely cut off", s: "access road flooded / blocked" },
      { v: `${s.roadsCut} / ${s.byType.road.count}`, l: "Arterial roads likely impassable", s: "flooding or tree / pole fall" },
      { v: `${s.tiers.critical + s.tiers.serious}`, l: "Assets at serious or critical risk", s: `of ${s.total} modelled` },
    ];
    $("kpis").innerHTML = k.map((x) => `<div class="kpi"><div class="v">${x.v}</div><div class="l">${x.l}</div><div class="s">${x.s}</div></div>`).join("");
  }

  function renderLiveConditions(wx) {
    const card = $("live-card");
    card.hidden = !wx;
    if (!wx) return;
    const rows = Object.entries(wx.weather).sort((a, b) => b[1].rain72 + b[1].gustMax / 4 - (a[1].rain72 + a[1].gustMax / 4)).slice(0, 10);
    card.querySelector("tbody").innerHTML = rows.map(([t, w]) => `<tr><td>${esc(t)}</td><td>${w.rain72.toFixed(1)} mm</td><td>${Math.round(w.windMax)}</td><td>${Math.round(w.gustMax)}</td></tr>`).join("");
    card.querySelector(".hint").textContent = `${wx.source}, next 72 h from ${wx.weather[TOWNS[0].name].issued.replace("T", " ")} IST. Top 10 of ${TOWNS.length} towns by rain + gusts.`;
  }

  function renderPathways(list) {
    $("pathways").innerHTML = list.length
      ? list.map((p) => `<li data-id="${p.id}" tabindex="0"><span class="badge ${M.riskTier(p.p)}"><i></i>${Math.round(p.p * 100)} % cut off</span>
          <div class="chain">${p.chain.map((c) => `<span>${esc(c)}</span>`).join('<b aria-hidden="true">→</b>')}</div></li>`).join("")
      : `<li class="muted">No hospital or shelter is likely to be cut off.</li>`;
    $("pathways").querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => focusAsset(li.dataset.id)));
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
        <div class="hbar-track" style="width:${(t.count / max) * 100}%"><div class="hbar-fill" style="width:${(t.expectedDamaged / t.count) * 100}%"></div></div>
        <span class="val">${t.expectedDamaged.toFixed(1)}</span>
      </div>`).join("");
    $("type-chart").querySelectorAll(".hbar-row").forEach((row) => {
      const t = s.byType[row.dataset.type];
      row.addEventListener("mousemove", (e) => showTip(e, `<b>${ASSET_TYPES[row.dataset.type].label}</b><br>${t.expectedDamaged.toFixed(1)} of ${t.count} expected damaged<br>${t.expectedDisrupted.toFixed(1)} expected out of service`));
      row.addEventListener("mouseleave", hideTip);
    });
  }

  function renderActions(actions) {
    actions = actions.slice(0, 16);
    $("actions").innerHTML = actions.length
      ? actions.map((a) => `<li data-id="${a.id}" tabindex="0">
          <div class="action-top"><span class="kind">${a.kind}</span><span class="badge ${a.tier}"><i></i>${a.p}% · ${TIER[a.tier].label.split(" ")[0]}</span></div>
          <span class="txt">${esc(a.text)}</span></li>`).join("")
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
    $("asset-table").querySelector("tbody").innerHTML = list.slice().sort((a, b) => b.pDisruption - a.pDisruption)
      .map((a) => `<tr><td>${esc(a.name)}</td><td>${Math.round(a.hazard.wind)}</td><td>${a.hazard.flood.toFixed(1)} m</td><td>${pct(a.pDamage)}</td><td>${pct(a.pDisruption)}</td></tr>`).join("");
  }

  // ---------------- advisories + dispatch ----------------
  function renderAdvisories(list) {
    $("adv-count").textContent = list.length ? list.length : "";
    const s = DSP.settings();
    $("auto-dispatch").checked = !!s.auto;
    $("auto-level").textContent = { red: "Red", orange: "Orange", yellow: "Yellow" }[s.minLevel];
    $("dispatch-target").textContent = s.webhook ? `Webhook: ${s.webhook}` : "No webhook set — use Settings, or e-mail / WhatsApp / CAP below.";
    $("advisories").innerHTML = list.length ? list.map((a, i) => `
      <li class="adv" style="--lvl:${LEVEL_COLOR[a.level]}" data-i="${i}">
        <div class="adv-head"><span class="lvl">${a.levelLabel}</span><span class="muted">${esc(a.district)}, ${esc(a.state)}</span></div>
        <h4>${esc(a.headline)}</h4>
        <p>${esc(a.description)}</p>
        ${a.ai ? `<p class="adv-ai"><b>✦ Gemini (${esc(a.ai.local_language)}):</b> ${esc(a.ai.message_local)}</p>` : ""}
        <details><summary>Actions (${a.instructions.length}) · recipients (${a.recipients.length})</summary>
          <ol>${a.instructions.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
          <p class="hint">To: ${a.recipients.map(esc).join("; ")}</p></details>
        <div class="adv-actions">
          <button class="btn-small primary" data-act="send">Dispatch</button>
          <a class="btn-small" data-act="mail" href="${DSP.mailto(a)}">E-mail</a>
          <a class="btn-small" href="${DSP.whatsapp(a)}" target="_blank" rel="noopener">WhatsApp</a>
          <button class="btn-small" data-act="cap">CAP XML</button>
          <button class="btn-small" data-act="map">Map</button>
        </div>
      </li>`).join("") : `<li class="card muted">No district reaches the Yellow threshold.</li>`;
    $("advisories").querySelectorAll(".adv").forEach((li) => {
      const a = list[+li.dataset.i];
      li.querySelector('[data-act="send"]').addEventListener("click", () => DSP.dispatch(a, { scenario: state.scenario.id }));
      li.querySelector('[data-act="cap"]').addEventListener("click", () => DSP.downloadCAP(a));
      li.querySelector('[data-act="map"]').addEventListener("click", () => showAdvisoryArea(a));
    });
  }
  function showAdvisoryArea(a) {
    layers.advisory.clearLayers();
    L.circle([a.area.lat, a.area.lon], { radius: a.area.radiusKm * 1000, color: LEVEL_COLOR[a.level], weight: 2, fillOpacity: 0.08 })
      .bindTooltip(`${a.levelLabel} · ${a.district}`, { permanent: true, direction: "center", className: "town-label" }).addTo(layers.advisory);
    map.flyToBounds(L.latLng(a.area.lat, a.area.lon).toBounds(a.area.radiusKm * 2200), { duration: 0.8 });
  }
  $("dispatch-all").addEventListener("click", async () => {
    for (const a of state.result.advisories.filter((a) => a.level !== "yellow")) await DSP.dispatch(a, { scenario: state.scenario.id });
  });
  $("auto-dispatch").addEventListener("change", (e) => DSP.save({ ...DSP.settings(), auto: e.target.checked }));
  DSP.onLog((log) => {
    $("dispatch-log").innerHTML = log.slice(0, 30).map((e) => `<li class="${e.ok ? "ok" : "fail"}">
      <span>${e.ok ? "✓" : "✗"} ${e.at.toLocaleTimeString("en-IN")} · <b>${e.adv.levelLabel}</b> ${esc(e.adv.district)}${e.auto ? " · auto" : ""}</span>
      <span class="muted">${esc(e.status)}</span></li>`).join("");
  });

  // ---------------- Gemini analyst ----------------
  function updateAIPill() {
    const c = window.CS_CONFIG || {};
    $("ai-pill").textContent = c.aiProxy ? `✦ Gemini 3.7 Flash · ${/\.run\.app$/.test(location.hostname) ? "via Cloud Run" : "via backend proxy"}` : AI.getKey() ? "✦ Gemini 3.7 Flash · your key" : "✦ Gemini · cached results (add key in ⚙)";
    $("ai-pill").classList.toggle("on", AI.hasAccess());
  }

  async function loadCachedAI(id) {
    const c = await AI.cached(id);
    if (state.scenario && state.scenario.id === id && !state.ai && c) { state.ai = { ...c, cached: true }; renderAI(state.ai); }
  }

  $("ai-run").addEventListener("click", async () => {
    if (!state.result) return;
    if (!AI.hasAccess()) {
      $("ai-status").innerHTML = 'Add a Gemini API key in <b>⚙ Settings</b> (free at aistudio.google.com) to run live analysis.';
      return;
    }
    const w = state.satWhen || { date: new Date(Date.now() - 864e5) };
    $("ai-run").disabled = true;
    const t0 = performance.now();
    try {
      const out = await AI.analyze({ scenario: state.scenario, result: state.result, towns: TOWNS, center: state.center, when: w.date, onStatus: (s) => ($("ai-status").textContent = s) });
      state.ai = { scenario: state.scenario.id, ...out };
      $("ai-status").textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${out.model}`;
      renderAI(state.ai);
    } catch (e) {
      $("ai-status").textContent = `Gemini unavailable: ${e.message}`;
      const c = await AI.cached(state.scenario.id);
      if (c) { state.ai = { ...c, cached: true }; renderAI(state.ai); $("ai-status").textContent += " — showing cached analysis."; }
    } finally {
      $("ai-run").disabled = false;
    }
  });

  function renderAI(ai) {
    const box = $("ai-output");
    if (!ai) { box.innerHTML = ""; $("ai-status").textContent = ""; return; }
    const j = ai.json;
    const when = new Date(ai.generatedAt).toLocaleString("en-IN");
    box.innerHTML = `
      <p class="ai-meta">${ai.cached ? "📦 Cached" : "⚡ Live"} response from <b>${esc(ai.model)}</b> · ${when}${ai.cached ? " · press Analyse to regenerate" : ""}</p>
      ${ai.satellite ? `<figure class="card sat"><img src="${esc(ai.satellite.url)}" alt="NASA VIIRS satellite image sent to Gemini" loading="lazy" /><figcaption>Input image: NASA VIIRS true colour, ${esc(ai.satellite.date)}</figcaption></figure>` : ""}
      <section class="card"><h3>Situation</h3><p>${esc(j.situation_summary)}</p><p class="muted">Confidence: ${esc(j.confidence)}</p></section>
      <section class="card"><h3>What the satellite shows</h3><p>${esc(j.satellite_observations)}</p></section>
      <section class="card"><h3>Imagery vs. impact model</h3><p>${esc(j.model_agreement)}</p></section>
      <section class="card"><h3>Key risks</h3><ul class="ai-list">${j.key_risks.map((k) => `<li><b>${esc(k.location)}</b> — ${esc(k.risk)}<br><span class="muted">${esc(k.why)}</span></li>`).join("")}</ul></section>
      <section class="card"><h3>Rainfall damage pathways</h3><ul class="ai-list">${j.rainfall_damage_pathways.map((k) => `<li><b>${esc(k.location)}</b>: ${esc(k.pathway)}<br><span class="muted">Mitigation: ${esc(k.mitigation)}</span></li>`).join("")}</ul></section>
      <section class="card"><h3>Advisories (multilingual)</h3>
        <ul class="ai-list">${j.advisories.map((a, i) => `<li><span class="lvl-chip" style="--lvl:${LEVEL_COLOR[a.level.toLowerCase()] || "#898781"}">${esc(a.level)}</span> <b>${esc(a.district)}</b>
          <p>${esc(a.message_en)}</p><p class="local">${esc(a.message_local)} <span class="muted">(${esc(a.local_language)})</span></p>
          <button class="btn-small primary" data-ai="${i}">Attach to advisory &amp; dispatch</button></li>`).join("")}</ul></section>
      <section class="card"><h3>Caveats</h3><p class="muted">${esc(j.caveats)}</p></section>`;
    box.querySelectorAll("[data-ai]").forEach((b) => b.addEventListener("click", () => {
      const g = j.advisories[+b.dataset.ai];
      const adv = state.result.advisories.find((a) => a.district.toLowerCase() === g.district.toLowerCase());
      if (!adv) { b.textContent = "No matching district advisory"; return; }
      adv.ai = g;
      adv.instructions = [g.message_en, ...adv.instructions.filter((t) => t !== g.message_en)];
      renderAdvisories(state.result.advisories);
      DSP.dispatch(adv, { scenario: state.scenario.id });
      b.textContent = "Attached ✓ — dispatched";
    }));
  }

  // ---------------- asset popup ----------------
  function fragilitySvg(a) {
    const t = ASSET_TYPES[a.type];
    const W = 300, H = 96, pl = 28, pr = 8, pt = 8, pb = 20, xmax = 320;
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
    return `<div class="pop">
      <h4>${esc(a.name)}</h4>
      <div class="sub">${t.label} · ${esc(a.district)}, ${esc(a.state)} · ${a.coastKm} km from coast · ${a.elev} m elevation</div>
      <span class="badge ${a.tier}"><i></i>${pct(a.pDisruption)} service disruption · ${TIER[a.tier].label.split(" ")[0]}</span>
      <p class="pop-h">Damage pathway</p>
      <ol class="pathway">${a.pathway.map((s) => `<li class="k-${s.kind}">${esc(s.text)}</li>`).join("")}</ol>
      <dl>
        <dt>Peak wind (P10–P90)</dt><dd>${Math.round(a.hazard.wind)} km/h (${Math.round(a.windP10)}–${Math.round(a.windP90)})</dd>
        <dt>Hours of gale-force wind</dt><dd>${a.hazard.galeHours} h</dd>
        ${t.power ? `<dt>Backup power covers</dt><dd>${Math.round(t.backup * 100)} %</dd>` : ""}
      </dl>
      ${fragilitySvg(a)}
      <div class="frag-cap">Wind fragility curve: P(damage) vs wind (km/h). Shaded = ensemble P10–P90 wind.</div>
    </div>`;
  }

  // ---------------- settings ----------------
  $("open-settings").addEventListener("click", () => {
    const s = DSP.settings();
    $("s-key").value = AI.getKey();
    $("s-webhook").value = s.webhook; $("s-emails").value = s.emails; $("s-level").value = s.minLevel; $("s-cap").value = s.capStatus;
    $("settings").showModal();
  });
  $("settings").addEventListener("close", () => {
    if ($("settings").returnValue !== "save") return;
    AI.setKey($("s-key").value);
    DSP.save({ ...DSP.settings(), webhook: $("s-webhook").value.trim(), emails: $("s-emails").value.trim(), minLevel: $("s-level").value, capStatus: $("s-cap").value });
    updateAIPill();
    if (state.result) renderAdvisories(state.result.advisories);
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $("play").click(); }
  });

  // ---------------- boot ----------------
  async function boot() {
    // Same-origin backend (server/main.py on Cloud Run or localhost) → Gemini proxy + dispatch inbox.
    try {
      const h = await fetch("healthz", { cache: "no-store" });
      if (h.ok && (h.headers.get("content-type") || "").includes("json")) {
        const j = await h.json();
        if (j.gemini) window.CS_CONFIG.aiProxy = location.origin;
        if (!DSP.settings().webhook) window.CS_CONFIG.dispatch.webhook = location.origin + "/api/dispatch";
      }
    } catch { /* static hosting */ }
    // Optional Google Earth Engine exposure attributes.
    const gee = await F.geeExposure();
    if (gee && gee.assets) {
      let n = 0;
      for (const a of assets) {
        const g = gee.assets[a.id];
        if (!g) continue;
        if (g.elev_m != null) a.elev = +(+g.elev_m).toFixed(1);
        if (g.water_occurrence != null) a.waterOccurrence = g.water_occurrence;
        n++;
      }
      $("exposure-source").textContent = `Exposure: Google Earth Engine (${gee.source || "Copernicus DEM, JRC GSW"}) for ${n} assets, generated ${gee.generated || ""}.`;
    } else {
      $("exposure-source").textContent = "Exposure: town-level estimates (run gee/exposure_pipeline.py for Earth Engine elevation & water layers).";
    }
    updateAIPill();
    window.CycloneSentinel = { run, setStep, focusAsset, showTab, state, map };
    run();
  }
  boot();
})();
