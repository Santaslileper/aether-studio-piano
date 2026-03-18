// ─── AGENT BASE URL ───────────────────────────────────────────────────────────
// Reads from localStorage so users can change port without editing code.
// Set via: localStorage.setItem('aurum_agent_url', 'http://localhost:3002')
const API = localStorage.getItem('aurum_agent_url') || 'http://localhost:3001';

// ─── STATE ────────────────────────────────────────────────────────────────────
let library = [];
let filteredLibrary = [];
let activeItem = null;
let sortMode = 'priority';
let rangeLimit = 'all';
let compareMode = false;
let selectMode = false;
let compareQueue = [];
let selectedItems = new Set();

const TOP_GREATS = [
    "JOHANN SEBASTIAN BACH", "LUDWIG VAN BEETHOVEN", "WOLFGANG AMADEUS MOZART",
    "FRÉDÉRIC CHOPIN", "FRANZ SCHUBERT", "JOHANNES BRAHMS", "FRANZ LISZT",
    "CLAUDE DEBUSSY", "SERGEI RACHMANINOFF", "PYOTR ILYICH TCHAIKOVSKY"
];

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const vaultList    = document.getElementById('vault-list');
const stageFrame   = document.getElementById('stage-frame');
const splash       = document.getElementById('stage-splash');
const searchInput  = document.getElementById('lib-search');
const searchHint   = document.getElementById('search-hint');
const compareStage = document.getElementById('compare-stage');
const npTitle      = document.getElementById('np-title');
const npComposer   = document.getElementById('np-composer');
const pBtn         = document.getElementById('p-btn');
const statComposers = document.getElementById('stat-composers');
const statSongs    = document.getElementById('stat-songs');
const statMidis    = document.getElementById('stat-midis');

// ─── SMART SEARCH PARSER ──────────────────────────────────────────────────────
function parseQuery(raw) {
    const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filters = { midiOnly: null, yearMin: null, yearMax: null, cat: null, text: [] };
    for (const tok of tokens) {
        if (tok === 'midi' || tok === 'midi:yes' || tok === 'has:midi') {
            filters.midiOnly = true;
        } else if (tok === 'no:midi' || tok === 'midi:no') {
            filters.midiOnly = false;
        } else if (tok.startsWith('year:')) {
            const y = parseInt(tok.slice(5));
            if (!isNaN(y)) { filters.yearMin = y; filters.yearMax = y; }
        } else if (tok.startsWith('after:')) {
            const y = parseInt(tok.slice(6)); if (!isNaN(y)) filters.yearMin = y;
        } else if (tok.startsWith('before:')) {
            const y = parseInt(tok.slice(7)); if (!isNaN(y)) filters.yearMax = y;
        } else if (tok.startsWith('cat:') || tok.startsWith('opus:') ||
                   tok.startsWith('op:') || tok.startsWith('k:') ||
                   tok.startsWith('bwv:') || tok.startsWith('rwv:') ||
                   tok.startsWith('d:') || tok.startsWith('s:')) {
            filters.cat = tok.split(':')[1];
        } else {
            filters.text.push(tok);
        }
    }
    return filters;
}

function buildHint(filters) {
    const parts = [];
    if (filters.midiOnly === true)  parts.push('has MIDI');
    if (filters.midiOnly === false) parts.push('no MIDI');
    if (filters.yearMin !== null && filters.yearMax !== null && filters.yearMin === filters.yearMax)
        parts.push(`year ${filters.yearMin}`);
    else {
        if (filters.yearMin !== null) parts.push(`after ${filters.yearMin}`);
        if (filters.yearMax !== null) parts.push(`before ${filters.yearMax}`);
    }
    if (filters.cat) parts.push(`catalogue: "${filters.cat}"`);
    if (filters.text.length) parts.push(`text: "${filters.text.join(' ')}"`);
    return parts.length ? 'Filtering by: ' + parts.join(' · ') : '';
}

