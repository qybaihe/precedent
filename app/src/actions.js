// Rovo actions. The same handlers power the Precedent Rovo agent, any custom agent built in
// Rovo Studio, and external MCP clients (Claude Code, Cursor, ...) through the rovo:mcp module.
// Every response is plain JSON with decision ids and source links so agents can cite them.

import { checkWork } from './lib/check.js';
import { checkIssue, enqueueRecheck } from './lib/checker.js';
import { bm25, buildIndex } from './lib/check.js';
import { listDecisions, getDecision, createDecision, saveDecision, listChecks, getCheck, saveCheck } from './lib/store.js';
import { siteUrl } from './lib/products.js';
import { snippet } from './lib/text.js';
import { suggestFix } from './lib/fix.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

function brief(d) {
  return {
    id: d.id,
    title: d.title,
    decision: d.statement,
    status: d.status,
    owner: d.owner?.name || null,
    decidedOn: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
    source: d.source ? { title: d.source.title, url: d.source.url, kind: d.source.kind || d.source.label } : null,
    tags: d.tags || [],
    avoid: (d.guardrails?.avoid || []).map((t) => t.text),
    prefer: (d.guardrails?.prefer || []).map((t) => t.text),
    linkedWorkItems: d.links || [],
    supersededBy: d.supersededBy || null,
  };
}

function contextIssueKey(payload) {
  const fromInput = String(payload.issueKey || '').trim().toUpperCase();
  if (ISSUE_KEY.test(fromInput)) return fromInput;
  return payload.context?.jira?.issueKey || null;
}

function actor(context) {
  return context?.principal?.accountId || context?.accountId || null;
}

function describeCheck(r) {
  return {
    verdict: r.status,
    summary:
      r.status === 'conflict'
        ? `${r.conflicts.filter((c) => !c.acknowledged).length} active decision(s) appear to be contradicted.`
        : r.status === 'acknowledged'
          ? 'Conflicts exist but the team has already reviewed them.'
          : r.status === 'related'
            ? 'No contradictions found; related decisions are listed for context.'
            : 'No recorded decision covers this work.',
    conflicts: r.conflicts.map((c) => ({
      decision: brief(c.decision),
      matchedGuardrail: c.terms?.join(', ') || c.term,
      evidence: c.evidence,
      alreadyReviewed: Boolean(c.acknowledged),
      compliantAlternative: c.fix ? { advice: c.fix.advice, use: c.fix.to || null, insteadOf: c.fix.from || null } : null,
    })),
    aligned: r.aligned.map((a) => ({ decision: brief(a.decision), why: a.reason })),
    related: r.related.map((x) => ({ decision: brief(x.decision), sharedTopics: x.overlap })),
    guidance:
      'Cite decision ids and source links. Lead with the compliant alternative when one is given. If the work must go ahead anyway, suggest either logging an exception (log-exception) or superseding the decision (supersede-decision) with the owner involved.',
  };
}

/** search-decisions: find decisions about a topic. */
export async function searchDecisions(payload) {
  const query = String(payload.query || '').trim();
  const includeInactive = payload.includeInactive === true || payload.includeInactive === 'true';
  const all = await listDecisions();
  const pool = includeInactive ? all : all.filter((d) => d.status === 'active');
  if (!query) return { total: pool.length, decisions: pool.slice(0, 10).map(brief) };
  const ranked = bm25(buildIndex(pool), query, { expand: true }).slice(0, 6);
  return {
    query,
    total: ranked.length,
    decisions: ranked.map((r) => ({ ...brief(r.decision), relevance: Number(r.score.toFixed(2)) })),
    note: ranked.length ? undefined : 'No recorded decision matches. It may never have been decided — consider recording one.',
  };
}

/** get-decision: full record, history and the work items that reference it. */
export async function getDecisionDetails(payload) {
  const d = await getDecision(payload.decisionId);
  if (!d) return { error: `No decision with id ${payload.decisionId}` };
  const checks = await listChecks();
  const touching = checks
    .filter((c) => [...c.conflicts, ...c.aligned].some((x) => x.decision.id === d.id))
    .map((c) => ({ key: c.issue.key, summary: c.issue.summary, url: c.issue.url, verdict: c.conflicts.some((x) => x.decision.id === d.id) ? 'conflict' : 'aligned' }));
  return {
    ...brief(d),
    rationale: d.rationale || null,
    supersedes: d.supersedes || null,
    exceptions: d.exceptions || [],
    history: d.history || [],
    workItemsTouchingIt: touching,
  };
}

/** check-work-item: check a Jira work item (or a free-text plan) against active decisions. */
export async function checkWorkItem(payload) {
  const issueKey = contextIssueKey(payload);
  if (issueKey) {
    const r = await checkIssue(issueKey);
    return { workItem: { key: issueKey, summary: r.issue.summary, url: r.issue.url }, ...describeCheck(r) };
  }
  const text = String(payload.plan || payload.text || '').trim();
  if (!text) return { error: 'Provide either issueKey or plan (a description of the intended change).' };
  const decisions = await listDecisions();
  const r = checkWork({ text, projectKey: payload.projectKey }, decisions);
  // a coding agent's plan gets the same compliant alternative a work item would
  for (const c of r.conflicts) {
    const d = decisions.find((x) => x.id === c.decision.id);
    const f = d ? suggestFix({ summary: text, description: '' }, c, d) : null;
    if (f) c.fix = { kind: f.kind, from: f.from, to: f.to, advice: f.advice };
  }
  return { plan: snippet(text, 200), ...describeCheck(r) };
}

