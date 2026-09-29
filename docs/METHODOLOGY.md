# Methodology

CycloneSentinel chains five models. Each is a published, parametric approximation, chosen so the whole
forecast (40 ensemble members × ~475 assets × ~130 hourly steps) runs in the browser in about 0.3 s.

```
Track fixes ──► hourly track ──► ensemble (forecast uncertainty)
                                     │
                                     ▼
              ┌──────── hazard at every asset ────────┐
              │ wind (Holland 1980 + asymmetry + terrain)
              │ storm surge (parametric, shelf-amplified)
              │ rainfall (R-CLIPER-style) → flood depth
              └───────────────────┬───────────────────┘
                                  ▼
               fragility curves → P(physical damage)
                                  ▼
          power-dependency cascade → P(service disruption)
                                  ▼
             impact summary + ranked response actions
```

## 1. Track and forecast uncertainty

* Historical tracks are IMD best-track fixes (approximate, digitised for the demo), interpolated to 1 h.
  Heading and forward speed are derived from consecutive positions.
* **What-if storms** are generated from a landfall point, intensity, heading and speed. Intensification
  before landfall is linear. Decay over land follows **Kaplan & DeMaria (1995)**:
  `V(t) = Vb + (R·V0 − Vb)·e^(−αt)`, with `α = 0.095 h⁻¹`.
* **Ensemble.** The forecast is issued `lead` hours before landfall. Each member shifts the track
  across and along its path by a random offset that grows as `σ(t) = 45 km · (t/24 h)^0.9`, which
  matches recent IMD landfall-position errors. Members also perturb intensity by ±12 % (1σ). Every
  asset metric is the ensemble mean, and the popups show the P10–P90 wind range.

## 2. Hazards

| Hazard | Model |
|---|---|
| Wind | Holland (1980) radial profile `V(r) = Vmax·√((Rm/r)^B·e^(1−(Rm/r)^B))`. `Rm` comes from **Willoughby et al. (2006)**, with `B = 1 + Vmax/60 m s⁻¹` clamped to 1.1–2.2. Half the forward speed is added on the right of motion (northern hemisphere). Wind is cut by up to 15 % inland for surface roughness. |
| Storm surge | Peak coastal surge is `S = k·(V/100)²` m, where `k` rises from 0.65 to 1.6 towards the shallow head of the Bay (West Bengal). It is stronger on the right of the track, decays with distance from the eye and with inland distance (e-folding 8 km), and is reduced by the asset's elevation. |
| Rainfall | A radial rain-rate profile `(6 + V/22)·e^(−(r−Rm)/140)` mm/h, accumulated over the storm's passage, so slow storms produce more rain. Rain above 180 mm becomes flood depth at low-lying sites. |

## 3. Vulnerability (fragility curves)

Each asset type has lognormal fragility curves for wind and flood depth:
`P(damage | x) = Φ(ln(x / median) / β)`. The two combine as independent failure modes:
`P = 1 − (1 − P_wind)(1 − P_flood)`.

| Type | Wind median (km/h) | β | Flood median (m) |
|---|---|---|---|
| Kutcha housing | 125 | 0.35 | 0.6 |
| Transmission line span | 145 | 0.30 | 3.0 |
| Substation + distribution feeders | 160 | 0.30 | 0.6 |
| Telecom tower | 165 | 0.30 | 1.5 |
| Port terminal | 215 | 0.30 | 2.5 |
| Hospital | 235 | 0.25 | 1.2 |
| Water treatment plant | 240 | 0.25 | 1.0 |
| Cyclone shelter | 290 | 0.25 | 2.5 |
| Road bridge | 320 | 0.30 | 2.0 |

These parameters are indicative. They are adapted from HAZUS-MH hurricane and flood guidance and from
post-event damage reports for Indian construction. They should be calibrated against state damage
assessments.

## 4. Cascading failure

Infrastructure fails as a network, not one asset at a time:

* A substation loses supply if it is damaged **or** its nearest transmission line fails:
  `P_supply = 1 − (1 − P_sub)(1 − 0.6·P_line)`.
* Hospitals, water plants and telecom towers draw power from their nearest substation. On-site backup
  absorbs part of a grid outage (hospitals 60 %, telecom batteries 50 %, water 30 %):
  `P_disruption = 1 − (1 − P_damage)(1 − P_grid·(1 − backup))`.

This is why an undamaged hospital can still show high disruption risk. In Fani (2019) and Hudhud (2014)
it was the grid, not the buildings, that failed first.

## 5. Impact metrics and actions

* **Expected loss** = Σ replacement value × P(damage) × 0.55 (mean damage ratio).
* **People in ≥ 118 km/h winds** = town population × the fraction of ensemble members that bring
  very-severe-cyclone winds to the town.
* **People losing power** = town population × the mean supply-loss probability of the town's substations.
* **Response actions** are rule-based, one per asset over 35 % disruption risk (15 % for shelters).
  They are ranked by `P_disruption × criticality × log10(10 + people served)`.

