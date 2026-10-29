// Resolvers behind the Custom UI surfaces (issue panel, Decision Radar, Decision Center, page byline).
// Issue and page ids always come from the trusted Forge context, never from the client payload.

import Resolver from '@forge/resolver';
import { checkIssue, enqueueRecheck, jobs } from './lib/checker.js';
import {
  listDecisions,
  getDecision,
  saveDecision,
  createDecision,
  withGuardrails,
  listChecks,
  getCheck,
  decisionsFromSourcePrefix,
  getSettings,
  saveSettings,
} from './lib/store.js';
import { acknowledge, logException, supersedeDecision } from './actions.js';
import { listProjects, listSpaces, userCanBrowse, userCanEdit, siteUrl, getIssue, updateIssue, addComment, getPage, addPageComment, decisionLogUrl, issueKeysMatching, countIssues } from './lib/products.js';
import { createSampleData } from './sample.js';
import { applyReplacementsToAdf, applyReplacementsToText, preferredAlternative } from './lib/fix.js';
import { findDecisionCandidates } from './lib/extract.js';
import { decisionHealth, teamHealth, REVIEW_DAYS } from './lib/health.js';
import { dateFromTitle } from './lib/adf.js';
import { pageUrl } from './lib/harvest.js';
import { graphConnections, lastGraphSync } from './lib/graph.js';
import { normalizeGuard } from './lib/guard.js';
import { bm25, buildIndex } from './lib/check.js';
import { buildBrief, briefMarkdown, stripBrief } from './lib/brief.js';
import { enableCreateHints, createHintsStatus } from './gate.js';
import { createHintFor, createFlagFor } from './lib/hint.js';
import { normalizeTripwire } from './lib/tripwire.js';
import { runTripwires } from './tripwires.js';
import { pageCandidates, acceptFromInbox, listInbox, dismissFromInbox, mergeFromInbox, NOTES_PREFIX } from './inbox.js';

const resolver = new Resolver();

function issueKeyFrom(context) {
  return context.extension?.issue?.key;
}

/** Per decision: open conflicts, aligned and related work items. */
function impactRefs(checks) {
  const refs = {};
  const at = (id) => (refs[id] ||= { conflicts: 0, aligned: 0, related: 0 });
  for (const c of checks) {
    for (const x of c.conflicts) at(x.decision.id).conflicts += x.acknowledged ? 0 : 1;
    for (const x of c.aligned) at(x.decision.id).aligned += 1;
    for (const x of c.related) at(x.decision.id).related += 1;
  }
  return refs;
}

/** What the browser needs from a stored check (no rationale or full decision copies). */
function slimCheck(c) {
  const ref = (x) => ({ id: x.decision.id, title: x.decision.title });
  return {
    issue: c.issue,
    status: c.status,
    checkedAt: c.checkedAt,
    conflicts: c.conflicts.map((x) => ({ decision: ref(x), terms: x.terms, evidence: x.evidence, acknowledged: x.acknowledged, fix: x.fix || null, outdated: x.outdated || null })),
    aligned: c.aligned.map((x) => ({ decision: ref(x), reason: x.reason })),
    related: c.related.map((x) => ({ decision: ref(x) })),
  };
}

const mention = (owner) => (owner?.accountId ? { type: 'mention', attrs: { id: owner.accountId } } : { type: 'text', text: owner?.name || 'the owner' });
const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Decisions found in meeting-note prose get their own key prefix: harvesting archives anything under
// `confluence:<page>:` that is no longer a /decision item, and these never were.
async function pageDecisions(pageId) {
  if (!pageId) return [];
  const [items, notes] = await Promise.all([decisionsFromSourcePrefix(`confluence:${pageId}:`), decisionsFromSourcePrefix(NOTES_PREFIX(pageId))]);
  return [...items, ...notes];
}

// ---------- issue panel ----------

resolver.define('getIssueCheck', async ({ context }) => {
  const key = issueKeyFrom(context);
  if (!key) return { error: 'No work item in context' };
  if (!(await userCanBrowse(key))) return { error: 'You do not have access to this work item' };
  return checkIssue(key);
});

