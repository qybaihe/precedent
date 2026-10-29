// Runs conflict checks against live Jira work items and records the outcome where people
// will see it: the Precedent issue panel, the Decision Radar and a JQL-searchable issue property.

import { Queue } from '@forge/events';
import { checkWork } from './check.js';
import { suggestFix } from './fix.js';
import { adfToText } from './adf.js';
import { outdated } from './health.js';
import { normalizeGuard } from './guard.js';
import { buildBrief, briefAdf, stripBrief, withBriefBlock } from './brief.js';
import { getIssue, issueText, issueMeta, setIssueProperty, siteUrl, searchIssues, issueKeysMatching, decisionLogUrl, addComment, updateComment, deleteComment, updateIssue } from './products.js';
import { listDecisions, getCheck, saveCheck, listChecks, deleteCheck, getSettings, getBriefRecord, saveBriefRecord } from './store.js';

export const jobs = new Queue({ key: 'precedent-jobs' });

/** Summary written to the `precedent` issue property (indexed for JQL via jira:entityProperty). */
function propertyFor(result) {
  const open = result.conflicts.filter((c) => !c.acknowledged);
  return {
    status: result.status,
    conflictCount: open.length,
    relatedCount: result.related.length,
    decisions: [...result.conflicts, ...result.related, ...result.aligned].map((x) => x.decision.id).join(' '),
    checkedAt: result.checkedAt,
  };
}

/**
 * Compliant alternatives for each conflict. The stored check keeps a slim version (for the Radar,
 * Rovo and MCP); the full rewrite preview is only returned to the issue panel.
 */
function attachFixes(result, issue, decisions) {
  const work = { summary: issue.fields?.summary || '', description: adfToText(stripBrief(issue.fields?.description).adf).trim() };
  const fixes = {};
  for (const c of result.conflicts) {
    const d = decisions.find((x) => x.id === c.decision.id);
    if (!d) continue;
    const stale = outdated(d);
    if (stale.possibly) c.outdated = stale.reasons;
    try {
      const f = suggestFix(work, c, d);
      if (!f) continue;
      fixes[d.id] = f;
      c.fix = { kind: f.kind, from: f.from, to: f.to, advice: f.advice };
    } catch (e) {
      console.warn(`fix for ${issue.key} / ${d.id} failed: ${e.message}`);
    }
  }
  return fixes;
}

const guardedByJql = (decisions) => decisions.filter((d) => d.status === 'active' && normalizeGuard(d.guard)?.jql);

/**
 * Which work items each decision's guard JQL governs: decision id -> Set of keys (for one work
 * item when `issueKey` is given). A broken JQL is logged and leaves the decision applying
 * everywhere, so a typo never silently switches a decision off.
 */
export async function jqlScopes(decisions, issueKey) {
  const out = {};
  for (const d of guardedByJql(decisions)) {
    const jql = issueKey ? `issuekey = ${issueKey} AND (${d.guard.jql})` : `(${d.guard.jql})`;
    try {
      // eslint-disable-next-line no-await-in-loop
      out[d.id] = new Set(await issueKeysMatching(jql, issueKey ? 1 : 500));
    } catch (e) {
      console.warn(`guard JQL of ${d.id} failed (${e.message}); it applies to every work item until fixed`);
    }
  }
  return out;
}

const scopeFor = (scopes, key) => Object.fromEntries(Object.entries(scopes).map(([id, keys]) => [id, keys.has(key)]));

/**
 * Keep the Precedent brief on a work item in step with its check. It lives either in one comment
 * or in a marked block at the end of the description (settings.briefTarget), because Jira's "Open
 * in coding tool" passes the description to the coding agent. Posted when a decision applies (if
 * auto briefs are on, or when `force`d from the issue panel), edited in place when what it says
 * changes, removed when no decision applies any more.
 */
