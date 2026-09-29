# Demo video — narration script (~2 min)

`scripts/record_demo.py` records the screen with on-screen captions. If you want a voice-over, read
this script over the recording. Each block lines up with a scene; timings are approximate.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Title card | "This is CycloneSentinel, a Cyclone Impact and Infrastructure Vulnerability Forecaster." |
| 0:05 | Problem card | "Cyclone warnings tell us where a storm will go. But district collectors, power utilities and hospitals need to know what will break, and what fails next when the grid goes down." |
| 0:10 | Fani loaded | "Here we replay Cyclone Fani from 2019 as if the forecast were issued 24 hours before landfall. Forty ensemble tracks capture forecast uncertainty, and all 475 infrastructure assets are evaluated in the browser in about half a second." |
| 0:20 | Swath + ensemble | "The blue swath is forecast peak wind by IMD category. The faint lines are the ensemble members." |
| 0:25 | Playback | "As the storm moves, each asset lights up when peak winds reach it. Red and orange mean a high probability of losing service." |
| 0:40 | KPI tiles | "The dashboard shows expected infrastructure loss, people exposed to very-severe-cyclone winds, how many people will likely lose power, and how many should be evacuated." |
| 0:50 | Type chart | "Kutcha housing, power lines and telecom towers fail first." |
| 0:55 | Priority actions | "Most importantly, it turns risk into action: evacuations to specific shelters, generators to hospitals, restoration crews to substations. Everything is ranked by risk, criticality and people served." |
| 1:00 | Hospital popup | "Every asset explains itself: peak wind with its uncertainty range, surge, rainfall, and its fragility curve. This hospital is structurally fine, but its feeder substation will probably trip. That's a cascading failure, and it's exactly what happened in Puri and Visakhapatnam." |
| 1:15 | 72 h lead | "Issue the forecast three days out and uncertainty widens, so risk spreads along the coast. That's the honest picture a planner needs." |
| 1:25 | Amphan | "Super Cyclone Amphan: the shallow head of the Bay amplifies storm surge, and the risk concentrates on Sagar Island and the Sundarbans." |
| 1:35 | What-if at Paradip | "In planning mode, we can design a storm: a 230 km/h super cyclone hitting Paradip port. The port, substations and coastal housing are flagged critical before the storm exists." |
| 1:45 | Lifeline filter | "Filter to lifelines only: hospitals, substations and water." |
| 1:50 | How-it-works card | "Under the hood: a Holland wind model, parametric surge, rainfall flooding, a Monte-Carlo ensemble, fragility curves and a power-dependency cascade. It's hindcast-validated on four historical cyclones, and the model's worst-hit district matches reality every time." |
| 1:57 | Closing card | "CycloneSentinel: from track forecast to actionable infrastructure risk, in under a second." |

## Uploading

1. Upload `video/cyclonesentinel-demo.webm` to YouTube as **Unlisted** or **Public**. YouTube accepts
   `.webm` directly. Alternatively, use Google Drive with "Anyone with the link" access.
2. Paste the link into the submission form and into the README.
