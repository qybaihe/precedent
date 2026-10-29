// Product event triggers and the background job consumer.

import { checkIssue, recheck, enqueueRecheck, jobs } from './lib/checker.js';
import { harvestConfluencePage, harvestJiraComment } from './lib/harvest.js';
import { getSettings, deleteCheck, listDecisions, listChecks } from './lib/store.js';
import { recentPageIds, siteUrl, decisionLogUrl } from './lib/products.js';
import { refreshInbox } from './inbox.js';
import { syncDecisionsToGraph } from './lib/graph.js';

const CONTENT_FIELDS = new Set(['summary', 'description', 'labels', 'components', 'Component']);

/** Jira work item created/updated: re-check it when its text or labels changed. Deleted: forget it. */
export async function onJiraIssue(event) {
  const key = event.issue?.key;
  if (!key) return;
  if (event.eventType === 'avi:jira:deleted:issue') {
    await deleteCheck(key);
    console.log(`forgot deleted ${key}`);
    return;
  }
  if (event.eventType === 'avi:jira:updated:issue') {
    const items = event.changelog?.items || [];
    if (items.length && !items.some((i) => CONTENT_FIELDS.has(i.field) || CONTENT_FIELDS.has(i.fieldId))) return;
  }
  const r = await checkIssue(key);
  console.log(`checked ${key}: ${r.status} (${r.conflicts.length} conflicts, ${r.related.length} related)`);
}

/** Jira comment: harvest "Decision: ..." comments. */
export async function onJiraComment(event) {
  const settings = await getSettings();
  if (!settings.harvestJiraComments) return;
  const issueKey = event.issue?.key;
  const commentId = event.comment?.id;
  if (!issueKey || !commentId) return;
  const d = await harvestJiraComment(issueKey, commentId);
  if (d) {
    console.log(`harvested ${d.id} from ${issueKey} comment ${commentId}`);
    await enqueueRecheck();
  }
}

/** Confluence page created/updated: harvest decision items and decision pages. */
export async function onConfluencePage(event) {
  const settings = await getSettings();
  if (!settings.harvestConfluence) return;
  const id = event.content?.id;
  if (!id) return;
  const r = await harvestConfluencePage(id);
  // decisions written in prose ("we agreed to…") wait in the Decision Inbox
  const inbox = await refreshInbox(id).catch((e) => console.warn(`inbox for page ${id}: ${e.message}`));
  console.log(`harvested page ${id}: +${r.created} new, ${r.updated} updated, ${r.archived} archived${inbox ? `, ${inbox} in the inbox` : ''}`);
  if (r.created || r.archived || r.updated) await enqueueRecheck();
}

async function syncGraph() {
  try {
    const [decisions, checks, base] = await Promise.all([listDecisions(), listChecks(), siteUrl()]);
    await syncDecisionsToGraph(decisions, checks, { logUrl: decisionLogUrl(base) });
  } catch (e) {
    console.warn(`teamwork graph sync failed: ${e.message}`);
  }
}

/** Async job consumer (queue: precedent-jobs). */
export async function runJob(event) {
  const body = event.body || {};
  if (body.type === 'recheck') {
    const r = await recheck(body.jql ? { jql: body.jql } : {});
    console.log(`recheck done: ${r.checked} checked, ${r.conflicts} in conflict`);
    // decisions or their conflicts changed: refresh the Teamwork Graph copy
    await syncGraph();
  } else if (body.type === 'graph-sync') {
    await syncGraph();
  } else if (body.type === 'scan-confluence') {
    const ids = await recentPageIds(body.limit || 50);
    let created = 0;
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await harvestConfluencePage(id);
        created += r.created;
        // eslint-disable-next-line no-await-in-loop
        await refreshInbox(id);
      } catch (e) {
        console.warn(`scan: page ${id} skipped: ${e.message}`);
      }
    }
    console.log(`confluence scan: ${ids.length} pages, ${created} new decisions`);
    await jobs.push({ body: { type: 'recheck' } });
  }
}

/** Daily safety net: re-check recent work so long-running conflicts stay visible. */
export async function dailySweep() {
  await enqueueRecheck('updated >= -7d ORDER BY updated DESC');
}
