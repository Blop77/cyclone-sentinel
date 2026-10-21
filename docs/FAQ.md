# CycloneSentinel — FAQ

Answers to the questions judges and visitors ask most. The **💬 Ask** chatbot in the app answers from this
file, the [README](../README.md) and the [methodology](METHODOLOGY.md).

## The project

### What is CycloneSentinel? What does the project do?
CycloneSentinel predicts what a cyclone will damage **before it makes landfall**: which hospitals, substations,
roads and shelters are likely to fail, and why. It then writes district early-warning advisories and sends them
automatically to the right authorities. It was built by **Team Nebula Nomads** for *Build with AI: Code for
Communities (2nd edition), Track 5: Track-Based Cyclone Impact & Infrastructure Vulnerability Forecaster*.

### What problem does it solve?
Cyclone warnings say **where** a storm will go. Disaster managers also need to know **what will break**:
which hospitals lose power, which roads flood, which places get cut off, and who has to be warned. In Fani (2019)
and Hudhud (2014) the power grid failed before the buildings did. CycloneSentinel turns a track forecast into
those answers 24–72 hours before landfall, so generators, shelters and evacuations can be arranged in time.

### Who would use it?
District Collectors and District Disaster Management Authorities (DDMAs), state authorities such as OSDMA
(Odisha), APSDMA (Andhra Pradesh) and the West Bengal Dept. of Disaster Management, power utilities (DISCOMs),
district health officers and municipal bodies, in the 24–72 hours before a cyclone makes landfall.

### Which areas does it cover?
India's east coast: **Odisha, Andhra Pradesh and West Bengal**, with 34 real coastal towns and their districts.
Adding a state or country is new data, not new code (see *How does it scale?*).

## How it works

### How does the forecast work?
1. Take the cyclone's track and create a **40-member ensemble**: 40 slightly different tracks and intensities
   that represent forecast uncertainty.
2. For each member, compute **wind** (Holland 1980 profile), **storm surge** (parametric, stronger towards the
   shallow head of the Bay) and **rainfall → flood depth** at every asset.
3. Turn hazard into a probability of damage with **fragility curves**.
4. Follow **cascades**: a failed substation cuts power to hospitals; a flooded road cuts off a hospital or shelter.
5. Produce impact numbers, ranked response actions and district advisories.

The whole chain (40 members × 511 assets × hourly steps) runs **in the browser in well under a second**.

### What is an ensemble and why 40 members?
A forecast is never exact. Each ensemble member shifts the track sideways and along its path by a random offset
that grows with lead time (about 45 km at 24 h, matching recent IMD landfall errors) and varies intensity by
±12 %. Averaging 40 members gives probabilities instead of a single guess. You can pick 20 (faster) or 80 (more
precise) in the app.

### What are fragility curves?
A fragility curve gives the probability that an asset is damaged at a given wind speed or flood depth. They are
lognormal curves, the standard engineering approach (as in FEMA HAZUS-MH). For example, kutcha housing has a
median wind capacity of 125 km/h, a hospital 235 km/h, and an arterial road becomes impassable at a median of
0.3 m of water. Wind and flood are combined as independent ways to fail. The parameters are indicative and
should be calibrated with state damage data.

### What is a cascade?
Infrastructure fails as a network. A substation loses supply if it is damaged **or** its transmission line
fails. Hospitals, water plants and telecom towers depend on their nearest substation, with on-site backup
absorbing part of an outage (hospitals 60 %, telecom 50 %, water 30 %). That is why an undamaged hospital can
still show a high risk of disruption.

### What are rainfall damage pathways?
A chain like: **heavy rain → water on the Puri–Konark road → road impassable → Puri Hospital cut off**, even
though the hospital building itself survives. Every asset carries its own ordered chain (rainfall, ponding,
surge, wind, physical damage, loss of grid feed, loss of road access, service outcome), and the app lists the
chains that end in a hospital or shelter being cut off.

### How do you decide what is most critical?
Each asset type has a **criticality weight**: hospitals 1.6, cyclone shelters 1.5, substations 1.4, water plants
and ports 1.3, telecom and arterial roads 1.2, power lines and bridges 1.1, kutcha housing 1.0. Response actions
are ranked by **probability of disruption × criticality weight × log10(10 + people served)**. The weights are
the team's judgement and would be tuned with disaster-management authorities.

### Does it show safer areas, less likely to be damaged, for evacuation?
Yes. The **Lower-risk areas** panel lists towns where no modelled asset is above 15 % disruption or cut-off
risk, nearest to landfall first, with their peak wind, rain and how many shelters and hospitals stay
operational. These are candidate **evacuation destinations and relief staging points**. On the map, three
labelled **wind radii** around the storm show how far gale-force (62 km/h), severe (89 km/h) and very severe
(118 km/h) winds reach; outside the dashed outer ring, winds stay below gale force.