/** The agent brief for this work item as markdown (what the comment says, for copy/paste). */
resolver.define('getAgentBrief', async ({ context }) => {
  const key = issueKeyFrom(context);
  if (!key) return { error: 'No work item in context' };
  if (!(await userCanBrowse(key))) return { error: 'You do not have access to this work item' };
  const [result, decisions, base] = await Promise.all([checkIssue(key), listDecisions(), siteUrl()]);
  const b = buildBrief({ issueKey: key, result, decisions, logUrl: decisionLogUrl(base) });
  return { markdown: briefMarkdown(b), ids: b.ids };
});

/** Post (or refresh) the Precedent brief comment, even when automatic briefs are off. */
resolver.define('attachBrief', async ({ context }) => {
  const key = issueKeyFrom(context);
  if (!key) return { error: 'No work item in context' };
  if (!(await userCanBrowse(key))) return { error: 'You do not have access to this work item' };
  const r = await checkIssue(key, { forceBrief: true });
  if (!r.brief) return { error: 'No recorded decision applies to this work item, so there is nothing to brief.' };
  return r;
});

/** Create dialog: the "Already decided" hint for the summary being typed. */
resolver.define('createHint', async ({ payload, context }) => {
  const summary = String(payload.summary || '').slice(0, 500);
  const projectKey = context.extension?.project?.key || payload.projectKey;
  const hint = createHintFor(summary, await listDecisions(), projectKey);
  return { hint, flag: createFlagFor(hint) };
});

resolver.define('enableCreateHints', async () => {
  try {
    return await enableCreateHints();
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('applyFix', async ({ payload, context }) => {
  const key = issueKeyFrom(context);
  if (!key) return { error: 'No work item in context' };
  if (!(await userCanEdit(key))) return { error: 'You do not have permission to edit this work item' };
  // recompute on the server from the live work item: never trust a rewrite sent by the browser
  const [issue, decision] = await Promise.all([getIssue(key), getDecision(payload.decisionId)]);
  if (!decision) return { error: `${payload.decisionId} not found` };
  const current = await checkIssue(issue);
  const fix = current.fixes?.[decision.id];
  if (!fix || fix.kind !== 'rewrite') return { error: 'There is no safe automatic rewrite for this conflict. Ask Precedent for options, or log an exception.' };
  const fields = {};
  const summary = applyReplacementsToText(issue.fields.summary || '', fix.replacements);
  if (summary !== issue.fields.summary) fields.summary = summary;
  const { adf: ownText, had: hadBrief } = stripBrief(issue.fields.description);
  if (ownText) {
    // rewrite the team's text only; the brief block is rebuilt from the new check below
    const r = applyReplacementsToAdf(ownText, fix.replacements);
    if (r.changed) fields.description = r.adf;
  }
  if (!Object.keys(fields).length) return { error: 'Nothing to change.' };
  await updateIssue(key, fields);
  await addComment(key, {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Precedent: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: `updated to comply with ${decision.id} (“${decision.title}”). Replaced “${fix.from}” with “${fix.to}”${fields.description ? ' in the summary and description' : ' in the summary'}.` },
        ],
      },
      ...(fields.summary ? [{ type: 'paragraph', content: [{ type: 'text', text: `Previous summary: “${issue.fields.summary}”`, marks: [{ type: 'em' }] }] }] : []),
      { type: 'paragraph', content: [{ type: 'text', text: 'Requested by ' }, mention({ accountId: context.accountId }), { type: 'text', text: '.' }] },
    ],
  });
  const after = await checkIssue(key, { forceBrief: hadBrief && Boolean(fields.description) });
  return { check: after, applied: { from: fix.from, to: fix.to, summary: fields.summary || null } };
});

resolver.define('acknowledge', async ({ payload, context }) => {
  const key = issueKeyFrom(context);
  return acknowledge(key, payload.decisionId, context.accountId, Boolean(payload.undo));
});

resolver.define('logException', async ({ payload, context }) => {
  const key = issueKeyFrom(context);
  await logException({ decisionId: payload.decisionId, issueKey: key, reason: payload.reason }, { accountId: context.accountId });
  return checkIssue(key);
});

