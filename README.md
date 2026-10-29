# Precedent — decision memory for teams and their AI agents

**Precedent** is an Atlassian Forge app: a decision memory that *acts*. It remembers what your team has already decided and stops new work, and AI coding agents, from quietly contradicting it: in Jira's Create dialog, on the work item, in the workflow, in Rovo, and in the coding agent's first prompt.

Decisions get made in architecture reviews, meeting notes, decision pages and Jira comments. Months later nobody remembers them, and a new work item (or an AI coding agent) undoes them without anyone noticing. Precedent turns those scattered decisions into a register, extracts explicit guardrails ("avoid MongoDB for payments", "never log customer PII"), and checks every new work item against them automatically.

Built for **Codegeist 2026** (Apps for Software Teams · Teamwork Graph · Atlassian MCP · Rovo Agents). Runs entirely on Atlassian.

## What it does

| Where | What you get |
|---|---|
| **Confluence** | Every `/decision` item in any page and every page built from the Decision template is captured automatically as `DEC-n`, with owner, date, rationale (the surrounding section) and a link back. A page byline shows "3 decisions · 1 conflict". |
| **Jira work item** | A *Precedent* panel in the issue context sidebar: verdict, the contradicted decision, the exact evidence sentence, the owner and source — plus *Ask Precedent*, *Mark reviewed*, *Log exception* and *Record a decision*. Comments that start with `Decision:` are captured too. |
| **Jira project** | *Decision Radar*: every work item in the project that contradicts a decision, which decisions are hit most, and a breakdown of checked work. |
| **JQL** | Results are written to an indexed issue property: `precedentConflicts > 0`, `precedentStatus = "conflict"`, `precedentDecisions ~ "DEC-3"`. |
| **Decision Log** | A global page in both Confluence and Jira: search, filter, edit guardrails, change status, see every work item touching a decision, history and exceptions. Includes guided sample content for a first run. |
| **Create dialog** | A `jira:uiModifications` module flags the Summary while a work item is being created: *"⚠ Already decided in DEC-1"*, with who decided, when, and what to use instead. |
| **Workflow** | A `jira:workflowValidator` blocks Done while a work item contradicts an active decision (reviewed conflicts and logged exceptions pass). *Setup → Enforce in Jira* adds it to every workflow in one click. |
| **Coding agents** | A **🧭 Precedent brief** (do, don't, denied packages, governed code paths, approved exceptions) is kept at the end of every governed work item's description, so Jira's *Open in coding tool* hands it to Claude Code, Cursor, Copilot, Codex or VS Code. Or keep it as a comment. |
| **Guards** | Optional, machine-checkable rules per decision: code path globs, denied / preferred packages, extra phrases, a JQL scope. Every check (panel, create warning, Done gate, agent tools) evaluates them deterministically. |
| **Living decisions** | Assumptions and revisit dates; **tripwires** (JQL count thresholds, dates, a work item being done) measured hourly. A tripped premise flags the decision for review, turns the Radar red, and notifies the owner where the decision was made. Health score, lineage timeline, supersede and exception history. |
| **Decision Inbox** | Decisions written in plain prose in meeting notes ("we agreed to…") are found when the page is published: accept, merge into an existing decision, or dismiss. |
| **Rovo agent** | *Precedent* answers "why did we choose…", "who decided…", reviews work items (PASS / BLOCKED with evidence), records decisions, supersedes them and logs exceptions, always citing `DEC-n`, owner, date and source. |
| **MCP** | Nine actions are exposed through `rovo:mcp`, including `precedent-preflight` (call first: the brief) and `guard-check` (call before finishing: pass / warn / fail per decision). An open-source [`SKILL.md`](skills/precedent/SKILL.md) teaches coding agents when to call them. |
| **Teamwork Graph** | A `graph:connector` publishes every decision as a document, so Rovo Search and every Rovo agent can find it. |

## How it works

```mermaid
flowchart LR
  subgraph Sources
    C[Confluence pages<br/>/decision items, Decision template]
    J[Jira comments<br/>"Decision: …"]
    R[Rovo / MCP<br/>record-decision]
  end
  C -- page created/updated trigger --> H[Harvester]
  J -- comment trigger --> H
  R --> S
  H --> G[Guardrail extraction<br/>avoid / prefer terms]
  G --> S[(Decision register<br/>Forge KVS)]
  W[Jira work item created/updated] --> K[Conflict check<br/>guardrails + BM25 relevance]
  S --> K
  K --> P[Issue panel + badge]
  K --> Q[Issue property → JQL]
  K --> D[Decision Radar / Log / byline]
  S <--> A[Rovo agent + rovo:mcp tools]
```

- **Guardrail extraction** is deterministic and explainable: negations ("do not introduce X", "we will not support X"), bans ("phase out X", "no homegrown X"), passive prohibitions ("PII must never be logged" → requires both *PII* and *log*), and lost alternatives ("Stripe instead of Adyen", "React Native over Flutter"). Named technologies are decisive on their own; generic phrases need most of their words within a short window.
- **Direction-aware matching** separates *introducing* the avoided thing ("migrate the ledger **to** MongoDB" → conflict) from *removing* it ("migrate refunds **off** MongoDB" → aligned).
- **Relevance** uses BM25 over decision titles, statements, rationale and tags to surface related decisions even when no guardrail is tripped.
- **Rovo** adds semantic reasoning on demand; the app itself never needs an external LLM and is eligible for *Runs on Atlassian*.
- Background work (re-checking recent work items after a decision changes, Confluence backfill scans) runs on a Forge async-events queue; a daily scheduled trigger re-checks recent work.

## Forge modules used

`jira:issueContext` (with dynamic status badge) · `jira:projectPage` · `jira:globalPage` · `jira:entityProperty` · `jira:uiModifications` · `jira:workflowValidator` · `graph:connector` · `confluence:globalPage` · `confluence:contentBylineItem` (dynamic title) · `trigger` (Jira issue created/updated, comment created; Confluence page created/updated) · `scheduledTrigger` (daily sweep, hourly tripwires) · `consumer` (async events queue) · `rovo:agent` · `action` ×9 · `rovo:mcp` · Custom UI (React + Vite, one bundle for every surface) · multi-app compatibility (Jira required, Confluence optional, one installation with shared storage) · Forge KVS storage.

## Install (from the installation link)

1. Install with the **Jira** installation link (Jira is required), then open the **Confluence** link, pick the same site and tick **Confluence** so both products share one installation.
2. **Apps → Precedent — Decision Log → Setup & integrations**: pick a space and a project → **Create sample content** (or **Scan Confluence now** to backfill from recent pages).
3. Same tab, **Enforce in Jira**: **Turn on for all projects** (create-time warning) and **Turn on for all workflows** (Done gate).
4. Open any Jira work item and expand **Precedent** in the right-hand panel; try **Create** with a summary that contradicts a decision; try moving a conflicting work item to Done.
5. Optional: Rovo chat → Browse agents → **Precedent**; Teamwork Graph: an org admin connects *Precedent decisions* in Atlassian Administration → Connected apps → Precedent → Connections.
6. Optional, MCP (Preview): an org admin enables the tools (Connected apps → Precedent → Tools → *Expose tools to MCP-compatible apps*), then `claude mcp add --transport http precedent https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28`. On our test sites the external endpoint authenticated but still refused `tools/list`; in Rovo Studio the same tools work today (*Tools → Connected apps → Precedent*).

## Development

```bash
cd app
npm install && npm --prefix ui install
npm test                       # 68 unit tests: extraction, matching, guards, briefs, tripwires, fixes, health
npm run build:ui               # Custom UI bundle (app/ui → app/static/ui); `npm run deploy` builds and deploys
../scripts/deploy.sh dev       # development deploy (adds a token-protected selftest web trigger)
../scripts/deploy.sh prod      # production deploy (manifest.yml as-is)
forge install --site <site>.atlassian.net --product jira
forge install --site <site>.atlassian.net --product confluence
```

Code map:
- Pure logic (unit tested): `lib/guardrails.js` (extraction), `lib/check.js` (matching + BM25), `lib/guard.js` (guards), `lib/brief.js` (the Precedent brief), `lib/tripwire.js`, `lib/hint.js` (create-dialog hint), `lib/fix.js`, `lib/extract.js` (prose decisions), `lib/health.js`, `lib/adf.js`.
- Forge glue: `lib/checker.js` (checks, briefs, JQL scopes), `gate.js` (UI modifications, workflow validator), `tripwires.js`, `inbox.js`, `lib/graph.js` (Teamwork Graph), `actions.js` (Rovo actions / MCP tools), `resolvers.js`, `triggers.js`.
- UI: `app/ui/src` (React; `surfaces/` per module, `uim.js` for the Create dialog).

All of the above is under `app/src/` except the UI.

## Privacy

Precedent stores decisions and check results in Forge storage inside your Atlassian site's installation. Nothing leaves Atlassian's infrastructure. See [PRIVACY.md](PRIVACY.md).

## License

MIT
