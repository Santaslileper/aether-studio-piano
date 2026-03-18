"""
AURUM STUDIO — Local Agent  v1.1.0
Runs on the user's machine at http://localhost:3001
Serves the API only — frontend is hosted on GitHub Pages.

All fixes from the deep-improvement pass are included:
  • Multi-track MIDI parsing (Type 0 + Type 1)
  • Targeted harvest calls run_vault_merge() so new MIDIs appear immediately
  • Freeform fetch in-flight guard (no duplicate concurrent launches)
  • Stale midi_file_path cleared on vault merge
  • Filename cap (200 chars) in sanitize_filename
  • /api/status exposes missing count + active fetches
  • /api/search — server-side filtered search
"""
import json
import sys
import time
import os
import io
import re
import socket
import zipfile
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse

# ── PATHS ─────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent
DATA_DIR   = BASE_DIR / "data"
MIDIS_DIR  = BASE_DIR / "midis"
COMPS_FILE = DATA_DIR / "all_compositions.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MIDIS_DIR.mkdir(parents=True, exist_ok=True)

# Initialise empty library if first run
if not COMPS_FILE.exists():
    COMPS_FILE.write_text("[]", encoding="utf-8")

PYTHON     = sys.executable
save_lock  = threading.Lock()

# ── STATE ─────────────────────────────────────────────────────────────────────
class AgentState:
    def __init__(self):
        self.metadata_running = False
        self.midi_running     = False
        self.last_log         = "Agent ready."
        self.log_buffer: list = []
        self.stats            = {"composers": 0, "songs": 0, "midis": 0, "missing": 0}
        self.midi_process     = None
        self.fetch_status: dict = {}   # query → 'running'|'found:title'|'not_found'|'error:msg'

state = AgentState()

def _log(msg: str):
    state.log_buffer.append(msg)
    if len(state.log_buffer) > 200:
        state.log_buffer.pop(0)
    state.last_log = msg
    print(f"[Agent] {msg}", flush=True)

def refresh_stats():
    try:
        missing = 0
        if COMPS_FILE.exists():
            data = json.loads(COMPS_FILE.read_text(encoding="utf-8"))
            state.stats["songs"]     = len(data)
            state.stats["composers"] = len({i.get("composer", "?") for i in data})
            missing = sum(1 for i in data if i.get("midi") is not True)
        state.stats["midis"]   = sum(1 for f in MIDIS_DIR.iterdir() if f.suffix.lower() == ".mid")
        state.stats["missing"] = missing
    except Exception as e:
        _log(f"Stats error: {e}")

# ── LIFESPAN ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    refresh_stats()
    _log("Aurum agent started.")
    yield
    _log("Shutting down.")
    if state.midi_process:
        state.midi_process.terminate()

# ── APP ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Aurum Studio Agent", lifespan=lifespan)

