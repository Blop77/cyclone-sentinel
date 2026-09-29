/*
 * CycloneSentinel — Gemini multimodal analyst.
 *
 * Sends Gemini the satellite image of the storm together with the impact
 * model's structured output and asks for a situation assessment, rainfall
 * damage pathways and district advisories in English + the local language.
 *
 * Key handling: the key never ships in the repo. It comes from (1) a Cloud Run
 * proxy (CS_CONFIG.aiProxy — server/ in this repo), or (2) the viewer's own key
 * saved in this browser's localStorage. Without either, a cached Gemini response
 * committed under data/ai/ is shown and clearly labelled as cached.
 */
(function (root) {
  "use strict";

  const MODELS = ["gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
  const LANG = { Odisha: "Odia", "Andhra Pradesh": "Telugu", "West Bengal": "Bengali", "Tamil Nadu": "Tamil", Gujarat: "Gujarati", Maharashtra: "Marathi" };
  const cfg = () => root.CS_CONFIG || {};

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
  };

  const SCHEMA = {
    type: "OBJECT",
    properties: {
      situation_summary: { type: "STRING", description: "3-4 sentence operational summary for a district control room" },
      satellite_observations: { type: "STRING", description: "What the satellite image shows: eye/centre, cloud organisation, rain-band extent, land areas under cloud" },
      model_agreement: { type: "STRING", description: "Does the imagery support or challenge the impact model's hotspots? Be specific." },
      key_risks: { type: "ARRAY", items: { type: "OBJECT", properties: { location: { type: "STRING" }, risk: { type: "STRING" }, why: { type: "STRING" } }, required: ["location", "risk", "why"] } },
      rainfall_damage_pathways: { type: "ARRAY", items: { type: "OBJECT", properties: { location: { type: "STRING" }, pathway: { type: "STRING", description: "cause → effect chain" }, mitigation: { type: "STRING" } }, required: ["location", "pathway", "mitigation"] } },
      advisories: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            district: { type: "STRING" }, level: { type: "STRING", enum: ["RED", "ORANGE", "YELLOW"] },
            message_en: { type: "STRING", description: "<= 320 characters, SMS-ready, action-first" },
            local_language: { type: "STRING" }, message_local: { type: "STRING", description: "same message in the local language script" },
          },
          required: ["district", "level", "message_en", "local_language", "message_local"],
        },
      },
      confidence: { type: "STRING", enum: ["high", "medium", "low"] },
      caveats: { type: "STRING" },
    },
    required: ["situation_summary", "satellite_observations", "model_agreement", "key_risks", "rainfall_damage_pathways", "advisories", "confidence", "caveats"],
  };

  /** Compact, token-cheap context from a model run. */
  function buildContext(scenario, result, towns) {
    const s = result.summary;
    const top = result.assets.slice().sort((a, b) => Math.max(b.pDisruption, b.pIsolated || 0) - Math.max(a.pDisruption, a.pIsolated || 0)).slice(0, 18)
      .map((a) => ({ asset: a.name, district: a.district, wind_kmh: Math.round(a.hazard.wind), surge_m: +a.hazard.surge.toFixed(2), rain_mm: Math.round(a.hazard.rain),
        p_damage: +a.pDamage.toFixed(2), p_disruption: +a.pDisruption.toFixed(2), p_cut_off: a.pIsolated != null ? +a.pIsolated.toFixed(2) : undefined, driver: a.driver }));
    return {
      scenario: { title: scenario.title, detail: scenario.sub, mode: result.mode, landfall_or_issue_time_utc: result.advisories[0] ? result.advisories[0].onset : null },
      impact_summary: {
        expected_loss_inr_crore: Math.round(s.loss), people_in_118kmh_winds: Math.round(s.popSevere), people_losing_power: Math.round(s.popPowerLoss),
        residents_to_evacuate: Math.round(s.peopleToEvacuate), hospitals_serious_risk: s.hospitalsAtRisk, arterial_roads_impassable: s.roadsCut, facilities_cut_off: s.facilitiesCutOff,
      },
      highest_risk_assets: top,
      rainfall_pathways_from_model: s.rainPathways.map((p) => p.chain.join(" → ")),
      model_advisories: result.advisories.slice(0, 6).map((a) => ({ district: a.district, state: a.state, level: a.levelLabel, local_language: LANG[a.state] || "Hindi", description: a.description })),
    };
  }

  function prompt(ctx, sat) {
    return `You are the duty analyst in an Indian State Emergency Operations Centre during a cyclone.
You receive (1) a NASA VIIRS true-colour satellite image (${sat ? `date ${sat.date}, bounding box lat ${sat.bbox.s.toFixed(1)}–${sat.bbox.n.toFixed(1)}°N, lon ${sat.bbox.w.toFixed(1)}–${sat.bbox.e.toFixed(1)}°E; north is up` : "not available"}) and
(2) the output of a physics-based impact model (Holland wind field, parametric surge, rainfall flooding, fragility curves, power and road-access cascades) as JSON.

Tasks:
- Read the image: locate the storm centre/eye if visible, describe cloud organisation and which coastal land areas are under the dense overcast or rain bands.
- Cross-check the imagery against the model's hotspots and say plainly where they agree or disagree.
- Identify the most important rainfall damage pathways (rain → waterlogging → road/power/facility failure) with a concrete mitigation each.
- Write one advisory per district for the top ${Math.min(4, ctx.model_advisories.length)} districts in model_advisories: SMS-ready (≤ 320 characters), action-first, naming towns and facilities from the data, with the same message translated into the given local language (native script).
- Never invent numbers that are not in the data. Output JSON only, following the schema.

MODEL OUTPUT:
${JSON.stringify(ctx)}`;
  }

  async function callGemini(body, key, onStatus) {
    let lastErr;
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        onStatus && onStatus(`Asking ${model}${attempt ? ` (retry ${attempt})` : ""}…`);
        const url = cfg().aiProxy
          ? `${cfg().aiProxy.replace(/\/$/, "")}/api/gemini/${model}`
          : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const t0 = performance.now();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          return { model: data.modelVersion || model, ms: Math.round(performance.now() - t0), json: JSON.parse(text), usage: data.usageMetadata };
        }
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error.message || msg; } catch { /* non-JSON */ }
        lastErr = new Error(`${model}: ${msg}`);
        if (res.status === 400 || res.status === 401 || res.status === 403) throw lastErr; // bad key/request: don't retry
        if (res.status === 404 || res.status === 429) break; // model unavailable or quota exhausted: next model, don't burn quota
        if (attempt === 1) break; // 5xx overload: one retry, then fall back to the next model
        await new Promise((r) => setTimeout(r, 2500)); // back off before the retry
      }
    }
    throw lastErr || new Error("Gemini unavailable");
  }

  /** Run the multimodal analysis. Returns { json, model, ms, satellite }. */
  async function analyze({ scenario, result, towns, center, when, onStatus }) {
    const key = store.get("cs.geminiKey") || cfg().geminiKey;
    if (!key && !cfg().aiProxy) throw new Error("NO_KEY");
    onStatus && onStatus("Fetching NASA VIIRS satellite image…");
    let sat = null;
    try { sat = await root.CIF_FEEDS.satelliteSnapshot({ lat: center.lat, lon: center.lon, when }); } catch (e) { console.warn(e); }
    const ctx = buildContext(scenario, result, towns);
    const parts = [{ text: prompt(ctx, sat) }];
    if (sat) parts.push({ inline_data: { mime_type: sat.mime, data: sat.base64 } });
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingLevel: "low" } },
    };
    const out = await callGemini(body, key, onStatus);
    return { ...out, satellite: sat ? { url: sat.url, date: sat.date } : null, generatedAt: new Date().toISOString() };
  }

  /** Cached analysis committed to the repo (data/ai/<scenario>.json), if any. */
  async function cached(scenarioId) {
    try {
      const res = await fetch(`data/ai/${scenarioId}.json`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  root.CIF_AI = {
    analyze, cached, buildContext, prompt, SCHEMA, MODELS, LANG,
    getKey: () => store.get("cs.geminiKey") || "",
    setKey: (k) => store.set("cs.geminiKey", (k || "").trim()),
    hasAccess: () => !!(store.get("cs.geminiKey") || cfg().geminiKey || cfg().aiProxy),
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CIF_AI;
})(typeof globalThis !== "undefined" ? globalThis : this);
