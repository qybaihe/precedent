// Decision Inbox: decisions written in plain prose in meeting notes ("we agreed to…") are found
// whenever a Confluence page is published or edited, and wait here until someone accepts them
// (they become DEC-n), merges them into a decision the register already has, or dismisses them.
// The page byline's "Find decisions on this page" reads the same candidates on demand.

import { kvs, WhereConditions } from '@forge/kvs';
import { findDecisionCandidates } from './lib/extract.js';
import { listDecisions, getDecision, saveDecision, createDecision } from './lib/store.js';
import { getPage, siteUrl } from './lib/products.js';
import { pageUrl } from './lib/harvest.js';
import { dateFromTitle } from './lib/adf.js';
import { enqueueRecheck } from './lib/checker.js';

export const NOTES_PREFIX = (pageId) => `confluence-notes:${pageId}:`;
const INBOX = (pageId) => `inbox:${pageId}`;
const DISMISSED = (pageId) => `inbox-dismissed:${pageId}`;

/** Every decision-like statement on a page, marked when the register already has it. */
export async function pageCandidates(pageId) {
  const [page, existing] = await Promise.all([getPage(pageId), listDecisions()]);
  const adf = JSON.parse(page.body?.atlas_doc_format?.value || '{"content":[]}');
  const tracked = new Set(existing.filter((d) => d.sourceKey?.startsWith(NOTES_PREFIX(pageId))).map((d) => d.sourceKey));
  const candidates = findDecisionCandidates(adf, { existing: existing.filter((d) => d.status === 'active') }).map((c) => {
    if (c.duplicateOf || !tracked.has(`${NOTES_PREFIX(pageId)}${c.key}`)) return c;
    return { ...c, duplicateOf: existing.find((d) => d.sourceKey === `${NOTES_PREFIX(pageId)}${c.key}`)?.id || 'tracked' };
  });
  return { page, candidates, existing };
}

/** Turn candidates found on `page` into decisions. */
export async function recordCandidates(page, candidates, accountId) {
  const base = await siteUrl();
  const recorded = [];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const d = await createDecision({
      title: c.title,
      statement: c.statement,
      owner: c.ownerName ? { name: c.ownerName, accountId: c.ownerAccountId || undefined } : null,
      decidedAt: dateFromTitle(page.title) || page.createdAt,
      createdBy: accountId,
      sourceKey: `${NOTES_PREFIX(page.id)}${c.key}`,
      source: { type: 'confluence', label: 'Confluence', kind: 'Found in meeting notes', title: page.title, url: pageUrl(page, base), pageId: String(page.id), heading: c.heading || undefined },
      history: [{ at: new Date().toISOString(), what: `Found in meeting notes (${c.reason}) and confirmed`, by: accountId }],
    });
    recorded.push(d);
  }
  if (recorded.length) await enqueueRecheck();
  return recorded;
}

/** Re-read a page into the inbox (Confluence trigger and scans). */
export async function refreshInbox(pageId) {
  const { page, candidates, existing } = await pageCandidates(pageId);
  const dismissed = new Set((await kvs.get(DISMISSED(pageId))) || []);
  // decisions already captured from this very page (as /decision items or accepted from here)
  const fromPage = new Set(existing.filter((d) => d.source?.pageId === String(page.id)).map((d) => d.id));
  const open = candidates
    .filter((c) => !dismissed.has(c.key) && c.duplicateOf !== 'tracked' && !fromPage.has(c.duplicateOf))
    // a likely duplicate of a decision made elsewhere: only when clearly a decision, so it can be merged
    .filter((c) => !c.duplicateOf || c.confidence === 'high')
    .map(({ key, statement, title, confidence, reason, heading, ownerName, ownerAccountId, duplicateOf, guardrails }) => ({ key, statement, title, confidence, reason, heading, ownerName, ownerAccountId, duplicateOf, guardrails }));
  if (!open.length) {
    await kvs.delete(INBOX(pageId));
    return 0;
  }
  const base = await siteUrl();
  await kvs.set(INBOX(pageId), { pageId: String(page.id), title: page.title, url: pageUrl(page, base), at: new Date().toISOString(), items: open });
  return open.length;
}

export async function listInbox() {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith('inbox:')).limit(100);
    if (cursor) q = q.cursor(cursor);
    // eslint-disable-next-line no-await-in-loop
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

async function dropFromInbox(pageId, keys) {
  const entry = await kvs.get(INBOX(pageId));
  if (!entry) return;
  const items = entry.items.filter((i) => !keys.includes(i.key));
  if (items.length) await kvs.set(INBOX(pageId), { ...entry, items });
  else await kvs.delete(INBOX(pageId));
}

/** Accept: record the picked candidates as decisions (re-read from the page, never from the client). */
export async function acceptFromInbox(pageId, keys, accountId) {
  const { page, candidates } = await pageCandidates(pageId);
  const picked = candidates.filter((c) => keys.includes(c.key) && c.duplicateOf !== 'tracked');
  const recorded = await recordCandidates(page, picked, accountId);
  await dropFromInbox(pageId, keys);
  return recorded;
}

/** Dismiss: not a decision (or not worth tracking); it won't come back for this page. */
export async function dismissFromInbox(pageId, key) {
  const list = new Set((await kvs.get(DISMISSED(pageId))) || []);
  list.add(key);
  await kvs.set(DISMISSED(pageId), [...list].slice(-200));
  await dropFromInbox(pageId, [key]);
}

/** Merge: the register already has this decision; note where else it was (re)affirmed. */
export async function mergeFromInbox(pageId, key, intoId, accountId) {
  const entry = await kvs.get(INBOX(pageId));
  const item = entry?.items.find((i) => i.key === key);
  const d = await getDecision(intoId);
  if (!item || !d) return { error: 'Not found' };
  await saveDecision({
    ...d,
    history: [...(d.history || []), { at: new Date().toISOString(), kind: 'review', what: `Reaffirmed in “${entry.title}”: “${item.statement}”`, by: accountId }],
    reviewedAt: new Date().toISOString(),
  });
  await dismissFromInbox(pageId, key);
  return { merged: intoId };
}