# Allow any origin — GitHub Pages, localhost, custom domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── BACKGROUND WORKERS ────────────────────────────────────────────────────────
def run_midi_harvester(max_items=10000, shards=6):
    state.midi_running = True
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1"}
    last_hb = 0.0
    _log("Harvest protocol initiated.")
    try:
        state.midi_process = subprocess.Popen(
            [PYTHON, "-m", "core.harvester", "--max", str(max_items), "--shards", str(shards)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=env, cwd=str(BASE_DIR),
        )
        for line in iter(state.midi_process.stdout.readline, ""):
            line = line.strip()
            if not line:
                continue
            _log(line)
            if "SUCCESS" in line:
                refresh_stats()
            now = time.time()
            if now - last_hb >= 30:
                last_hb = now
                _log(f"Harvest persisting... [{state.stats['midis']} secured]")
        state.midi_process.wait()
        state.midi_process = None
    except Exception as e:
        _log(f"Harvest error: {e}")
    finally:
        state.midi_running = False
        refresh_stats()
        _log("Harvest complete.")

def run_metadata_scan():
    state.metadata_running = True
    _log("Metadata scan: merging JSONL shards...")
    try:
        sys.path.insert(0, str(BASE_DIR))
        from core.vault import run_vault_merge
        run_vault_merge()
        refresh_stats()
        _log(f"Scan complete — {state.stats['songs']} works indexed.")
    except Exception as e:
        _log(f"Scan error: {e}")
    finally:
        state.metadata_running = False

def run_targeted_harvest(composer: str, title: str):
    """Harvest a single specific work. Calls run_vault_merge so MIDI appears immediately."""
    from core.harvester import process_item
    from playwright.sync_api import sync_playwright

    _log(f"Targeted harvest: {composer} — {title}")
    item = {"composer": composer, "title": title}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(user_agent="Mozilla/5.0")
            success = process_item(item, context, shard_id="TARGET")
            browser.close()
        if success or item.get("midi") is True:
            # run_vault_merge guarantees the library immediately reflects the new file
            from core.vault import run_vault_merge
            run_vault_merge()
            refresh_stats()
            _log(f"Targeted harvest success: {title}")
        else:
            _log(f"Targeted harvest: no MIDI found for {title}")
    except Exception as e:
        _log(f"Targeted harvest error: {e}")

def run_freeform_fetch(query: str):
    """Fetch the best bitmidi result for a raw freeform search string."""
    from urllib.parse import quote_plus
    from playwright.sync_api import sync_playwright
    from core.utils import sanitize_filename

    # In-flight guard — don't double-launch the same query
    if state.fetch_status.get(query) == "running":
        _log(f"Freeform fetch already running for '{query}', skipping.")
        return None

    state.fetch_status[query] = "running"
    _log(f"Freeform fetch: {query}")
    search_url = f"https://bitmidi.com/search?q={quote_plus(query + ' midi')}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page = context.new_page()

            # bitmidi is a React SPA — wait for actual result links
            page.goto(search_url, wait_until="domcontentloaded", timeout=20000)
            try:
                page.wait_for_selector('a[href*="-mid"]', timeout=8000)
            except Exception:
                pass

            links = page.query_selector_all('a[href*="-mid"]')
            target_link  = None
            target_label = query
            for l in links:
                href = l.get_attribute("href") or ""
                if href.endswith("-mid") or re.search(r"-mid-[0-9]+$", href):
                    target_link  = href
                    txt = (l.inner_text() or "").strip()
                    if txt:
                        target_label = txt
                    break

            if not target_link:
                state.fetch_status[query] = "not_found"
                _log(f"Nothing found for '{query}'")
                browser.close()
                return None

            page.goto(f"https://bitmidi.com{target_link}", wait_until="domcontentloaded", timeout=15000)
            dl_btn = page.query_selector('a[href^="/uploads/"]')
            if not dl_btn:
                state.fetch_status[query] = "not_found"
                browser.close()
                return None

            dl_url   = f"https://bitmidi.com{dl_btn.get_attribute('href')}"
            response = page.request.get(dl_url, headers={"Referer": f"https://bitmidi.com{target_link}"})
            browser.close()

            if response.status != 200:
                state.fetch_status[query] = f"error:HTTP {response.status}"
                return None

            # Basename only — portable, consistent with rest of the codebase
            safe_name = sanitize_filename(query, max_len=80) + "_fetched.mid"
            file_path = MIDIS_DIR / safe_name
            file_path.write_bytes(response.body())

            new_entry = {
                "title":          target_label,
                "composer":       "User Fetch",
                "source":         "bitmidi",
                "midi":           True,
                "midi_file_path": safe_name,
                "catalogue":      "",
                "year":           None,
                "copyright":      "unknown",
            }

            with save_lock:
                data = json.loads(COMPS_FILE.read_text(encoding="utf-8"))
                if not any(e.get("midi_file_path") == safe_name for e in data):
                    data.append(new_entry)
                    COMPS_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

            refresh_stats()
            state.fetch_status[query] = f"found:{target_label}"
            _log(f"Fetch success: {target_label} → {safe_name}")
            return new_entry

    except Exception as e:
        state.fetch_status[query] = f"error:{e}"
        _log(f"Fetch error: {e}")
        return None

# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    refresh_stats()
    return {
        "running_metadata":  state.metadata_running,
        "running_midi":      state.midi_running,
        "last_log":          state.last_log,
        "last_midi_log":     state.last_log,
        "last_metadata_log": state.last_log,
        "stats":             state.stats,
        # Active freeform fetches — used by the frontend live-fetch banner
        "fetching": [q for q, s in state.fetch_status.items() if s == "running"],
    }

@app.get("/api/logs")
async def get_logs():
    return {"midi_logs": state.log_buffer, "metadata_log": state.last_log}

@app.get("/api/library")
async def get_library():
    if COMPS_FILE.exists():
        data = json.loads(COMPS_FILE.read_text(encoding="utf-8"))
        for item in data:
            if item.get("midi_file_path"):
                item["midi_file_path"] = Path(item["midi_file_path"]).name
        return data
    return []

@app.get("/api/search")
async def search_library(q: str = Query(default=""), limit: int = Query(default=200, le=1000)):
    """Server-side library search — same token syntax as the frontend.

    Tokens: midi | no:midi | after:YEAR | before:YEAR | composer:NAME | cat:LABEL
    Everything else matched against composer + title. Returns up to `limit` items.
    """
    if not COMPS_FILE.exists():
        return []
    data = json.loads(COMPS_FILE.read_text(encoding="utf-8"))

    tokens = q.strip().lower().split() if q.strip() else []
    midi_only = None
    year_min = year_max = None
    text: list = []
    cat = composer_filter = None

    for tok in tokens:
        if tok in ("midi", "midi:yes", "has:midi"):       midi_only = True
        elif tok in ("no:midi", "midi:no"):               midi_only = False
        elif tok.startswith("after:"):
            try: year_min = int(tok[6:])
            except ValueError: pass
        elif tok.startswith("before:"):
            try: year_max = int(tok[7:])
            except ValueError: pass
        elif tok.startswith("composer:"):                  composer_filter = tok[9:]
        elif any(tok.startswith(p) for p in ("cat:", "opus:", "op:", "k:", "bwv:", "d:", "s:", "rwv:")):
            cat = tok.split(":", 1)[1]
        else:
            text.append(tok)

    results = []
    for item in data:
        if midi_only is True  and item.get("midi") is not True: continue
        if midi_only is False and item.get("midi") is True:     continue
        if year_min or year_max:
            try:
                y = int(item.get("year") or 0)
                if year_min and y < year_min: continue
                if year_max and y > year_max: continue
            except (ValueError, TypeError):
                continue
        if composer_filter and composer_filter not in (item.get("composer") or "").lower(): continue
        if cat:
            haystack = ((item.get("catalogue") or "") + " " + (item.get("title") or "")).lower()
            if cat not in haystack: continue
        if text:
            haystack = ((item.get("composer") or "") + " " + (item.get("title") or "")).lower()
            if not all(w in haystack for w in text): continue
        if item.get("midi_file_path"):
            item["midi_file_path"] = Path(item["midi_file_path"]).name
        results.append(item)
        if len(results) >= limit:
            break

    return results

@app.get("/api/midi_json")
async def get_midi_json(path: str = Query(...)):
    """Convert MIDI filename → JSON note array.

    Handles both Type 0 (single-track) and Type 1 (multi-track) MIDI files.
    Uses merge_tracks() + tick accumulation + dynamic tempo tracking.
    """
    try:
        from mido import MidiFile, merge_tracks
        from core.utils import midi_to_name
        name        = Path(path).name
        actual_path = MIDIS_DIR / name
        if not actual_path.exists():
            return {"error": f"NOT_FOUND: {name}"}

        mid             = MidiFile(str(actual_path))
        ticks_per_beat  = mid.ticks_per_beat or 480
        tempo           = 500_000   # default 120 BPM

        merged   = merge_tracks(mid.tracks)
        abs_tick = 0
        notes: list = []
        active_notes: dict = {}   # (channel, note) → start_seconds

        for msg in merged:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                tempo = msg.tempo
                continue
            abs_time = (abs_tick / ticks_per_beat) * (tempo / 1_000_000)

            if msg.type == "note_on" and msg.velocity > 0:
                active_notes[(getattr(msg, "channel", 0), msg.note)] = abs_time
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                key = (getattr(msg, "channel", 0), msg.note)
                if key in active_notes:
                    start    = active_notes.pop(key)
                    duration = max(0.05, abs_time - start)
                    try:
                        notes.append({
                            "note":     midi_to_name(msg.note),
                            "time":     round(start, 4),
                            "duration": round(duration, 4),
                        })
                    except ValueError:
                        pass  # skip out-of-range notes

        notes.sort(key=lambda n: n["time"])
        return notes
    except Exception as e:
        return {"error": str(e)}

@app.get("/midis/{filename}")
async def serve_midi(filename: str):
    p = MIDIS_DIR / filename
    if not p.exists() or p.suffix.lower() != ".mid":
        return Response(status_code=404)
    return FileResponse(str(p), media_type="audio/midi")

@app.post("/api/start_midi")
async def start_midi(background_tasks: BackgroundTasks):
    if state.midi_running:
        return {"status": "already_running"}
    background_tasks.add_task(run_midi_harvester)
    return {"status": "started"}

@app.post("/api/start_metadata")
async def start_metadata(background_tasks: BackgroundTasks):
    if state.metadata_running:
        return {"status": "already_running"}
    background_tasks.add_task(run_metadata_scan)
    return {"status": "started"}

@app.post("/api/harvest_target")
async def harvest_target(
    background_tasks: BackgroundTasks,
    composer: str = Query(...),
    title: str = Query(...),
):
    background_tasks.add_task(run_targeted_harvest, composer, title)
    return {"status": "started"}

@app.post("/api/fetch_query")
async def fetch_query(background_tasks: BackgroundTasks, q: str = Query(...)):
    background_tasks.add_task(run_freeform_fetch, q)
    return {"status": "started", "query": q}

@app.get("/api/fetch_status")
async def fetch_status_ep(q: str = Query(...)):
    return {"q": q, "status": state.fetch_status.get(q, "not_started")}

@app.post("/api/sync")
async def sync_data(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_metadata_scan)
    return {"status": "started"}

@app.post("/api/export_zip")
async def export_zip(payload: dict):
    filenames = payload.get("files", [])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in filenames:
            safe = Path(name).name
            p    = MIDIS_DIR / safe
            if p.exists() and p.suffix.lower() == ".mid":
                zf.write(p, safe)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=aurum_export.zip"},
    )

# ── ENTRY POINT ───────────────────────────────────────────────────────────────
def find_free_port(preferred=3001, n=20):
    for port in range(preferred, preferred + n):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port in {preferred}–{preferred+n-1}")

if __name__ == "__main__":
    import uvicorn, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=3001)
    args   = parser.parse_args()
    port   = find_free_port(args.port)
    if port != args.port:
        print(f"[Agent] Port {args.port} busy — using {port}")
    print(f"[Agent] Running at http://localhost:{port}")
    print(f"[Agent] Open https://YOUR-GITHUB-USERNAME.github.io/aurum-studio")
    uvicorn.run(app, host="127.0.0.1", port=port)
