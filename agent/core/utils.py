import re

def sanitize_filename(name: str, max_len: int = 200) -> str:
    """Clean name for across-drive filesystem safety.
    Strips illegal characters and caps the result at max_len chars."""
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    name = name.replace(" ", "_").replace(",", "")
    return name[:max_len]

def midi_to_name(midi_number: int) -> str:
    """Normalize MIDI note to canonical name. Raises ValueError for out-of-range input."""
    if not (0 <= midi_number <= 127):
        raise ValueError(f"MIDI note must be 0–127, got {midi_number}")
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = midi_number // 12 - 1
    return f"{names[midi_number % 12]}{octave}"
