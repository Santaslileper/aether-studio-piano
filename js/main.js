import { state, lsGet } from './state.js';
import { CURATED_SONGS } from './constants.js';
import { initVisuals, animate } from './visuals.js';
import { setupUI, updateLibraryUI } from './ui.js';
import { setupInput } from './input.js';
import { initAudio, loadInstrument } from './audio.js';
import { 
    startAutoplay, stopAutoplay, switchSong, selectSong, deleteSong,
    startNarrator, stopNarrator, setSustain, triggerFootBass,
    updateSongDisplay
} from './piano.js';

async function init() {
    console.log('Initializing Aether Studio Piano...');

    // 1. Setup Input & Visuals
    initVisuals();
    setupInput();

    // 2. Setup UI Handlers
    const handlers = {
        startAutoplay, stopAutoplay, switchSong, selectSong, deleteSong,
        startNarrator, stopNarrator, setSustain, triggerFootBass,
        initAudio, loadInstrument,
        updateSongDisplay,
        updateSheetMusic: (data, idx) => {
            // Internal bridge for UI triggering visuals
            import('./visuals.js').then(m => m.updateSheetMusic(data, idx));
        },
        setVolume: (v) => {
            if (state.audioStarted) {
                import('https://esm.sh/tone@15.1.22').then(Tone => {
                    Tone.getDestination().volume.rampTo(Tone.gainToDb(v), 0.1);
                });
            }
        },
        updateSongDisplay: () => {
             updateSongDisplay();
        }
    };

    setupUI(handlers);

    // 3. Populate Library with Songs from Manifest
    try {
        const response = await fetch('./assets/songs_manifest.json');
        const assetFiles = await response.json();

        for (const songInfo of assetFiles) {
            const { fileName, friendlyName } = songInfo;
            state.playlists[friendlyName] = { 
                name: friendlyName, 
                fileName: fileName,
                isLocal: true,
                data: null
            };
        }
        console.log(`Successfully loaded ${assetFiles.length} songs from manifest.`);
    } catch (e) {
        console.error('Failed to load songs manifest:', e);
    }

    // Load extra saved songs from localStorage
    try {
        const saved = JSON.parse(localStorage.getItem('piano_saved_songs') || '{}');
        Object.assign(state.playlists, saved);
    } catch (_) {}

    const playlistCount = Object.keys(state.playlists).length;
    console.log(`Library populated with ${playlistCount} songs.`);
    updateLibraryUI();

    // 4. Load Last Song or Default
    const playlistKeys = Object.keys(state.playlists);
    const defaultSong = playlistKeys[0] || '';
    const lastSong = lsGet('last_song', defaultSong);
    if (state.playlists[lastSong]) {
        state.currentSongKey = lastSong;
        // Since we don't have the data yet, we need to load it
        await loadSongData(lastSong);
        updateSongDisplay();
    }
    
    // Set initial volume if audio is later started
    if (state.masterVolume !== 0.8) {
        import('https://esm.sh/tone@15.1.22').then(Tone => {
            if (Tone.getDestination()) Tone.getDestination().volume.value = Tone.gainToDb(state.masterVolume);
        });
    }

    // 5. Start Animation Loop
    animate();
}

async function loadSongData(key) {
    const song = state.playlists[key];
    if (!song || song.data) return;

    try {
        const module = await import(`../assets/${song.fileName}`);
        song.data = Object.values(module)[0];
        console.log(`Loaded song data for: ${song.name}`);
    } catch (e) {
        console.error(`Failed to load song data for ${song.name}:`, e);
    }
}

// Override internal selectSong to handle data loading
const originalSelectSong = selectSong;
window.selectSong = async (key) => {
    await loadSongData(key);
    originalSelectSong(key);
};

// Start the app
init().catch(console.error);
