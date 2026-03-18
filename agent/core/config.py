from pathlib import Path

BASE_DIR        = Path(__file__).resolve().parent.parent
DATA_DIR        = BASE_DIR / "data"
MIDIS_DIR       = BASE_DIR / "midis"
COMPOSITIONS_FILE = DATA_DIR / "all_compositions.json"

# Backwards compat aliases
INPUT_FILE  = COMPOSITIONS_FILE
OUTPUT_FILE = COMPOSITIONS_FILE

DATA_DIR.mkdir(parents=True, exist_ok=True)
MIDIS_DIR.mkdir(parents=True, exist_ok=True)
