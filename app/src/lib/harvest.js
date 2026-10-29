// Harvesting: discover decisions where teams already write them down.
//   - Confluence: native decision items ("/decision") and pages built from the Decision template
//   - Jira: comments that start with "Decision:"

import { extractDecisionItems, parseDecisionTemplate, extractCommentDecision, titleFrom, dateFromTitle } from './adf.js';
import { getPage, getPageLabels, getSpace, siteUrl, getIssue, getComment, issueMeta } from './products.js';
import { upsertFromSource, decisionsFromSourcePrefix, saveDecision } from './store.js';

export function pageUrl(page, base) {
  const webui = page._links?.webui || `/spaces/${page.spaceId}/pages/${page.id}`;
  const wikiBase = page._links?.base || `${base}/wiki`;
  return `${wikiBase}${webui}`;
}

/** Harvest every decision on a Confluence page. Returns { created, updated, archived, decisions }. */
export async function harvestConfluencePage(pageId) {
  const page = await getPage(pageId);
  if (!page || page.status !== 'current') return { created: 0, updated: 0, archived: 0, decisions: [] };
  const adf = JSON.parse(page.body?.atlas_doc_format?.value || '{"content":[]}');
  const [labels, space, base] = await Promise.all([getPageLabels(pageId), getSpace(page.spaceId), siteUrl()]);
  const url = pageUrl(page, base);
  const source = {
    type: 'confluence',
    label: 'Confluence',
    title: page.title,
    url,
    pageId: String(page.id),
    spaceKey: space?.key || null,
    spaceName: space?.name || null,
  };
  const tags = labels.filter((l) => !/^(decision|decisions|adr)$/i.test(l));

  const found = [];
  let created = 0;
  let updated = 0;

  // Decision template pages ("Outcome" row) become one decision titled after the page.
  const template = parseDecisionTemplate(adf);
  if (template) {
    const res = await upsertFromSource(`confluence:${page.id}:page`, {
      title: page.title.replace(/^decision\s*[:–-]\s*/i, ''),
      statement: template.statement,
      rationale: template.rationale,
      status: template.status,
      owner: template.ownerName ? { name: template.ownerName, accountId: template.ownerAccountId } : null,
      decidedAt: template.decidedAt || dateFromTitle(page.title) || page.createdAt,
      source: { ...source, kind: 'Decision page' },
      tags,
    });
    found.push(res.decision);
    res.created ? created++ : updated++;
  }

  // Inline decision items, typically in meeting notes.
  for (const item of extractDecisionItems(adf)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await upsertFromSource(`confluence:${page.id}:${item.localId}`, {
      title: titleFrom(item.statement),
      statement: item.statement,
      rationale: item.rationale,
      owner: item.ownerName ? { name: item.ownerName, accountId: item.ownerAccountId } : null,
      decidedAt: item.decidedAt || dateFromTitle(page.title) || page.createdAt,
      source: { ...source, kind: 'Decision in meeting notes', heading: item.heading },
      tags,
    });
    found.push(res.decision);
    res.created ? created++ : updated++;
  }

  // Decisions deleted from the page are archived (kept for history, no longer enforced).
  let archived = 0;
  const keep = new Set(found.map((d) => d.id));
  for (const d of await decisionsFromSourcePrefix(`confluence:${page.id}:`)) {
    if (!keep.has(d.id) && d.status === 'active' && !d.statusLocked) {
      // eslint-disable-next-line no-await-in-loop
      await saveDecision({
        ...d,
        status: 'archived',
        history: [...(d.history || []), { at: new Date().toISOString(), what: 'Removed from the source page' }],
      });
      archived++;
    }
  }
  return { created, updated, archived, decisions: found };
}

/** Harvest "Decision: ..." from a Jira comment. Returns the decision or null. */
export async function harvestJiraComment(issueKey, commentId) {
  const comment = await getComment(issueKey, commentId);
  const statement = extractCommentDecision(comment.body);
  if (!statement) return null;
  const [issue, base] = await Promise.all([getIssue(issueKey), siteUrl()]);
  const meta = issueMeta(issue, base);
  const res = await upsertFromSource(`jira-comment:${issueKey}:${commentId}`, {
    title: titleFrom(statement),
    statement,
    rationale: `Recorded in a comment on ${issueKey}: ${meta.summary}`,
    owner: comment.author ? { name: comment.author.displayName, accountId: comment.author.accountId } : null,
    decidedAt: comment.created,
    source: {
      type: 'jira',
      label: 'Jira comment',
      kind: 'Decision in a Jira comment',
      title: `${issueKey} · ${meta.summary}`,
      url: `${base}/browse/${issueKey}?focusedCommentId=${commentId}`,
      issueKey,
    },
    scope: { projects: [meta.projectKey] },
    tags: meta.labels,
    links: [issueKey],
  });
  return res.decision;
}
