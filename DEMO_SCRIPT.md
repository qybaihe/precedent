# Precedent — demo video script (target 2:40, hard limit < 3:00)

Recorded on the live site `https://qybaihe-forge.atlassian.net` (production install of Precedent, demo org "Lumen Pay")
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
screenshots to `demo/tmp/`, `HEADED=1` shows the browser. Scenes 1, 7 and 9 are local pages and use a throwaway profile.

## Narration (exact TTS input)

| # | Narration | Audio (s) |
|---|---|---|
| 1 | Every team has had this moment: wait, didn't we already decide not to do that? Decisions live in meeting notes and decision pages. Months later, new work, or an AI coding agent, quietly undoes them. Precedent gives your team, and your agents, a memory of what has already been decided. | 18 |
| 2 | There is no new process. Teams keep typing slash decision in their meeting notes and decision pages, or start a Jira comment with Decision. Precedent captures every decision, with its owner, date, rationale and source, and shows right on the page which Jira work contradicts it. | 18 |
| 3 | Here is a new work item: move the payout ledger to MongoDB. Precedent checked it the moment it was written. It contradicts D E C one: keep all transactional payment data in PostgreSQL. It shows the exact sentence that tripped the guardrail, who decided, when, and where. | 18 |
| 4 | It works live. Here is a brand new work item: integrate Adyen for EU card payments. The moment it is created, Precedent flags it against the decision to standardize on Stripe, owned by Dana Kim. And it understands direction: removing MongoDB from the refunds service is aligned with the decision, not a conflict. | 17 |
| 5 | Ask Precedent hands the context to the Rovo agent. It explains why the decision was made, who to talk to, and the options: comply, log an exception with a reason, or supersede the decision. Every answer cites the decision and its source. | 16 |
| 6 | Leads get a Decision Radar for every project: the open conflicts, the evidence, and who is affected. And every result is indexed, so precedent conflicts greater than zero works in J Q L, filters and dashboards. | 13 |
| 7 | Precedent also exposes the same actions as MCP tools. Any team can add them to its own agents in Rovo Studio. Here, a custom Architecture Guard agent checks a planned change, finds the decision it would break, and proposes a compliant design instead. An open source skill file brings the same check to coding agents. | 20 |
| 8 | Everything lives in one decision log, in Confluence and Jira, with editable guardrails, history, exceptions and supersession, plus one click sample content, so a new team sees value in a minute. | 12 |
| 9 | Precedent. One Forge app across Jira, Confluence, Rovo and MCP, so your team, and your agents, know what has already been decided. | 9 |

## Pre-flight (not recorded)

1. Reset demo data so DEC numbers match this script:
   `cd ~/hackathons/codegeist2026 && source ~/hackathons/.secrets/atlassian.env && node scripts/seed-demo.mjs --reset`
   then wait ~60 s. Check: Jira search `precedentConflicts > 0` returns exactly **8** work items
   (PAY-1, PAY-2, PAY-3, CHK-1, CHK-2, CHK-3, PLAT-1, PLAT-2).
2. Rovo agent: top bar **Rovo / Chat** → agent selector → **Browse agents** → **Precedent** → **Enable** (once per user).
   Send one throw-away question so the onboarding tips are dismissed.
3. MCP for scene 7 (once): admin.atlassian.com → **Apps → Sites → qybaihe-forge → Connected apps → Precedent → Tools** → turn all
   seven tools on. Then in a terminal:
   `claude mcp add --transport http precedent https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28`,
   start `claude`, run `/mcp` → *precedent* → Authenticate → choose `qybaihe-forge.atlassian.net` → Approve.
4. Close every banner/toast in Jira and Confluence ("try the new navigation", cookie banners). Collapse the left sidebar in
   Confluence for scene 2 if it covers the page byline.

Base URLs (production environment id `1c85a2f4-e35c-49f7-bc7a-39674f4f24b0`, app id `92a37583-d5ab-4554-97dd-8e6d41617e28`):
- Decision Log (Confluence): `https://qybaihe-forge.atlassian.net/wiki/apps/92a37583-d5ab-4554-97dd-8e6d41617e28/1c85a2f4-e35c-49f7-bc7a-39674f4f24b0/decision-log`
- Decision Log (Jira): `https://qybaihe-forge.atlassian.net/jira/apps/92a37583-d5ab-4554-97dd-8e6d41617e28/1c85a2f4-e35c-49f7-bc7a-39674f4f24b0`
- Confluence pages: space **ENG** (Engineering). Page ids change on every reseed — open by title from the space sidebar.

## Shot list

### Scene 1 — Title card (≥ 19 s)
- Open `demo/cards/title.html` (local file, animates in over 3 s). Hold.
- Expect: Precedent logo + "Decision memory for your team — and your AI agents." + chips.

### Scene 2 — Decisions captured in Confluence (≥ 19 s)
1. Open space ENG → page **Payments Architecture Review — 2026-03-12**.
2. Wait for the page to render (title + attendees visible). Hold 2 s.
3. Scroll slowly (≈ 400 px every 1.5 s) through *Payout ledger storage*, *Partner bank access*, *Card processing*, *Logging*:
   each has a purple ✓ **decision** item.
