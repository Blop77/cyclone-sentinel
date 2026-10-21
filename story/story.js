/*
 * CycloneSentinel scroll story.
 * Each .scene is tall; its .sticky child stays on screen while the scene scrolls past, and the scene's
 * scroll progress p (0 → 1) drives every animation in it. Nothing runs on timers except the cyclone's
 * slow rotation, so the page (and a frame-by-frame video of it) is fully deterministic.
 */
(function () {
  "use strict";

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const range = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the video recorder sets window.__storyTime to step the storm deterministically
  const now = () => (window.__storyTime != null ? window.__storyTime : performance.now() / 1000);

  // ---------------- the cyclone (canvas) ----------------
  const cvs = $("#storm");
  const ctx = cvs.getContext("2d");
  let W = 0, H = 0, DPR = 1, R = 1, parts = [];

  function rng(seed) { // mulberry32
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function puff(rgb) {
    const s = 128, c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d"), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},0.42)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    return c;
  }
  const SPRITES = { white: puff("232,240,255"), blue: puff("70,140,255"), deep: puff("40,80,200"), gold: puff("255,186,110") };

  function build() {
    const rand = rng(11);
    const small = W < 800;
    const nPuffs = small ? 700 : 1500, nStreaks = small ? 700 : 1600;
    parts = [];
    const ARMS = 3;
    for (let i = 0; i < nPuffs + nStreaks; i++) {
      const streak = i >= nPuffs;
      // radius: dense eyewall just outside the eye, long tail in the spiral bands
      const r = 0.05 + Math.pow(rand(), 1.6) * 1.05;
      const arm = Math.floor(rand() * ARMS);
      const spread = (0.25 + r * 0.55) * (rand() - 0.5);
      const theta = arm * (2 * Math.PI / ARMS) + 2.2 * Math.log(r / 0.05) + spread;
      const band = Math.exp(-Math.pow((r - 0.12) / 0.07, 2)); // eyewall brightness
      const tone = rand();
      parts.push({
        r, theta, streak,
        size: streak ? 0 : (0.025 + rand() * 0.07) * (0.6 + r),
        alpha: streak ? 0.18 + 0.3 * rand() : (0.05 + 0.13 * rand()) * (0.55 + 1.6 * band),
        len: 0.05 + rand() * 0.18,
        sprite: tone < 0.62 ? SPRITES.white : tone < 0.85 ? SPRITES.blue : tone < 0.95 ? SPRITES.deep : SPRITES.gold,
      });
    }
  }
  function resize() {
    DPR = Math.min(2, devicePixelRatio || 1);
    W = cvs.clientWidth; H = cvs.clientHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    R = Math.max(W, H) * 0.62;
    build();
  }
  let zoom = 1, spinExtra = 0;
  function drawStorm() {
    const t = now();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#0b1d3a"); bg.addColorStop(0.55, "#051024"); bg.addColorStop(1, "#010308");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.globalCompositeOperation = "lighter";
    for (const q of parts) {
      // inner bands turn faster (northern-hemisphere cyclones turn anticlockwise)
      const a = q.theta - t * (0.16 / (q.r + 0.12)) - spinExtra;
      const x = Math.cos(a) * q.r * R, y = Math.sin(a) * q.r * R * 0.92;
      if (q.streak) {
        ctx.strokeStyle = `rgba(225,236,255,${q.alpha})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(0, 0, Math.hypot(x, y), Math.atan2(y, x), Math.atan2(y, x) + q.len, false);
        ctx.stroke();
      } else {
        const s = q.size * R;
        ctx.globalAlpha = q.alpha;
        ctx.drawImage(q.sprite, x - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }
    // the eye
    ctx.globalCompositeOperation = "source-over";
    const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.07 * R);
    eye.addColorStop(0, "rgba(3,10,24,0.95)"); eye.addColorStop(0.6, "rgba(3,10,24,0.6)"); eye.addColorStop(1, "rgba(3,10,24,0)");
    ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(0, 0, 0.07 * R, 0, Math.PI * 2); ctx.fill();
  }

  // ---------------- scenes ----------------
  // statement: split into words
  const statement = $("#statement");
  (function split(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((w) => {
          if (!w) return;
          if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(w));
          else { const s = document.createElement("span"); s.className = "w"; s.textContent = w; frag.appendChild(s); }
        });
        child.replaceWith(frag);
      } else split(child);
    }
  })(statement);
  const words = $$(".w", statement);

  const set = (el, op, tf) => { if (!el) return; if (op != null) el.style.opacity = op; if (tf != null) el.style.transform = tf; };

  const UPDATE = {
    hero(p, el) {
      zoom = lerp(1, 2.4, ease(range(p, 0, 0.55)));
      spinExtra = p * 1.4;
      const out = range(p, 0.03, 0.15);
      set($(".hero-intro", el), 1 - out, `translateY(${-50 * out}px)`);
      // the storm fades out inside the letters first, then the clean title fades in: no overlap
      const fin = range(p, 0.77, 0.87);
      set($(".mask", el), range(p, 0.16, 0.28) * (1 - range(p, 0.74, 0.78)));
      set($(".mask span", el), null, `scale(${lerp(10, 1, ease(range(p, 0.18, 0.62)))})`);
      set($(".hero-final", el), fin, `scale(${lerp(1.06, 1, fin)})`);
      set($(".hero-final p", el), range(p, 0.85, 0.95));
      set(cvs, 1 - range(p, 0.64, 0.75));
    },
    statement(p) {
      const on = Math.floor(range(p, 0.05, 0.82) * (words.length + 1));
      words.forEach((w, i) => w.classList.toggle("on", i < on));
    },
    numbers(p, el) {
      const h = range(p, 0, 0.16);
      set($(".eyebrow", el), h); set($(".title", el), h, `translateY(${30 * (1 - h)}px)`);
      $$(".stats div", el).forEach((d, i) => {
        const k = range(p, 0.18 + i * 0.09, 0.5 + i * 0.09);
        const b = $("b", d), n = +b.dataset.count;
        set(d, range(p, 0.14 + i * 0.09, 0.24 + i * 0.09), `translateY(${24 * (1 - k)}px)`);
        b.textContent = b.dataset.prefix ? (k > 0.5 ? `${b.dataset.prefix}${n}${b.dataset.suffix}` : "…") : Math.round(n * ease(k)).toLocaleString("en-IN");
      });
    },
    product(p, el) {
      const k = ease(range(p, 0.04, 0.5));
      const head = range(p, 0.28, 0.42);
      set($(".product-head", el), 1 - head, `translateY(${-40 * head}px)`);
      $(".device", el).style.top = `${lerp(62, 51, k)}%`;
      set($(".device", el), null, `translate(-50%, -50%) scale(${lerp(0.56, 1.02, k)})`);
      $$(".callouts li", el).forEach((c, i) => {
        const a = range(p, 0.56 + i * 0.1, 0.64 + i * 0.1);
        set(c, a, `translate(-50%, -50%) translateY(${16 * (1 - a)}px)`);
      });
    },
    pathway(p, el) {
      const h = range(p, 0, 0.12);
      set($(".eyebrow", el), h); set($(".title", el), h);
      $$(".chain li", el).forEach((li, i) => {
        const a = range(p, 0.12 + i * 0.15, 0.24 + i * 0.15);
        set(li, 0.12 + 0.88 * a, `translateY(${30 * (1 - a)}px)`);
      });
      set($(".caption", el), range(p, 0.76, 0.88));
    },
    radii(p, el) {
      [[".r3", 0.04, 0.3], [".r2", 0.14, 0.4], [".r1", 0.24, 0.5]].forEach(([s, a, b]) => {
        const k = ease(range(p, a, b));
        set($(s, el), Math.min(1, k * 1.5), `translate(-50%, -50%) scale(${k})`);
      });
      set($(".eye", el), null, `translate(-50%, -50%) rotate(${-p * 540}deg)`);
      const h = range(p, 0.02, 0.16);
      set($(".radii-text .eyebrow", el), h); set($(".radii-text .title", el), h, `translateY(${30 * (1 - h)}px)`);
      $$(".safe li", el).forEach((li, i) => {
        const a = range(p, 0.5 + i * 0.1, 0.6 + i * 0.1);
        set(li, a, `translateX(${40 * (1 - a)}px)`);
      });
    },
    gemini(p, el) {
      const h = range(p, 0, 0.12);
      set($(".gem-head", el), h, `translateY(${30 * (1 - h)}px)`);
      set($(".sat", el), range(p, 0.04, 0.16), `scale(${lerp(0.9, 1, ease(range(p, 0.04, 0.2)))})`);
      const scan = $(".scan", el), s = range(p, 0.14, 0.44);
      scan.style.top = `${s * 100}%`; scan.style.opacity = s > 0 && s < 1 ? 1 : 0;
      $$(".card", el).forEach((c, i) => {
        const a = range(p, 0.22 + i * 0.18, 0.32 + i * 0.18);
        set(c, a, `translateX(${50 * (1 - a)}px)`);
      });
    },
    dispatch(p, el) {
      const h = range(p, 0, 0.12);
      set($(".disp-head", el), h, `translateY(${30 * (1 - h)}px)`);
      const a = ease(range(p, 0.06, 0.4)), b = ease(range(p, 0.2, 0.55));
      set($(".f1", el), a, `translateX(${-60 * (1 - a)}vw) rotate(${-4 * (1 - a)}deg)`);
      set($(".f2", el), b, `translateX(${60 * (1 - b)}vw) rotate(${4 * (1 - b)}deg)`);
      $$(".chips span", el).forEach((c, i) => set(c, range(p, 0.58 + i * 0.06, 0.66 + i * 0.06)));
    },
    proof(p, el) {
      const h = range(p, 0, 0.12);
      set($(".proof-head", el), h, `translateY(${30 * (1 - h)}px)`);
      const track = $(".track", el);
      const dist = Math.max(0, track.scrollWidth - innerWidth + Math.max(16, innerWidth * 0.06));
      set(track, range(p, 0.08, 0.18), `translateX(${-dist * ease(range(p, 0.18, 0.9))}px)`);
    },
    close(p, el) {
      const a = range(p, 0, 0.3);
      set($(".big", el), a, `scale(${lerp(0.9, 1, ease(a))})`);
      set($(".sub", el), range(p, 0.2, 0.38));
      set($(".buttons", el), range(p, 0.32, 0.5));
      set($(".foot", el), range(p, 0.4, 0.55));
    },
  };

  const scenes = $$(".scene").map((el) => ({ el, fn: UPDATE[el.dataset.scene] }));
  const bar = $(".progress i");

  function update() {
    const vh = innerHeight;
    for (const s of scenes) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > 2 * vh) continue; // off screen
      const p = reduced ? 1 : clamp(-r.top / Math.max(1, s.el.offsetHeight - vh));
      s.fn && s.fn(p, s.el);
    }
    const doc = document.documentElement;
    bar.style.transform = `scaleX(${clamp(scrollY / Math.max(1, doc.scrollHeight - vh))})`;
  }
  function render() {
    update();
    const hero = scenes[0].el.getBoundingClientRect();
    if (hero.bottom > 0) drawStorm();
  }
  function loop() { render(); if (!reduced) requestAnimationFrame(loop); }

  addEventListener("resize", () => { resize(); render(); });
  resize();
  loop();
  window.__storyRender = render; // used by the video recorder
})();
