# 🌀 CycloneSentinel — AI-powered cyclone impact & infrastructure vulnerability forecaster

**Build with AI: Code for Communities (2nd edition) · Track 5 — Track-Based Cyclone Impact & Infrastructure Vulnerability Forecaster · Team Nebula Nomads**

CycloneSentinel moves cyclone response from *post-landfall recovery* to *pre-landfall action*. It combines
**satellite feeds**, **real-time meteorological data** and **Gemini 3.7 Flash multimodal reasoning** with a
physics-based impact model. It simulates storm surge, traces **rainfall damage pathways**, maps exposure of
**power grids, arterial roads and medical shelters**, and **automatically dispatches early-warning advisories**
(CAP 1.2, the format India's SACHET platform uses) to district, municipal and state disaster-management authorities.

**▶ Live demo:** https://blop77.github.io/cyclone-sentinel/ · **🎬 Video:** https://youtu.be/l2LTAcgFshg · **📑 Deck:** [`docs/CycloneSentinel-deck.pdf`](docs/CycloneSentinel-deck.pdf)

![Dashboard — Cyclone Fani (2019) replayed as a 24 h forecast](docs/img/dashboard.jpg)

## The challenge, point by point

| Track 5 asks for… | CycloneSentinel |
|---|---|
| **Google Earth Engine satellite feeds** | [`gee/exposure_pipeline.py`](gee/exposure_pipeline.py) samples **Copernicus GLO-30 DEM, JRC Global Surface Water, WorldPop and GPM IMERG** in Earth Engine for every asset. The app loads the output (`data/gee_exposure.json`) automatically. [`gee/code_editor.js`](gee/code_editor.js) maps the populated land below 5 m. Live **NASA VIIRS true-colour** and **GPM IMERG rainfall** imagery (NASA GIBS) is on the map, dated to each storm. |
| **Real-time meteorological data** | **Live mode** pulls a 72 h hourly forecast (wind, gusts, rain) for all coastal towns from Open-Meteo (ECMWF/GFS) in a single request, and runs it through the same impact chain. |
| **Gemini 3.7 Flash multimodal reasoning** | The **AI Analyst** sends Gemini the **satellite image of the storm** plus the model's structured output. Gemini locates the eye and rain bands, cross-checks the imagery against model hotspots, explains rainfall damage pathways and drafts SMS-ready advisories in **English + Odia / Telugu / Bengali**. It uses structured JSON output, automatic retries and fallback models. |
| **Simulate cyclone storm surges** | Parametric surge that grows with intensity, is amplified by the shallow shelf at the head of the Bay, is stronger right of the track, decays inland and is reduced by site elevation. |
| **Predict local rainfall damage pathways** | Rain → ponding → **arterial road impassable** → **hospital / shelter cut off**. Every asset carries an ordered causal chain (hazard → damage → power/access dependency → service outcome). |
| **Map exposure: power grids, arterial roads, medical shelters** | 511 assets in 10 classes: substations & feeders, transmission lines, **36 arterial road links**, hospitals, cyclone shelters, telecom, water, bridges, ports, kutcha housing. Lognormal fragility curves plus **power and road-access cascades**. |
| **Automate early-warning advisory dispatch** | District advisories on the IMD colour code (RED / ORANGE / YELLOW), routed to the **District Collector & DDMA, the urban local bodies, the state SDMA (OSDMA / APSDMA / WB DM&CD), the DISCOM and the District Health Officer**. Delivered by webhook, e-mail or WhatsApp, and as **CAP 1.2 XML**. **Auto-dispatch** fires after every forecast run. A Cloud Run relay receives them into a control-room inbox and can forward to Google Chat or a CAP gateway. |

## Architecture

```
 NASA GIBS (VIIRS, IMERG) ─┐          ┌── Google Earth Engine (DEM, JRC water, WorldPop, IMERG) → data/gee_exposure.json
 Open-Meteo real-time ─────┤          │
 IMD best tracks / what-if ┤          ▼
                           ▼   ┌──────────────────────────────── browser (static, GitHub Pages / Cloud Run) ──┐
                 track + 40-member ensemble → wind · surge · rain at 511 assets → fragility → P(damage)        │
                               → power cascade + road-access cascade → pathways → KPIs, actions, advisories      │
                               └────────────┬──────────────────────────────────────────────┬─────────────────┘
                                            │ satellite image + model JSON                  │ advisory JSON + CAP XML
                                            ▼                                               ▼
                              Gemini 3.7 Flash (via Cloud Run proxy                Cloud Run: /api/dispatch → control-room
                              or the viewer's own key)                               inbox, Google Chat, CAP/SACHET gateway
```

| Layer | Files |
|---|---|
| Physics & consequence engine (pure JS, runs in browser and Node) | `js/model.js`, `js/data.js` |
| Data feeds: NASA GIBS, Open-Meteo, GEE output | `js/feeds.js`, `gee/` |
| Gemini multimodal analyst | `js/ai.js` |
| Advisory dispatch & CAP | `js/dispatch.js`, `js/model.js` (`buildAdvisories`, `toCAP`) |
| UI | `index.html`, `css/style.css`, `js/app.js` |
| Cloud Run service: Gemini proxy, dispatch relay and inbox, static hosting | `server/main.py`, `Dockerfile` |
| Tests (physics, hindcast, cascades, advisories, CAP, live mode) | `tests/model.test.js` |

## Run it

**Static (no AI key needed; cached Gemini results are shown):**
```bash
python -m http.server 8000     # open http://localhost:8000
```

**With live Gemini + dispatch inbox (same as Cloud Run):**
```bash
pip install -r server/requirements.txt
GEMINI_API_KEY=your-key uvicorn server.main:app --port 8080
# app:   http://localhost:8080/        inbox: http://localhost:8080/inbox
```

**Deploy to Google Cloud Run (one command):**
```bash
gcloud run deploy cyclone-sentinel --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your-key
```
Or, on GitHub Pages, any visitor can paste their own key in **⚙ Settings**; it's stored only in their browser.

**Earth Engine exposure layer:**
```bash
pip install earthengine-api && earthengine authenticate
node scripts/export_assets.js > data/assets.json
python gee/exposure_pipeline.py --project YOUR_GCP_PROJECT --rain-start 2019-05-02 --rain-end 2019-05-04
```

**Tests:** `npm test` (Node 18+) · **Demo video:** `python scripts/record_demo.py` (Playwright + neural TTS, synced voice-over)

## Validation (hindcast)

Each historical cyclone is replayed as a forecast issued 24 h before landfall (40 members):

| Cyclone | Actual landfall | Model's worst-hit towns | People likely without power |
|---|---|---|---|
| Fani (2019) | Puri, Odisha | Puri, Bhubaneswar, Cuttack | 9.0 lakh |
| Amphan (2020) | Sundarbans, West Bengal | Sagar Island, Haldia, Kolkata | 7.5 lakh |
| Phailin (2013) | Gopalpur, Odisha | Berhampur, Gopalpur, Rambha | 3.6 lakh |
| Hudhud (2014) | Visakhapatnam, AP | Visakhapatnam, Vizianagaram, Bheemunipatnam | 15.3 lakh |

In every case the highest risk falls in the district that was actually hit hardest (checked by `npm test`).

## Scaling across India and BRICS

* **New states or countries are data, not code.** A region is a list of towns (with district and state authority), a set of tracks, and an asset inventory (OpenStreetMap / Bhuvan / GEE). The engine, cascades, advisories and CAP output are unchanged.
* **The physics is hemisphere-aware** (wind asymmetry flips south of the equator; tested), so the same model serves the Bay of Bengal, the Arabian Sea (Gujarat, Maharashtra, Kerala), the South China Sea (China), the Mozambique Channel (South Africa) and the South Atlantic (Brazil).
* **CAP 1.2** is the international alerting standard (WMO / ITU), so advisories plug into SACHET in India and national alert gateways elsewhere.
* **Serverless:** one Cloud Run service per state, scaling to zero between storms.

## Data and honesty notes

* Cyclone tracks are approximate IMD best-track fixes, digitised for the demo.
* **The infrastructure inventory is synthetic**, generated deterministically around 34 real coastal towns (real names, locations, populations and districts). Replacing it with OSM, Bhuvan, discom or GEE-derived data is the first production step.
* Fragility parameters are indicative (HAZUS-MH and post-event reports) and need local calibration.
* Advisories are model output and are marked `Exercise` in CAP by default. Operational use requires IMD bulletins and human sign-off.
* Gemini output is shown with the model name and timestamp. Cached responses (`data/ai/`) are labelled "Cached".

## Credits & licenses

| Component | Use | License / terms |
|---|---|---|
| [Leaflet](https://leafletjs.com) 1.9.4 | map UI | BSD-2-Clause |
| [Google Gemini API](https://ai.google.dev) (Gemini 3.7 Flash) | multimodal analysis | Google APIs Terms |
| [Google Earth Engine](https://earthengine.google.com) | exposure pipeline | Earth Engine Terms (noncommercial) |
| Copernicus GLO-30 DEM · JRC Global Surface Water · WorldPop · NASA GPM IMERG | GEE datasets | respective open licenses (Copernicus, CC BY 4.0, public domain) |
| [NASA GIBS](https://earthdata.nasa.gov/gibs) (VIIRS, IMERG) | satellite imagery | NASA open data |
| [Open-Meteo](https://open-meteo.com) | real-time forecast | CC BY 4.0: weather data by Open-Meteo.com |
| Esri World Dark Gray Canvas | basemap | Esri terms, attribution shown |
| [FastAPI](https://fastapi.tiangolo.com), [httpx](https://www.python-httpx.org) | Cloud Run service | MIT / BSD-3-Clause |
| [Playwright](https://playwright.dev), [edge-tts](https://github.com/rany2/edge-tts), [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | demo-video tooling | Apache-2.0 / LGPL-3.0 / BSD-2-Clause |
| Holland (1980), Willoughby et al. (2006), Kaplan & DeMaria (1995), FEMA HAZUS-MH | model equations & parameters | cited in [METHODOLOGY](docs/METHODOLOGY.md) |

All application code in this repository was written during the hackathon and is released under the MIT License.