4. Scroll back to top. In the byline under the title click **4 decisions · 4 conflicts** (Precedent icon).
5. Expect a dialog listing DEC-1…DEC-4, each with a red *conflict* lozenge and the work item that contradicts it
   (DEC-1 → PAY-1, DEC-2 → PAY-2, DEC-3 → PAY-3, DEC-4 → CHK-1). Hold 3 s, close.

### Scene 3 — A conflicting work item (≥ 19 s)
1. Open `https://qybaihe-forge.atlassian.net/browse/PAY-1` (*Store payout ledger in MongoDB for flexible schemas*).
2. In the right-hand details area find the app button **Decisions** with the red lozenge **1 conflict** (title *Precedent*) and click it.
3. Expect: red section message **Contradicts 1 team decision**; card **DEC-1 · Keep all transactional payment data in PostgreSQL**,
   quoted statement, pink evidence box *"Trips guardrail: avoid MongoDB" — "Move the ledger to MongoDB so we can iterate…"*,
   meta line *Priya Shah · Mar 12, 2026 · Payments Architecture Review — 2026-03-12* (link).
4. Hover the evidence box (1 s), then the source link (1 s). Do **not** click the buttons yet.

### Scene 4 — Live check + direction awareness (≥ 13 s)
1. Press `c` (or **+ Create**). Project **Payments (PAY)**, type **Task**, Summary: `Integrate Adyen for EU card payments`. Create.
2. Open the new work item (PAY-7) from the success flag. Expand **Precedent**.
3. Expect: **Contradicts 1 team decision** → **DEC-3 · Standardize on Stripe for card payments instead of Adyen** (Dana Kim).
4. Open `/browse/PAY-4` (*Remove MongoDB from the refunds service*) → expand **Precedent**.
5. Expect: blue/green message **Consistent with team decisions** and an **Aligned** card: *DEC-1 — Removes or replaces "MongoDB"*.
   (After recording, delete PAY-7.)

### Scene 5 — Rovo agent (≥ 17 s, allow up to 30 s for the answer)
1. Back on PAY-1, expanded Precedent panel → click **Ask Precedent** (Rovo icon) on the DEC-1 card.
2. Expect: Rovo chat opens on the right with agent **Precedent** and the prompt
   *"Explain how PAY-1 conflicts with DEC-1 (…): why was it decided, who should I talk to, and what are my options?"*.
3. Wait for the answer. Expect it to cite **DEC-1**, **Priya Shah**, **Mar 12, 2026**, link the architecture review page,
   give the rationale (ACID transactions, nightly SQL audits, extra on-call runbook) and offer: comply (e.g. PostgreSQL JSONB),
   log an exception, or supersede. Scroll the answer slowly once.

### Scene 6 — Decision Radar + JQL (≥ 11 s)
1. Open project **Payments** → sidebar **Decision Radar** (Apps section).
2. Expect: stat tiles (Open conflicts **3**, Work items checked **6**…), table PAY-1/PAY-2/PAY-3 with DEC ids and evidence, donut chart.
3. Click **Open in JQL** (or open `https://qybaihe-forge.atlassian.net/issues/?jql=precedentConflicts%20%3E%200%20ORDER%20BY%20key`).
4. Expect the list view with the 8 conflicting work items. Hold 2 s.

### Scene 7 — Precedent's MCP tools in a customer-built Rovo Studio agent (≥ 21 s)
1. Rovo Studio → **Tools** → *Connected apps* → **Precedent**: the seven Precedent tools (Check work against decisions,
   Get decision details, List open decision conflicts, Log a decision exception, Record a decision, Search team decisions,
   Supersede a decision). Hover *Check work against decisions*.
2. Open the agent **Architecture Guard** (built in Studio from blank: short instructions + three Precedent tools) → **Test**.
3. Type: *I am about to move the payout ledger to a MongoDB collection so the schema can evolve without migrations. Check our
   team decisions first.* → Enter (thinking time is cut).
4. Expect: *Stop: This plan conflicts with an active team decision* — source page, owner Priya Shah, the tripped guardrail
   *"Do not introduce MongoDB or other document stores for payments."*, rationale, and a PostgreSQL JSONB alternative.
   Scroll the answer once.

Alternative take (`SCENE7=terminal node demo/record.mjs 7`): replay of a real `claude -p` session against the external MCP
endpoint (`demo/mcp-session.sh` → `demo/cards/transcript.js`), for when the site's external MCP exposure is live.

### Scene 8 — Decision Log (≥ 13 s)
1. Open the Confluence **Decision Log** URL above.
2. Expect: header *Decision Log*, tiles (Active decisions **12**, Open conflicts **8**, Work items aligned **3**, Captured from Confluence **11**),
   table of DEC-12…DEC-1 with guardrail lozenges (green *prefer …*, red *avoid …*) and Impact lozenges.
3. Click **DEC-1** → detail dialog: quote, Why, Guardrails, *Work items touching this decision* (PAY-1 conflict, PAY-4 aligned, PAY-5 related), History. Hold 3 s, close.
4. Click tab **Setup & integrations** for 2 s (shows "Try it with sample content" and the MCP command).

### Scene 9 — Closing card (≥ 10 s)
- Open `demo/cards/closing.html`. Hold.

## After recording
- Delete PAY-7 (`DELETE /rest/api/3/issue/PAY-7`) and re-run `node scripts/seed-demo.mjs --reset` if anything else changed.
- Compose: `python3 demo/compose.py` → `demo/precedent-demo.mp4` (check length 2:30–2:55).
