#!/usr/bin/env python3
"""Compose the final demo MP4 from per-scene screen recordings and narration.

Inputs
  demo/raw/scenes.json          written by demo/record.mjs: [{scene, video, readyMs, endMs}]
  demo/narration/NN.wav         written by demo/make-narration.py
Output
  demo/precedent-demo.mp4       1920x1080 (recorded natively, browser zoom 120 %), H.264 + AAC

Each scene clip starts when its page was ready, lasts max(recorded length, narration + padding),
and gets its narration starting 0.4 s in. Scenes are joined with short crossfades.
"""
import json, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent
RAW = ROOT / 'raw'
TMP = ROOT / 'tmp'
TMP.mkdir(exist_ok=True)
LEAD = 0.4   # seconds of silence before narration in each scene
TAIL = 0.6   # seconds after narration ends


def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]).decode().strip())


def run(args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


scenes = json.loads((RAW / 'scenes.json').read_text())
parts = []
for s in scenes:
    n = s['scene']
    wav = ROOT / 'narration' / f'{n:02d}.wav'
    narr = dur(wav)
    start = max(0.0, s['readyMs'] / 1000)
    recorded = (s['endMs'] - s['readyMs']) / 1000
    length = max(recorded, LEAD + narr + TAIL)
    out = TMP / f'scene{n:02d}.mp4'
    # video: trim, hold the last frame if narration runs longer, scale into 1920x1080
    vf = (
        f"trim=start={start:.3f},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={max(0, length - recorded) + 0.1:.3f},"
        "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b1220,fps=30,format=yuv420p"
    )
    af = f"adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad,atrim=0:{length:.3f}"
    run([
        '-i', str(RAW / s['video']), '-i', str(wav),
        '-filter_complex', f"[0:v]{vf},trim=0:{length:.3f}[v];[1:a]{af}[a]",
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        str(out),
    ])
    parts.append((out, length))
    print(f'scene {n}: {length:.1f}s (recorded {recorded:.1f}s, narration {narr:.1f}s)')

# join with 0.35 s crossfades
XF = 0.35
inputs, filters = [], []
for i, (p, _) in enumerate(parts):
    inputs += ['-i', str(p)]
v_prev, a_prev, offset = '0:v', '0:a', parts[0][1] - XF
for i in range(1, len(parts)):
    v_out, a_out = f'v{i}', f'a{i}'
    filters.append(f'[{v_prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={offset:.3f}[{v_out}]')
    filters.append(f'[{a_prev}][{i}:a]acrossfade=d={XF}[{a_out}]')
    v_prev, a_prev = v_out, a_out
    offset += parts[i][1] - XF
final = ROOT / 'precedent-demo.mp4'
# normalise loudness for YouTube (~-14 LUFS target; -16 leaves headroom)
filters.append(f'[{a_prev}]loudnorm=I=-16:TP=-1.5:LRA=11[aout]')
run([*inputs, '-filter_complex', ';'.join(filters), '-map', f'[{v_prev}]', '-map', '[aout]',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', str(final)])
print(f'wrote {final} ({dur(final):.1f}s)')
