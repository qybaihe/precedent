#!/usr/bin/env python3
"""Quality-check MiMo narration with a local speech recogniser and regenerate bad takes.

Neural TTS occasionally adds words ("Um," or an invented closing sentence) or slurs a product name.
Each scene is transcribed with whisper.cpp; a take passes when its word error rate against the
script is low and it has no extra words. Failing scenes are regenerated (best take kept).

  source ~/hackathons/.secrets/mimo.env
  WHISPER_MODEL=/path/ggml-base.en.bin python3 demo/qc-narration.py [--voice Mia] [--tries 5] [--only 8,9]
"""
import argparse, json, os, pathlib, re, shutil, subprocess, sys, tempfile

root = pathlib.Path(__file__).resolve().parent
NARR = root / 'narration'
sys.path.insert(0, str(root))
mk = __import__('make-narration')

# product words the recogniser hears as everyday words; a near-miss here is not the voice's fault
ALIASES = {'president': 'precedent', 'precedence': 'precedent', 'dec1': 'dec one', 'jql': 'j q l'}


def words(t):
    t = t.lower().replace('d-e-c', 'dec').replace('d e c', 'dec')
    out = []
    for w in re.sub(r"[^a-z0-9' ]+", ' ', t).split():
        out.extend(ALIASES.get(w, w).split())
    return out


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
    return d[-1] / max(1, len(r)), len(h) - len(r)


def transcribe(wav, model):
    with tempfile.TemporaryDirectory() as tmp:
        mono = pathlib.Path(tmp) / 'a.wav'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-ar', '16000', '-ac', '1', str(mono)], check=True)
        return subprocess.run(['whisper-cli', '-m', model, '-f', str(mono), '-nt', '-np'], capture_output=True, text=True).stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='Mia')
    ap.add_argument('--tries', type=int, default=5)
    ap.add_argument('--max-wer', type=float, default=0.08)
    ap.add_argument('--only')
    a = ap.parse_args()
    model = os.environ['WHISPER_MODEL']
    index_file = NARR / 'durations.json'
    index = {d['scene']: d for d in json.loads(index_file.read_text())}
    only = {int(x) for x in a.only.split(',')} if a.only else set(index)
    for n in sorted(only):
        text = (NARR / f'{n:02d}.txt').read_text().strip()
        wav = NARR / f'{n:02d}.wav'
        score = lambda f: wer(text, transcribe(f, model))  # noqa: E731
        best_w, best_extra = score(wav)
        tries = 0
        while (best_w > a.max_wer or best_extra > 1) and tries < a.tries:
            tries += 1
            cand = NARR / f'{n:02d}.try.wav'
            mk.mimo(mk.spoken(text, 'mimo'), cand, a.voice)
            w, extra = score(cand)
            print(f'  scene {n} try {tries}: WER {w:.1%}, extra words {extra:+d}', flush=True)
            if (extra <= 1, -w) > (best_extra <= 1, -best_w):
                shutil.move(cand, wav)
                best_w, best_extra = w, extra
            else:
                cand.unlink()
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(wav)]).decode().strip())
        index[n] = {**index[n], 'seconds': round(dur, 2), 'qc_wer': round(best_w, 3)}
        flag = 'ok' if best_w <= a.max_wer and best_extra <= 1 else 'CHECK'
        print(f'scene {n}: WER {best_w:.1%}, extra {best_extra:+d}, {dur:.2f}s  {flag}', flush=True)
    index_file.write_text(json.dumps([index[k] for k in sorted(index)], indent=1))
    print('total', round(sum(d['seconds'] for d in index.values()), 1))


if __name__ == '__main__':
    main()
