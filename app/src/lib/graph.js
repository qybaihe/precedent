// Teamwork Graph connector: every DEC-n becomes a document in Atlassian's Teamwork Graph, so Rovo
// Search, Rovo agents and anything else built on the graph can find what the team decided.
// Data only flows from Forge storage into the graph (an Atlassian service): no egress.
//
// An org admin creates the connection once (Atlassian Administration → Apps → Sites → site →
// Connected apps → Precedent → Connections → Connect). Precedent keeps the graph in sync after
// every decision change (the same background job that re-checks work items).

import { graph } from '@forge/teamwork-graph';
import { kvs } from '@forge/kvs';
import { outdated, reviewDate } from './health.js';

const CONNECTIONS = 'meta:twgConnections';
const LAST_SYNC = 'meta:twgLastSync';

export async function graphConnections() {
  return (await kvs.get(CONNECTIONS)) || [];
}

export async function lastGraphSync() {
  return (await kvs.get(LAST_SYNC)) || null;
}

/** graph:connector lifecycle: remember connection ids; Atlassian deletes the data of a removed connection. */
export async function onConnectionChange(request) {
  try {
    const list = (await graphConnections()).filter((c) => c.connectionId !== request.connectionId);
    if (request.action !== 'DELETED') list.push({ connectionId: request.connectionId, name: request.name || 'Precedent decisions', at: new Date().toISOString() });
    await kvs.set(CONNECTIONS, list);
    console.log(`teamwork graph connection ${request.action}: ${request.connectionId}`);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

/** One decision as a Teamwork Graph document: the text says everything a search or agent needs. */
export function decisionDocument(d, { conflicts = [], logUrl }) {
  const g = d.guardrails || {};
  const stale = outdated(d);
  const lines = [
    `${d.id}: ${d.title}`,
    `Decision: ${d.statement}`,
    d.rationale ? `Why: ${d.rationale}` : null,
    `Status: ${d.status}${stale.possibly ? ' (possibly outdated)' : ''}`,
    d.owner?.name ? `Owner: ${d.owner.name}` : null,
    d.decidedAt ? `Decided on: ${day(d.decidedAt)}` : null,
    reviewDate(d) ? `Revisit by: ${day(reviewDate(d))}` : null,
    (g.avoid || []).length ? `Avoid: ${g.avoid.map((t) => t.text).join(', ')}` : null,
    (g.prefer || []).length ? `Prefer: ${g.prefer.map((t) => t.text).join(', ')}` : null,
    (d.assumptions || []).length ? `Assumptions: ${d.assumptions.map((a) => `${a.text}${a.status === 'changed' ? ' (no longer holds)' : ''}`).join('; ')}` : null,
    stale.possibly ? `Possibly outdated because: ${stale.reasons.join('; ')}` : null,
    d.supersededBy ? `Superseded by: ${d.supersededBy}` : null,
    d.supersedes ? `Supersedes: ${d.supersedes}` : null,
    conflicts.length ? `Contradicted by Jira work items: ${conflicts.join(', ')}` : null,
    d.source?.title ? `Source: ${d.source.title}${d.source.url ? ` (${d.source.url})` : ''}` : null,
    (d.tags || []).length ? `Tags: ${d.tags.join(', ')}` : null,
  ].filter(Boolean);
  const updated = d.updatedAt || d.createdAt || new Date().toISOString();
  return {
    schemaVersion: '1.0',
    id: d.id,
    updateSequenceNumber: new Date(updated).getTime(),
    displayName: `${d.id} · ${d.title}`,
    description: d.statement.slice(0, 250),
    url: d.source?.url || logUrl,
    createdAt: d.createdAt || d.decidedAt || updated,
    lastUpdatedAt: updated,
    // the register is visible to everyone who can use the app on this site, so is the graph copy
    permissions: [{ accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] }],
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: lines.join('\n') },
      labels: ['decision', d.status, ...(d.tags || [])].slice(0, 10),
    },
  };
}

/** Push every decision to every Teamwork Graph connection (100 objects per call). */
export async function syncDecisionsToGraph(decisions, checks, { logUrl } = {}) {
  const connections = await graphConnections();
  if (!connections.length) return { connections: 0 };
  const conflictsOf = {};
  for (const c of checks) for (const x of c.conflicts) if (!x.acknowledged) (conflictsOf[x.decision.id] ||= []).push(c.issue.key);
  const objects = decisions.map((d) => decisionDocument(d, { conflicts: conflictsOf[d.id] || [], logUrl }));
  const result = { at: new Date().toISOString(), connections: connections.length, objects: objects.length, accepted: 0, rejected: [], error: null };
  for (const { connectionId } of connections) {
    for (let i = 0; i < objects.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const r = await graph.setObjects({ objects: objects.slice(i, i + 100), connectionId });
      result.accepted += r.results?.accepted?.length || 0;
      result.rejected.push(...(r.results?.rejected || []).map((x) => `${x.key?.entityId}: ${x.errors?.map((e) => e.message).join('; ')}`));
      if (!r.success && r.error) result.error = r.error;
    }
  }
  result.rejected = result.rejected.slice(0, 10);
  await kvs.set(LAST_SYNC, result);
  console.log(`teamwork graph sync: ${result.accepted}/${objects.length * connections.length} accepted${result.error ? `, error: ${result.error}` : ''}`);
  return result;
}