## 6. Rainfall damage pathways and road access

* **Arterial roads** are 36 town-to-town links: each town connects to its nearest neighbour and to its
  nearest larger inland town within ~120 km (the evacuation and supply route). Hazard is evaluated at the
  segment's low point, which floods first. A road is *impassable* under a lognormal fragility with a median
  of **0.3 m of water** (β 0.5) or **175 km/h wind** (tree and pole fall).
* Hospitals, shelters and water plants depend on their town's nearest arterial road:
  `P(cut off) = P(road impassable)`.
* Every asset carries an **ordered pathway**: rainfall → ponding depth → surge → wind → physical damage
  (with the dominant driver) → grid-feed loss → access loss → service outcome. The *rainfall damage
  pathways* panel lists the chains that end in a hospital or shelter being cut off.

## 7. Real-time mode

Open-Meteo's hourly 72 h forecast (ECMWF/GFS blend) is fetched for all 34 towns in one request. Each asset
takes its town's maximum sustained wind (with inland roughness) and 72 h rainfall; roads take the worse
of their two towns. The results then run through the same fragility, cascade, pathway and advisory chain.

## 8. Early-warning advisories and dispatch

* Assets are grouped by **district**. The district level follows the IMD colour code on the highest
  disruption or cut-off probability: **RED ≥ 60 %** (take action), **ORANGE ≥ 35 %** (be prepared),
  **YELLOW ≥ 15 %** (be updated).
* Recipients: District Collector & DDMA, the urban local body of every affected town, the state authority
  (OSDMA, APSDMA, WB DM&CD); the DISCOM control room if substations are at risk; and the District Health
  Officer if hospitals are at risk or cut off.
* Each advisory has hazards, quantified impacts and the district's ranked actions. It is exported as
  **CAP 1.2** (`urn:oasis:names:tc:emergency:cap:1.2`; severity Extreme/Severe/Moderate; area as a circle)
  and dispatched by webhook, e-mail or WhatsApp, or **automatically** after each run for levels at or above
  a threshold. It is sent once per (scenario, district, level).

## 9. Gemini multimodal analyst

* **Input:** a NASA VIIRS true-colour image (GIBS WMS, 8° × 8° around landfall, dated to the satellite
  pass) plus compact JSON from the model: KPIs, the 18 highest-risk assets with hazards and probabilities,
  the rainfall pathways, and the district advisories with their local language.
* **Output:** a strict JSON schema with a situation summary, satellite observations (eye, cloud
  organisation, affected coast), imagery-vs-model agreement, key risks, rainfall damage pathways with
  mitigations, and ≤ 320-character advisories in English plus **Odia / Telugu / Bengali**, confidence and
  caveats.
* **Reliability:** `gemini-3.7-flash` first, then other Flash models, with exponential back-off on
  429/5xx. The key stays server-side on Cloud Run, or in the viewer's browser. Responses for the demo
  cyclones are cached in `data/ai/` and labelled as cached.

## 10. Google Earth Engine exposure pipeline

`gee/exposure_pipeline.py` samples for every asset: Copernicus GLO-30 elevation, JRC Global Surface Water
occurrence (max within 500 m), WorldPop 2020 population within 1 km, and GPM IMERG V07 rainfall accumulated
over a chosen window. The app replaces its town-level elevation estimates with these values when
`data/gee_exposure.json` is present.

## Validation (hindcast)

The test suite (`npm test`) runs all four historical cyclones. It checks that the model's worst-hit
asset lies in the district that was actually worst hit (Puri, Sundarbans, Ganjam, Visakhapatnam).
It also checks physical sanity: peak wind at `Rm`, a right-side bias, monotonic fragility, a
cascade that is never below physical damage, and spread that grows with lead time.

## Limitations and path to production

* The asset inventory is **synthetic** and generated around real towns. Replace it with OpenStreetMap
  (`power=substation`, `amenity=hospital`, `man_made=mast`), the Bhuvan/NDEM layers, and
  discom/state records.
* Coastline, bathymetry and elevation are simplified to per-town values. Use SRTM/Copernicus DEM, a
  real coastline, and ADCIRC/IMD surge guidance for production.
* Plug in live IMD/JTWC forecast advisories and ensemble products (ECMWF, NCMRWF) in place of
  synthetic perturbations.
* Calibrate fragility parameters against observed losses (Fani, Amphan, Hudhud, Phailin, Biparjoy,
  Michaung).

## References

* Holland, G. J. (1980). An analytic model of the wind and pressure profiles in hurricanes. *Mon. Wea. Rev.*
* Willoughby, H. E., Darling, R. W. R., & Rahn, M. E. (2006). Parametric representation of the primary hurricane vortex. *Mon. Wea. Rev.*
* Kaplan, J., & DeMaria, M. (1995). A simple empirical model for predicting the decay of tropical cyclone winds after landfall. *J. Appl. Meteor.*
* FEMA HAZUS-MH Hurricane Model Technical Manual.
* India Meteorological Department — RSMC New Delhi cyclone reports and best-track data.
