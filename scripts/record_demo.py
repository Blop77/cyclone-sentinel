"""
Record a captioned, narrated demo video of CycloneSentinel with Playwright.

    pip install playwright edge-tts imageio-ffmpeg && python -m playwright install chromium
    GEMINI_API_KEY=... uvicorn server.main:app --port 8080   # backend: Gemini proxy + inbox
    python scripts/record_demo.py         # -> video/cyclonesentinel-demo.mp4 (with voice-over)

Options:
    --url URL        record another deployment, e.g. https://<user>.github.io/<repo>/
    --voice NAME     edge-tts voice (default en-IN-NeerjaNeural; try en-IN-PrabhatNeural, en-US-AndrewNeural)
    --silent         skip narration, write video/cyclonesentinel-demo.webm only

Each scene waits for its narration line to finish, so voice and visuals stay in sync.
"""
import argparse
import asyncio
import json
import pathlib
import re
import shutil
import subprocess
import time

from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8080/")
ap.add_argument("--voice", default="en-IN-NeerjaNeural")
ap.add_argument("--silent", action="store_true")
ap.add_argument("--skip-ai", action="store_true", help="skip the Gemini scene (dry runs)")
ARGS = ap.parse_args()

URL = ARGS.url
OUT = pathlib.Path(__file__).resolve().parent.parent / "video"
W, H = 1920, 1080
GAP = 0.45  # seconds of silence between narration lines

NARRATION = {
    "title": "This is CycloneSentinel: an AI-powered platform that forecasts cyclone impact on critical infrastructure, and warns the right authorities before landfall.",
    "problem": "Warnings tell us where a storm will go. Disaster managers need to know what will break: which hospitals, substations and roads will fail, and who must be warned.",
    "fani": "Here we replay Cyclone Fani, from 2019, as if the forecast were issued twenty-four hours before landfall. Underneath is the real NASA VIIRS satellite image of Fani that day.",
    "swath": "Our physics engine runs forty ensemble tracks and simulates wind, storm surge and rainfall at five hundred and eleven assets, in under a second.",
    "play": "As the storm moves, each asset lights up when the peak hazard reaches it.",
    "kpis": "The impact dashboard: expected losses, people exposed to very severe winds, about nine lakh people likely to lose power, twenty hospitals and shelters likely cut off, and nine arterial roads likely impassable.",
    "pathways": "These are rainfall damage pathways. About three hundred millimetres of rain puts water on the Puri to Konark road, the road becomes impassable, and Puri Hospital is cut off, even though the building itself survives.",
    "popup": "Every asset explains its own causal chain: rainfall, ponding, wind, physical damage, loss of its grid feed, and loss of road access.",
    "advisories": "From risk to warning. CycloneSentinel writes district advisories on the I.M.D. colour code, with Red for Puri and Jagatsinghpur. Each one is routed to the District Collector, the municipal bodies, the state disaster authority, the power utility and the health officer.",
    "dispatch": "With auto-dispatch on, every Red and Orange advisory is sent automatically, as a CAP alert: the format India's SACHET system uses.",
    "inbox": "And here they arrive, in the district control-room inbox served by our Google Cloud Run backend.",
    "ai": "Now, Google Gemini. We send it the real satellite image of the storm, together with the impact model's output.",
    "ai2": "Gemini reads the storm's structure, checks the imagery against our hotspots, explains the rainfall damage pathways, and drafts advisories in English and Odia, ready to dispatch.",
    "live": "It also runs in real time. Live mode pulls the latest seventy-two hour forecast for every coastal town and runs the same chain, from hazard to advisory.",
    "how": "Google Earth Engine layers, NASA satellite feeds, real-time weather, a physics ensemble, Gemini multimodal reasoning, and automated CAP dispatch on Cloud Run, validated against four historical cyclones.",
    "outro": "CycloneSentinel. From satellite to action, before landfall.",
}

