#!/usr/bin/env python3
"""English subtitles for the demo video, timed to the narration that is actually in it.

  WHISPER_MODEL=/path/ggml-base.en.bin python3 demo/subtitles.py [--no-burn]

Inputs
  demo/narration/NN.txt, NN.wav   narration script and audio (make-narration.py / qc-narration.py)
  demo/tmp/timeline.json          where each scene's narration starts in the final video (compose.py)
  demo/precedent-demo.mp4         the composed video
Outputs
  demo/precedent-demo.srt             subtitles (one line per cue, <= MAX_CHARS)
  demo/precedent-demo-subtitled.mp4   the video with the subtitles burned in (render-subtitles.mjs)

The text comes from the script (not from speech recognition); whisper.cpp only supplies word times.
Script words are aligned to the recognised words, so a misheard word still gets the right time.
"""
import argparse, difflib, json, math, os, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent
NARR, TMP = ROOT / 'narration', ROOT / 'tmp'
sys.path.insert(0, str(ROOT))
words = __import__('qc-narration').words

MAX_CHARS = 40
# the script is written to be spoken; show these the way they are written in the product
DISPLAY = [
    ('d e c one', 'DEC-1'),
    ('j q l', 'JQL'),
    ('slash decision', '/decision'),
    ('precedent conflicts greater than zero', 'precedentConflicts > 0'),
    ('with decision', 'with "Decision:"'),
    ('one click', 'one-click'),
    ('brand new', 'brand-new'),
    ('open source', 'open-source'),
]
WEAK = {'a', 'an', 'the', 'to', 'of', 'and', 'or', 'with', 'in', 'on', 'for', 'its', 'is', 'who', 'that', 'so', 'your', 'their', 'by', 'from'}
# a line may start with these: a natural break before a clause or list item
BREAK_BEFORE = {'and', 'or', 'but', 'so', 'with', 'who', 'which', 'that', 'when', 'where', 'because', 'plus', 'instead'}


def units(text):
    """Script tokens, with DISPLAY phrases merged: [{'text': shown, 'spoken': [normalised words]}]."""
    toks = text.split()
    bare = [re.sub(r'[^a-z0-9]', '', t.lower()) for t in toks]
    out, i = [], 0
    while i < len(toks):
        for phrase, shown in DISPLAY:
            ph = phrase.split()
            if bare[i:i + len(ph)] == ph:
                tail = re.sub(r'^.*?([.,:;?!]*)$', r'\1', toks[i + len(ph) - 1])
                out.append({'text': shown + tail, 'spoken': words(' '.join(toks[i:i + len(ph)]))})
                i += len(ph)
                break
        else:
            out.append({'text': toks[i], 'spoken': words(toks[i])})
            i += 1
    return out


def word_times(wav, model):
    """[(normalised word, start s, end s)] from whisper.cpp word-level segments."""
    with tempfile.TemporaryDirectory() as tmp:
        mono, prefix = pathlib.Path(tmp) / 'a.wav', pathlib.Path(tmp) / 'a'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-ar', '16000', '-ac', '1', str(mono)], check=True)
        subprocess.run(['whisper-cli', '-m', model, '-f', str(mono), '-ml', '1', '-sow', '-dtw', 'base.en', '-oj', '-of', str(prefix), '-np'],
                       check=True, capture_output=True)
        segs = json.loads(prefix.with_suffix('.json').read_text())['transcription']
    out = []
    for s in segs:
        for w in words(s['text']):
            out.append((w, s['offsets']['from'] / 1000, s['offsets']['to'] / 1000))
    return out


def align(us, heard):
    """Give every unit a (start, end) from the recognised words."""
    script = [(k, w) for k, u in enumerate(us) for w in u['spoken']]
    times = [None] * len(script)
    sm = difflib.SequenceMatcher(None, [w for _, w in script], [w for w, _, _ in heard], autojunk=False)
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == 'equal':
            for d in range(a1 - a0):
                times[a0 + d] = heard[b0 + d][1:]
        elif op == 'replace':  # spread the heard span over the script span
            t0, t1 = heard[b0][1], heard[b1 - 1][2]
            step = (t1 - t0) / (a1 - a0)
            for d in range(a1 - a0):
                times[a0 + d] = (t0 + d * step, t0 + (d + 1) * step)
    # script words nobody heard: interpolate between neighbours
    for i, t in enumerate(times):
        if t is None:
            prev = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), 0.0)
            nxt = next((times[j][0] for j in range(i + 1, len(times)) if times[j]), prev)
            times[i] = (prev, max(prev, nxt))
    for u in us:
        u['start'], u['end'] = math.inf, 0.0
    for (k, _), (a, b) in zip(script, times):
        us[k]['start'] = min(us[k]['start'], a)
        us[k]['end'] = max(us[k]['end'], b)
    for i, u in enumerate(us):  # punctuation-only tokens have no spoken words
        if u['start'] == math.inf:
            u['start'] = u['end'] = us[i - 1]['end'] if i else 0.0
    return us


