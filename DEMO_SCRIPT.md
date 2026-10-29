# Precedent — demo video script (target 2:45, hard limit < 3:00)

Recorded on the live site `https://one-atlas-hreq.atlassian.net` (production install of Precedent, demo org "Lumen Pay")
by `node demo/record.mjs` (Playwright, logged-in `.browser-profile`, headless): native **1920×1080** frames with the
browser zoomed to **120 %** (the UI lays out like a 1600×900 screen, so text stays large and sharp), light theme, an
injected visible cursor with click ripples. Voice-over: **Xiaomi MiMo-V2.5-TTS, English voice "Mia"**, generated per scene
from the **Narration** table below with a short style instruction (`python3 demo/make-narration.py --engine mimo --voice Mia`,
API key from `$MIMO_API_KEY`), then checked by `demo/qc-narration.py`: every take is transcribed locally with whisper.cpp and
regenerated when it has extra words or a word error rate above 8 % (neural TTS occasionally adds an "Um" or an invented
sentence). Offline fallback: `python3 demo/make-narration.py` (macOS `say -v Samantha -r 178`). Output: `demo/narration/NN.wav`,
durations in `durations.json`.
Each scene is recorded as its own clip and lasts at least as long as its narration (+1.4 s);
`python3 demo/compose.py` trims each clip to the moment its page was ready, lays the narration over it, crossfades
(0.35 s), normalises loudness to −16 LUFS and writes `demo/precedent-demo.mp4` (H.264/AAC, 1080p30).

Commands: `node demo/record.mjs` (all scenes) or `node demo/record.mjs 3 5` (re-take some); `SHOTS=1` saves debug
screenshots to `demo/tmp/`, `HEADED=1` shows the browser. Scenes 1, 8 and 10 are local pages and use a throwaway profile.

**Storyline (one thread):** Confluence decides → Jira warns while the work item is being created → the issue panel flags the conflict → the workflow blocks Done → Rovo explains → the coding agent gets the brief from Jira and changes its plan. Subtitles are burned in (`python3 demo/subtitles.py`), SRT next to the MP4.

## Narration (exact TTS input)

| # | Narration | Audio (s) |
|---|---|---|
| 1 | Every team has had this moment: wait, didn't we already decide not to do that? Precedent is a decision memory that acts. It catches the contradiction in Confluence, in Jira, in your workflow, and in your AI coding agent. | 13 |
| 2 | It starts where teams already write. In this architecture review, the payments team decided, with a slash decision, to keep all transactional payment data in PostgreSQL. Precedent captures it with its owner, date and rationale, and the page shows which Jira work contradicts it. | 16 |
| 3 | Months later, someone files new work: move payout reconciliation to MongoDB. Before they even press create, Jira's own create dialog warns them: already decided in D E C one, with who decided, when, and what to use instead. | 14 |
| 4 | If it is filed anyway, the Precedent panel flags the conflict, quotes the sentence that tripped the guardrail, and offers a one click compliant alternative. Precedent also keeps a short brief for coding agents in the work item: what to do, which packages are denied, and which code the decision governs. | 18 |
| 5 | And it is enforced in the workflow. Moving the work item to Done is blocked while the conflict is unresolved, unless the team reviews it or logs an exception. | 10 |
| 6 | Ask Precedent hands the work item to the Rovo agent. It explains why the decision was made, who owns it, and the options: comply, log an exception, or supersede the decision, citing the source every time. | 13 |
| 7 | Now a developer opens the work item in Claude Code, straight from Jira. Jira hands over the summary and the description, and with it, the Precedent brief. | 10 |
| 8 | This is a real Claude Code session with exactly that prompt. Before writing a line of code, the agent stops: the task would break D E C one. It reads the ledger code, explains why the decision exists, and proposes a PostgreSQL JSON B design instead, or an exception for the owner to approve. | 18 |
| 9 | Decisions stay alive. Tripwires watch the assumptions behind them: when shared Redis incidents pile up, the Radar turns red and the owner is asked to review. Meeting notes feed a decision inbox, and Rovo Search finds every decision through the Teamwork Graph. | 16 |
| 10 | Precedent. One Forge app that runs entirely on Atlassian, so your team, and your agents, know what has already been decided. | 8 |

## Pre-flight (not recorded)

1. Demo data on one-atlas-hreq (Lumen Pay: space ENG, projects PAY / CHK / PLF). DEC-1 has a guard (paths
   `services/payments/**`, `db/ledger/**`; denied `mongodb`, `mongoose`, `@aws-sdk/client-dynamodb`; use `pg`, `prisma`;
   scope `project = PAY`) and is marked *Still valid*. DEC-16 (an old test) is archived.
2. Setup → Coding agents → brief **In the description**; Setup → Enforce in Jira → **Turn on for all projects** (create-time warning).
3. The Done transition of PAY / CHK / PLF has the validator *No unresolved decision conflicts (Precedent)* (added with
   `POST /rest/api/3/workflows/update`, see STATUS.md).
4. DEC-8 has the assumption "The shared Redis cluster has headroom for every team" with the tripwire
   `labels = redis-incident AND created >= -30d` > 3 (tripped by PLF-5…PLF-8), so the PLF Radar shows *needs review*.
5. Scene 8 transcript: capture PAY-1's deeplink prompt (Development → Open in coding tool → Claude Code) into
   `demo/tmp/pay1-prompt.txt`, then `demo/coding-session.sh` runs a real headless Claude Code session with exactly that
   prompt in a copy of `demo/lumen-payments` and writes `demo/cards/transcript.js`.

Base URLs (production environment `1c85a2f4-e35c-49f7-bc7a-39674f4f24b0`, app `92a37583-d5ab-4554-97dd-8e6d41617e28`):
- Decision Log (Jira): `https://one-atlas-hreq.atlassian.net/jira/apps/<app>/<env>`
- Decision Radar (PLF): `https://one-atlas-hreq.atlassian.net/jira/software/projects/PLF/apps/<app>/<env>`

## Shot list

1. **Title card** — `demo/cards/title.html`.
2. **Confluence decides** — ENG → *Payments Architecture Review — 2026-03-12*; scroll to the decisions; open the
   Precedent byline ("N decisions tracked", the work items that contradict them).
3. **Warned while creating** — PAY board → **Create** → type *Move payout reconciliation to MongoDB* → Tab: the label
   becomes *Summary · ⚠ Already decided in DEC-1*; open the ⓘ to show the full hint. Close and discard (nothing is created).
4. **Panel + brief** — PAY-1: Precedent panel (conflict, evidence, compliant alternative, brief card), then the
   *🧭 Precedent brief* block at the end of the description.
5. **Workflow blocks Done** — PAY-1 status → **Done**: Jira shows *Blocked by Precedent: PAY-1 contradicts DEC-1…*.
6. **Rovo explains** — panel → **Ask Precedent** → Rovo answer citing DEC-1.
7. **Open in coding tool** — PAY-1 → Development → *Open in coding tool* → Claude Code.
8. **Coding agent changes plan** — `demo/cards/terminal.html` replays the real session (`demo/raw/scene07.jsonl`).
9. **Living decisions** — PLF Decision Radar (red *needs review* for DEC-8's tripwire) → Decision Log **Inbox**.
10. **Closing card** — `demo/cards/closing.html`.

## After recording
- Compose: `python3 demo/compose.py` → `demo/precedent-demo.mp4` (check length 2:30–2:55), then subtitles:
  `WHISPER_MODEL=… python3 demo/subtitles.py` → `demo/precedent-demo-subtitled.mp4` + `demo/precedent-demo.srt`.
