"""
Record a captioned demo video of CycloneSentinel with Playwright.

    pip install playwright && python -m playwright install chromium
    python -m http.server 8000            # in the repo root, separate terminal
    python scripts/record_demo.py         # -> video/cyclonesentinel-demo.webm

Pass a URL to record the deployed site instead:
    python scripts/record_demo.py https://<user>.github.io/<repo>/
"""
import asyncio
import pathlib
import shutil
import sys

from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/index.html"
OUT = pathlib.Path(__file__).resolve().parent.parent / "video"
W, H = 1920, 1080

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


async def main():
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": W, "height": H}, record_video_dir=str(OUT), record_video_size={"width": W, "height": H})
        page = await ctx.new_page()

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

        # 1 — title
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>Cyclone Impact &amp; Infrastructure Vulnerability Forecaster</p>
            <p style="font-size:22px">Know which hospitals, substations, towers and homes will fail — before landfall.</p>`)""")
        await page.wait_for_timeout(4500)
        await page.evaluate("""demoCard(`<h1 style="font-size:44px">The problem</h1>
            <p>Cyclone warnings tell us where the storm goes.<br>Disaster managers need to know <b>what breaks</b> —
            and what fails next when the grid goes down.</p>`)""")
        await page.wait_for_timeout(5000)
        await page.evaluate("demoCard('')")
        await page.wait_for_timeout(900)

        # 2 — Fani replay
        await cap("Replaying <b>Cyclone Fani (2019)</b> as a forecast issued 24 h before landfall<small>40-member ensemble · 475 infrastructure assets · runs entirely in the browser</small>", 5000)
        await cap("Blue swath = forecast peak wind by IMD class · faint lines = ensemble track uncertainty", 4500)
        await cap("Press play: assets light up as the storm's peak winds reach them")
        await page.wait_for_timeout(1200)
        await play_storm()
        await cap("Red / orange = high probability of service disruption", 3500)

        # 3 — impact panel
        await page.mouse.move(1700, 330, steps=30)
        await cap("Impact dashboard: expected loss, people in ≥118 km/h winds, people losing power, evacuation need", 5500)
        await page.mouse.move(1700, 700, steps=30)
        await cap("Damage by infrastructure type — housing and power lines fail first", 4000)

        # 4 — actions + popup (cascade)
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 620, behavior: 'smooth'})")
        await page.wait_for_timeout(1200)
        await cap("Auto-generated priority actions, ranked by risk × criticality × people served", 4000)
        hosp = await page.evaluate("""(() => { const a = CycloneSentinel.state.result.actions;
            const h = a.find(x => x.id.includes('hospital')) || a.find(x => x.id.includes('substation')) || a[0]; return h.id; })()""")
        await click(f'#actions li[data-id="{hosp}"]', 1800)
        await cap("Every asset: peak wind with P10–P90 range, surge, rainfall and its fragility curve", 5000)
        await cap("<b>Cascading failure</b>: a hospital can stay standing and still go dark when its feeder substation trips", 5500)
        await page.keyboard.press("Escape")
        await page.evaluate("() => { CycloneSentinel.map.closePopup(); }")

        # 5 — lead time
        await page.evaluate("document.querySelector('.impact').scrollTo({top: 0, behavior: 'smooth'})")
        await cap("Issue the forecast 72 h out instead — uncertainty grows, risk spreads along the coast")
        await select("#lead", "72")
        await run_forecast()
        await page.wait_for_timeout(2500)
        await select("#lead", "24", 200)

        # 6 — Amphan
        await cap("Switch to <b>Super Cyclone Amphan (2020)</b> — the shallow head of the Bay amplifies storm surge")
        await select("#scenario", "amphan-2020")
        await run_forecast()
        await page.wait_for_timeout(3000)

        # 7 — what-if
        await cap("Planning mode: design a <b>what-if</b> storm — here a 230 km/h super cyclone striking Paradip port")
        await select("#scenario", "custom", 800)
        await select("#c-town", "Paradip", 300)
        await page.evaluate("const s=document.getElementById('c-vmax'); s.value=230; s.dispatchEvent(new Event('input'))")
        await page.wait_for_timeout(800)
        await run_forecast()
        await play_storm()
        await cap("Paradip port, substations and coastal housing flagged critical — pre-position crews before the storm", 5000)

        # 8 — filter
        await cap("Filter to lifeline infrastructure only: hospitals, substations, water")
        for t in ["housing", "transmission", "telecom", "bridge", "port", "shelter"]:
            await click(f'.chip[data-type="{t}"]', 250)
        await page.wait_for_timeout(3500)
        await cap("")

        # 9 — outro
        await page.evaluate("""demoCard(`<h1 style="font-size:48px">How it works</h1>
            <p>Holland wind model · parametric storm surge · rainfall flooding<br>
            Monte-Carlo track ensemble · lognormal fragility curves · power-dependency cascade</p>
            <p style="font-size:22px">Hindcast-validated on Fani, Amphan, Phailin &amp; Hudhud · zero-install web app · open source</p>`)""")
        await page.wait_for_timeout(6500)
        await page.evaluate("""demoCard(`<div class="big">🌀</div><h1>CycloneSentinel</h1>
            <p>From track forecast to <b>actionable infrastructure risk</b> — in under a second.</p>`)""")
        await page.wait_for_timeout(4500)

        video = page.video
        await ctx.close()
        await browser.close()
        src = pathlib.Path(await video.path())
        dst = OUT / "cyclonesentinel-demo.webm"
        shutil.move(str(src), dst)
        print(f"Saved {dst}")


asyncio.run(main())
