import json
from pathlib import Path
from .config import DATA_DIR, MIDIS_DIR, OUTPUT_FILE
from .utils import sanitize_filename

def run_vault_merge():
    """Consolidation Protocol: Merge all per-composer shards into a unified vault."""
    all_data = []
    seen = set()
    jsonl_files = list(DATA_DIR.glob("*.jsonl"))

    # Pre-scan MIDIS_DIR for absolute linking
    existing_midis = {f.name: f for f in MIDIS_DIR.glob("*.mid")}
    print(f"[Vault] Scanned {len(existing_midis)} MIDI files on disk.", flush=True)

    for f in jsonl_files:
        composer = f.stem.replace("_", " ")
        with f.open("r", encoding="utf-8") as fin:
            for line in fin:
                if line.strip():
                    item = json.loads(line)
                    if not item.get("composer"):
                        item["composer"] = composer

                    # Sanitize for match
                    s_comp = sanitize_filename(item.get("composer", "Unknown"))
                    s_title = sanitize_filename(item.get("title", "Unknown"))
                    expected_mid = f"{s_comp}_{s_title}.mid"

                    if expected_mid in existing_midis:
                        item["midi"] = True
                        # Store only the filename — portable across machines
                        item["midi_file_path"] = existing_midis[expected_mid].name
                    else:
                        if item.get("midi") is True:
                            item["midi"] = False
                        # Clear stale path so the API never returns a broken reference
                        item.pop("midi_file_path", None)

                    # Deduplicate — use .get() to avoid KeyError on missing keys
                    key = (item.get("composer", "Unknown"), item.get("title", "Unknown"))
                    if key in seen:
                        continue
                    seen.add(key)

                    all_data.append(item)

    with OUTPUT_FILE.open("w", encoding="utf-8") as fout:
        json.dump(all_data, fout, ensure_ascii=False, indent=2)
    print(f"[Vault] Consolidating {len(all_data)} compositions to {OUTPUT_FILE}", flush=True)

if __name__ == "__main__":
    run_vault_merge()
