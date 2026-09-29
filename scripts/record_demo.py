"""
Record a captioned, narrated demo video of CycloneSentinel with Playwright.

    pip install playwright edge-tts imageio-ffmpeg && python -m playwright install chromium
    python -m http.server 8000            # in the repo root, separate terminal
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
ap.add_argument("--url", default="http://localhost:8000/index.html")
ap.add_argument("--voice", default="en-IN-NeerjaNeural")
ap.add_argument("--silent", action="store_true")
ARGS = ap.parse_args()

URL = ARGS.url
OUT = pathlib.Path(__file__).resolve().parent.parent / "video"
W, H = 1920, 1080
GAP = 0.45  # seconds of silence between narration lines

NARRATION = {
    "title": "This is CycloneSentinel: a cyclone impact and infrastructure vulnerability forecaster.",
    "problem": "Cyclone warnings tell us where a storm will go. But disaster managers, power utilities and hospitals need to know what will break, and what fails next when the grid goes down.",
    "fani": "Here we replay Cyclone Fani, from 2019, as if the forecast were issued twenty-four hours before landfall. Forty ensemble tracks and four hundred and seventy-five infrastructure assets are simulated right in the browser, in about half a second.",
    "swath": "The blue swath is the forecast peak wind, by I.M.D. category. The faint lines show the spread of possible tracks.",
    "play": "Now let's play the storm. Each asset lights up as the peak winds reach it.",
    "colors": "Red and orange mark a high probability of losing service.",
    "kpis": "The dashboard sums it up: expected infrastructure loss, people exposed to very severe winds, people likely to lose power, and residents who need evacuation.",
    "types": "Kutcha housing, power lines and telecom towers are the first to fail.",
    "actions": "Most importantly, risk becomes action. Evacuations to named shelters, generators for hospitals, and restoration crews for substations, all ranked by risk, criticality, and the number of people served.",
    "popup": "Every asset explains itself: peak wind with its uncertainty range, storm surge, rainfall, and its fragility curve.",
    "cascade": "This hospital will probably stay standing, but its feeder substation is likely to trip. That is a cascading failure, the kind of grid collapse seen in Puri and Visakhapatnam.",
    "lead": "If we issue the forecast seventy-two hours out instead, the uncertainty grows and the risk spreads along the coast. That's the honest picture a planner needs.",
    "amphan": "Super Cyclone Amphan, 2020. The shallow head of the Bay amplifies storm surge, and the risk concentrates on Sagar Island and the Hooghly estuary.",
    "whatif": "In planning mode, we can design our own storm. Here, a two hundred and thirty kilometre per hour super cyclone strikes Paradip port.",
    "whatif2": "Paradip's port, substations and coastal housing are flagged critical, before the storm even exists.",
    "filter": "We can also filter down to lifeline infrastructure: hospitals, substations and water supply.",
    "how": "Under the hood: a Holland wind model, parametric storm surge, rainfall flooding, a Monte Carlo ensemble, fragility curves, and a power-dependency cascade, validated against four historical cyclones.",
    "outro": "CycloneSentinel. From track forecast to actionable infrastructure risk, in under a second.",
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
        await page.wait_for_function("window.CycloneSentinel && CycloneSentinel.state.result")
        await page.evaluate(OVERLAY_JS)
        await page.mouse.move(W / 2, H / 2)

        # 1 — title + problem
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>Cyclone Impact &amp; Infrastructure Vulnerability Forecaster</p>
            <p style="font-size:22px">Know which hospitals, substations, towers and homes will fail — before landfall.</p>`)""")
        await page.wait_for_timeout(600)
        await scene("title")
        await page.wait_for_timeout(3500)
        await scene("problem")
        await page.evaluate("""demoCard(`<h1 style="font-size:44px">The problem</h1>
            <p>Cyclone warnings tell us where the storm goes.<br>Disaster managers need to know <b>what breaks</b> —
            and what fails next when the grid goes down.</p>`)""")
        await page.wait_for_timeout(5000)

        # 2 — Fani replay
        await scene("fani")
        await page.evaluate("demoCard('')")
        await cap("Replaying <b>Cyclone Fani (2019)</b> as a forecast issued 24 h before landfall<small>40-member ensemble · 475 infrastructure assets · runs entirely in the browser</small>", 5000)
        await scene("swath")
        await cap("Blue swath = forecast peak wind by IMD class · faint lines = ensemble track uncertainty", 4500)
        await scene("play")
        await cap("Press play: assets light up as the storm's peak winds reach them")
        await page.wait_for_timeout(1500)
        await play_storm()
        await scene("colors")
        await cap("Red / orange = high probability of service disruption", 3000)

        # 3 — impact panel
        await scene("kpis")
        await page.mouse.move(1700, 330, steps=30)
        await cap("Impact dashboard: expected loss, people in ≥118 km/h winds, people losing power, evacuation need", 5000)
        await scene("types")
        await page.mouse.move(1700, 700, steps=30)
        await cap("Damage by infrastructure type — housing and power lines fail first", 3500)

        # 4 — actions + popup (cascade)
        await scene("actions")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 620, behavior: 'smooth'})")
        await cap("Auto-generated priority actions, ranked by risk × criticality × people served", 4000)
        hosp = await page.evaluate("""(() => { const a = CycloneSentinel.state.result.actions;
            const h = a.find(x => x.id.includes('hospital')) || a.find(x => x.id.includes('substation')) || a[0]; return h.id; })()""")
        await scene("popup")
        await click(f'#actions li[data-id="{hosp}"]', 1800)
        await cap("Every asset: peak wind with P10–P90 range, surge, rainfall and its fragility curve", 4000)
        await scene("cascade")
        await cap("<b>Cascading failure</b>: a hospital can stay standing and still go dark when its feeder substation trips", 5000)

        # 5 — lead time
        await scene("lead")
        await page.keyboard.press("Escape")
        await page.evaluate("() => { CycloneSentinel.map.closePopup(); }")
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 0, behavior: 'smooth'})")
        await cap("Issue the forecast 72 h out instead — uncertainty grows, risk spreads along the coast")
        await select("#lead", "72")
        await run_forecast()
        await page.wait_for_timeout(2000)

        # 6 — Amphan
        await scene("amphan")
        await select("#lead", "24", 200)
        await cap("Switch to <b>Super Cyclone Amphan (2020)</b> — the shallow head of the Bay amplifies storm surge")
        await select("#scenario", "amphan-2020")
        await run_forecast()
        await page.wait_for_timeout(2500)

        # 7 — what-if
        await scene("whatif")
        await cap("Planning mode: design a <b>what-if</b> storm — here a 230 km/h super cyclone striking Paradip port")
        await select("#scenario", "custom", 800)
        await select("#c-town", "Paradip", 300)
        await page.evaluate("const s=document.getElementById('c-vmax'); s.value=230; s.dispatchEvent(new Event('input'))")
        await page.wait_for_timeout(800)
        await run_forecast()
        await play_storm()
        await scene("whatif2")
        await cap("Paradip port, substations and coastal housing flagged critical — pre-position crews before the storm", 4000)

        # 8 — filter
        await scene("filter")
        await cap("Filter to lifeline infrastructure only: hospitals, substations, water")
        for t in ["housing", "transmission", "telecom", "bridge", "port", "shelter"]:
            await click(f'.chip[data-type="{t}"]', 250)
        await page.wait_for_timeout(2500)

        # 9 — outro
        await scene("how")
        await cap("")
        await page.evaluate("""demoCard(`<h1 style="font-size:48px">How it works</h1>
            <p>Holland wind model · parametric storm surge · rainfall flooding<br>
            Monte-Carlo track ensemble · lognormal fragility curves · power-dependency cascade</p>
            <p style="font-size:22px">Hindcast-validated on Fani, Amphan, Phailin &amp; Hudhud · zero-install web app · open source</p>`)""")
        await page.wait_for_timeout(6000)
        await scene("outro")
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>From track forecast to <b>actionable infrastructure risk</b> — in under a second.</p>
            <p style="font-size:22px">blop77.github.io/cyclone-sentinel · github.com/Blop77/cyclone-sentinel</p>`)""")
        await page.wait_for_timeout(4000)
        await scene("end")  # waits for the last line to finish
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


asyncio.run(main())
