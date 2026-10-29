// Precedent inside Jira's own flows:
//   - the "Already decided" hint under the summary in the Create dialog (jira:uiModifications)
//   - a workflow validator that blocks a transition (e.g. to Done) while the work item still
//     contradicts an active decision (jira:workflowValidator)

import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { checkIssue } from './lib/checker.js';
import { listDecisions, getCheck } from './lib/store.js';
import { listProjects } from './lib/products.js';

const UIM_KEY = 'meta:uim';
/** Register the Create-dialog modification for every project (one context per project). */
export async function enableCreateHints() {
  const projects = (await listProjects()).filter((p) => p.type !== 'service_desk');
  const contexts = projects.map((p) => ({ projectId: p.id, issueTypeId: null, viewType: 'GIC' }));
  const body = { name: 'Precedent: already decided', description: 'Shows under the summary when a new work item contradicts a team decision.', data: '{}', contexts };
  const existing = await kvs.get(UIM_KEY);
  let id = existing?.id;
  if (id) {
    const res = await api.asApp().requestJira(route`/rest/api/3/uiModifications/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 404) id = null;
    else if (!res.ok) throw new Error(`update UI modification: ${res.status} ${await res.text()}`);
  }
  if (!id) {
    const res = await api.asApp().requestJira(route`/rest/api/3/uiModifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`create UI modification: ${res.status} ${await res.text()}`);
    id = (await res.json()).id;
  }
  const saved = { id, projects: projects.map((p) => p.key), at: new Date().toISOString() };
  await kvs.set(UIM_KEY, saved);
  return saved;
}

export async function createHintsStatus() {
  return (await kvs.get(UIM_KEY)) || null;
}

/**
 * Workflow validator ("No unresolved decision conflicts"). Uses the stored check (kept fresh by the
 * issue trigger) so the transition stays fast; checks now if the work item was never checked.
 */
export async function validateTransition(args) {
  const key = args?.issue?.key;
  if (!key) return { result: true };
  try {
    const check = (await getCheck(key)) || (await checkIssue(key, { decisions: await listDecisions() }));
    const open = (check.conflicts || []).filter((c) => !c.acknowledged);
    if (!open.length) return { result: true };
    const first = open[0];
    const list = open.map((c) => c.decision.id).join(', ');
    return {
      result: false,
      errorMessage: `Blocked by Precedent: ${key} contradicts ${list} (“${first.decision.title}”, mentions ${(first.terms || [first.term]).join(', ')}). Apply the compliant alternative in the Precedent panel, log an exception, or supersede the decision.`.slice(0, 500),
    };
  } catch (e) {
    console.warn(`validator for ${key} failed: ${e.message}`);
    return { result: true }; // never trap work behind an outage
  }
}
