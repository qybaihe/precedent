---
name: precedent
description: Check team decisions before changing architecture, dependencies, vendors or policies. Use whenever a task would add or replace a database, framework, library, cloud service, vendor, API exposure, logging of user data, or a process the team may already have decided on — and whenever the user states a new decision. Requires the Precedent MCP server (Atlassian Forge app) to be connected.
---

# Precedent — decision memory for coding agents

Your team records decisions in Confluence (architecture reviews, meeting notes, decision pages),
Jira comments and Rovo. Precedent turns them into a searchable register and exposes it as MCP tools.
Use it so you never quietly implement something the team already ruled out.

## Tools (Precedent MCP server)

| Tool | When |
|---|---|
| `check-work-item` | **Before** implementing any non-trivial change. Pass `plan` (one or two sentences describing what you are about to do) or `issueKey` if the task comes from a Jira work item. |
| `search-decisions` | The user asks "did we decide…", "why do we use…", or you are choosing between technologies. |
| `get-decision` | You need the rationale, owner, source page or history of a `DEC-n`. |
| `record-decision` | The user states a decision ("from now on…", "we decided…"). Include `avoid` / `prefer` lists. |
| `list-conflicts` | The user wants to know what work currently contradicts decisions (optionally per project). |
| `log-exception`, `supersede-decision` | Only after the user explicitly confirms. Never on your own initiative. |

## Workflow

1. Before writing code for a task that touches architecture, data storage, external services,
   security, logging, or build/deploy tooling, call `check-work-item` with a `plan` that names the
   concrete technologies involved (e.g. "store the payout ledger in a MongoDB collection").
2. If the verdict is `conflict`:
   - Stop. Do not implement the conflicting approach.
   - Tell the user which decision is contradicted: **DEC-n — title**, the owner, the date and the
     source link, and quote the guardrail that was tripped.
   - Propose a compliant alternative that satisfies the task (usually what the decision prefers).
   - Offer the two legitimate escape hatches: a one-off exception for the Jira work item
     (`log-exception`, with a reason) or replacing the decision (`supersede-decision`), both only
     with explicit user confirmation and ideally after talking to the decision owner.
3. If the verdict is `related`, read the related decisions and follow them; mention them briefly.
4. If the verdict is `clear`, proceed. If you and the user make a lasting choice along the way,
   offer to `record-decision` so the next person (or agent) knows.

## Example

> User: add a cache for merchant settings, use Redis
>
> Agent: calls `check-work-item` with plan "add a Redis cache for merchant settings" →
> `related`: DEC-8 "Caching goes through the shared Redis cluster managed by Platform" →
> implements the cache against the shared cluster's connection settings and says so.

## Setup

```bash
# 1. An Atlassian org admin enables the Precedent tools:
#    admin.atlassian.com → Apps → Sites → <site> → Connected apps → Precedent → Tools
# 2. Connect your MCP client (Claude Code shown):
claude mcp add --transport http precedent https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28
# 3. In Claude Code run /mcp, authenticate, pick your site.
# 4. Copy this folder to ~/.claude/skills/precedent/ (or your project's .claude/skills/).
```
