"""
Run the Gemini analyst for each replay scenario through the real web app and save
the responses to data/ai/<scenario>.json. The app shows these (labelled "Cached")
to visitors who have no Gemini access, so judges always see genuine Gemini output.

    GEMINI_API_KEY=... uvicorn server.main:app --port 8080      # separate terminal
    python scripts/generate_ai_cache.py [--url http://localhost:8080/] [scenario ...]
"""
import argparse
import asyncio
import json
import pathlib

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8080/")
ap.add_argument("scenarios", nargs="*", default=["fani-2019", "amphan-2020", "phailin-2013", "hudhud-2014"])
ARGS = ap.parse_args()


async def main():
    out_dir = ROOT / "data" / "ai"
    out_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 900})
        await page.goto(ARGS.url)
        await page.wait_for_function("window.CycloneSentinel && CycloneSentinel.state.result", timeout=60000)
        for sc in ARGS.scenarios:
            for attempt in range(2):  # the app already falls back across models; keep free-tier quota safe
                await page.select_option("#scenario", sc)
                await page.click("#run")
                await page.wait_for_function(f"CycloneSentinel.state.scenario.id === '{sc}' && !document.getElementById('run').disabled", timeout=60000)
                await page.evaluate("() => { CycloneSentinel.state.ai = null; }")
                await page.click('[data-tab="ai"]')
                await page.click("#ai-run")
                await page.wait_for_function("!document.getElementById('ai-run').disabled", timeout=600000)
                ai = await page.evaluate("CycloneSentinel.state.ai && !CycloneSentinel.state.ai.cached ? CycloneSentinel.state.ai : null")
                status = await page.evaluate("document.getElementById('ai-status').textContent")
                print(f"{sc}: {status}")
                if ai:
                    ai.pop("cached", None)
                    (out_dir / f"{sc}.json").write_text(json.dumps(ai, ensure_ascii=False, indent=1), encoding="utf-8")
                    print(f"  saved data/ai/{sc}.json ({ai['model']}, {ai['ms']} ms)")
                    break
                await asyncio.sleep(60)
        await browser.close()


asyncio.run(main())
