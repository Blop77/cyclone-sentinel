/*
 * CycloneSentinel — early-warning advisory dispatch.
 *
 * Channels: webhook (JSON + CAP XML → Cloud Run relay, Google Chat, n8n, a
 * district control-room system…), e-mail (mailto), WhatsApp share, CAP 1.2 file.
 * Auto-dispatch sends every advisory at or above the chosen level after each
 * forecast run, once per (scenario, district, level).
 */
(function (root) {
  "use strict";

  const KEY = "cs.dispatch";
  const DEFAULTS = { webhook: "", emails: "", auto: false, minLevel: "orange", capStatus: "Exercise" };
  const RANK = { red: 0, orange: 1, yellow: 2 };
  const log = [];
  const sent = new Set();
  const listeners = [];

  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* ignore */ }
    const c = (root.CS_CONFIG || {}).dispatch || {};
    return { ...DEFAULTS, ...c, ...s };
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

  function record(entry) {
    log.unshift({ at: new Date(), ...entry });
    listeners.forEach((f) => f(log));
  }

  async function postWebhook(url, payload) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return { ok: res.ok, status: `HTTP ${res.status}` };
    } catch (e) {
      // Endpoints without CORS (Slack, some webhooks) still accept a "simple" request.
      await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) });
      return { ok: true, status: "sent (opaque, no-CORS endpoint)" };
    }
  }

  /** Dispatch one advisory over the configured webhook. */
  async function dispatch(adv, { scenario, auto = false } = {}) {
    const M = root.CIF_MODEL;
    const s = settings();
    const cap = M.toCAP(adv, { status: s.capStatus });
    const text = M.advisoryText(adv);
    const payload = {
      source: "CycloneSentinel", scenario, level: adv.levelLabel, district: adv.district, state: adv.state,
      recipients: adv.recipients, headline: adv.headline, text, cap_xml: cap, ai: adv.ai || null,
    };
    if (!s.webhook) {
      record({ adv, channel: "none", ok: false, status: "No webhook configured — open Settings", auto });
      return false;
    }
    try {
      const r = await postWebhook(s.webhook, payload);
      record({ adv, channel: "webhook", ok: r.ok, status: r.status, auto });
      return r.ok;
    } catch (e) {
      record({ adv, channel: "webhook", ok: false, status: e.message, auto });
      return false;
    }
  }

  /** Auto-dispatch after a forecast run. */
  async function autoDispatch(advisories, scenarioId) {
    const s = settings();
    if (!s.auto) return 0;
    let n = 0;
    for (const adv of advisories) {
      if (RANK[adv.level] > RANK[s.minLevel]) continue;
      const k = `${scenarioId}|${adv.id}`;
      if (sent.has(k)) continue;
      sent.add(k);
      if (await dispatch(adv, { scenario: scenarioId, auto: true })) n++;
    }
    return n;
  }

  function mailto(adv) {
    const s = settings();
    const body = root.CIF_MODEL.advisoryText(adv).slice(0, 1800);
    return `mailto:${encodeURIComponent(s.emails)}?subject=${encodeURIComponent(adv.headline)}&body=${encodeURIComponent(body)}`;
  }
  const whatsapp = (adv) => `https://wa.me/?text=${encodeURIComponent(root.CIF_MODEL.advisoryText(adv).slice(0, 1500))}`;

  function downloadCAP(adv) {
    const xml = root.CIF_MODEL.toCAP(adv, { status: settings().capStatus });
    const url = URL.createObjectURL(new Blob([xml], { type: "application/cap+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `CAP-${adv.id}.xml` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  root.CIF_DISPATCH = { settings, save, dispatch, autoDispatch, mailto, whatsapp, downloadCAP, log, onLog: (f) => listeners.push(f) };
})(typeof globalThis !== "undefined" ? globalThis : this);
