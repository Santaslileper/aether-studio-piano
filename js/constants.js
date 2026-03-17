export const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const WKW = 0.55;
export const WKH = 3.5;
export const WKD = 0.38;
export const BKW = 0.30;
export const BKH = 2.0;
export const BKD = 0.32;
export const KEY_GAP = 0.025;
export const KEY_STEP = WKW + KEY_GAP;

export function get88KeyRange() {
    const r = [];
    r.push({note:'A',octave:0}); r.push({note:'A#',octave:0}); r.push({note:'B',octave:0});
    for (let o = 1; o <= 7; o++) NOTES.forEach(n => r.push({note:n,octave:o}));
    r.push({note:'C',octave:8});
    return r;
}
export const FULL_RANGE = get88KeyRange();
export const PIANO_WIDTH = KEY_STEP * 52;
export const PIANO_CX = (51 * KEY_STEP) / 2;

export const keyMap = {
    '1':'C2','2':'C#2','3':'D2','4':'D#2','5':'E2','6':'F2','7':'F#2',
    '8':'G2','9':'G#2','0':'A2','-':'A#2','=':'B2',
    'q':'C3','w':'C#3','e':'D3','r':'D#3','t':'E3','y':'F3','u':'F#3',
    'i':'G3','o':'G#3','p':'A3',
    'a':'A#3','s':'B3','d':'C4','f':'C#4','g':'D4','h':'D#4','j':'E4',
    'k':'F4','l':'F#4',';':'G4',"'":'G#4',
    'z':'A4','x':'A#4','c':'B4','b':'C5','m':'C#5',',':'D5','.':'D#5','/':'E5',
    ' ':'SUSTAIN','v':'VB_PEDAL','n':'SOFT_PEDAL',
};
export const revKeyMap = Object.fromEntries(Object.entries(keyMap).map(([k,v]) => [v,k]));

export const SALAMANDER_URLS = {
    A0:'A0.mp3',C1:'C1.mp3','D#1':'Ds1.mp3','F#1':'Fs1.mp3',
    A1:'A1.mp3',C2:'C2.mp3','D#2':'Ds2.mp3','F#2':'Fs2.mp3',
    A2:'A2.mp3',C3:'C3.mp3','D#3':'Ds3.mp3','F#3':'Fs3.mp3',
    A3:'A3.mp3',C4:'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3',
    A4:'A4.mp3',C5:'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3',
    A5:'A5.mp3',C6:'C6.mp3','D#6':'Ds6.mp3','F#6':'Fs6.mp3',
    A6:'A6.mp3',C7:'C7.mp3','D#7':'Ds7.mp3','F#7':'Fs7.mp3',
    A7:'A7.mp3',C8:'C8.mp3',
};
export const SAL_BASE = 'https://tonejs.github.io/audio/salamander/';

export const CURATED_SONGS = [
    'Johann Sebastian Bach – Toccata and Fugue in D minor',
    'Johann Sebastian Bach – Goldberg Variations',
    'Johann Sebastian Bach – Well-Tempered Clavier',
    'Ludwig van Beethoven – Moonlight Sonata',
    'Ludwig van Beethoven – Für Elise',
    'Ludwig van Beethoven – Appassionata Sonata',
    'Ludwig van Beethoven – Pathétique Sonata',
    'Wolfgang Amadeus Mozart – Rondo alla Turca',
    'Wolfgang Amadeus Mozart – Piano Sonata No. 16',
    'Frédéric Chopin – Nocturne Op. 9 No. 2',
    'Frédéric Chopin – Ballade No. 1 in G minor',
    'Frédéric Chopin – Raindrop Prelude',
    'Frédéric Chopin – Heroic Polonaise',
    'Frédéric Chopin – Minute Waltz',
    'Franz Liszt – Hungarian Rhapsody No. 2',
    'Franz Liszt – Liebesträume No. 3',
    'Franz Liszt – La Campanella',
    'Claude Debussy – Clair de Lune',
    'Claude Debussy – Arabesque No. 1',
    'Erik Satie – Gymnopédie No. 1',
    'Erik Satie – Gnossienne No. 1',
    'Sergei Rachmaninoff – Prelude in C-sharp minor',
    'Maurice Ravel – Pavane for a Dead Princess',
    'Edvard Grieg – Piano Concerto in A minor',
    'Felix Mendelssohn – Rondo Capriccioso',
    'Franz Schubert – Impromptu Op. 90 No. 3',
    'Johannes Brahms – Intermezzo Op. 118 No. 2',
    'Camille Saint-Saëns – The Swan',
    'The Muffin Man',
];

export const COMPOSERS = [
    'Beethoven','Mozart','Bach','Chopin','Liszt','Debussy','Satie',
    'Rachmaninoff','Tchaikovsky','Ravel','Schubert','Brahms',
    'Grieg','Vivaldi','Handel','Haydn',
];