resolver.define('recordDecision', async ({ payload, context }) => {
  const key = issueKeyFrom(context);
  const base = await siteUrl();
  const d = await createDecision(
    {
      title: payload.title?.trim() || payload.statement.split(/(?<=[.!?;])\s/)[0].slice(0, 90),
      statement: payload.statement.trim(),
      rationale: payload.rationale?.trim() || '',
      owner: payload.ownerName ? { name: payload.ownerName } : null,
      tags: (payload.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      links: key ? [key] : [],
      scope: payload.projectOnly && context.extension?.project?.key ? { projects: [context.extension.project.key] } : undefined,
      createdBy: context.accountId,
      source: key
        ? { type: 'jira', label: 'Jira', kind: 'Recorded on a work item', title: key, url: `${base}/browse/${key}`, issueKey: key }
        : { type: 'manual', label: 'Precedent', kind: 'Recorded in Precedent', title: 'Decision Log' },
    },
    { avoid: payload.avoid, prefer: payload.prefer },
  );
  await enqueueRecheck();
  return d;
});

// ---------- decision log ----------

resolver.define('listDecisions', async () => {
  const [decisions, checks] = await Promise.all([listDecisions(), listChecks()]);
  const refs = {};
  for (const c of checks) {
    for (const x of c.conflicts) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).conflicts += x.acknowledged ? 0 : 1;
    for (const x of c.aligned) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).aligned += 1;
    for (const x of c.related) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).related += 1;
  }
  return { decisions, refs, settings: await getSettings() };
});

resolver.define('getOverview', async () => {
  const [decisions, checks, settings, base, connections, graphSync, createHints, inbox] = await Promise.all([
    listDecisions(),
    listChecks(),
    getSettings(),
    siteUrl().catch(() => ''),
    graphConnections(),
    lastGraphSync(),
    createHintsStatus(),
    listInbox(),
  ]);
  const refs = impactRefs(checks);
  const team = teamHealth(decisions, refs);
  const { byId, ...summary } = team;
  return {
    decisions: decisions.map((d) => ({ ...d, health: byId[d.id] || decisionHealth(d, refs[d.id]) })),
    refs,
    checks: checks.map(slimCheck),
    team: summary,
    settings: { ...settings, reviewDays: REVIEW_DAYS },
    siteUrl: base,
    teamworkGraph: { connections: connections.length, lastSync: graphSync },
    createHints,
    inboxCount: inbox.reduce((n, e) => n + e.items.length, 0),
  };
});

resolver.define('syncGraph', async () => {
  await jobs.push({ body: { type: 'graph-sync' } });
  return { queued: true };
});

resolver.define('reviewDecision', async ({ payload, context }) => {
  const d = await getDecision(payload.id);
  if (!d) return null;
  const now = new Date();
  const saved = await saveDecision({
    ...d,
    reviewedAt: now.toISOString(),
    reviewBy: new Date(now.getTime() + REVIEW_DAYS * 86400000).toISOString(),
    history: [...(d.history || []), { at: now.toISOString(), kind: 'review', what: 'Reviewed: still valid', by: context.accountId }],
  });
  await jobs.push({ body: { type: 'graph-sync' } }).catch(() => {});
  return saved;
});

