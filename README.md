# AETHER STUDIO — Classical Piano Vault

> **GitHub Pages frontend + local Python agent** — the Ollama model for classical MIDI.

A dark-gold sheet music reader backed by 7,000+ classical piano works, with live Playwright harvesting, VexFlow engraving, and Tone.js playback.

---

## Architecture

```
Santaslileper.github.io/aether-studio-piano   ←  GitHub Pages (this repo's /docs)
         │
         │  API calls to http://localhost:3001
         ▼
  localhost:3001  ←  aether-agent.py   (user's machine)
         │
         ├── midis/        MIDI files on disk
         ├── data/         all_compositions.json
         └── core/         harvester · vault · utils
```

---

## 🚀 Go Live in 3 Steps

### 1. Push this repo to GitHub
```bash
git init
git add .
git commit -m "initial"
gh repo create aether-studio-piano --public --push --source=.
```

### 2. Enable GitHub Pages
Settings → Pages → **Source: GitHub Actions** → Save

---

## 👤 User Install (Windows)

Users visit your GitHub Pages URL. If the local agent isn't running, they see the install overlay. One paste in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Santaslileper/aether-studio-piano/main/install.ps1 | iex
```

That script:
1. Checks Python 3.8+
2. Downloads `aether-agent.zip` from your latest GitHub Release
3. `pip install` all deps (`fastapi`, `uvicorn`, `playwright`, `mido`)
4. `playwright install chromium`
5. Creates a desktop shortcut **Aether Studio**
6. Starts the agent at `http://localhost:3001`

After install, double-click the desktop shortcut to start the agent on future sessions.

---

## 📦 Releasing a New Agent Version

```bash
git tag v1.1.0
git push origin v1.1.0
```

GitHub Actions (`release.yml`) automatically zips `agent/` → `aether-agent.zip` and attaches it to the release. Users who re-run the installer get the latest agent.

Updating the **frontend** only (UI fixes, new features): just `git push main` — no reinstall needed by users.

---

## 🔧 Local Development

```bash
# Run the agent (API only, for testing with the GitHub Pages frontend)
cd client/agent
python agent.py
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Stats, harvest state, active fetches |
| GET | `/api/library` | Full composition list |
| GET | `/api/search?q=` | Server-side filtered search |
| GET | `/api/midi_json?path=` | MIDI → JSON notes |
| GET | `/midis/{filename}` | Serve MIDI file |
| POST | `/api/start_midi` | Begin full harvest |
| POST | `/api/harvest_target` | Harvest single work |
| POST | `/api/fetch_query?q=` | Freeform bitmidi search |
| POST | `/api/sync` | Re-run vault merge |
| POST | `/api/export_zip` | Download selected MIDIs |

---

## Search Tokens

```
midi              only works with MIDI
no:midi           works without MIDI  
after:1820        composed after 1820
before:1900       before 1900
composer:bach     filter by composer
cat:bwv           catalogue match
opus:13           opus number
k:331             Köchel number
```
