import * as THREE from 'https://esm.sh/three@0.160.0';
import * as Tone from 'https://esm.sh/tone@15.1.22';
import { state } from './state.js';
import { camera, scene } from './visuals.js';
import { 
    playNote, releaseNote, setSustain, triggerFootBass, handleNarratorKeypress,
    switchSong
} from './piano.js';
import { updateKeyLabels } from './visuals.js';
import { getShiftedNote } from './utils.js';
import { keyMap, revKeyMap } from './constants.js';

function syncZoomUI() {
    const zsl = document.getElementById('camera-zoom');
    if (zsl) zsl.value = state.cameraZoom;
    const zlb = document.querySelector('.zoom-label');
    if (zlb) zlb.textContent = `${state.cameraZoom.toFixed(1)}×`;
}

export function setupInput() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    window.addEventListener('mousedown', e => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        if (!hits.length) return;
        let obj = hits[0].object;
        while (obj && !obj.userData.note && !obj.userData.pedalType) obj = obj.parent;
        if (obj?.userData.note) { playNote(obj.userData.note); state.hoveredKey = obj; }
        else if (obj?.userData.pedalType === 'sustain') setSustain(true);
        else if (obj?.userData.pedalType === 'footBass') triggerFootBass(true);
    });

    window.addEventListener('mouseup', () => {
        if (state.hoveredKey) { releaseNote(state.hoveredKey.userData.note); state.hoveredKey = null; }
        state.activeNotes.forEach(n => releaseNote(n));
        if (!state.activeKeyboardNotes.has('Space')) setSustain(false);
        triggerFootBass(false);
    });

    window.addEventListener('blur', () => {
        state.activeKeyboardNotes.forEach((note) => releaseNote(note));
        state.activeKeyboardNotes.clear();
        state.activeNotes.forEach(n => releaseNote(n));
        setSustain(false);
        triggerFootBass(false);
    });

    window.addEventListener('keydown', e => {
        // Skip if typing in an input field
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        
        if (e.repeat) return;
        const ks = e.key?.toLowerCase() || '';

        if (ks === '`') { 
            console.log('Toggling Debug Panel');
            const dbg = document.getElementById('debug-panel');
            if (dbg) dbg.style.display = dbg.style.display === 'none' ? 'block' : 'none'; 
            return; 
        }
        console.log('Keydown:', ks, 'Midi:', keyMap[ks]);
        if (e.key === 'ArrowRight') { switchSong(1); return; }
        if (e.key === 'ArrowLeft')  { switchSong(-1); return; }
        if (e.key === '=' || e.key === '+') { 
            state.cameraZoom = Math.max(0.4, state.cameraZoom - 0.1); 
            syncZoomUI();
            return; 
        }
        if (e.key === '-' || e.key === '_') { 
            state.cameraZoom = Math.min(3.0, state.cameraZoom + 0.1); 
            syncZoomUI();
            return; 
        }

        const base = keyMap[ks];
        if (!base) return;

        if (base === 'SUSTAIN')    { setSustain(true); return; }
        if (base === 'VB_PEDAL')   { triggerFootBass(true); return; }
        if (base === 'SOFT_PEDAL') { if (state.audioStarted) Tone.Destination.volume.rampTo(Tone.gainToDb(state.masterVolume * 0.55), 0.08); return; }

        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
            // Prevent browser default behavior (like Alt opening the menu)
            if (ks !== 'c' && ks !== 'v' && ks !== 'x') e.preventDefault();
        }

        let shift = 0;
        let shiftText = "NORMAL";
        if (e.shiftKey) { shift += 1; shiftText = "+1 OCTAVE"; }
        if (e.ctrlKey)  { shift -= 1; shiftText = "-1 OCTAVE"; }
        if (e.metaKey)  { shift -= 2; shiftText = "-2 OCTAVE"; } // Swapped Alt for Meta/Win

        if (state.octaveShift !== shift) {
            state.octaveShift = shift;
            updateKeyLabels();
        }

        const octDisp = document.getElementById('octave-display');
        if (octDisp && shift !== 0) {
            octDisp.textContent = `Octave: ${shiftText}`;
            octDisp.classList.add('visible');
            clearTimeout(state._octTimer);
            state._octTimer = setTimeout(() => octDisp.classList.remove('visible'), 1500);
        }

        const note = getShiftedNote(base, shift);
        if (!note) return;
        
        // Anti-skip: if note is already active on this code, release first
        if (state.activeKeyboardNotes.has(e.code)) {
             releaseNote(state.activeKeyboardNotes.get(e.code));
        }

        state.activeKeyboardNotes.set(e.code, note);

        if (state.narratorMode) {
            handleNarratorKeypress(note);
            return;
        }
        playNote(note);
    });

    window.addEventListener('keyup', e => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        const ks = e.key?.toLowerCase() || '';
        const base = keyMap[ks];
        if (base === 'SUSTAIN')    { setSustain(false); return; }
        if (base === 'VB_PEDAL')   { triggerFootBass(false); return; }
        if (base === 'SOFT_PEDAL') { if (state.audioStarted) Tone.Destination.volume.rampTo(Tone.gainToDb(state.masterVolume), 0.08); return; }
        
        let shift = 0;
        if (e.shiftKey) shift += 1;
        if (e.ctrlKey)  shift -= 1;
        if (e.metaKey)  shift -= 2;

        if (state.octaveShift !== shift) {
            state.octaveShift = shift;
            updateKeyLabels();
        }

        const note = state.activeKeyboardNotes.get(e.code);
        if (note) { releaseNote(note); state.activeKeyboardNotes.delete(e.code); }
    });

    window.addEventListener('wheel', e => {
        const delta = e.deltaY > 0 ? 0.05 : -0.05;
        state.cameraZoom = Math.max(0.4, Math.min(3.0, state.cameraZoom + delta));
        syncZoomUI();
    }, { passive: true });
}