resolver.define('remindOwner', async ({ payload, context }) => {
  const d = await getDecision(payload.id);
  if (!d) return { posted: false, error: 'Decision not found' };
  const h = decisionHealth(d);
  const due = new Date(h.reviewBy).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const ask = `${d.id} “${d.title}” is ${h.reviewState === 'overdue' ? `overdue for review (since ${due})` : `due for review on ${due}`}. Is it still valid? Confirm it with “Still valid” in Precedent's Decision Log, or supersede it if things have changed.`;
  let where;
  try {
    if (d.source?.type === 'confluence' && d.source.pageId) {
      const who = d.owner?.accountId ? `<ac:link><ri:user ri:account-id="${escapeHtml(d.owner.accountId)}" /></ac:link>` : escapeHtml(d.owner?.name || 'Decision owner');
      await addPageComment(d.source.pageId, `<p><strong>Precedent review reminder</strong> for ${who}: ${escapeHtml(ask)}</p>`);
      where = `Comment posted on “${d.source.title}”${d.owner?.accountId ? ', mentioning the owner' : ''}.`;
    } else if (d.source?.issueKey) {
      await addComment(d.source.issueKey, { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Precedent review reminder for ', marks: [{ type: 'strong' }] }, mention(d.owner), { type: 'text', text: `: ${ask}` }] }] });
      where = `Comment posted on ${d.source.issueKey}.`;
    } else return { posted: false, error: 'This decision has no source page or work item to comment on.' };
  } catch (e) {
    return { posted: false, error: e.message.slice(0, 200) };
  }
  await saveDecision({ ...d, history: [...(d.history || []), { at: new Date().toISOString(), kind: 'reminder', what: `Review reminder sent to ${d.owner?.name || 'the owner'}`, by: context.accountId }] });
  return { posted: true, where };
});

// Assumptions: what has to stay true for the decision to keep making sense ("Finance audits the
// ledger with SQL"). When one stops holding, the decision is flagged as possibly outdated.
resolver.define('updateAssumptions', async ({ payload, context }) => {
  const d = await getDecision(payload.id);
  if (!d) return null;
  const now = new Date().toISOString();
  const list = [...(d.assumptions || [])];
  const event = (what) => ({ at: now, kind: 'assumption', what, by: context.accountId });
  const history = [...(d.history || [])];
  if (payload.op === 'add') {
    const text = String(payload.text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (text.length < 6) return { error: 'Describe the assumption in a few words.' };
    list.push({ id: `a${Date.now().toString(36)}`, text, status: 'holds', addedAt: now, by: context.accountId });
    history.push(event(`Assumption tracked: “${text}”`));
  } else {
    const i = list.findIndex((a) => a.id === payload.assumptionId);
    if (i < 0) return { error: 'Assumption not found' };
    const a = list[i];
    if (payload.op === 'remove') {
      list.splice(i, 1);
      history.push(event(`Assumption removed: “${a.text}”`));
    } else if (payload.op === 'tripwire') {
      const { tripwire, error } = normalizeTripwire(payload.tripwire);
      if (error) return { error };
      if (tripwire?.kind === 'jql') {
        try {
          await countIssues(tripwire.jql);
        } catch (e) {
          return { error: `The JQL is not valid: ${e.message.replace(/^.*?: /, '')}` };
        }
      }
      list[i] = { ...a, tripwire: tripwire || undefined, lastCheck: undefined };
      history.push(event(tripwire ? `Tripwire set on “${a.text}”` : `Tripwire removed from “${a.text}”`));
    } else if (payload.op === 'set' && ['holds', 'changed'].includes(payload.status)) {
      const note = String(payload.note || '').trim().slice(0, 200);
      list[i] = { ...a, status: payload.status, changedAt: now, note: payload.status === 'changed' ? note : '' };
      if (payload.status === 'holds' && a.lastCheck?.tripped) list[i].snoozed = true;
      history.push(event(payload.status === 'changed' ? `Assumption no longer holds: “${a.text}”${note ? ` — ${note}` : ''}` : `Assumption confirmed: “${a.text}”`));
    }
  }
  let saved = await saveDecision({ ...d, assumptions: list, history });
  // measure a new tripwire right away, so the drawer shows its first reading
  if (payload.op === 'tripwire' && list.some((x) => x.tripwire)) {
    await runTripwires({ only: d.id });
    saved = await getDecision(d.id);
  }
  await jobs.push({ body: { type: 'graph-sync' } }).catch(() => {});
  const checks = await listChecks();
  return { ...saved, health: decisionHealth(saved, impactRefs(checks)[saved.id]) };
});

resolver.define('runTripwires', async ({ payload }) => runTripwires({ only: payload?.id }));

resolver.define('supersede', async ({ payload, context }) => {
  const r = await supersedeDecision(
    { decisionId: payload.id, newStatement: payload.statement, reason: payload.reason, title: payload.title, avoid: payload.avoid, prefer: payload.prefer, via: 'Precedent' },
    { accountId: context.accountId },
  );
  return r;
});

resolver.define('getDecision', async ({ payload }) => {
  const d = await getDecision(payload.id);
  if (!d) return null;
  const checks = await listChecks();
  const workItems = checks
    .map((c) => {
      const conflict = c.conflicts.find((x) => x.decision.id === d.id);
      const aligned = c.aligned.find((x) => x.decision.id === d.id);
      const related = c.related.find((x) => x.decision.id === d.id);
      if (!conflict && !aligned && !related) return null;
      return {
        issue: c.issue,
        relation: conflict ? (conflict.acknowledged ? 'reviewed' : 'conflict') : aligned ? 'aligned' : 'related',
        evidence: conflict?.evidence || aligned?.reason || '',
      };
    })
    .filter(Boolean);
  return { decision: { ...d, health: decisionHealth(d, impactRefs(checks)[d.id]) }, workItems };
});

resolver.define('updateDecision', async ({ payload, context }) => {
  const d = await getDecision(payload.id);
  if (!d) return null;
  const patch = payload.patch || {};
  const now = new Date().toISOString();
  let next = {
    ...d,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.statement !== undefined ? { statement: patch.statement } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) } : {}),
    ...(patch.ownerName !== undefined ? { owner: patch.ownerName ? { ...(d.owner || {}), name: patch.ownerName } : null } : {}),
  };
  if (patch.reviewBy !== undefined) {
    const at = patch.reviewBy ? new Date(patch.reviewBy) : null;
    next.reviewBy = at && !Number.isNaN(at.getTime()) ? at.toISOString() : undefined;
    next.history = [...(next.history || []), { at: now, kind: 'review', what: next.reviewBy ? `Revisit date set to ${next.reviewBy.slice(0, 10)}` : 'Revisit date cleared', by: context.accountId }];
  }
  if (patch.guard !== undefined) {
    const guard = normalizeGuard(patch.guard);
    if (guard?.jql) {
      try {
        await issueKeysMatching(`(${guard.jql})`, 1);
      } catch (e) {
        return { error: `The guard JQL is not valid: ${e.message.replace(/^.*?: /, '')}` };
      }
    }
    next.guard = guard || undefined;
    next.history = [...(next.history || []), { at: now, kind: 'guard', what: guard ? 'Guard updated' : 'Guard removed', by: context.accountId }];
  }
  if (patch.status && patch.status !== d.status) {
    next.status = patch.status;
    next.statusLocked = true;
    next.history = [...(next.history || []), { at: now, kind: 'status', what: `Status changed to ${patch.status}`, by: context.accountId }];
  }
  if (patch.avoid !== undefined || patch.prefer !== undefined || patch.statement !== undefined) {
    next = withGuardrails(next, {
      avoid: patch.avoid ?? (d.guardrails?.curated ? d.guardrails.avoid.map((t) => t.text).join(', ') : undefined),
      prefer: patch.prefer ?? (d.guardrails?.curated ? d.guardrails.prefer.map((t) => t.text).join(', ') : undefined),
    });
  }
  const saved = await saveDecision(next);
  await enqueueRecheck();
  return saved;
});

