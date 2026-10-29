#!/usr/bin/env python3
"""Generate per-scene narration audio from the Narration table in DEMO_SCRIPT.md.

  python3 demo/make-narration.py                      # macOS `say` (Samantha), offline fallback
  source ~/hackathons/.secrets/mimo.env && python3 demo/make-narration.py --engine mimo [--voice Chloe] [--only 3,6]

MiMo: Xiaomi MiMo-V2.5-TTS (OpenAI-compatible chat completions, built-in English voices Mia, Chloe,
Milo, Dean), style set by a natural-language instruction. The API key comes from $MIMO_API_KEY and is
never printed or written anywhere.
"""
import argparse, base64, json, os, re, subprocess, pathlib, time, urllib.request

root = pathlib.Path(__file__).resolve().parent
NARR = root / 'narration'

STYLE = (
    'Narrator for a polished software product demo video. Warm, confident, clear American English, '
    'friendly and professional, like a senior engineer showing a colleague something useful. '
    'Brisk, energetic pace like a well-rehearsed conference demo (about 170 words per minute), '
    'short natural pauses only at full stops; no exaggerated emotion, no whispering, consistent volume.'
)


def spoken(text, engine):
    """The table is written for `say`, which needs spelled-out acronyms; a neural voice reads them naturally."""
    if engine == 'mimo':
        text = text.replace('D E C one', 'D-E-C one').replace('J Q L', 'JQL')
    return text


def say(text, wav):
    aiff = wav.with_suffix('.aiff')
    subprocess.run(['say', '-v', 'Samantha', '-r', '178', '-o', str(aiff), text], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(aiff), '-ar', '48000', '-ac', '2', str(wav)], check=True)
    aiff.unlink()


def mimo(text, wav, voice):
    body = {
        'model': 'mimo-v2.5-tts',
        'messages': [{'role': 'user', 'content': STYLE}, {'role': 'assistant', 'content': text}],
        'audio': {'format': 'wav', 'voice': voice},
    }
    req = urllib.request.Request(
        'https://api.xiaomimimo.com/v1/chat/completions',
        data=json.dumps(body).encode(),
        headers={'api-key': os.environ['MIMO_API_KEY'], 'Content-Type': 'application/json'},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = json.load(res)
            break
        except Exception as e:  # noqa: BLE001 - retry transient API errors, then fail loudly
            if attempt == 2:
                raise RuntimeError(f'MiMo TTS failed: {getattr(e, "code", "")} {e}') from None
            time.sleep(3)
    raw = wav.with_suffix('.raw.wav')
    raw.write_bytes(base64.b64decode(data['choices'][0]['message']['audio']['data']))
    # trim leading/trailing silence, then match the `say` pipeline: 48 kHz stereo
    af = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-af', af, '-ar', '48000', '-ac', '2', str(wav)], check=True)
    raw.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', choices=['say', 'mimo'], default='say')
    ap.add_argument('--voice', default='Chloe')
    ap.add_argument('--only', help='comma-separated scene numbers')
    ap.add_argument('--out', help='write to this directory instead of demo/narration (for trials)')
    a = ap.parse_args()
    out_dir = pathlib.Path(a.out) if a.out else NARR
    out_dir.mkdir(parents=True, exist_ok=True)
    only = {int(x) for x in a.only.split(',')} if a.only else None

    script = (root.parent / 'DEMO_SCRIPT.md').read_text()
    rows = [l for l in script.splitlines() if re.match(r'^\| \d+ \|', l)]
    index_file = out_dir / 'durations.json'
    index = {d['scene']: d for d in json.loads(index_file.read_text())} if index_file.exists() else {}
    for row in rows:
        cells = [c.strip() for c in row.strip('|').split('|')]
        n, text = int(cells[0]), cells[1]
        if only and n not in only:
            continue
        wav = out_dir / f'{n:02d}.wav'
        if a.engine == 'mimo':
            mimo(spoken(text, 'mimo'), wav, a.voice)
        else:
            say(text, wav)
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(wav)]).decode().strip())
        (out_dir / f'{n:02d}.txt').write_text(text + '\n')
        index[n] = {'scene': n, 'seconds': round(dur, 2), 'text': text, 'engine': a.engine, **({'voice': a.voice} if a.engine == 'mimo' else {})}
        print(f'{n:2d} {dur:6.2f}s  {a.engine}{":" + a.voice if a.engine == "mimo" else ""}', flush=True)
    out = [index[k] for k in sorted(index)]
    index_file.write_text(json.dumps(out, indent=1))
    print('total', round(sum(o['seconds'] for o in out), 1))


if __name__ == '__main__':
    main()