OVERLAY_JS = """
() => {
  const css = document.createElement('style');
  css.textContent = `
    #demo-cap { position: fixed; left: 50%; top: 84px; transform: translateX(-50%); z-index: 99999;
      max-width: 1000px; padding: 14px 22px; border-radius: 12px; font: 600 22px/1.35 system-ui, sans-serif;
      color: #fff; background: rgba(13,13,13,.88); border: 1px solid rgba(255,255,255,.15);
      box-shadow: 0 10px 40px rgba(0,0,0,.6); text-align: center; transition: opacity .35s; opacity: 0; pointer-events: none; }
    #demo-cap small { display: block; font-weight: 400; font-size: 16px; color: #c3c2b7; margin-top: 4px; }
    #demo-card { position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 18px; background: radial-gradient(circle at 50% 40%, #1c2b44, #0d0d0d 70%);
      color: #fff; font-family: system-ui, sans-serif; text-align: center; transition: opacity .6s; }
    #demo-card h1 { font-size: 64px; margin: 0; }
    #demo-card p { font-size: 26px; color: #c3c2b7; margin: 0; max-width: 1100px; }
    #demo-card .big { font-size: 90px; }
    #demo-cursor { position: fixed; z-index: 100001; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(255,255,255,.35); border: 2px solid #fff; pointer-events: none; transition: transform .12s; }
    #demo-cursor.down { transform: scale(.7); background: rgba(57,135,229,.7); }`;
  document.head.appendChild(css);
  const cap = Object.assign(document.createElement('div'), { id: 'demo-cap' });
  const cur = Object.assign(document.createElement('div'), { id: 'demo-cursor' });
  document.body.append(cap, cur);
  addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => cur.classList.add('down'), true);
  addEventListener('mouseup', () => cur.classList.remove('down'), true);
  window.demoCaption = (html) => { cap.innerHTML = html; cap.style.opacity = html ? 1 : 0; };
  window.demoCard = (html) => {
    let c = document.getElementById('demo-card');
    if (!html) { if (c) { c.style.opacity = 0; setTimeout(() => c.remove(), 700); } return; }
    if (!c) { c = Object.assign(document.createElement('div'), { id: 'demo-card' }); document.body.appendChild(c); }
    c.innerHTML = html; c.style.opacity = 1;
  };
}
"""

_FFMPEG = None


def ffmpeg():
    global _FFMPEG
    if _FFMPEG is None:
        import imageio_ffmpeg
        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
    return _FFMPEG


def audio_seconds(path):
    err = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def synthesize():
    import edge_tts
    vdir = OUT / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    durations = {}
    for key, text in NARRATION.items():
        path = vdir / f"{key}.mp3"
        await edge_tts.Communicate(text, ARGS.voice, rate="+4%").save(str(path))
        durations[key] = audio_seconds(path)
        print(f"  voice {key:8s} {durations[key]:5.1f}s")
    return durations


def mux(webm, timeline, out):
    """Lay each narration clip at its scene's start time and encode an MP4."""
    vdir = OUT / "voice"
    cmd = [ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(webm)]
    for key, _ in timeline:
        cmd += ["-i", str(vdir / f"{key}.mp3")]
    parts = [f"[{i + 1}:a]adelay={int(t * 1000)}:all=1[a{i}]" for i, (_, t) in enumerate(timeline)]
    mix = "".join(f"[a{i}]" for i in range(len(timeline))) + f"amix=inputs={len(timeline)}:normalize=0:dropout_transition=0[aout]"
    cmd += ["-filter_complex", ";".join(parts + [mix]), "-map", "0:v", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)


