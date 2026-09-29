"""
CycloneSentinel backend — designed for Google Cloud Run.

  * POST /api/gemini/{model}  Gemini proxy: the API key stays server-side (env GEMINI_API_KEY)
  * POST /api/dispatch        receives early-warning advisories (JSON + CAP XML) from the app
  * GET  /api/dispatch        lists received advisories (JSON)
  * GET  /api/dispatch/{id}.xml  the CAP 1.2 document for one advisory
  * GET  /inbox               simple district control-room inbox (HTML)
  * GET  /                    the web app itself (static files from the repo root)

Optional forwarding of every advisory:
  CHAT_WEBHOOK   Google Chat / Slack-compatible incoming-webhook URL (text message)
  CAP_FORWARD    URL that accepts CAP XML via POST (e.g. a SACHET/state gateway)

Run locally:   uvicorn server.main:app --port 8080
Deploy:        see server/README.md
"""
import html
import os
import pathlib
import time
import uuid

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
ALLOWED_MODELS = ("gemini-",)
ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="CycloneSentinel API", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])

INBOX: list[dict] = []  # in-memory; swap for Firestore/BigQuery in production


@app.get("/healthz")
def health():
    return {"ok": True, "gemini": bool(GEMINI_KEY), "advisories": len(INBOX)}


@app.post("/api/gemini/{model}")
async def gemini(model: str, request: Request):
    if not model.startswith(ALLOWED_MODELS) or "/" in model:
        raise HTTPException(400, "model not allowed")
    if not GEMINI_KEY:
        raise HTTPException(503, "GEMINI_API_KEY not configured on the server")
    body = await request.body()
    if len(body) > 4_000_000:
        raise HTTPException(413, "request too large")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15)) as client:
            r = await client.post(url, content=body, headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY})
    except httpx.HTTPError as e:
        return JSONResponse({"error": {"code": 504, "message": f"Upstream Gemini error: {type(e).__name__}"}}, status_code=504)
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.post("/api/dispatch")
async def receive(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = __import__("json").loads((await request.body()).decode("utf-8"))  # text/plain from no-cors clients
    item = {"id": uuid.uuid4().hex[:10], "received": time.strftime("%Y-%m-%d %H:%M:%S %Z"), **payload}
    INBOX.insert(0, item)
    del INBOX[500:]
    forwarded = []
    async with httpx.AsyncClient(timeout=15) as client:
        if os.environ.get("CHAT_WEBHOOK"):
            r = await client.post(os.environ["CHAT_WEBHOOK"], json={"text": payload.get("text", payload.get("headline", ""))})
            forwarded.append({"chat": r.status_code})
        if os.environ.get("CAP_FORWARD") and payload.get("cap_xml"):
            r = await client.post(os.environ["CAP_FORWARD"], content=payload["cap_xml"], headers={"Content-Type": "application/cap+xml"})
            forwarded.append({"cap": r.status_code})
    return {"ok": True, "id": item["id"], "forwarded": forwarded}


@app.get("/api/dispatch")
def list_dispatch():
    return JSONResponse([{k: v for k, v in i.items() if k != "cap_xml"} for i in INBOX])


@app.get("/api/dispatch/{item_id}.xml")
def cap(item_id: str):
    for i in INBOX:
        if i["id"] == item_id and i.get("cap_xml"):
            return Response(i["cap_xml"], media_type="application/cap+xml")
    raise HTTPException(404)


LEVEL_COLOR = {"RED": "#d03b3b", "ORANGE": "#ec835a", "YELLOW": "#fab219"}


@app.get("/inbox", response_class=HTMLResponse)
def inbox():
    rows = []
    rank = {"RED": 0, "ORANGE": 1, "YELLOW": 2}
    for i in sorted(INBOX, key=lambda x: rank.get(x.get("level"), 3)):  # most severe first (stable: newest first within a level)
        color = LEVEL_COLOR.get(i.get("level", ""), "#898781")
        ai = i.get("ai") or {}
        local = f"<p class='local'>{html.escape(ai.get('message_local', ''))}</p>" if ai.get("message_local") else ""
        # body = advisory text without the headline (shown above) and the recipient line (shown below)
        body_lines = i.get("text", "").split("\n")[1:]
        text = "\n".join(l for l in body_lines if not l.startswith("To: ")).strip()
        rows.append(f"""<article style="border-left:6px solid {color}">
          <header><b style="color:{color}">{html.escape(i.get('level', ''))}</b> · {html.escape(i.get('district', ''))}, {html.escape(i.get('state', ''))}
          <span>{html.escape(i['received'])} · <a href="/api/dispatch/{i['id']}.xml">CAP XML</a></span></header>
          <h3>{html.escape(i.get('headline', ''))}</h3>
          <pre>{html.escape(text)}</pre>{local}
          <p class="to">To: {html.escape('; '.join(i.get('recipients', [])))}</p></article>""")
    body = "".join(rows) or "<p>No advisories received yet.</p>"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Control-room inbox — CycloneSentinel</title>
<style>body{{margin:0;background:#0d0d0d;color:#fff;font:14px/1.5 system-ui,sans-serif;padding:24px 16px}}
main{{max-width:900px;margin:auto}}h1{{font-size:22px}}article{{background:#1a1a19;border-radius:10px;padding:14px 18px;margin:12px 0}}
header{{display:flex;justify-content:space-between;gap:12px;color:#c3c2b7;flex-wrap:wrap}}a{{color:#86b6ef}}h3{{margin:8px 0}}
pre{{white-space:pre-wrap;color:#c3c2b7;font:13px/1.5 system-ui,sans-serif}}.local{{font-size:15px}}.to{{color:#898781;font-size:12px}}</style></head>
<body><main><h1>📥 District control-room inbox</h1><p style="color:#898781">Advisories dispatched by CycloneSentinel · auto-refreshes every 5 s</p>{body}</main></body></html>"""


# The web app (index.html, js/, css/, docs/, data/) served from the repo root.
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="static")