function itemMatchesFilters(item, filters) {
    if (filters.midiOnly === true  && item.midi !== true)  return false;
    if (filters.midiOnly === false && item.midi === true)  return false;
    if (filters.yearMin !== null || filters.yearMax !== null) {
        const y = parseInt(item.year);
        if (isNaN(y)) return false;
        if (filters.yearMin !== null && y < filters.yearMin) return false;
        if (filters.yearMax !== null && y > filters.yearMax) return false;
    }
    if (filters.cat) {
        const h = ((item.catalogue || '') + ' ' + (item.title || '')).toLowerCase();
        if (!h.includes(filters.cat)) return false;
    }
    for (const word of filters.text) {
        const h = ((item.composer || '') + ' ' + (item.title || '')).toLowerCase();
        if (!h.includes(word)) return false;
    }
    return true;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function fetchFromWeb() {
    const q = searchInput.value.trim();
    if (!q) return;
    const statusEl = document.getElementById('fetch-status');
    const btn = vaultList.querySelector('.btn-aurum');
    const setStatus = (msg, color) => {
        if (statusEl) { statusEl.innerText = msg; statusEl.style.color = color || 'var(--gold)'; }
    };
    if (btn) { btn.disabled = true; btn.innerText = 'FETCHING...'; }
    setStatus('INITIATING...');
    try {
        const startRes = await fetch(`${API}/api/fetch_query?q=${encodeURIComponent(q)}`, { method: 'POST' });
        if (!startRes.ok) { setStatus('SERVER ERROR ' + startRes.status, '#ff4444'); return; }
        setStatus('SEARCHING BITMIDI...');
        let finalStatus = 'running';
        for (let i = 0; i < 45; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const sr = await fetch(`${API}/api/fetch_status?q=${encodeURIComponent(q)}`);
                const sd = await sr.json();
                finalStatus = sd.status || 'running';
                if (finalStatus.startsWith('found:')) break;
                if (finalStatus === 'not_found' || finalStatus.startsWith('error:')) break;
                const labels = ['SEARCHING BITMIDI.', 'SEARCHING BITMIDI..', 'SEARCHING BITMIDI...'];
                setStatus(labels[i % 3]);
            } catch (_) {}
        }
        if (finalStatus.startsWith('found:')) {
            const title = finalStatus.slice(6);
            setStatus('FOUND: ' + title, '#00ff00');
            await fetchLibrary();
            searchInput.value = '';
            searchHint.style.display = 'none';
            applyFilters();
            setTimeout(() => {
                const items = vaultList.querySelectorAll('.vault-item');
                for (const el of items) {
                    if (el.innerText.includes(title.slice(0, 15))) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.style.outline = '1px solid var(--gold)';
                        setTimeout(() => el.style.outline = '', 2000);
                        break;
                    }
                }
            }, 300);
        } else if (finalStatus === 'not_found') {
            setStatus('NOTHING FOUND ON BITMIDI — TRY A DIFFERENT QUERY.', '#ff4444');
            if (btn) { btn.disabled = false; btn.innerText = 'TRY AGAIN'; }
        } else if (finalStatus.startsWith('error:')) {
            setStatus('ERROR: ' + finalStatus.slice(6), '#ff4444');
            if (btn) { btn.disabled = false; btn.innerText = 'RETRY'; }
        } else {
            setStatus('TIMED OUT — CHECK DEBUG LOG.', '#ff4444');
        }
    } catch (e) {
        setStatus('ERROR: ' + e.message, '#ff4444');
        if (btn) { btn.disabled = false; btn.innerText = 'RETRY'; }
    }
}

