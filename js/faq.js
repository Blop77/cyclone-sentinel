/*
 * CycloneSentinel — FAQ chatbot ("💬 Ask").
 *
 * Answers questions about the project from docs/FAQ.md, README.md and
 * docs/METHODOLOGY.md:
 *   1. with Gemini (Cloud Run proxy or the viewer's key, via CIF_AI.generate),
 *      grounded in those documents only;
 *   2. otherwise by searching the FAQ entries, so it also works on GitHub Pages
 *      with no key at all.
 * Open it with the "💬 Ask" button or the #ask URL hash.
 */
(function (root) {
  "use strict";

  const DOCS = { faq: "docs/FAQ.md", readme: "README.md", methodology: "docs/METHODOLOGY.md" };
  const REPO = "https://github.com/Blop77/cyclone-sentinel/blob/main/docs/";
  const STARTERS = [
    "What problem does it solve?",
    "How accurate is it?",
    "What does Gemini do?",
    "Is the infrastructure data real?",
    "How is Google Earth Engine used?",
    "How does it scale to other states?",
  ];

  // ---------------- FAQ search (pure; also used by tests) ----------------
  const STOP = new Set(("a an and are as at be been by can could do does did for from has have how i if in into is it its " +
    "me my of on or our so than that the their them then there these they this to us was we were what when where which " +
    "who whom why will with would you your about any some just also tell explain please").split(" "));
  // Stem prefix → concept, so "validated", "accuracy" and "hindcast" meet in the same place.
  // Prefixes match stemmed words ("mistakes" → "mistak"); prefixes of 3 letters or fewer must match exactly.
  const CONCEPTS = [
    ["accuracy", ["accura", "valid", "hindcast", "test", "reliab", "proof", "correct", "precis", "verif"]],
    ["gemini", ["gemini", "ai", "llm", "genai", "artificial", "intelligen", "multimodal"]],
    ["earth", ["gee", "earth", "engine"]],
    ["data", ["data", "dataset", "source", "inventor"]],
    ["cost", ["cost", "pric", "expens", "cheap", "money", "budget", "afford"]],
    ["scale", ["scal", "expand", "countr", "brics", "nationwide", "replicat"]],
    ["offline", ["offline", "internet", "connectiv", "network", "outag"]],
    ["warning", ["warn", "alert", "advisor", "dispatch", "notif", "sms", "whatsapp", "email"]],
    ["critical", ["critical", "priorit", "rank", "important", "weight"]],
    ["real", ["real", "synthetic", "fake", "actual", "genuine", "dummy", "mock"]],
    ["key", ["key", "secur", "safe", "secret", "privacy"]],
    ["limit", ["limit", "weakness", "drawback", "next", "future", "improv", "roadmap", "challeng"]],
    ["tech", ["stack", "tech", "framework", "built", "librar", "python", "javascript", "fastapi", "leaflet"]],
    ["ensemble", ["ensemble", "member", "uncertain", "probabil"]],
    ["fragility", ["fragil", "vulnerab", "curv"]],
    ["cascade", ["cascad", "domino", "depend", "knock"]],
    ["colour", ["colour", "color", "red", "orange", "yellow", "imd"]],
    ["cap", ["cap", "sachet", "protocol", "standard"]],
    ["mistak", ["mistake", "hallucinat", "wrong", "error", "trust", "bias"]],
    ["link", ["demo", "link", "video", "url", "websit", "github", "youtube"]],
    ["chatbot", ["chatbot", "bot", "faq", "chat", "assistant"]],
    ["live", ["live", "realtime", "current", "today"]],
    ["area", ["cover", "area", "region", "odisha", "andhra", "bengal", "coast"]],
    ["problem", ["problem", "issu", "motivat", "pain", "solve", "gap"]],
    ["user", ["user", "customer", "authorit", "collector", "ddma", "official", "government", "stakeholder"]],
  ];

  function stem(w) {
    return w.length > 4 ? w.replace(/(ations?|ings?|ities|ity|ness|ies|ed|es|s)$/, "") : w;
  }

  function tokens(text) {
    const out = [];
    for (const raw of String(text).toLowerCase().normalize("NFKD").match(/[a-z0-9]+/g) || []) {
      if (STOP.has(raw)) continue;
      const s = stem(raw);
      const concept = CONCEPTS.find(([, prefixes]) => prefixes.some((p) => (p.length <= 3 ? s === p : s.startsWith(p))));
      out.push(concept ? concept[0] : s);
    }
    return out;
  }

  /** "### Question" headings followed by answer text → [{ q, a, section }]. */
  function parseFaq(md) {
    const entries = [];
    let section = "", cur = null;
    for (const line of String(md).split(/\r?\n/)) {
      const h2 = line.match(/^##\s+(.*)/), h3 = line.match(/^###\s+(.*)/);
      if (h3) { cur = { q: h3[1].trim(), a: "", section }; entries.push(cur); }
      else if (h2) { section = h2[1].trim(); cur = null; }
      else if (cur) cur.a += line + "\n";
    }
    for (const e of entries) e.a = e.a.trim();
    return entries.filter((e) => e.a);
  }

  /** Rank FAQ entries for a question: concept/stem overlap, weighted by rarity, question text counts triple. */
  function search(question, entries, limit = 3) {
    const query = [...new Set(tokens(question))];
    if (!query.length) return [];
    const docs = entries.map((e) => ({ e, q: new Set(tokens(e.q)), a: new Set(tokens(e.a)) }));
    const df = (t) => docs.filter((d) => d.q.has(t) || d.a.has(t)).length;
    const idf = Object.fromEntries(query.map((t) => [t, Math.log(1 + docs.length / (1 + df(t)))]));
    return docs
      .map((d) => {
        const shared = query.filter((t) => d.q.has(t)).length;
        const score = query.reduce((s, t) => s + idf[t] * ((d.q.has(t) ? 3 : 0) + (d.a.has(t) ? 1 : 0)), 0)
          + shared / Math.max(1, d.q.size); // tie-break: the FAQ question the user's words cover most completely
        return { ...d.e, inQuestion: shared > 0, score };
      })
      .filter((r) => r.inQuestion && r.score >= 1.5) // must share a word with the FAQ question itself, not just its answer
      .sort((x, y) => y.score - x.score)
      .slice(0, limit);
  }

  // ---------------- rendering (escape first, then a little Markdown) ----------------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const href = (u) => (/^https?:/.test(u) ? u : new URL(u, REPO).href);
  function inline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(href(u.replace(/&amp;/g, "&")))}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  /** Paragraphs (wrapped lines joined), "-"/"*" and "1." lists with indented continuation lines. */
  function render(md) {
    const marker = /^\s*(\d+\.|[-*])\s+/;
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
    for (const raw of String(md).trim().split("\n")) {
      const line = raw.trim(), m = raw.match(marker);
      if (!line) { flushPara(); flushList(); }
      else if (m) {
        flushPara();
        const tag = /\d/.test(m[1]) ? "ol" : "ul";
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push(raw.replace(marker, ""));
      } else if (list && /^\s/.test(raw)) list.items[list.items.length - 1] += " " + line;
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return out.join("");
  }

  // ---------------- Gemini ----------------
  const ANSWER_SCHEMA = {
    type: "OBJECT",
    properties: {
      answer: { type: "STRING", description: "The answer in plain language, Markdown allowed (bold, short lists, links)" },
      in_docs: { type: "BOOLEAN", description: "true if the documents contain the answer" },
    },
    required: ["answer", "in_docs"],
  };

  function systemPrompt(docs) {
    return `You are the FAQ assistant for CycloneSentinel, a hackathon project by Team Nebula Nomads. Hackathon judges and
visitors ask you about the project. Answer ONLY from the documents below.

Rules:
- Be accurate. Use only facts and numbers that appear in the documents; never invent results, users, partners or numbers.
- If the documents don't contain the answer, say so plainly and suggest asking the team. Set in_docs to false.
- Be honest about limitations the documents state (synthetic asset inventory, indicative fragility parameters,
  the Earth Engine output not yet committed, advisories marked Exercise), whenever they are relevant.
- Keep answers short: 2–5 sentences or a short list. Plain language a non-expert understands; explain jargon briefly.
- Answer in the language of the question.

=== docs/FAQ.md ===
${docs.faq}

=== README.md ===
${docs.readme}

=== docs/METHODOLOGY.md ===
${docs.methodology}`;
  }

  async function askGemini(question, turns, docs, onStatus) {
    const contents = turns.slice(-6).map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    contents.push({ role: "user", parts: [{ text: question }] });
    const out = await root.CIF_AI.generate({
      systemInstruction: { parts: [{ text: systemPrompt(docs) }] },
      contents,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: ANSWER_SCHEMA, thinkingConfig: { thinkingLevel: "low" } },
    }, onStatus);
    return { text: out.json.answer, model: out.model };
  }

  // ---------------- UI ----------------
  function mount() {
    const panel = document.getElementById("faq");
    const openBtn = document.getElementById("open-faq");
    if (!panel || !openBtn) return;
    const log = panel.querySelector(".faq-log");
    const form = panel.querySelector("form");
    const input = form.querySelector("input");
    const mode = panel.querySelector(".faq-mode");
    const turns = []; // chat history sent to Gemini
    let docs = null, entries = [], busy = false;

    const gemini = () => !!(root.CIF_AI && root.CIF_AI.hasAccess());
    const setMode = () => { mode.textContent = gemini() ? "✦ Gemini · answers from project docs" : "FAQ search · add a Gemini key in ⚙ Settings for free-form answers"; };

    async function loadDocs() {
      if (docs) return docs;
      const get = async (p) => { try { const r = await fetch(p, { cache: "no-store" }); return r.ok ? await r.text() : ""; } catch { return ""; } };
      const [faq, readme, methodology] = await Promise.all([get(DOCS.faq), get(DOCS.readme), get(DOCS.methodology)]);
      docs = { faq, readme, methodology };
      entries = parseFaq(faq);
      return docs;
    }

    function bubble(who, html) {
      const div = document.createElement("div");
      div.className = `faq-msg ${who}`;
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }
    function chips(questions, label) {
      if (!questions.length) return;
      const wrap = bubble("chips", label ? `<span class="faq-chips-label">${esc(label)}</span>` : "");
      for (const q of questions) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "faq-chip"; b.textContent = q;
        b.addEventListener("click", () => ask(q));
        wrap.appendChild(b);
      }
    }

    function answerFromFaq(question, note) {
      const hits = search(question, entries);
      if (!hits.length) {
        bubble("bot", `<p>${note ? esc(note) + " " : ""}I couldn't find that in the FAQ. Try one of these, or ask the team directly.</p>`);
        chips(STARTERS.slice(0, 4));
        return "";
      }
      const [top, ...rest] = hits;
      bubble("bot", `${note ? `<p class="faq-note">${esc(note)}</p>` : ""}<p class="faq-src">From the FAQ: <b>${esc(top.q)}</b></p>${render(top.a)}`);
      chips(rest.filter((r) => r.score >= top.score * 0.5).map((r) => r.q), "Related");
      return top.a;
    }

    async function ask(question) {
      question = question.trim();
      if (!question || busy) return;
      busy = true; input.value = ""; input.disabled = true;
      log.querySelectorAll(".faq-msg.chips").forEach((c) => c.remove());
      bubble("user", `<p>${esc(question)}</p>`);
      const thinking = bubble("bot thinking", "<p>Thinking…</p>");
      let reply = "";
      try {
        await loadDocs();
        setMode();
        if (gemini() && docs.faq) {
          try {
            const out = await askGemini(question, turns, docs, (s) => { thinking.innerHTML = `<p>${esc(s)}</p>`; });
            thinking.remove();
            bubble("bot", `${render(out.text)}<p class="faq-meta">✦ ${esc(out.model)} · from the project docs</p>`);
            reply = out.text;
          } catch (e) {
            console.warn(e);
            thinking.remove();
            reply = answerFromFaq(question, "Gemini is unavailable right now, so here is the closest FAQ answer.");
          }
        } else {
          thinking.remove();
          reply = docs.faq ? answerFromFaq(question) : (bubble("bot", "<p>Couldn't load the FAQ. Please read docs/FAQ.md on GitHub.</p>"), "");
        }
      } finally {
        if (thinking.isConnected) thinking.remove();
        turns.push({ role: "user", text: question });
        if (reply) turns.push({ role: "model", text: reply });
        busy = false; input.disabled = false; input.focus();
      }
    }

    function open() {
      panel.hidden = false;
      openBtn.setAttribute("aria-expanded", "true");
      setMode();
      if (!log.children.length) {
        bubble("bot", "<p>Hi! I answer questions about <b>CycloneSentinel</b>: the problem, how the model works, the data, Gemini, validation and next steps. Ask anything, or pick a question.</p>");
        chips(STARTERS);
      }
      loadDocs();
      input.focus();
    }
    function close() {
      panel.hidden = true;
      openBtn.setAttribute("aria-expanded", "false");
      if (location.hash === "#ask") root.history.replaceState(null, "", location.pathname + location.search);
      openBtn.focus();
    }

    openBtn.addEventListener("click", () => (panel.hidden ? open() : close()));
    panel.querySelector(".faq-close").addEventListener("click", close);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
    if (location.hash === "#ask") open();
    root.addEventListener("hashchange", () => { if (location.hash === "#ask") open(); });
  }

  root.CIF_FAQ = { parseFaq, search, tokens, render };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CIF_FAQ;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