### How far do the cyclone's winds reach?
The map draws three labelled rings around the storm at every time step: how far **gale-force (≥ 62 km/h)**,
**severe (≥ 89 km/h)** and **very severe (≥ 118 km/h)** winds reach. For Fani at landfall they are about 165,
110 and 75 km. Outside the dashed outer ring, winds stay below gale force.

### What do Red, Orange and Yellow mean?
They follow the **IMD colour code**, applied per district on the highest disruption or cut-off probability:
**Red ≥ 60 %** (take action), **Orange ≥ 35 %** (be prepared), **Yellow ≥ 15 %** (be updated). On the map,
assets use the same thresholds: critical (≥ 60 %), serious, warning and good (< 15 %).

## Data

### Where does the data come from?
* **Cyclone tracks:** approximate IMD best-track fixes for Fani (2019), Amphan (2020), Phailin (2013) and
  Hudhud (2014), plus what-if storms you can design.
* **Satellite imagery:** NASA GIBS — VIIRS true-colour images and GPM IMERG rainfall, dated to each storm.
* **Real-time weather:** Open-Meteo's 72-hour hourly forecast (ECMWF/GFS) for every town, in Live mode.
* **Exposure layers:** a Google Earth Engine pipeline (Copernicus elevation, JRC surface water, WorldPop
  population, GPM IMERG rainfall).
* **Towns:** 34 real coastal towns with real names, locations, populations and districts.

### Is the infrastructure data real?
**Not yet.** The 511 assets (substations, power lines, 36 arterial road links, hospitals, shelters, telecom
towers, water plants, bridges, ports and kutcha housing) are **synthetic**: generated deterministically around
34 real towns. Real asset registers from OpenStreetMap, Bhuvan/NDEM or DISCOM and state records plug into the
same format, and replacing the synthetic inventory is the first production step.

### How is Google Earth Engine used?
`gee/exposure_pipeline.py` samples four Earth Engine datasets at every asset: **Copernicus GLO-30** elevation,
**JRC Global Surface Water** occurrence (within 500 m), **WorldPop 2020** population (within 1 km) and **NASA
GPM IMERG** rainfall. Its output (`data/gee_exposure.json`) replaces the app's town-level elevation estimates
automatically. A status line under the map says which one is in use; until the pipeline output is added to the
repo, the demo uses the town-level estimates. `gee/code_editor.js` shows the same layers in the Earth Engine
Code Editor, including populated land below 5 m.

### Does it work in real time?
Yes. **Live mode** fetches the latest 72-hour forecast for all 34 towns in one request and runs it through the
same fragility, cascade, pathway and advisory chain.

## AI (Gemini)

### What does Gemini do?
The physics model makes the prediction; **Gemini explains it and makes it usable**. Gemini receives the real
NASA satellite image of the storm together with the model's output, and returns: a situation summary, what the
satellite image shows (eye, cloud bands, which coast is covered), whether the imagery agrees with the model's
hotspots, key risks, rainfall damage pathways with mitigations, and SMS-ready advisories in **English plus Odia,
Telugu or Bengali**.

### Why use a physics model and not only AI?
Predictions that trigger evacuations must be explainable and reproducible. A physics model gives the same answer
every time and shows its reasoning (every asset has a causal chain). Gemini adds what physics can't: reading the
satellite image, cross-checking it, explaining in plain language and translating into local languages.


### Which Gemini model do you use?
The app asks **Gemini 3.7 Flash** first and falls back to other Flash models, with retries and back-off if a model
is overloaded. Output follows a strict JSON schema. The saved demo analyses in `data/ai/` were answered by the
fallback, Gemini 3.5 Flash, because 3.7 Flash was at capacity when they were generated; they are labelled
"cached" in the app.

### Can the AI make mistakes? How do you stop hallucinations reaching officials?
Yes, so Gemini never decides what officials receive:
* **The model makes every alert.** District, Red/Orange/Yellow level, hazards, numbers, recipients and the CAP
  file are all built by our code from the physics model. Auto-dispatch only ever sends these.
* **Every Gemini answer is fact-checked automatically** against the model run it was based on. Each advisory
  must name a district the model issued an alert for, at the same level, and every number with a unit
  (km/h, mm, m, %) must match a model value with that unit. It also catches unit slips: in our saved Fani
  analysis it flagged Gemini calling the model's *residents* in kutcha housing *houses*.
* **Failed text can't be used.** An advisory that fails the check can't be attached to an alert. One that
  passes is attached only when a person clicks *Attach*, and it still can't change the level or numbers.
* **Transparent input.** The AI Analyst tab shows the exact data sent to Gemini, built by our code from the model.
* Gemini must follow a fixed JSON schema and is told never to invent numbers; local-language text is not
  machine-checked and needs a human review. Alerts are marked **Exercise** in CAP until an official signs off.

