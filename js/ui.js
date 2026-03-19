import { state, lsSet, dlog } from './state.js';
import { 
    CURATED_SONGS, COMPOSERS, keyMap 
} from './constants.js';
import { INSTRUMENT_GROUPS } from './audio.js';
import { fmtTime, getShiftedNote, countConsecutive } from './utils.js';

export function setupUI(handlers) {
    const { 
        startAutoplay, stopAutoplay, switchSong, selectSong, deleteSong,
        startNarrator, stopNarrator, setSustain, triggerFootBass,
        initAudio, loadInstrument
    } = handlers;

    // Search
    const searchInput = document.getElementById('song-search');
    const searchResults = document.getElementById('search-results');
    let searchTimer;

    searchInput.addEventListener('input', e => {
        clearTimeout(searchTimer);
        const term = e.target.value.trim();
        if (!term || term.length < 2) { searchResults.classList.add('hidden'); return; }

        const local = Object.entries(state.playlists)
            .filter(([, s]) => s.name.toLowerCase().includes(term.toLowerCase()))
            .slice(0, 10);
        
        const localHtml = local.map(([k, s]) => `<div class="search-item local" data-key="${k}"><span>${s.name}</span><span class="badge local">Library</span></div>`).join('');
        
        if (localHtml) {
            searchResults.innerHTML = localHtml;
            searchResults.classList.remove('hidden');
            searchResults.style.display = 'block';
        } else {
            searchResults.innerHTML = '<div class="search-item" style="opacity:.5">Searching...</div>';
            searchResults.classList.remove('hidden');
            searchResults.style.display = 'block';
        }

        searchTimer = setTimeout(async () => {
            const currentLocalHtml = Object.entries(state.playlists)
                .filter(([, s]) => s.name.toLowerCase().includes(term.toLowerCase()))
                .map(([k, s]) => `<div class="search-item local" data-key="${k}"><span>${s.name}</span><span class="badge local">Local</span></div>`).join('');

            try {
                // BYPASS: If term looks like a URL, allow direct download
                if (term.match(/^https?:\/\/.*\.mid(i)?$/i)) {
                    searchResults.innerHTML = `<div class="search-item direct-dl" data-url="${term}"><span>Direct Import: ${term.split('/').pop()}</span><span class="badge">Bypass</span></div>` + currentLocalHtml;
                    searchResults.classList.remove('hidden');
                    return;
                }

                const apiBase = 'http://127.0.0.1:3001';
                const res = await fetch(`${apiBase}/search?q=${encodeURIComponent(term)}`);
                if (!res.ok) throw new Error();
                const online = await res.json();
                
                const filtered = online.filter(r => {
                   const n = r.name.toLowerCase();
                   return !n.includes('random midi') && !n.includes('privacy') && !n.includes('about bitmidi') && !n.includes('terms') && !n.includes('contact');
                });
                const onlineHtml = filtered.map(r => `<div class="search-item online" data-path="${r.path}" data-name="${r.name}">${r.name} <span class="badge">BitMidi</span></div>`).join('');
                
                if (currentLocalHtml || onlineHtml) { 
                    searchResults.innerHTML = currentLocalHtml + onlineHtml; 
                    searchResults.classList.remove('hidden'); 
                    searchResults.style.display = 'block';
                }
            } catch (_) { 
                if (currentLocalHtml) {
                    searchResults.innerHTML = currentLocalHtml + '<div class="search-item" style="opacity:.6; font-size:0.75rem; justify-content:center"><i>Library Mode (Backend Offline)</i></div>';
                } else {
                    searchResults.innerHTML = '<div class="search-item" style="opacity:.5; justify-content:center">Paste a MIDI URL here to Import Directly</div>';
                }
            }
        }, 500);
    });

    document.addEventListener('click', e => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('hidden');
            searchResults.style.display = 'none';
        }
    });

    searchResults.addEventListener('click', async e => {
        const item = e.target.closest('.search-item');
        if (!item) return;
        if (item.dataset.key) { 
            selectSong(item.dataset.key); 
            searchResults.classList.add('hidden'); searchResults.style.display='none';
            searchInput.value=''; 
            return; 
        }
        if (item.dataset.name && item.classList.contains('curated') && !item.dataset.key) {
            searchInput.value = item.dataset.name;
            searchInput.dispatchEvent(new Event('input'));
            return;
        }
        if (item.dataset.path || item.dataset.url) {
            const name = item.dataset.name || (item.dataset.url ? item.dataset.url.split('/').pop() : 'Direct Import');
            const path = item.dataset.path;
            const url = item.dataset.url;

            item.innerHTML = `<div class="dl-progress"><div class="dl-label">Downloading ${name}…</div><div class="dl-bar"><div class="dl-fill" style="width:50%"></div></div></div>`;
            try {
                let sequence = [];
                if (url) {
                    const { Midi } = await import('https://esm.sh/@tonejs/midi');
                    const res = await fetch(url);
                    const arrayBuffer = await res.arrayBuffer();
                    const midi = new Midi(arrayBuffer);
                    let notes = [], pedalEvents = [];
                    midi.tracks.forEach(track => {
                        track.notes.forEach(note => {
                            notes.push({ type: 'note', note: note.name, time: note.time, duration: note.duration });
                        });
                        if (track.controlChanges[64]) {
                            track.controlChanges[64].forEach(cc => {
                                pedalEvents.push({ type: 'sustain', time: cc.time, value: cc.value > 0.5 });
                            });
                        }
                    });
                    sequence = [...notes, ...pedalEvents].sort((a, b) => a.time - b.time);
                } else {
                    const apiBase = 'http://127.0.0.1:3001';
                    const res = await fetch(`${apiBase}/download?path=${encodeURIComponent(path)}`);
                    if (!res.ok) throw new Error();
                    sequence = await res.json();
                }

                if (!Array.isArray(sequence) || !sequence.length) throw new Error('Empty');
                const key = `ONLINE_${Date.now()}`;
                const song = { name: name.replace('.mid', '').replace(/-/g, ' '), data: sequence };
                state.playlists[key] = song;
                const saved = JSON.parse(localStorage.getItem('piano_saved_songs') || '{}');
                saved[key] = song; lsSet('piano_saved_songs', JSON.stringify(saved));
                updateLibraryUI();
                
                // Instant Feedback & Auto-Selection (No alerts/resets)
                searchResults.classList.add('hidden');
                searchResults.style.display = 'none';
                searchInput.value = '';
                selectSong(key);
            } catch (_) { item.innerHTML = `<span style="color:var(--danger)">Failed — is the server running?</span>`; }
        }
    });

    // Library
    // Library Modal Search & Filters
    const libSearchInput = document.getElementById('library-search');
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    libSearchInput?.addEventListener('input', () => updateLibraryUI());
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateLibraryUI();
        });
    });

    const libraryModal = document.getElementById('library-modal');

    document.getElementById('library-open').addEventListener('click', () => { 
        updateLibraryUI(); 
        libraryModal.classList.remove('hidden'); 
    });
    
    const closeBtn = document.getElementById('library-close-btn') || document.getElementById('library-close');
    closeBtn?.addEventListener('click', () => libraryModal.classList.add('hidden'));

    document.addEventListener('click', e => {
        const chip = e.target.closest('.composer-chip');
        const btn = e.target.closest('.lib-btn');
        const item = e.target.closest('.library-item');
        if (chip) { 
            if (libSearchInput) {
                libSearchInput.value = chip.dataset.name;
                updateLibraryUI();
            } else {
                searchInput.value = chip.dataset.name; 
                searchInput.dispatchEvent(new Event('input')); 
                libraryModal.classList.add('hidden'); 
            }
        }
        if (btn && item) {
            e.stopPropagation();
            const key = item.dataset.key;
            if (btn.classList.contains('play')) { selectSong(key); libraryModal.classList.add('hidden'); }
            if (btn.classList.contains('del'))  { deleteSong(key); }
            return;
        }

        if (item) {
            const key = item.dataset.key;
            selectSong(key);
            libraryModal.classList.add('hidden');
        }
    });

    // Transport
    document.getElementById('auto-play').addEventListener('click', () => startAutoplay());
    document.getElementById('prev-track').addEventListener('click', () => switchSong(-1));
    document.getElementById('next-track').addEventListener('click', () => switchSong(1));

    const scrubEl = document.getElementById('song-scrub');
    scrubEl?.addEventListener('input', e => { const c = document.querySelector('.curr-time'); if (c) c.textContent = fmtTime(+e.target.value); });
    scrubEl?.addEventListener('change', e => {
        const v = +e.target.value;
        if (state.isPlaying) startAutoplay(v);
        else { 
            const s = state.playlists[state.currentSongKey]?.data || []; 
            let ni = -1; 
            for (const it of s) { if (it.time <= v && it.type === 'note') ni++; else if (it.time > v) break; } 
            handlers.updateSheetMusic(s, ni); 
        }
    });

    // Settings
    const settingsModal = document.getElementById('settings-modal');
    const KB = [
        ['1','2','3','4','5','6','7','8','9','0','-','=',{l:'Back',c:'Back',w:'w-wide'}],
        [{l:'Tab',c:'Tab',w:'w-wide'},'q','w','e','r','t','y','u','i','o','p','[',']'],
        [{l:'Caps',c:'Caps',w:'w-wide'},'a','s','d','f','g','h','j','k','l',";","'",{l:'Enter',c:'Enter',w:'w-xl'}],
        [{l:'Shift',c:'Shift',w:'w-2xl'},'z','x','c','v','b','n','m',',','.','/'],
        [{l:'Ctrl',c:'ctrl',w:'w-wide'},{l:'Alt',c:'alt'},{l:'Space',c:' ',w:'w-space'},{l:'Alt',c:'alt'},{l:'Ctrl',c:'ctrl',w:'w-wide'}],
    ];

    document.getElementById('settings-open').addEventListener('click', () => {
        const list = document.getElementById('key-bindings-list');
        let h = '<div class="vkb">';
        KB.forEach(row => {
            h += '<div class="vkb-row">';
            row.forEach(k => {
                const isObj = typeof k === 'object';
                const label = isObj ? k.l : k, code = isObj ? k.c : k, cls = isObj ? (k.w || '') : '';
                const mapped = keyMap[code.toLowerCase()] || keyMap[code];
                h += `<div class="vk ${cls} ${mapped ? 'mapped' : ''}"><span class="vk-label">${label}</span>${mapped ? `<span class="vk-note">${mapped}</span>` : ''}</div>`;
            });
            h += '</div>';
        });
        h += '</div>';
        list.innerHTML = h;
        const ptToggle = document.getElementById('toggle-page-turn');
        if (ptToggle) ptToggle.checked = state.disablePageTurn;
        
        settingsModal.classList.remove('hidden');
    });

    document.getElementById('toggle-page-turn')?.addEventListener('change', e => {
        state.disablePageTurn = e.target.checked;
        lsSet('disablePageTurn', state.disablePageTurn);
    });

    document.getElementById('settings-close-btn').addEventListener('click', () => settingsModal.classList.add('hidden'));

    // Recording
    const recBtn = document.getElementById('record-btn');
    const replayBtn = document.getElementById('replay-btn');

    recBtn.addEventListener('click', () => {
        if (state.isRecording) {
            state.isRecording = false;
            recBtn.classList.remove('recording'); recBtn.title = 'Record';
            if (state.recordBuffer.length > 0) {
                const key = `REC_${Date.now()}`;
                state.playlists[key] = { name: `Recording ${new Date().toLocaleTimeString()}`, data: state.recordBuffer, isRecording: true };
                state.currentSongKey = key;
                handlers.updateSongDisplay();
                replayBtn.classList.remove('hidden');
                console.log(`Saved recording: ${state.recordBuffer.length} events`);
            }
            state.recordBuffer = [];
        } else {
            if (state.isPlaying) stopAutoplay();
            state.isRecording = true; state.recordStart = Date.now(); state.recordBuffer = [];
            recBtn.classList.add('recording'); recBtn.title = 'Stop Recording';
            replayBtn.classList.add('hidden');
        }
    });

    replayBtn.addEventListener('click', () => {
        if (!state.currentSongKey || !state.playlists[state.currentSongKey]?.isRecording) return;
        startAutoplay(0);
    });

    // Sliders
    const speedSlider = document.getElementById('play-speed');
    const speedLabel = document.querySelector('.speed-label');
    speedSlider.value = state.playbackSpeed;
    if (speedLabel) speedLabel.textContent = `${state.playbackSpeed.toFixed(1)}×`;
    speedSlider.addEventListener('input', e => {
        state.playbackSpeed = +e.target.value;
        if (speedLabel) speedLabel.textContent = `${state.playbackSpeed.toFixed(1)}×`;
        lsSet('speed', state.playbackSpeed);
        if (state.isPlaying) { const off = +(document.getElementById('song-scrub')?.value || 0); stopAutoplay(); startAutoplay(off); }
    });

    const zoomSlider = document.getElementById('camera-zoom');
    const zoomLabel = document.querySelector('.zoom-label');
    if (zoomSlider) {
        zoomSlider.value = state.cameraZoom;
        zoomSlider.addEventListener('input', e => {
            state.cameraZoom = +e.target.value;
            if (zoomLabel) zoomLabel.textContent = `${state.cameraZoom.toFixed(1)}×`;
        });
    }

    const volSlider = document.getElementById('play-volume');
    const volLabel = document.querySelector('.volume-label');
    volSlider.value = state.masterVolume * 100;
    if (volLabel) volLabel.textContent = `${Math.round(state.masterVolume * 100)}%`;
    volSlider.addEventListener('input', e => {
        state.masterVolume = +e.target.value / 100;
        if (volLabel) volLabel.textContent = `${Math.round(state.masterVolume * 100)}%`;
        handlers.setVolume(state.masterVolume);
        lsSet('vol', state.masterVolume);
    });

    // Others
    document.getElementById('narrator-toggle').addEventListener('click', startNarrator);
    document.getElementById('sustain-indicator').addEventListener('click', () => setSustain(!state.sustainActive));
    document.getElementById('fullscreen-toggle').addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen?.();
    });

    const instrSel = document.getElementById('instrument-select');
    let instrHtml = '';
    for (const [group, names] of Object.entries(INSTRUMENT_GROUPS)) {
        instrHtml += `<optgroup label="${group.toUpperCase()}">`;
        names.forEach(n => { instrHtml += `<option value="${n}">${n.toUpperCase()}</option>`; });
        instrHtml += '</optgroup>';
    }
    instrSel.innerHTML = instrHtml;
    instrSel.value = state.currentInstrumentName;
    instrSel.addEventListener('change', e => { if (state.audioStarted) loadInstrument(e.target.value); else lsSet('instrument', e.target.value); });

    document.getElementById('start-audio').addEventListener('click', async e => {
        e.stopPropagation();
        e.target.textContent = 'Starting…';
        await initAudio();
        if (!state.audioStarted) { e.target.textContent = 'Start Session'; alert('Audio failed. Try refreshing.'); }
    });

    // MIDI Load / Upload Bypass
    const loadMidiBtn = document.getElementById('load-midi-btn');
    const midiUpload = document.getElementById('midi-upload');

    loadMidiBtn?.addEventListener('click', () => midiUpload.click());

    const handleMidiFile = async (file) => {
        if (!file) return;
        const name = file.name;
        try {
            const { Midi } = await import('https://esm.sh/@tonejs/midi');
            const arrayBuffer = await file.arrayBuffer();
            const midi = new Midi(arrayBuffer);
            let notes = [], pedalEvents = [];
            midi.tracks.forEach(track => {
                track.notes.forEach(note => {
                    notes.push({ type: 'note', note: note.name, time: note.time, duration: note.duration });
                });
                if (track.controlChanges[64]) {
                    track.controlChanges[64].forEach(cc => {
                        pedalEvents.push({ type: 'sustain', time: cc.time, value: cc.value > 0.5 });
                    });
                }
            });
            const sequence = [...notes, ...pedalEvents].sort((a, b) => a.time - b.time);
            if (!sequence.length) throw new Error('Empty');
            const key = `ONLINE_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const song = { name: name.replace('.mid', '').replace('.midi', '').replace(/-/g, ' ').replace(/_/g, ' '), data: sequence };
            state.playlists[key] = song;
            const saved = JSON.parse(localStorage.getItem('piano_saved_songs') || '{}');
            saved[key] = song; lsSet('piano_saved_songs', JSON.stringify(saved));
            updateLibraryUI();
            selectSong(key);
            document.getElementById('library-modal').classList.add('hidden');
        } catch (err) {
            console.error('MIDI Load failed', err);
            alert('Failed to load MIDI file: ' + err.message);
        }
    };

    midiUpload?.addEventListener('change', e => {
        if (e.target.files) {
            Array.from(e.target.files).forEach(file => handleMidiFile(file));
        }
    });

    // Drag and Drop Bypass
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
        e.preventDefault();
        if (e.dataTransfer.files) {
            Array.from(e.dataTransfer.files).forEach(file => {
                if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
                    handleMidiFile(file);
                }
            });
        }
    });
}

export function updateLibraryUI() {
    const searchVal = document.getElementById('library-search')?.value.toLowerCase() || '';
    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
    const songsList = document.getElementById('library-songs-list');
    const compList = document.getElementById('composer-list');

    // 1. Filter Songs
    const allSongs = Object.entries(state.playlists);
    const filteredSongs = allSongs.filter(([k, s]) => {
        // Basic Metadata Filter
        const matchesSearch = s.name.toLowerCase().includes(searchVal);
        const isOnline = k.startsWith('ONLINE_');
        const isLocal = s.isLocal;
        const isRecording = s.isRecording;

        if (!matchesSearch) return false;

        // Type Filter
        if (activeFilter === 'local') return isLocal;
        if (activeFilter === 'downloaded') return isOnline || isRecording;
        
        return true;
    });

    // 2. Render Songs Grid (Grouped by Composer for folder-like feel)
    if (songsList) {
        if (filteredSongs.length === 0) {
            songsList.innerHTML = `<div class="empty-state">No songs found for "${searchVal}"</div>`;
        } else {
            // Grouping logic
            const groups = {};
            filteredSongs.forEach(([k, s]) => {
                let composer = 'Other';
                for (const c of COMPOSERS) {
                    if (s.name.toLowerCase().includes(c.toLowerCase())) {
                        composer = c;
                        break;
                    }
                }
                if (!groups[composer]) groups[composer] = [];
                groups[composer].push([k, s]);
            });

            // Sort groups: Composers first, then Other
            const sortedGroupNames = Object.keys(groups).sort((a, b) => {
                if (a === 'Other') return 1;
                if (b === 'Other') return -1;
                return a.localeCompare(b);
            });

            songsList.innerHTML = sortedGroupNames.map(groupName => `
                <div class="library-group">
                    <h3 class="group-header"><span class="icon">📁</span> ${groupName}</h3>
                    <div class="group-content">
                        ${groups[groupName].map(([k, s]) => `
                            <div class="library-item ${state.currentSongKey === k ? 'active' : ''}" data-key="${k}">
                                <div class="item-visual">
                                    <span class="icon">${s.isLocal ? '🏛️' : s.isRecording ? '⏺️' : '☁️'}</span>
                                </div>
                                <div class="item-info">
                                    <h4>${s.name.replace(groupName + ' – ', '').replace(groupName + ' - ', '').replace('Fr d ric', 'Frédéric')}</h4>
                                    <p>${s.isLocal ? 'Aether Library' : s.isRecording ? 'Your Recording' : 'Downloaded'}</p>
                                </div>
                                <div class="item-actions">
                                    <button class="lib-btn play" title="Play Now">▶</button>
                                    ${(!s.isLocal) ? `<button class="lib-btn del" title="Delete">✕</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }
    }

    // 3. Render Composers
    if (compList) {
        compList.innerHTML = COMPOSERS.map(c => `
            <button class="composer-chip ${searchVal.includes(c.toLowerCase()) ? 'active' : ''}" data-name="${c}">${c}</button>
        `).join('');
    }

    // 4. Update Online Results in sidebar (if element exists)
    const onlineList = document.getElementById('online-song-list');
    if (onlineList) {
        const downloaded = allSongs.filter(([k]) => k.startsWith('ONLINE_'));
        onlineList.innerHTML = downloaded.map(([k, s]) => `
             <div class="library-item mini" data-key="${k}">
                <span>${s.name}</span>
                <button class="lib-btn play">▶</button>
             </div>
        `).join('');
    }
}

export function updateSongDisplayUI(song) {
    if (!song) return;
    const nameEl = document.querySelector('.song-name');
    if (nameEl) nameEl.textContent = song.name;
    const s = document.getElementById('song-scrub');
    const tt = document.querySelector('.total-time');
    const ct = document.querySelector('.curr-time');
    const dur = song.data?.length ? song.data[song.data.length - 1].time : 0;
    if (s) { s.max = dur; s.value = 0; }
    if (tt) tt.textContent = fmtTime(dur);
    if (ct) ct.textContent = '0:00';
}

export function updateScrubUI(time) {
    const s = document.getElementById('song-scrub');
    const c = document.querySelector('.curr-time');
    if (s && !s.matches(':active')) s.value = time;
    if (c) c.textContent = fmtTime(time);
}