def line_len(us):
    return sum(len(u['text']) for u in us) + len(us) - 1


def split_sentence(us):
    """Break one sentence into lines <= MAX_CHARS: balanced lengths, breaking at punctuation, not after a weak word."""
    n = len(us)
    k = max(1, math.ceil(line_len(us) / MAX_CHARS))
    target = line_len(us) / k
    best = [0.0] + [math.inf] * n
    back = [0] * (n + 1)
    for i in range(1, n + 1):
        for j in range(i):
            seg = us[j:i]
            L = line_len(seg)
            if L > MAX_CHARS and i - j > 1:
                continue
            cost = 4 + ((L - target) / 10) ** 2
            if i < n:
                last = seg[-1]['text']
                cost += 0 if last[-1] in ',;:' else 2
                cost += 4 if re.sub(r'\W', '', last.lower()) in WEAK else 0
                cost -= 1.5 if re.sub(r'\W', '', us[i]['text'].lower()) in BREAK_BEFORE else 0
            if best[j] + cost < best[i]:
                best[i], back[i] = best[j] + cost, j
    lines, i = [], n
    while i:
        lines.append(us[back[i]:i])
        i = back[i]
    return lines[::-1]


def cues_for(us):
    sentences, cur = [], []
    for u in us:
        cur.append(u)
        if u['text'][-1] in '.?!':
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    lines = [line for s in sentences for line in split_sentence(s)]
    # a very short sentence ("It works live.") shares a line with the next one when it fits
    merged = []
    for line in lines:
        if merged and line_len(merged[-1]) < 20 and line_len(merged[-1] + line) <= MAX_CHARS:
            merged[-1] = merged[-1] + line
        else:
            merged.append(line)
    return [{'text': ' '.join(u['text'] for u in line), 'start': line[0]['start'], 'end': line[-1]['end']} for line in merged]


def srt_time(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-burn', action='store_true', help='only write the SRT')
    a = ap.parse_args()
    model = os.environ['WHISPER_MODEL']
    timeline = json.loads((TMP / 'timeline.json').read_text())
    cues = []
    for scene in timeline:
        n = scene['scene']
        us = align(units((NARR / f'{n:02d}.txt').read_text().strip()), word_times(NARR / f'{n:02d}.wav', model))
        for c in cues_for(us):
            cues.append({**c, 'scene': n, 'start': c['start'] + scene['narration'], 'end': c['end'] + scene['narration']})
    # display timing: appear with the first word, stay a beat after the last one, never overlap,
    # bridge short gaps so the line doesn't flicker, and stay up long enough to read
    for i, c in enumerate(cues):
        nxt = cues[i + 1]['start'] if i + 1 < len(cues) else math.inf
        end = c['end'] + 0.35
        if nxt - end < 0.5:
            end = nxt - 0.04
        end = max(end, min(c['start'] + 1.0, nxt - 0.04))
        c['end'] = min(end, nxt - 0.04)
    srt = ROOT / 'precedent-demo.srt'
    srt.write_text(''.join(f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}\n\n" for i, c in enumerate(cues, 1)))
    longest = max(cues, key=lambda c: len(c['text']))
    fastest = max(cues, key=lambda c: len(c['text']) / (c['end'] - c['start']))
    print(f'wrote {srt.name}: {len(cues)} cues, longest {len(longest["text"])} chars, '
          f'fastest {len(fastest["text"]) / (fastest["end"] - fastest["start"]):.1f} chars/s ("{fastest["text"]}")')
    if not a.no_burn:
        subprocess.run(['node', str(ROOT / 'render-subtitles.mjs'), str(srt), str(ROOT / 'precedent-demo.mp4'),
                        str(ROOT / 'precedent-demo-subtitled.mp4')], check=True)


if __name__ == '__main__':
    main()
