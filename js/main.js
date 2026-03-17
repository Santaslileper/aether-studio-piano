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
        updateSongDisplay: () => {
             updateSongDisplay();
        }
    };

    setupUI(handlers);

    // 3. Populate Library with Curated Songs
    for (const songName of CURATED_SONGS) {
        const key = songName;
        // Map song name to potential filename
        const slug = songName.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents (ü -> u)
                .replace(/ – /g, '___')
                .replace(/ - /g, '___')
                .replace(/ /g, '_')
                .replace(/[^a-z0-9_]/g, '')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
        
        const fileMap = {
            'ludwig_van_beethoven___fur_elise': 'ludwig_van_beethoven___f_r_elise.js',
            'ludwig_van_beethoven___moonlight_sonata': 'ludwig_van_beethoven___moonlight_sonata.js',
            'the_muffin_man': 'the_muffin_man.js'
        };
        const fileName = fileMap[slug] || (slug + '.js');
        
        state.playlists[key] = { 
            name: songName, 
            fileName: fileName,
            isLocal: true,
            data: null
        };
    }

    // Load extra saved songs from localStorage
    try {
        const saved = JSON.parse(localStorage.getItem('piano_saved_songs') || '{}');
        Object.assign(state.playlists, saved);
    } catch (_) {}

    updateLibraryUI();

    // 4. Load Last Song or Default
    const lastSong = lsGet('last_song', CURATED_SONGS[4] || CURATED_SONGS[0]); // Default to Fur Elise
    if (state.playlists[lastSong]) {
        state.currentSongKey = lastSong;
        // Since we don't have the data yet, we need to load it
        await loadSongData(lastSong);
        updateSongDisplay();
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