resolver.define('scanConfluence', async () => {
  await jobs.push({ body: { type: 'scan-confluence', limit: 50 } });
  return { queued: true };
});

resolver.define('saveSettings', async ({ payload }) => saveSettings(payload));

resolver.define('getSetup', async () => {
  const [projects, spaces] = await Promise.all([listProjects().catch(() => []), listSpaces().catch(() => [])]);
  return { projects: projects.filter((p) => p.type === 'software' || p.type === 'business' || p.type === 'service_desk'), spaces };
});

resolver.define('createSampleData', async ({ payload }) => createSampleData(payload));

// ---------- decision radar (project page) ----------

resolver.define('getRadar', async ({ context }) => {
  const projectKey = context.extension?.project?.key;
  const [decisions, checks] = await Promise.all([listDecisions(), listChecks()]);
  const mine = checks.filter((c) => c.issue?.projectKey === projectKey);
  const active = decisions.filter((d) => d.status === 'active' && (!d.scope?.projects?.length || d.scope.projects.includes(projectKey)));
  const refs = impactRefs(checks);
  return {
    projectKey,
    decisions: active.map((d) => ({ ...d, health: decisionHealth(d, refs[d.id]), preferred: preferredAlternative(d) })),
    checks: mine.map(slimCheck),
    totalDecisions: decisions.length,
  };
});

