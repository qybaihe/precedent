# Precedent — decision memory for teams and their AI agents

**Precedent** is an Atlassian Forge app that remembers what your team has already decided and catches new work that quietly contradicts it — in Jira, in Confluence, in Rovo, and inside AI coding agents over MCP.

Decisions get made in architecture reviews, meeting notes, decision pages and Jira comments. Months later nobody remembers them, and a new work item (or an AI coding agent) undoes them without anyone noticing. Precedent turns those scattered decisions into a register, extracts explicit guardrails ("avoid MongoDB for payments", "never log customer PII"), and checks every new work item against them automatically.

Built for **Codegeist 2026** (Apps for Software Teams · Best app with Atlassian MCP · Best Agents).

## What it does

| Where | What you get |
|---|---|
| **Confluence** | Every `/decision` item in any page and every page built from the Decision template is captured automatically as `DEC-n`, with owner, date, rationale (the surrounding section) and a link back. A page byline shows "3 decisions · 1 conflict". |
| **Jira work item** | A *Precedent* panel in the issue context sidebar: verdict, the contradicted decision, the exact evidence sentence, the owner and source — plus *Ask Precedent*, *Mark reviewed*, *Log exception* and *Record a decision*. Comments that start with `Decision:` are captured too. |
| **Jira project** | *Decision Radar*: every work item in the project that contradicts a decision, which decisions are hit most, and a breakdown of checked work. |
| **JQL** | Results are written to an indexed issue property: `precedentConflicts > 0`, `precedentStatus = "conflict"`, `precedentDecisions ~ "DEC-3"`. |
| **Decision Log** | A global page in both Confluence and Jira: search, filter, edit guardrails, change status, see every work item touching a decision, history and exceptions. Includes guided sample content for a first run. |
| **Rovo agent** | *Precedent* answers "why did we choose…", "who decided…", checks work items, records decisions, supersedes them and logs exceptions — always citing `DEC-n`, owner, date and source. |
| **MCP** | The same seven actions are exposed through the `rovo:mcp` module, so Rovo Studio agents and external clients (Claude Code, Cursor…) can call `check-work-item` *before* writing code. An open-source [`SKILL.md`](skills/precedent/SKILL.md) teaches coding agents when to call it. |

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

`jira:issueContext` (with dynamic status badge) · `jira:projectPage` · `jira:globalPage` · `jira:entityProperty` · `confluence:globalPage` · `confluence:contentBylineItem` (dynamic title) · `trigger` (Jira issue created/updated, comment created; Confluence page created/updated) · `scheduledTrigger` · `consumer` (async events queue) · `rovo:agent` · `action` ×7 · `rovo:mcp` · multi-app compatibility (Jira required, Confluence optional, one installation with shared storage) · Forge KVS storage.

## Install (from the installation link)

1. Open the installation link as a site admin, pick your site, and install into **Jira**, then **Confluence** (both are needed for the full experience; Jira alone works too).
2. In Confluence, open **Apps → Precedent — Decision Log → Setup & integrations** and either:
   - click **Scan Confluence now** to backfill decisions from recent pages, or
   - pick a space and a project and click **Create sample content** (creates two pages and seven work items so you can see conflicts within a minute).
3. Open any Jira work item and expand **Precedent** in the right-hand panel.
4. Rovo: open Rovo chat → Browse agents → **Precedent**.
5. MCP (optional): an org admin enables the tools in admin.atlassian.com → Apps → Sites → *site* → Connected apps → Precedent → TOOLS → *Expose tools to MCP-compatible apps* → Enable tools; then `claude mcp add --transport http precedent https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28`. External MCP access is in Preview: on our test sites the endpoint authenticated but still refused `tools/list` ("An admin must enable external MCP access for this app") with the toggle on. In Rovo Studio the same tools work today (*Agents → Create agent → Add tools → Connected apps → Precedent*).

## Development

```bash
cd app
npm install
npm test                       # unit tests for extraction, matching, ADF parsing, sample data
../scripts/deploy.sh dev       # development deploy (adds a token-protected selftest web trigger)
../scripts/deploy.sh prod      # production deploy (manifest.yml as-is)
forge install --site <site>.atlassian.net --product jira
forge install --site <site>.atlassian.net --product confluence
```

Code map: `app/src/lib/guardrails.js` (extraction), `app/src/lib/check.js` (matching + BM25), `app/src/lib/adf.js` (Confluence/Jira document parsing), `app/src/lib/harvest.js`, `app/src/lib/checker.js`, `app/src/actions.js` (Rovo actions / MCP tools), `app/src/resolvers.js`, `app/src/frontend/*` (UI Kit).

## Privacy

Precedent stores decisions and check results in Forge storage inside your Atlassian site's installation. Nothing leaves Atlassian's infrastructure. See [PRIVACY.md](PRIVACY.md).

## License

MIT
