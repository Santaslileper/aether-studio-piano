import json
import time
import os
import sys
import requests
import re
import random
import threading
from urllib.parse import quote_plus

# Force UTF-8 stdout so box-drawing / Unicode chars don't crash on Windows cp1252
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from .config import DATA_DIR, MIDIS_DIR, INPUT_FILE, OUTPUT_FILE
from .utils import sanitize_filename
from playwright.sync_api import sync_playwright

# Shared State
save_lock = threading.Lock()
stats_lock = threading.Lock()
stop_event = threading.Event()
success_count = 0

def save_shard_progress(data):
    """Securely write vault state to disk."""
    with save_lock:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

def process_item(item, browser_context, shard_id):
    """Discover, download and link a MIDI from bitmidi.com."""
    global success_count

    composer = item.get("composer", "Unknown")
    title = item.get("title", "Unknown")
    if item.get("midi") is True:
        return False

    file_name = f"{sanitize_filename(composer)}_{sanitize_filename(title)}.mid"
    file_path = MIDIS_DIR / file_name

    if file_path.exists():
        item["midi"] = True
        item["midi_file_path"] = str(file_path)
        return False

    query = f"{composer} {title} piano midi"
    search_url = f"https://bitmidi.com/search?q={quote_plus(query)}"

    page = browser_context.new_page()
    try:
        page.goto(search_url, wait_until="domcontentloaded", timeout=15000)
        links = page.query_selector_all('a[href*="-mid"]')
        target_link = None
        for l in links:
            href = l.get_attribute('href')
            if href and (href.endswith('-mid') or re.search(r'-mid-\d+$', href)):
                target_link = href
                break

        if not target_link:
            item["midi"] = "not_found"
            return False

        midi_page_url = f"https://bitmidi.com{target_link}"
        page.goto(midi_page_url, wait_until="domcontentloaded", timeout=15000)

        dl_btn = page.query_selector('a[href^="/uploads/"]')
        if dl_btn:
            dl_url = f"https://bitmidi.com{dl_btn.get_attribute('href')}"
            response = page.request.get(dl_url, headers={"Referer": midi_page_url})
            if response.status == 200:
                with open(file_path, "wb") as f_midi:
                    f_midi.write(response.body())
                item["midi"] = True
                # Store only the filename — portable across machines,
                # consistent with what /api/library and /api/midi_json expect.
                item["midi_file_path"] = file_name

                # FIX: capture should_save inside the lock to avoid race condition
                with stats_lock:
                    success_count += 1
                    should_save = success_count % 10 == 0

                print(f"[SHARD-{shard_id}] SUCCESS: {file_name}", flush=True)
                return should_save
            else:
                item["midi"] = f"failed_{response.status}"
                print(f"[SHARD-{shard_id}] ERR: HTTP {response.status} for {file_name}", flush=True)
        else:
            item["midi"] = "no_dl_link"
    except Exception as e:
        item["midi"] = "error"
    finally:
        page.close()
    return False

def shard_worker(shard_id, items, full_data, headless=True):
    """Isolated browser session that harvests one chunk of the todo queue."""
    print(f"[SHARD-{shard_id}] INITIALIZING...", flush=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            context = browser.new_context(user_agent="Mozilla/5.0")
            for i, item in enumerate(items):
                if stop_event.is_set():
                    print(f"[SHARD-{shard_id}] SHUTDOWN SIGNAL RECEIVED.", flush=True)
                    break

                if process_item(item, context, shard_id):
                    save_shard_progress(full_data)

                time.sleep(random.uniform(0.3, 0.8))
            browser.close()
    except Exception as e:
        print(f"[SHARD-{shard_id}] CRITICAL RELIABILITY FAILURE: {e}", flush=True)

def run_harvest(max_items=10000, shard_count=10, headless=True):
    """Sharded Harvester Protocol: Orchestration of multiple browser parallel threads."""
    if not INPUT_FILE.exists():
        print("[Harvester] Vault missing. Scrape metadata first.", flush=True)
        return

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # FIX: idiomatic predicate — item.get("midi") is not True
    todo = [item for item in data if item.get("midi") is not True]
    random.shuffle(todo)
    todo = todo[:max_items]

    if not todo:
        print("[Harvester] All works linked. System idle.", flush=True)
        return

    print(f"=== AURUM HARVESTER CORE ===", flush=True)
    print(f"PROTOCOL: DISCOVER-LINK-SECURE", flush=True)
    print(f"SHARDS: {shard_count}", flush=True)
    print(f"============================", flush=True)

    shards = [todo[i::shard_count] for i in range(shard_count) if todo[i::shard_count]]
    threads = []

    for i in range(len(shards)):
        t = threading.Thread(target=shard_worker, args=(i+1, shards[i], data, headless))
        t.start()
        threads.append(t)
        time.sleep(2)

    try:
        for t in threads:
            while t.is_alive():
                t.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\n[Harvester] INTERRUPT RECEIVED. SIGNALING SHARDS TO STOP...", flush=True)
        stop_event.set()
        for t in threads:
            t.join()

    save_shard_progress(data)
    print(f"=== PROTOCOL COMPLETE ===", flush=True)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--max", type=int, default=10000)
    parser.add_argument("--shards", type=int, default=10)
    args = parser.parse_args()
    run_harvest(max_items=args.max, shard_count=args.shards)