def write_srt(timeline, out):
    """Subtitles timed to the narration clips (≤ 2 lines × 42 chars per cue)."""
    import textwrap
    fix = {"I.M.D.": "IMD", "twenty-four hours": "24 hours", "five hundred and eleven": "511",
           "seventy-two hour": "72-hour", "nine lakh": "9 lakh", "twenty hospitals": "20 hospitals",
           "nine arterial": "9 arterial", "three hundred millimetres": "300 mm", "forty ensemble": "40 ensemble"}
    ts = lambda t: "%02d:%02d:%02d,%03d" % (t // 3600, t % 3600 // 60, t % 60, round(t * 1000) % 1000)
    cues = []
    for key, start in timeline:
        text = NARRATION[key]
        for a, b in fix.items():
            text = text.replace(a, b)
        dur = audio_seconds(OUT / "voice" / f"{key}.mp3") - 0.15
        parts, chunks, cur = re.split(r"(?<=[.:?!,])\s+", text), [], ""
        for p in parts:
            if cur and len(cur) + 1 + len(p) > 84:
                chunks.append(cur); cur = p
            else:
                cur = (cur + " " + p).strip()
        if cur:
            chunks.append(cur)
        total, t = sum(len(c) for c in chunks), start
        for c in chunks:
            span = dur * len(c) / total
            cues.append(f"{len(cues) + 1}\n{ts(t)} --> {ts(t + span - 0.05)}\n" + "\n".join(textwrap.wrap(c, 42)) + "\n")
            t += span
    out.write_text("\n".join(cues), encoding="utf-8")


async def main():
    OUT.mkdir(exist_ok=True)
    durations = {} if ARGS.silent else await synthesize()
    timeline = []

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": W, "height": H}, record_video_dir=str(OUT), record_video_size={"width": W, "height": H})
        page = await ctx.new_page()
        t0 = time.monotonic()  # video recording starts with the page
        busy_until = [0.0]

        async def scene(key):
            """Start narration line `key` once the previous line has finished."""
            wait = busy_until[0] - time.monotonic()
            if wait > 0:
                await page.wait_for_timeout(int(wait * 1000))
            if key in durations:
                timeline.append((key, time.monotonic() - t0))
                busy_until[0] = time.monotonic() + durations[key] + GAP

        async def cap(text, hold=0):
            await page.evaluate("t => demoCaption(t)", text)
            if hold:
                await page.wait_for_timeout(hold)

        async def click(selector, hold=600):
            box = await page.locator(selector).first.bounding_box()
            await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=25)
            await page.wait_for_timeout(250)
            await page.locator(selector).first.click()
            await page.wait_for_timeout(hold)

        async def select(selector, value, hold=500):
            box = await page.locator(selector).bounding_box()
            await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=25)
            await page.wait_for_timeout(300)
            await page.select_option(selector, value)
            await page.wait_for_timeout(hold)

        async def run_forecast():
            await click("#run", 400)
            await page.wait_for_function("!document.getElementById('run').disabled")
            await page.wait_for_timeout(2200)

        async def play_storm():
            await click("#play", 200)
            await page.wait_for_function("!CycloneSentinel.state.playing", timeout=60000)
            await page.wait_for_timeout(800)

        await page.goto(URL)
        await page.wait_for_function("window.CycloneSentinel && CycloneSentinel.state.result", timeout=60000)
        await page.evaluate(OVERLAY_JS)
        await page.evaluate("() => { const s = CIF_DISPATCH.settings(); CIF_DISPATCH.save({ ...s, auto: false }); }")
        await page.mouse.move(W / 2, H / 2)

        # 1 — title + problem
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>AI-powered cyclone impact &amp; infrastructure vulnerability forecaster</p>
            <p style="font-size:22px">Gemini 3.7 Flash · Google Earth Engine · Cloud Run · NASA satellite feeds · real-time weather</p>`)""")
        await page.wait_for_timeout(600)
        await scene("title")
        await page.wait_for_timeout(3000)
        await scene("problem")
        await page.evaluate("""demoCard(`<h1 style="font-size:44px">The problem</h1>
            <p>Warnings say <b>where</b> the storm goes.<br>Responders need to know <b>what breaks</b> — and <b>who to warn</b> — before landfall.</p>`)""")
        await page.wait_for_timeout(4000)

        # 2 — Fani replay on the real satellite image
        await scene("fani")
        await page.evaluate("demoCard('')")
        await click("#l-sat", 300)
        await cap("Replaying <b>Cyclone Fani (2019)</b>, forecast issued 24 h before landfall<small>under it: the real NASA VIIRS satellite image, 2 May 2019</small>", 6000)
        await scene("swath")
        await click("#l-sat", 300)
        await cap("40-member ensemble · wind, storm surge &amp; rainfall at 511 assets · &lt; 1 s in the browser", 4000)
        await scene("play")
        await cap("Assets light up as the storm's peak hazard reaches them")
        await page.wait_for_timeout(800)
        await play_storm()

        # 3 — KPIs, pathways, popup
        await scene("kpis")
        await page.mouse.move(1700, 400, steps=30)
        await cap("Impact: ~9 lakh people likely without power · 20 hospitals &amp; shelters likely cut off · 9 arterial roads impassable", 6000)
        await scene("pathways")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 560, behavior: 'smooth'})")
        await cap("<b>Rainfall damage pathways</b>: rain → flooded arterial road → hospital cut off", 3500)
        pid = await page.evaluate("(CycloneSentinel.state.result.summary.rainPathways.find(p => p.id.includes('hospital')) || CycloneSentinel.state.result.summary.rainPathways[0]).id")
        await scene("popup")
        await click(f'#pathways li[data-id="{pid}"]', 2200)
        await cap("Each asset's causal chain: hazard → damage → grid feed → road access → service outcome", 5000)
        await page.evaluate("() => { CycloneSentinel.map.closePopup(); }")

        # 4 — advisories + dispatch + inbox
        await scene("advisories")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 0, behavior: 'smooth'})")
        await click('[data-tab="advisories"]', 600)
        await cap("District advisories on the IMD colour code · routed to DDMA, municipal bodies, SDMA, DISCOM, health", 3000)
        await click('#advisories .adv summary', 2500)
        await scene("dispatch")
        await click("#auto-dispatch", 500)
        await cap("Auto-dispatch ON · every Red &amp; Orange advisory sent as CAP 1.2 (SACHET format)")
        await click("#dispatch-all", 2500)
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 99999, behavior: 'smooth'})")
        await page.wait_for_timeout(2500)
        await scene("inbox")
        await cap("")
        await page.evaluate("""demoCard(`<iframe src="inbox" style="width:1200px;height:860px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:#0d0d0d"></iframe>
            <p style="font-size:20px">District control-room inbox · Google Cloud Run backend</p>`)""")
        await page.wait_for_timeout(6500)
        await page.evaluate("demoCard('')")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 0})")

        # 5 — Gemini multimodal analyst
        if not ARGS.skip_ai:
            await scene("ai")
            await click('[data-tab="ai"]', 500)
            await cap("<b>Google Gemini</b> multimodal analyst · input: NASA satellite image + impact-model output")
            if not await page.evaluate("!!(CycloneSentinel.state.ai)"):  # no saved analysis → call Gemini live
                await click("#ai-run", 500)
                await page.wait_for_function("!document.getElementById('ai-run').disabled", timeout=420000)
            await page.wait_for_timeout(2500)
            await page.evaluate("document.querySelector('.impact').scrollTo({top: 200, behavior: 'smooth'})")
            await page.wait_for_timeout(3000)
            await scene("ai2")
            await cap("Gemini: satellite reading · imagery-vs-model check · pathways · advisories in English + Odia")
            for top in (300, 900, 1500, 2300):
                await page.evaluate(f"document.querySelector('.impact').scrollTo({{top: {top}, behavior: 'smooth'}})")
                await page.wait_for_timeout(3200)
            btn = page.locator("#ai-output [data-ai]").first
            if await btn.count():
                await btn.scroll_into_view_if_needed()
                await btn.click()
                await page.wait_for_timeout(2500)

        # 6 — live mode
        await scene("live")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 0})")
        await click('[data-tab="impact"]', 300)
        await cap("<b>Live mode</b>: real-time 72 h forecast for every coastal town (Open-Meteo)")
        await select("#scenario", "live", 400)
        await click("#run", 400)
        await page.wait_for_function("CycloneSentinel.state.result.mode === 'live' && !document.getElementById('run').disabled", timeout=60000)
        await page.wait_for_timeout(1000)
        await click("#l-sat", 300)
        await cap("<b>Live mode</b>: real-time 72 h forecast for every coastal town · latest NASA VIIRS satellite pass")
        await page.evaluate("document.getElementById('live-card').scrollIntoView({behavior: 'smooth', block: 'start'})")
        await page.wait_for_timeout(5000)
        await click("#l-sat", 200)

        # 7 — outro
        await scene("how")
        await cap("")
        await page.evaluate("""demoCard(`<h1 style="font-size:46px">How it works</h1>
            <p>Google Earth Engine exposure layers · NASA VIIRS &amp; GPM IMERG · Open-Meteo real-time<br>
            40-member physics ensemble · surge · rainfall pathways · power &amp; road cascades<br>
            <b>Gemini 3.7 Flash</b> multimodal analyst · CAP 1.2 auto-dispatch on <b>Cloud Run</b></p>
            <p style="font-size:22px">Hindcast-validated on Fani, Amphan, Phailin &amp; Hudhud · open source</p>`)""")
        await page.wait_for_timeout(6000)
        await scene("outro")
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>From satellite to action — before landfall.</p>
            <p style="font-size:22px">blop77.github.io/cyclone-sentinel · github.com/Blop77/cyclone-sentinel · Team Nebula Nomads</p>`)""")
        await page.wait_for_timeout(3500)
        await scene("end")
        await page.wait_for_timeout(1200)

        video = page.video
        await ctx.close()
        await browser.close()
        webm = OUT / "cyclonesentinel-demo.webm"
        shutil.move(str(pathlib.Path(await video.path())), webm)
        print(f"Saved {webm}")

    if not ARGS.silent:
        (OUT / "timeline.json").write_text(json.dumps(timeline, indent=1))
        mp4 = OUT / "cyclonesentinel-demo.mp4"
        mux(webm, timeline, mp4)
        print(f"Saved {mp4}")
        srt = OUT / "cyclonesentinel-demo.srt"
        write_srt(timeline, srt)
        print(f"Saved {srt}")


asyncio.run(main())
