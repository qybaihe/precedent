// Runs conflict checks against live Jira work items and records the outcome where people
// will see it: the Precedent issue panel, the Decision Radar and a JQL-searchable issue property.

import { Queue } from '@forge/events';
import { checkWork } from './check.js';
import { getIssue, issueText, issueMeta, setIssueProperty, siteUrl, searchIssues } from './products.js';
import { listDecisions, getCheck, saveCheck, listChecks, deleteCheck } from './store.js';

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

/** Check one issue (by key, or an already-fetched issue object) and persist the result. */
export async function checkIssue(issueOrKey, { decisions, base } = {}) {
  const issue = typeof issueOrKey === 'string' ? await getIssue(issueOrKey) : issueOrKey;
  const [all, prev, url] = await Promise.all([decisions || listDecisions(), getCheck(issue.key), base || siteUrl()]);
  const meta = issueMeta(issue, url);
  const acknowledged = prev?.acknowledged || [];
  const result = checkWork(
    { text: issueText(issue), projectKey: meta.projectKey, labels: meta.labels, issueKey: issue.key },
    all,
    { acknowledged },
  );
  const record = { ...result, issue: meta, acknowledged };
  await saveCheck(issue.key, record);
  const prop = propertyFor(result);
  const prevProp = prev ? propertyFor(prev) : null;
  if (!prevProp || prevProp.status !== prop.status || prevProp.decisions !== prop.decisions || prevProp.conflictCount !== prop.conflictCount) {
    await setIssueProperty(issue.key, prop);
  }
  return record;
}

/** Re-check many issues: everything checked before plus anything matching `jql`. */
export async function recheck({ jql = 'updated >= -90d ORDER BY updated DESC', max = 100 } = {}) {
  const [decisions, base, previous] = await Promise.all([listDecisions(), siteUrl(), listChecks()]);
  const issues = await searchIssues(jql, { max });
  const seen = new Set(issues.map((i) => i.key));
  let checked = 0;
  let conflicts = 0;
  for (const issue of issues) {
    // eslint-disable-next-line no-await-in-loop
    const r = await checkIssue(issue, { decisions, base });
    checked++;
    if (r.status === 'conflict') conflicts++;
  }
  // issues checked earlier that fell outside the JQL window still deserve fresh results
  for (const p of previous) {
    if (seen.has(p.issue?.key)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await checkIssue(p.issue.key, { decisions, base });
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