async function init() {
    await fetchStats();
    await fetchLibrary();
    searchInput.addEventListener('input', handleSearch);
    setInterval(fetchStats, 5000);
    installKeyboardShortcuts();
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
function installKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.code) {
            case 'Space':         e.preventDefault(); triggerPlay();     break;
            case 'Equal':
            case 'NumpadAdd':     e.preventDefault(); triggerZoom(+1);   break;
            case 'Minus':
            case 'NumpadSubtract':e.preventDefault(); triggerZoom(-1);   break;
            case 'KeyF':          e.preventDefault(); searchInput.focus();break;
            case 'Escape':
                if (compareMode) exitCompareMode();
                searchInput.blur();
                break;
        }
    });
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function fetchStats() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        const comps   = d.stats.composers || 0;
        const songs   = d.stats.songs     || 0;
        const midis   = d.stats.midis     || 0;
        const missing = d.stats.missing   || 0;

        [statComposers, statSongs, statMidis].forEach((el, i) => {
            if (el) el.innerText = [comps, songs, midis][i];
        });
        ['sb-stat-composers','sb-stat-songs','sb-stat-midis','sb-stat-missing'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.innerText = [comps, songs, midis, missing][i];
        });

        // ── Splash stats + per-composer breakdown ─────────────────────────────
        const splashStats = document.getElementById('splash-stats');
        if (splashStats) {
            let composerHtml = '';
            if (library.length) {
                const compMap = {};
                library.forEach(item => {
                    const c = item.composer || 'Unknown';
                    if (!compMap[c]) compMap[c] = { total: 0, midi: 0 };
                    compMap[c].total++;
                    if (item.midi === true) compMap[c].midi++;
                });
                const sorted = Object.entries(compMap)
                    .sort((a, b) => b[1].total - a[1].total)
                    .slice(0, 6);
                composerHtml = `
                    <div style="width:100%;max-width:640px;margin-top:32px;">
                        <div style="font-size:0.55rem;letter-spacing:3px;opacity:0.4;margin-bottom:14px;text-align:center;">TOP COMPOSERS BY CATALOGUE SIZE</div>
                        ${sorted.map(([name, cnt]) => {
                            const pct = cnt.total ? Math.round((cnt.midi / cnt.total) * 100) : 0;
                            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                <span style="width:180px;font-size:0.6rem;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;">${name.toUpperCase()}</span>
                                <div style="flex:1;position:relative;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;">
                                    <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:var(--gold);border-radius:2px;transition:width 0.6s ease;"></div>
                                </div>
                                <span style="width:60px;font-size:0.55rem;opacity:0.5;">${cnt.midi}/${cnt.total}</span>
                            </div>`;
                        }).join('')}
                    </div>`;
            }
            splashStats.innerHTML = `
                <div class="stat-card"><span class="stat-value">${comps}</span><span class="stat-label">COMPOSERS</span></div>
                <div class="stat-card"><span class="stat-value">${songs}</span><span class="stat-label">WORKS</span></div>
                <div class="stat-card" style="border-color:var(--gold)"><span class="stat-value" style="color:var(--gold)">${midis}</span><span class="stat-label">SONIC GOLD</span></div>
                <div class="stat-card" style="border-color:rgba(255,85,85,0.4)"><span class="stat-value" style="color:#ff5555">${missing}</span><span class="stat-label">MISSING</span></div>
            `;
            let breakdown = document.getElementById('splash-breakdown');
            if (!breakdown) {
                breakdown = document.createElement('div');
                breakdown.id = 'splash-breakdown';
                breakdown.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:center;';
                splashStats.parentNode.insertBefore(breakdown, splashStats.nextSibling);
            }
            breakdown.innerHTML = composerHtml;
        }

        // ── Status pill ───────────────────────────────────────────────────────
        const statusPill = document.getElementById('status-pill');
        statusPill.innerText = d.midi_running ? 'HARVESTING SONIC GOLD...' : 'SYSTEM IDLE';
        statusPill.style.color = d.midi_running ? '#00ff00' : '#d4af37';
        statusPill.classList.toggle('harvesting', !!d.midi_running);

        // ── Live freeform fetch banner ─────────────────────────────────────────
        const fetchBanner = document.getElementById('fetch-live-banner');
        const fetchMsg    = document.getElementById('fetch-live-msg');
        if (fetchBanner && d.fetching && d.fetching.length > 0) {
            fetchBanner.style.display = 'block';
            if (fetchMsg) fetchMsg.innerText = `⬤ FETCHING: ${d.fetching[0].toUpperCase()}`;
        } else if (fetchBanner) {
            fetchBanner.style.display = 'none';
        }

        // ── Auto-refresh library when new MIDIs arrive ────────────────────────
        if (d.stats.midis > (window._lastMidiCount || 0)) {
            window._lastMidiCount = d.stats.midis;
            await fetchLibrary();
            if (activeItem && activeItem.midi !== true) {
                const refreshed = library.find(i => i.title === activeItem.title && i.composer === activeItem.composer);
                if (refreshed && refreshed.midi === true) selectItem(refreshed);
            }
        }
    } catch (e) {}
}

async function fetchLibrary() {
    try {
        const r = await fetch(`${API}/api/library`);
        library = await r.json();
        window._compCounts = {};
        library.forEach(i => {
            const c = i.composer || 'Unknown';
            window._compCounts[c] = (window._compCounts[c] || 0) + 1;
        });
        applyFilters();
    } catch (e) {}
}

// ─── FILTERS & SORT ───────────────────────────────────────────────────────────
function handleSearch() {
    const raw = searchInput.value;
    const filters = parseQuery(raw);
    const hint = buildHint(filters);
    searchHint.innerText = hint;
    searchHint.style.display = hint ? 'block' : 'none';
    applyFilters();
}

function applyFilters() {
    const filters = parseQuery(searchInput.value);
    filteredLibrary = library.filter(item => {
        if (rangeLimit !== 'all') {
            const [min, max] = rangeLimit.split('-').map(Number);
            const count = window._compCounts[item.composer] || 0;
            if (count < min || count > max) return false;
        }
        return itemMatchesFilters(item, filters);
    });
    filteredLibrary.sort((a, b) => {
        if (sortMode === 'name')  return (a.composer || '').localeCompare(b.composer || '');
        if (sortMode === 'count') return (window._compCounts[b.composer] || 0) - (window._compCounts[a.composer] || 0);
        const aMidi = a.midi === true, bMidi = b.midi === true;
        if (aMidi !== bMidi) return aMidi ? -1 : 1;
        const aGreat = TOP_GREATS.includes((a.composer || '').toUpperCase());
        const bGreat = TOP_GREATS.includes((b.composer || '').toUpperCase());
        if (aGreat !== bGreat) return aGreat ? -1 : 1;
        return (a.composer || '').localeCompare(b.composer || '');
    });
    vaultPage = 0;
    renderVault(filteredLibrary);
}

function setSort(mode) {
    sortMode = mode;
    document.querySelectorAll('.btn-filter').forEach(b => {
        if (b.innerText === 'A-Z') b.classList.toggle('active', mode === 'name');
        if (b.innerText === '1-9') b.classList.toggle('active', mode === 'count');
    });
    applyFilters();
}
function setRange(range) { rangeLimit = range; applyFilters(); }
function toggleWorkSort() { sortMode = sortMode === 'count' ? 'priority' : 'count'; applyFilters(); }

// ─── RENDER ───────────────────────────────────────────────────────────────────
let vaultPage = 0;
const PAGE_SIZE = 60;

function renderVault(items) {
    if (!items.length) {
        const q = searchInput.value.trim();
        const fetchBtn = q
            ? `<button class="btn-aurum" style="margin-top:20px;padding:10px 24px;font-size:0.65rem;letter-spacing:2px;" onclick="fetchFromWeb()">
                   FETCH FROM WEB: ${q.toUpperCase()}
               </button>`
            : '';
        vaultList.innerHTML = `<div style="padding:30px 20px;text-align:center;">
            <div style="opacity:0.3;font-size:0.7rem;margin-bottom:8px;">NO MATCHES FOUND IN VAULT</div>
            ${fetchBtn}
            <div id="fetch-status" style="margin-top:12px;font-size:0.6rem;color:var(--gold);opacity:0.8;"></div>
        </div>`;
        return;
    }
    const displayed = items.slice(0, (vaultPage + 1) * PAGE_SIZE);
    const remaining = items.length - displayed.length;
    vaultList.innerHTML = displayed.map(item => {
        const isGreat    = TOP_GREATS.includes((item.composer || '').toUpperCase());
        const hasMidi    = item.midi === true;
        const isActive   = activeItem && activeItem.title === item.title && activeItem.composer === item.composer;
        const isQueued   = compareQueue.findIndex(q => q.title === item.title) + 1;
        const isSelected = hasMidi && selectedItems.has(item.midi_file_path);
        let badge = '';
        if (compareMode && isQueued) badge = `<span class="cmp-badge">${isQueued === 1 ? 'A' : 'B'}</span>`;
        if (selectMode  && isSelected) badge = `<span class="sel-badge">✓</span>`;
        return `
            <div class="vault-item ${isGreat ? 'is-great' : ''} ${hasMidi ? 'has-midi' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'is-selected' : ''}"
                 onclick='handleItemClick(${JSON.stringify(item).replace(/'/g, "&apos;")})'>
                ${badge}
                <span class="item-title">${item.title}</span>
                <div class="item-meta">
                    <span>${item.composer || 'Unknown'} [${window._compCounts[item.composer] || 1}]</span>
                    <span>${item.source}</span>
                    <span style="color:${hasMidi ? '#00ff00' : '#ff4444'}">${hasMidi ? '\u25cf MIDI' : '\u25cb NO MIDI'}</span>
                </div>
            </div>`;
    }).join('');
    if (remaining > 0) {
        vaultList.innerHTML += `<div style="padding:12px 20px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);">
            <button class="load-more-btn" onclick="loadMoreVault()">
                LOAD ${Math.min(PAGE_SIZE, remaining)} MORE &middot; ${remaining} REMAINING
            </button>
        </div>`;
    }
}

function loadMoreVault() {
    vaultPage++;
    renderVault(filteredLibrary);
    vaultList.scrollTop = vaultList.scrollHeight;
}

// ─── ITEM CLICK ROUTER ────────────────────────────────────────────────────────
function handleItemClick(item) {
    if (compareMode) { handleCompareClick(item); return; }
    if (selectMode)  { handleSelectClick(item);  return; }
    selectItem(item);
}

// ─── SINGLE PLAY ─────────────────────────────────────────────────────────────
function bridgeUrl(midiPath, title, composer) {
    // Pass the agent API base so kmuse_bridge.html can fetch midi_json from the right host
    return `kmuse_bridge.html?file=${encodeURIComponent(midiPath)}&title=${encodeURIComponent(title)}&composer=${encodeURIComponent(composer || '')}&api=${encodeURIComponent(API)}`;
}

function selectItem(item) {
    activeItem = item;
    renderVault(filteredLibrary);
    npTitle.innerText    = item.title.toUpperCase();
    npComposer.innerText = (item.composer || 'Unknown').toUpperCase();
    if (item.midi === true) {
        splash.style.display      = 'none';
        stageFrame.style.display  = 'block';
        stageFrame.src = bridgeUrl(item.midi_file_path, item.title, item.composer);
        pBtn.disabled = false; pBtn.innerText = 'PLAY'; pBtn.onclick = triggerPlay;
    } else {
        stageFrame.style.display = 'none';
        splash.style.display     = 'flex';
        splash.innerHTML = `
            <h2 style="font-family:'Playfair Display';font-style:italic;font-weight:normal;margin-bottom:20px;">LOCKED</h2>
            <p style="font-size:0.7rem;opacity:0.5;text-transform:uppercase;letter-spacing:2px;">MIDI FILE MISSING FOR THIS WORK</p>
            <button class="btn-aurum" style="width:auto;margin-top:30px;padding:15px 40px;" onclick='forceSearch(${JSON.stringify(item).replace(/'/g,"&apos;")})'>INITIATE TARGETED HARVEST</button>
        `;
        pBtn.disabled = false; pBtn.innerText = 'SEARCH NOW'; pBtn.onclick = () => forceSearch(item);
    }
}

async function forceSearch(item) {
    pBtn.innerText = 'SEARCHING...'; pBtn.disabled = true;
    try {
        await fetch(`${API}/api/harvest_target?composer=${encodeURIComponent(item.composer)}&title=${encodeURIComponent(item.title)}`, { method: 'POST' });
        setTimeout(fetchStats, 2000);
    } catch (e) { pBtn.innerText = 'ERROR'; }
}

// ─── COMPARE MODE ─────────────────────────────────────────────────────────────
function toggleCompareMode() {
    compareMode = !compareMode;
    selectMode = false; compareQueue = [];
    document.getElementById('btn-compare').classList.toggle('active', compareMode);
    document.getElementById('compare-hint').style.display = compareMode ? 'block' : 'none';
    document.getElementById('select-hint').style.display = 'none';
    document.getElementById('btn-select').classList.remove('active');
    if (!compareMode) exitCompareMode();
    renderVault(filteredLibrary);
}

function handleCompareClick(item) {
    if (item.midi !== true) return;
    const idx = compareQueue.findIndex(q => q.title === item.title);
    if (idx >= 0) compareQueue.splice(idx, 1);
    else if (compareQueue.length < 2) compareQueue.push(item);
    else compareQueue[1] = item;
    renderVault(filteredLibrary);
    if (compareQueue.length === 2) launchCompare();
}

function launchCompare() {
    const [a, b] = compareQueue;
    stageFrame.style.display   = 'none';
    splash.style.display       = 'none';
    compareStage.style.display = 'flex';
    compareStage.style.flexDirection = 'column';
    compareStage.style.flex    = '1';
    document.getElementById('cmp-label-a').innerText = a.title.toUpperCase().slice(0, 40);
    document.getElementById('cmp-label-b').innerText = b.title.toUpperCase().slice(0, 40);
    document.getElementById('frame-a').src = bridgeUrl(a.midi_file_path, a.title, a.composer);
    document.getElementById('frame-b').src = bridgeUrl(b.midi_file_path, b.title, b.composer);
    npTitle.innerText    = `A vs B COMPARISON`;
    npComposer.innerText = `${a.composer} vs ${b.composer}`;
}

function exitCompareMode() {
    compareStage.style.display = 'none';
    stageFrame.style.display   = 'block';
    splash.style.display       = activeItem && activeItem.midi === true ? 'none' : 'flex';
    compareMode = false; compareQueue = [];
    document.getElementById('btn-compare').classList.remove('active');
    document.getElementById('compare-hint').style.display = 'none';
    renderVault(filteredLibrary);
}

function triggerComparePlay(which) {
    const fa = document.getElementById('frame-a');
    const fb = document.getElementById('frame-b');
    if ((which === 'a' || which === 'both') && fa.contentWindow?.togglePlay) fa.contentWindow.togglePlay();
    if ((which === 'b' || which === 'both') && fb.contentWindow?.togglePlay) fb.contentWindow.togglePlay();
}

// ─── SELECT / ZIP MODE ────────────────────────────────────────────────────────
function toggleSelectMode() {
    selectMode = !selectMode;
    compareMode = false; compareQueue = []; selectedItems.clear();
    document.getElementById('btn-select').classList.toggle('active', selectMode);
    document.getElementById('select-hint').style.display  = selectMode ? 'block' : 'none';
    document.getElementById('compare-hint').style.display = 'none';
    document.getElementById('btn-compare').classList.remove('active');
    document.getElementById('btn-export').style.display   = 'none';
    renderVault(filteredLibrary);
}

function handleSelectClick(item) {
    if (item.midi !== true || !item.midi_file_path) return;
    const key = item.midi_file_path;
    if (selectedItems.has(key)) selectedItems.delete(key); else selectedItems.add(key);
    const exportBtn = document.getElementById('btn-export');
    exportBtn.style.display = selectedItems.size > 0 ? 'inline-block' : 'none';
    exportBtn.innerText = `EXPORT ZIP (${selectedItems.size})`;
    renderVault(filteredLibrary);
}

async function exportZip() {
    if (!selectedItems.size) return;
    const btn = document.getElementById('btn-export');
    btn.innerText = 'BUILDING...'; btn.disabled = true;
    try {
        const resp = await fetch(`${API}/api/export_zip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: Array.from(selectedItems) })
        });
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'aurum_export.zip'; a.click();
        URL.revokeObjectURL(url);
        btn.innerText = `EXPORTED (${selectedItems.size})`;
    } catch (e) {
        btn.innerText = 'ERROR';
    } finally {
        btn.disabled = false;
    }
}