export async function syncBrief(issue, result, decisions, { base, force = false, settings } = {}) {
  const key = issue.key;
  const opts = settings || (await getSettings());
  const target = opts.briefTarget === 'description' ? 'description' : 'comment';
  const b = buildBrief({ issueKey: key, result, decisions, logUrl: base ? decisionLogUrl(base) : null });
  const rec = await getBriefRecord(key);
  const inDescription = stripBrief(issue.fields?.description).had;
  const clearComment = async () => rec?.commentId && deleteComment(key, rec.commentId);
  const clearDescription = async () => inDescription && updateIssue(key, { description: stripBrief(issue.fields.description).adf });
  if (!b.items.length) {
    await clearComment();
    await clearDescription();
    if (rec) await saveBriefRecord(key, null);
    return null;
  }
  if (!rec && opts.autoBrief === false && !force) return null;
  if (rec && rec.signature === b.signature && rec.target === target && !force) return rec;
  let commentId = null;
  if (target === 'description') {
    await clearComment();
    await updateIssue(key, { description: withBriefBlock(issue.fields?.description, b) });
  } else {
    await clearDescription();
    commentId = rec?.commentId || null;
    if (commentId && !(await updateComment(key, commentId, briefAdf(b)))) commentId = null;
    if (!commentId) commentId = (await addComment(key, briefAdf(b))).id;
  }
  const saved = { target, commentId, signature: b.signature, ids: b.ids, conflicts: b.conflicts, at: new Date().toISOString() };
  await saveBriefRecord(key, saved);
  return saved;
}

/** Check one issue (by key, or an already-fetched issue object) and persist the result. */
export async function checkIssue(issueOrKey, { decisions, base, scopes, settings, forceBrief = false } = {}) {
  const issue = typeof issueOrKey === 'string' ? await getIssue(issueOrKey) : issueOrKey;
  const [all, prev, url] = await Promise.all([decisions || listDecisions(), getCheck(issue.key), base || siteUrl()]);
  const meta = issueMeta(issue, url);
  const acknowledged = prev?.acknowledged || [];
  const jqlScope = scopeFor(scopes || (await jqlScopes(all, issue.key)), issue.key);
  const result = checkWork(
    { text: issueText(issue), projectKey: meta.projectKey, labels: meta.labels, issueKey: issue.key, jqlScope },
    all,
    { acknowledged },
  );
  const fixes = attachFixes(result, issue, all);
  const record = { ...result, issue: meta, acknowledged };
  await saveCheck(issue.key, record);
  const prop = propertyFor(result);
  const prevProp = prev ? propertyFor(prev) : null;
  if (!prevProp || prevProp.status !== prop.status || prevProp.decisions !== prop.decisions || prevProp.conflictCount !== prop.conflictCount) {
    await setIssueProperty(issue.key, prop);
  }
  let brief = null;
  try {
    brief = await syncBrief(issue, record, all, { base: url, settings, force: forceBrief });
  } catch (e) {
    console.warn(`brief for ${issue.key} failed: ${e.message}`);
  }
  return { ...record, fixes, brief };
}

/** Re-check many issues: everything checked before plus anything matching `jql`. */
export async function recheck({ jql = 'updated >= -90d ORDER BY updated DESC', max = 100 } = {}) {
  const [decisions, base, previous, settings] = await Promise.all([listDecisions(), siteUrl(), listChecks(), getSettings()]);
  const scopes = await jqlScopes(decisions);
  const issues = await searchIssues(jql, { max });
  const seen = new Set(issues.map((i) => i.key));
  let checked = 0;
  let conflicts = 0;
  for (const issue of issues) {
    // eslint-disable-next-line no-await-in-loop
    const r = await checkIssue(issue, { decisions, base, scopes, settings });
    checked++;
    if (r.status === 'conflict') conflicts++;
  }
  // issues checked earlier that fell outside the JQL window still deserve fresh results
  for (const p of previous) {
    if (seen.has(p.issue?.key)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await checkIssue(p.issue.key, { decisions, base, scopes, settings });
      checked++;
      if (r.status === 'conflict') conflicts++;
    } catch (e) {
      // deleted (or moved out of reach) while we weren't listening: drop the stale result
      if (e.status === 404) {
        // eslint-disable-next-line no-await-in-loop
        await deleteCheck(p.issue.key);
        console.log(`forgot ${p.issue.key} (no longer exists)`);
      } else console.warn(`Skipping ${p.issue?.key}: ${e.message}`);
    }
  }
  return { checked, conflicts };
}

/** Queue a background re-check. Never fails the caller: a missed re-check is caught by the daily sweep. */
export async function enqueueRecheck(jql) {
  const body = jql ? { type: 'recheck', jql } : { type: 'recheck' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await jobs.push({ body });
      return true;
    } catch (e) {
      console.warn(`enqueue recheck failed (attempt ${attempt}): ${e.message}`);
    }
  }
  return false;
}
