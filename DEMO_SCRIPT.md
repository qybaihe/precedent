# Precedent — demo video script (target 2:45)

Voice: macOS `say -v Samantha` (rate 180). Screen: 1440×900 Chromium recording of the live dev site
`qybaihe-forge.atlassian.net` (Lumen Pay demo org), plus a recorded Claude Code session for MCP.
The narration lines below are the exact TTS input (`demo/narration/*.txt` is generated from this file).

| # | Scene (what is on screen) | Narration | ~sec |
|---|---|---|---|
| 1 | **Title card**: "Precedent — decision memory for your team and your AI agents". | Every team has had this moment. Wait — didn't we already decide not to do that? Decisions live in meeting notes and decision pages. Months later, new work, or an AI coding agent, quietly undoes them. Precedent fixes that. | 15 |
| 2 | **Confluence** → *Payments Architecture Review — 2026-03-12*. Scroll past the four `/decision` items. Click the byline item "4 decisions · N conflicts" → popup lists each decision and the Jira work items contradicting it. | There is no new process. Teams keep typing slash decision in their meeting notes. Precedent captures every decision, with its owner, date, rationale and source, and shows right on the page which Jira work contradicts it. | 17 |
| 3 | **Jira** → PAY-1 "Store payout ledger in MongoDB for flexible schemas". Right panel button **Precedent** shows red "1 conflict" → expand. Hover the evidence box and source link. | Here is a new work item: move the payout ledger to MongoDB. Precedent checked it the moment it was written. It contradicts D E C one, keep all transactional payment data in PostgreSQL, and it shows the exact sentence that tripped the guardrail, who decided, and where. | 19 |
| 4 | **Live create**: Create work item in PAY "Integrate Adyen for EU card payments" → open it → panel flags DEC-3 (Stripe instead of Adyen). Then open PAY-4 "Remove MongoDB from the refunds service" → green "Aligned". | It works live. Integrating Adyen? Flagged against the decision to standardize on Stripe. And it understands direction. Removing MongoDB is aligned with the decision, not a conflict. | 16 |
| 5 | **Rovo**: on PAY-1 click **Ask Precedent** → Rovo chat opens with the pre-filled prompt → agent answers: why (ACID, nightly SQL audits), owner Priya Shah, options (follow / exception / supersede). | Ask Precedent hands the context to the Rovo agent. It explains why the decision was made, who to talk to, and the options: comply, log an exception with a reason, or supersede the decision. | 20 |
| 6 | **Decision Radar** (PAY project page): stats, conflicts table, donut. Then Jira issue search with JQL `precedentConflicts > 0`. | Leads get a Decision Radar for every project. And every result is indexed, so precedent conflicts greater than zero works in J Q L, filters and dashboards. | 14 |
| 7 | **Claude Code + MCP** (terminal recording): user asks "Store the payout ledger in MongoDB — check our team decisions first". Claude calls `precedent · check-work-item` over MCP → conflict DEC-1 → proposes PostgreSQL with JSONB columns instead and offers to record or escalate. | Because Precedent exposes the same actions through Atlassian's MCP server, AI coding agents check team decisions before they write code. Claude Code calls check work item, finds D E C one, and proposes a compliant design instead. | 22 |
| 8 | **Decision Log** (Confluence global page): stats row, table of 12 decisions with guardrails, open the DEC-1 detail modal (work items touching it, history). | All decisions live in one register, in Confluence and Jira, with editable guardrails, history, exceptions and supersession. | 12 |
| 9 | **Closing card**: "Precedent · Jira · Confluence · Rovo agent · MCP · Runs on Atlassian" + repo URL. | Precedent. One Forge app across Jira, Confluence, Rovo and MCP, so your team, and your agents, know what has already been decided. | 11 |

Total ≈ 2:26 of narration + transitions ≈ 2:45.

## Recording notes
- Theme: light. Zoom 100%. Hide the Rovo onboarding spotlight if it appears.
- Data reset before recording: `node scripts/seed-demo.mjs --reset` (DEC numbers then match the script).
- Scene 4 creates a real work item; delete it after recording (`PAY-7`).
- Scene 7 is a real Claude Code session against the Precedent MCP endpoint, recorded with asciinema and rendered with agg.
