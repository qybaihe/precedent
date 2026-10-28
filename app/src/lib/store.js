// Persistence for the decision register, built on Forge Key-Value Storage.
//
// Keys:
//   decision:<DEC-n>      full decision record
//   source:<sourceKey>    maps an origin (Confluence decision item, Jira comment) to its DEC id
//   check:<ISSUE-KEY>     latest conflict check result for a Jira work item
//   meta:seq              last allocated decision number
//   meta:settings         app settings

import { kvs, WhereConditions } from '@forge/kvs';
import { extractGuardrails, termsFromList } from './guardrails.js';

const PREFIX = { decision: 'decision:', source: 'source:', check: 'check:' };

async function listByPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** KVS keys allow a limited character set; Confluence local ids and comment ids fit after this. */
function safeKey(raw) {
  return String(raw).replace(/[^a-zA-Z0-9:._#-]/g, '_').slice(0, 400);
}

async function nextDecisionId() {
  // Allocate DEC-n. Concurrent triggers could race on the counter, so verify the slot is free.
  let n = ((await kvs.get('meta:seq')) || 0) + 1;
  // eslint-disable-next-line no-await-in-loop
  while (await kvs.get(`${PREFIX.decision}DEC-${n}`)) n += 1;
  await kvs.set('meta:seq', n);
  return `DEC-${n}`;
}

export async function listDecisions() {
  const all = await listByPrefix(PREFIX.decision);
  return all.sort((a, b) => Number(b.id.split('-')[1]) - Number(a.id.split('-')[1]));
}

export async function getDecision(id) {
  if (!id) return null;
  const clean = String(id).trim().toUpperCase().replace(/^DEC\s*-?\s*/, 'DEC-');
  return (await kvs.get(`${PREFIX.decision}${clean}`)) || null;
}

export async function saveDecision(decision) {
  const now = new Date().toISOString();
  const record = { ...decision, updatedAt: now };
  await kvs.set(`${PREFIX.decision}${record.id}`, record);
  return record;
}

/** Compute guardrails from the statement unless the user curated them by hand. */
export function withGuardrails(decision, { avoid, prefer } = {}) {
  const auto = extractGuardrails(`${decision.statement}`);
  const manualAvoid = avoid !== undefined && avoid !== null && String(avoid).trim() !== '';
  const manualPrefer = prefer !== undefined && prefer !== null && String(prefer).trim() !== '';
  return {
    ...decision,
    guardrails: {
      avoid: manualAvoid ? termsFromList(avoid) : auto.avoid,
      prefer: manualPrefer ? termsFromList(prefer) : auto.prefer,
      curated: manualAvoid || manualPrefer || Boolean(decision.guardrails?.curated),
    },
  };
}

/**
 * Create a decision, or update the one previously harvested from the same source.
 * Harvested updates never overwrite fields a human curated (status, guardrails, links, exceptions).
 */
export async function upsertFromSource(sourceKey, fields) {
  const key = `${PREFIX.source}${safeKey(sourceKey)}`;
  const existingId = await kvs.get(key);
  const existing = existingId ? await getDecision(existingId) : null;
  const now = new Date().toISOString();

  if (existing) {
    const merged = {
      ...existing,
      title: fields.title || existing.title,
      statement: fields.statement || existing.statement,
      rationale: fields.rationale ?? existing.rationale,
      owner: fields.owner || existing.owner,
      decidedAt: existing.decidedAt || fields.decidedAt,
      source: { ...existing.source, ...fields.source },
      tags: [...new Set([...(existing.tags || []), ...(fields.tags || [])])],
      status: existing.statusLocked ? existing.status : fields.status || existing.status,
    };
    const changed = merged.statement !== existing.statement;
    const record = changed && !existing.guardrails?.curated ? withGuardrails(merged) : merged;
    return { decision: await saveDecision(record), created: false };
  }

  const id = await nextDecisionId();
  const record = withGuardrails({
    id,
    status: 'active',
    tags: [],
    links: [],
    exceptions: [],
    history: [{ at: now, what: `Captured from ${fields.source?.label || 'source'}` }],
    createdAt: now,
    ...fields,
    decidedAt: fields.decidedAt || now,
    sourceKey,
  });
  await kvs.set(key, id);
  return { decision: await saveDecision(record), created: true };
}

/** Decisions previously harvested from a source prefix (e.g. one Confluence page). */
export async function decisionsFromSourcePrefix(prefix) {
  const all = await listDecisions();
  return all.filter((d) => d.sourceKey && d.sourceKey.startsWith(prefix));
}

export async function createDecision(fields, { avoid, prefer } = {}) {
  const now = new Date().toISOString();
  const id = await nextDecisionId();
  const record = withGuardrails(
    {
      id,
      status: 'active',
      tags: [],
      links: [],
      exceptions: [],
      createdAt: now,
      history: [{ at: now, what: `Recorded via ${fields.source?.label || 'Precedent'}` }],
      ...fields,
      decidedAt: fields.decidedAt || now,
    },
    { avoid, prefer },
  );
  if (fields.sourceKey) await kvs.set(`${PREFIX.source}${safeKey(fields.sourceKey)}`, id);
  return saveDecision(record);
}

export async function deleteDecision(id) {
  const d = await getDecision(id);
  if (!d) return;
  await kvs.delete(`${PREFIX.decision}${d.id}`);
  if (d.sourceKey) await kvs.delete(`${PREFIX.source}${safeKey(d.sourceKey)}`);
}

// ---------- checks ----------

export async function saveCheck(issueKey, result) {
  await kvs.set(`${PREFIX.check}${issueKey}`, result);
  return result;
}

export async function getCheck(issueKey) {
  return (await kvs.get(`${PREFIX.check}${issueKey}`)) || null;
}

export async function listChecks() {
  return listByPrefix(PREFIX.check);
}

// ---------- settings ----------

const DEFAULT_SETTINGS = { commentOnConflict: false, harvestJiraComments: true, harvestConfluence: true };

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await kvs.get('meta:settings')) || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await kvs.set('meta:settings', next);
  return next;
}

export async function resetAll() {
  for (const prefix of [PREFIX.decision, PREFIX.source, PREFIX.check]) {
    let cursor;
    do {
      let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) q = q.cursor(cursor);
      // eslint-disable-next-line no-await-in-loop
      const page = await q.getMany();
      // eslint-disable-next-line no-await-in-loop
      for (const r of page.results) await kvs.delete(r.key);
      cursor = page.nextCursor;
    } while (cursor);
  }
  await kvs.delete('meta:seq');
}