resolver.define('rescanProject', async ({ context }) => {
  const projectKey = context.extension?.project?.key;
  await enqueueRecheck(`project = "${projectKey}" ORDER BY updated DESC`);
  return { queued: true };
});

// ---------- confluence page byline ----------

resolver.define('getPageDecisions', async ({ context }) => {
  const decisions = await pageDecisions(context.extension?.content?.id);
  const checks = await listChecks();
  const refs = impactRefs(checks);
  return decisions.map((d) => ({
    decision: { ...d, health: decisionHealth(d, refs[d.id]) },
    conflicts: checks
      .filter((c) => c.conflicts.some((x) => x.decision.id === d.id && !x.acknowledged))
      .map((c) => c.issue),
    aligned: checks.filter((c) => c.aligned.some((x) => x.decision.id === d.id)).map((c) => c.issue),
  }));
});

resolver.define('findPageDecisions', async ({ context }) => {
  const pageId = context.extension?.content?.id;
  if (!pageId) return { candidates: [] };
  const { page, candidates } = await pageCandidates(pageId);
  return { page: { id: String(page.id), title: page.title }, candidates };
});

resolver.define('recordPageDecisions', async ({ payload, context }) => {
  const pageId = context.extension?.content?.id;
  if (!pageId) return { recorded: [] };
  // only statements Precedent itself found on this page can be recorded from here
  const recorded = await acceptFromInbox(pageId, (payload.items || []).map((i) => i.key), context.accountId);
  return { recorded };
});

// ---------- Decision Inbox (decisions found in meeting notes) ----------

resolver.define('getInbox', async () => {
  const [pages, decisions] = await Promise.all([listInbox(), listDecisions()]);
  const index = buildIndex(decisions.filter((d) => d.status === 'active'));
  // the closest existing decision, so a restated decision can be merged instead of duplicated
  return pages.map((p) => ({
    ...p,
    items: p.items.map((c) => {
      if (c.duplicateOf) return c;
      const top = bm25(index, c.statement)[0];
      return top && top.overlap.length >= 4 ? { ...c, similar: { id: top.decision.id, title: top.decision.title } } : c;
    }),
  }));
});

resolver.define('inboxAction', async ({ payload, context }) => {
  const { pageId, key, op, into } = payload || {};
  if (!pageId || !key) return { error: 'Missing page or item' };
  if (op === 'accept') return { recorded: await acceptFromInbox(pageId, [key], context.accountId) };
  if (op === 'merge') return mergeFromInbox(pageId, key, into, context.accountId);
  if (op === 'dismiss') {
    await dismissFromInbox(pageId, key);
    return { dismissed: key };
  }
  return { error: `Unknown action ${op}` };
});

export const handler = resolver.getDefinitions();

// ---------- dynamic properties ----------

/** Badge on the issue-context panel button ("2 conflicts"). */
export async function issueContextStatus(payload) {
  const key = payload?.extension?.issue?.key;
  const check = key ? await getCheck(key) : null;
  if (!check) return {};
  const open = check.conflicts.filter((c) => !c.acknowledged).length;
  if (open) return { status: { type: 'lozenge', value: { label: `${open} conflict${open > 1 ? 's' : ''}`, type: 'removed' } } };
  if (check.aligned.length) return { status: { type: 'lozenge', value: { label: 'Aligned', type: 'success' } } };
  if (check.related.length) return { status: { type: 'badge', value: { label: String(check.related.length) } } };
  return {};
}

/** Byline title on Confluence pages that contain decisions ("3 decisions · 1 conflict"). */
export async function bylineProperties(payload) {
  const decisions = await pageDecisions(payload?.extension?.content?.id);
  if (!decisions.length) return { title: 'Precedent' };
  const checks = await listChecks();
  const ids = new Set(decisions.map((d) => d.id));
  const conflicts = checks.filter((c) => c.conflicts.some((x) => ids.has(x.decision.id) && !x.acknowledged)).length;
  const n = decisions.length;
  return {
    title: `${n} decision${n > 1 ? 's' : ''}${conflicts ? ` · ${conflicts} conflict${conflicts > 1 ? 's' : ''}` : ''}`,
    tooltip: 'Decisions on this page tracked by Precedent',
  };
}