/** record-decision: capture a new decision (from chat, an IDE agent, or a meeting). */
export async function recordDecision(payload, context) {
  const statement = String(payload.statement || '').trim();
  if (statement.length < 8) return { error: 'statement is required (the decision, in one or two sentences).' };
  const issueKey = contextIssueKey(payload);
  const base = await siteUrl();
  const decision = await createDecision(
    {
      title: String(payload.title || '').trim() || statement.split(/(?<=[.!?;])\s/)[0].replace(/[.;]$/, '').slice(0, 90),
      statement,
      rationale: String(payload.rationale || '').trim(),
      owner: payload.ownerName ? { name: String(payload.ownerName) } : null,
      tags: String(payload.tags || '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      links: issueKey ? [issueKey] : [],
      createdBy: actor(context),
      source: issueKey
        ? { type: 'rovo', label: 'Rovo', kind: 'Recorded with Rovo', title: issueKey, url: `${base}/browse/${issueKey}`, issueKey }
        : { type: 'rovo', label: 'Rovo', kind: 'Recorded with Rovo', title: 'Rovo conversation' },
    },
    { avoid: payload.avoid, prefer: payload.prefer },
  );
  await enqueueRecheck();
  return {
    recorded: brief(decision),
    message: `Recorded ${decision.id}. Precedent is re-checking recent work items against it now.`,
  };
}

/** supersede-decision: replace an old decision with a new one, keeping the trail. */
export async function supersedeDecision(payload, context) {
  const old = await getDecision(payload.decisionId);
  if (!old) return { error: `No decision with id ${payload.decisionId}` };
  const statement = String(payload.newStatement || '').trim();
  if (statement.length < 8) return { error: 'newStatement is required.' };
  const now = new Date().toISOString();
  const next = await createDecision(
    {
      title: String(payload.title || '').trim() || statement.split(/(?<=[.!?;])\s/)[0].replace(/[.;]$/, '').slice(0, 90),
      statement,
      rationale: String(payload.reason || '').trim(),
      tags: old.tags || [],
      scope: old.scope,
      supersedes: old.id,
      createdBy: actor(context),
      source: { type: 'rovo', label: 'Rovo', kind: `Supersedes ${old.id}`, title: old.source?.title || old.title, url: old.source?.url },
    },
    { avoid: payload.avoid, prefer: payload.prefer },
  );
  await saveDecision({
    ...old,
    status: 'superseded',
    statusLocked: true,
    supersededBy: next.id,
    history: [...(old.history || []), { at: now, what: `Superseded by ${next.id}: ${String(payload.reason || '').trim()}` }],
  });
  await enqueueRecheck();
  return { superseded: old.id, replacement: brief(next) };
}

/** log-exception: the team knowingly deviates from a decision for one work item. */
export async function logException(payload, context) {
  const d = await getDecision(payload.decisionId);
  if (!d) return { error: `No decision with id ${payload.decisionId}` };
  const issueKey = contextIssueKey(payload);
  if (!issueKey) return { error: 'issueKey is required.' };
  const reason = String(payload.reason || '').trim() || 'No reason given';
  const now = new Date().toISOString();
  await saveDecision({
    ...d,
    exceptions: [...(d.exceptions || []).filter((e) => e.issueKey !== issueKey), { issueKey, reason, by: actor(context), at: now }],
    links: [...new Set([...(d.links || []), issueKey])],
    history: [...(d.history || []), { at: now, what: `Exception logged for ${issueKey}: ${reason}` }],
  });
  const r = await checkIssue(issueKey);
  return { decision: d.id, workItem: issueKey, exception: reason, newVerdict: r.status };
}

/** list-conflicts: open contradictions across the site (optionally one project). */
export async function listConflicts(payload) {
  const projectKey = String(payload.projectKey || payload.context?.jira?.projectKey || '').trim().toUpperCase();
  const checks = (await listChecks()).filter((c) => !projectKey || c.issue?.projectKey === projectKey);
  const open = checks
    .filter((c) => c.status === 'conflict')
    .map((c) => ({
      workItem: { key: c.issue.key, summary: c.issue.summary, status: c.issue.status, assignee: c.issue.assignee?.displayName || null, url: c.issue.url },
      contradicts: c.conflicts.filter((x) => !x.acknowledged).map((x) => ({ id: x.decision.id, title: x.decision.title, matched: x.terms?.join(', ') })),
    }));
  return { project: projectKey || 'all', openConflicts: open.length, items: open };
}

/** Exposed for resolvers: acknowledge a conflict on a work item. */
export async function acknowledge(issueKey, decisionId, accountId, undo = false) {
  const prev = await getCheck(issueKey);
  const set = new Set(prev?.acknowledged || []);
  undo ? set.delete(decisionId) : set.add(decisionId);
  if (prev) await saveCheck(issueKey, { ...prev, acknowledged: [...set] });
  const d = await getDecision(decisionId);
  if (d && !undo) {
    await saveDecision({
      ...d,
      links: [...new Set([...(d.links || []), issueKey])],
      history: [...(d.history || []), { at: new Date().toISOString(), what: `Reviewed on ${issueKey}`, by: accountId }],
    });
  }
  return checkIssue(issueKey);
}
