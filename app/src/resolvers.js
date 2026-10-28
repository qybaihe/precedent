// Resolvers behind the UI Kit surfaces (issue panel, Decision Radar, Decision Log, page byline).
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
import { acknowledge, logException } from './actions.js';
import { listProjects, listSpaces, userCanBrowse, siteUrl } from './lib/products.js';
import { createSampleData } from './sample.js';

const resolver = new Resolver();

function issueKeyFrom(context) {
  return context.extension?.issue?.key;
}

// ---------- issue panel ----------

resolver.define('getIssueCheck', async ({ context }) => {
  const key = issueKeyFrom(context);
  if (!key) return { error: 'No work item in context' };
  if (!(await userCanBrowse(key))) return { error: 'You do not have access to this work item' };
  return checkIssue(key);
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
  return { decision: d, workItems };
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
  if (patch.status && patch.status !== d.status) {
    next.status = patch.status;
    next.statusLocked = true;
    next.history = [...(d.history || []), { at: now, what: `Status changed to ${patch.status}`, by: context.accountId }];
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
  return { projectKey, decisions: active, checks: mine, totalDecisions: decisions.length };
});

resolver.define('rescanProject', async ({ context }) => {
  const projectKey = context.extension?.project?.key;
  await enqueueRecheck(`project = "${projectKey}" ORDER BY updated DESC`);
  return { queued: true };
});

// ---------- confluence page byline ----------

resolver.define('getPageDecisions', async ({ context }) => {
  const pageId = context.extension?.content?.id;
  const decisions = pageId ? await decisionsFromSourcePrefix(`confluence:${pageId}:`) : [];
  const checks = await listChecks();
  return decisions.map((d) => ({
    decision: d,
    conflicts: checks
      .filter((c) => c.conflicts.some((x) => x.decision.id === d.id && !x.acknowledged))
      .map((c) => c.issue),
    aligned: checks.filter((c) => c.aligned.some((x) => x.decision.id === d.id)).map((c) => c.issue),
  }));
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
  const pageId = payload?.extension?.content?.id;
  const decisions = pageId ? await decisionsFromSourcePrefix(`confluence:${pageId}:`) : [];
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