### How many Gemini tokens would it use at large scale?
Measured, not guessed: one **AI Analyst** run uses about **4,400–5,400 tokens** (about 3,200–3,600 in,
including about 1,100 for the satellite image, plus 1,200–1,800 out); the app shows the count on every
analysis. One **FAQ chatbot** question sends about **9,400 tokens** of project documentation plus a short
answer. Gemini runs **once per forecast update, not once per citizen**: people receive the warning as an
SMS/CAP alert, which uses no tokens. Analysing about 50 coastal districts every 6 hours through a 3-day
cyclone is about 600 calls, roughly **3 million tokens per cyclone**. The chatbot cost can be cut further
with Gemini context caching, since the documentation part is the same for every question.

## Validation

### How accurate is it? How was it validated?
It was tested on **four real cyclones** — Fani, Amphan, Phailin and Hudhud — each replayed as a forecast issued
24 hours before landfall. In all four, the model's highest-risk asset falls in the district that was actually hit
hardest (Puri, the Sundarbans, Ganjam and Visakhapatnam). This is an automated test. It validates *where* the
impact is, not exact damage counts; calibrating damage needs official post-event loss data, which is a next step.

### What do the tests check?
`npm test` runs **15 model tests**: the four-cyclone hindcast, physics sanity checks (peak wind at the radius of maximum
wind, stronger winds right of the track, monotonic fragility curves, uncertainty growing with lead time),
cascades that are never below physical damage, road cut-offs, damage pathways, advisory routing (Fani's Puri is
Red), well-formed CAP 1.2 output, live mode, and southern-hemisphere wind asymmetry. Four more tests check this FAQ chatbot.

## Warnings and dispatch

### How are warnings sent?
Assets are grouped by district into IMD-coloured advisories with hazards, impacts and ranked actions. Each is
routed to the **District Collector & DDMA, the municipal bodies, the state disaster authority**, the **power
utility** if substations are at risk, and the **district health officer** if hospitals are at risk or cut off.
They can be sent by webhook, e-mail or WhatsApp, or **automatically** after every forecast run, to a
control-room inbox on Google Cloud Run.

### What are CAP and SACHET?
**CAP 1.2** (Common Alerting Protocol) is the international WMO/ITU standard for emergency alerts. **SACHET** is
India's national CAP-based alerting platform. Because CycloneSentinel exports every advisory as CAP 1.2, it can
feed SACHET in India and national alert gateways elsewhere.

## Technology

### What is the tech stack?
Plain JavaScript in the browser (no framework) with **Leaflet** maps, hosted on GitHub Pages; a small
**Python FastAPI** service on **Google Cloud Run** for the Gemini proxy and the dispatch inbox; **Google Earth
Engine** (Python) for exposure layers; NASA GIBS and Open-Meteo for data; Node's built-in test runner for tests.

### Where is the Gemini API key? Is it safe?
The key is never in the code. It lives server-side on Cloud Run (the backend calls Gemini on the visitor's
behalf), or a visitor can paste their own key in **⚙ Settings**, where it is stored only in their browser.

### Does it work without internet, for example during a cyclone?
The model itself runs entirely in the browser, with no server needed. The map library, map tiles and live data
do need a connection. Warnings are meant to go out 24–72 hours **before** landfall, while networks still work,
and CAP alerts can reach phones through SACHET.

### What would it cost to run?
The web app is static (free on GitHub Pages). The Cloud Run backend scales to zero between storms, so it costs
almost nothing when idle. Gemini Flash is called once per analysis, not continuously.

## Future

### How does it scale to other states or countries?
A new region is **data, not code**: a list of towns with districts and state authorities, cyclone tracks, and an
asset inventory. The physics is hemisphere-aware (tested), so it also fits the Arabian Sea (Gujarat,
Maharashtra, Kerala), the South China Sea, the Mozambique Channel and Brazil. Gemini can write advisories in
each state's language (Tamil, Gujarati, Marathi, Malayalam…).

### What are the limitations and next steps?
* Replace the synthetic asset inventory with real data (OpenStreetMap, Bhuvan/NDEM, DISCOM records).
* Commit the Earth Engine exposure output so the demo uses it.
* Calibrate fragility curves against real losses (Fani, Amphan, Hudhud, Phailin, Biparjoy, Michaung).
* Use live IMD/JTWC advisories and ECMWF/NCMRWF ensembles instead of synthetic perturbations.
* Higher-resolution coastline, elevation and surge models (e.g. ADCIRC, IMD surge guidance).

### Where can I see the demo, video and code?
* Live demo: https://blop77.github.io/cyclone-sentinel/
* Demo video: https://youtu.be/OTejnvAFbVE
* Code: https://github.com/Blop77/cyclone-sentinel

### How does this FAQ chatbot work?
If Gemini is available (through the Cloud Run backend or your own key in ⚙ Settings), your question is sent to
Gemini together with this FAQ, the README and the methodology, and it answers only from them. Otherwise the bot
searches this FAQ and shows the closest answers, so it works on GitHub Pages with no key.
