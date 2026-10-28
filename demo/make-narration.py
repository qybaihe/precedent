#!/usr/bin/env python3
"""Generate per-scene narration audio from DEMO_SCRIPT.md with macOS `say` (Samantha)."""
import json, re, subprocess, pathlib
root = pathlib.Path(__file__).resolve().parent
script = (root.parent / 'DEMO_SCRIPT.md').read_text()
rows = [l for l in script.splitlines() if re.match(r'^\| \d+ \|', l)]
out = []
for row in rows:
    cells = [c.strip() for c in row.strip('|').split('|')]
    n, text = int(cells[0]), cells[2]
    aiff = root / 'narration' / f'{n:02d}.aiff'
    wav = root / 'narration' / f'{n:02d}.wav'
    subprocess.run(['say', '-v', 'Samantha', '-r', '178', '-o', str(aiff), text], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(aiff), '-ar', '48000', '-ac', '2', str(wav)], check=True)
    aiff.unlink()
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(wav)]).decode().strip())
    (root / 'narration' / f'{n:02d}.txt').write_text(text + '\n')
    out.append({'scene': n, 'seconds': round(dur, 2), 'text': text})
(root / 'narration' / 'durations.json').write_text(json.dumps(out, indent=1))
print('\n'.join(f"{o['scene']:2d} {o['seconds']:6.2f}s" for o in out), '\ntotal', round(sum(o['seconds'] for o in out), 1))