// ─── TRANSPORT ────────────────────────────────────────────────────────────────
function triggerPlay()      { stageFrame.contentWindow?.togglePlay?.(); }
function triggerZoom(dir)   { stageFrame.contentWindow?.zoom?.(dir); }
function triggerVolume(val) { stageFrame.contentWindow?.setVolume?.(val); }
function startMetadata()    { fetch(`${API}/api/start_metadata`, { method: 'POST' }); }
function startMidi()        { fetch(`${API}/api/start_midi`,     { method: 'POST' }); }

async function syncVault(e) {
    const btn = e && e.target ? e.target : document.querySelector('.sidebar-footer .btn-mini:last-child');
    if (btn) btn.innerText = 'SYNCING...';
    try {
        await fetch(`${API}/api/sync`, { method: 'POST' });
        window._lastMidiCount = 0;
        await fetchStats();
        await fetchLibrary();
    } finally {
        if (btn) btn.innerText = 'SYNC';
    }
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────
let logsOpen = false;
function toggleLogs() {
    const lp = document.getElementById('log-panel');
    logsOpen = !logsOpen;
    lp.style.display = logsOpen ? 'flex' : 'none';
    if (logsOpen) updateLogs();
}
async function updateLogs() {
    if (!logsOpen) return;
    try {
        const r = await fetch(`${API}/api/logs`);
        const d = await r.json();
        const content = document.getElementById('log-content');
        content.innerHTML = d.midi_logs.map(line => {
            let cls = '';
            if (line.includes('SUCCESS')) cls = 'success';
            if (line.includes('ERR') || line.includes('FAILURE')) cls = 'error';
            return `<div class="log-line ${cls}">${line}</div>`;
        }).join('');
        content.scrollTop = content.scrollHeight;
    } catch (e) {}
}

// ─── POLLING ──────────────────────────────────────────────────────────────────
setInterval(updateLogs, 2000);
setInterval(() => {
    const win = stageFrame.contentWindow;
    if (!win || compareMode) return;
    if (win.isLoading)        { pBtn.innerText = 'LOADING AUDIO...'; pBtn.classList.remove('playing'); }
    else if (!win.audioReady) { pBtn.innerText = 'PLAY'; pBtn.classList.remove('playing'); }
    else { pBtn.innerText = win.isPlaying ? 'PAUSE' : 'PLAY'; pBtn.classList.toggle('playing', !!win.isPlaying); }
}, 300);

init();
