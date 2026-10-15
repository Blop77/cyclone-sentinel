# Demo video — narration script (~4 min)

`scripts/record_demo.py` records the demo automatically. It drives the app with Playwright and narrates
with neural text-to-speech (`edge-tts`, voice `en-IN-NeerjaNeural`). Every scene waits for its line to
finish, and the script writes `video/cyclonesentinel-demo.mp4` plus matching subtitles
(`cyclonesentinel-demo.srt`). The exact narration lives in the `NARRATION` dict in that script. This table
is a human-readable copy, useful if you'd rather record your own voice.

```bash
GEMINI_API_KEY=... uvicorn server.main:app --port 8080     # backend: Gemini proxy + control-room inbox
python scripts/record_demo.py                              # → video/cyclonesentinel-demo.mp4 + .srt
```

With `GEMINI_API_KEY` set on the backend, the Gemini analyst and the FAQ chatbot run **live** in the recording
(`--cached-ai` shows the saved analysis instead). If the edge-tts service is unreachable, `--tts kokoro` uses an
offline neural voice; see the options at the top of the script.

| Scene | On screen | Narration |
|---|---|---|
| Title | Title card | This is CycloneSentinel: an AI-powered platform that forecasts cyclone impact on critical infrastructure, and warns the right authorities before landfall. |
| Problem | Problem card | Warnings tell us where a storm will go. Disaster managers need to know what will break: which hospitals, substations and roads will fail, and who must be warned. |
| Fani | Fani replay over the real NASA VIIRS image | Here we replay Cyclone Fani, from 2019, as if the forecast were issued 24 hours before landfall. Underneath is the real NASA VIIRS satellite image of Fani that day. |
| Ensemble | Wind swath + ensemble tracks | Our physics engine runs 40 ensemble tracks and simulates wind, storm surge and rainfall at 511 assets, in under a second. |
| Playback | Storm animation | As the storm moves, each asset lights up when the peak hazard reaches it. |
| KPIs | Impact tiles | Expected losses, people exposed to very severe winds, about 9 lakh people likely to lose power, 20 hospitals and shelters likely cut off, 9 arterial roads likely impassable. |
| Pathways | Rainfall damage pathways | About 300 mm of rain puts water on the Puri–Konark road, the road becomes impassable, and Puri Hospital is cut off, even though the building itself survives. |
| Popup | Asset causal chain | Every asset explains its own causal chain: rainfall, ponding, wind, damage, loss of grid feed, loss of road access. |
| Advisories | Advisories tab | District advisories on the IMD colour code, Red for Puri and Jagatsinghpur, routed to the Collector, municipal bodies, state authority, power utility and health officer. |
| Dispatch | Auto-dispatch | With auto-dispatch on, every Red and Orange advisory is sent automatically as a CAP alert, the format India's SACHET system uses. |
| Inbox | Control-room inbox | And here they arrive, in the district control-room inbox served by our Google Cloud Run backend. |
| Gemini | AI Analyst tab | Now, Google's Gemini 3.7 Flash. We send it the satellite image of the storm together with the model's output. |
| Gemini output | Analysis + Odia advisories | Gemini reads the storm's structure, checks the imagery against our hotspots, explains the rainfall damage pathways, and drafts advisories in English and Odia, ready to dispatch. |
| Live | Live mode | It also runs in real time. Live mode pulls the latest 72-hour forecast for every coastal town and runs the same chain. |
| FAQ chatbot | 💬 Ask panel: "How do you know the model is accurate?" | For judges and officials, there is a built-in assistant. Ask it anything about the project, and Gemini answers using only our own documentation. |
| FAQ chatbot | "Is the infrastructure data real?" | It is honest about limitations too. Here it explains that the infrastructure inventory is still synthetic, and that replacing it with real data is the first production step. |
| How it works | Stack card | Google Earth Engine, NASA satellite feeds, real-time weather, a physics ensemble, Gemini multimodal reasoning and automated CAP dispatch on Cloud Run, validated against four historical cyclones. |
| Close | Closing card | CycloneSentinel. From satellite to action, before landfall. |

## Uploading

1. Upload `video/cyclonesentinel-demo.mp4` to YouTube as **Unlisted** or **Public**.
2. On the **Video elements** step, choose **Add subtitles → Upload file → With timing** and select `video/cyclonesentinel-demo.srt`.
3. Paste the link into the submission form and the README.
