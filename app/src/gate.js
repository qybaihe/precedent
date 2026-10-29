// Precedent inside Jira's own flows:
//   - the "Already decided" hint under the summary in the Create dialog (jira:uiModifications)
//   - a workflow validator that blocks a transition (e.g. to Done) while the work item still
//     contradicts an active decision (jira:workflowValidator)

import api, { route, getAppContext } from '@forge/api';
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

/**
 * Add the validator to every transition into a Done-category status, in the workflows of the given
 * projects. Runs as the admin who clicks (workflow changes need Administer
 * Jira or project admin); system workflows that can't be edited are skipped.
 */
export async function gateableProjects() {
  return (await listProjects()).filter((x) => x.type !== 'service_desk').map((p) => ({ id: p.id, key: p.key }));
}

/** `projectIds`: the projects to do in this call (the UI goes through them a few at a time). */
export async function enableDoneGate(projectIds) {
  const app = getAppContext();
  const ruleKey = 'forge:expression-validator';
  const key = `ari:cloud:ecosystem::extension/${app.appAri.appId}/${app.environmentAri.environmentId}/static/precedent-no-conflicts`;
  const call = async (path, body) => {
    const res = await api.asUser().requestJira(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const prev = (await kvs.get('meta:doneGate')) || { workflows: [], skipped: [] };
  const done = new Map(prev.workflows.map((w) => [w.id, w])); // workflow id -> { id, name, transitions }
  const skipped = [];
  const wanted = new Set((projectIds || []).map(String));
  for (const p of (await gateableProjects()).filter((x) => !wanted.size || wanted.has(String(x.id)))) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const types = await call(route`/rest/api/3/issuetype/project?projectId=${p.id}`);
      // eslint-disable-next-line no-await-in-loop
      const r = await call(route`/rest/api/3/workflows?expand=values.transitions`, { projectAndIssueTypes: types.map((t) => ({ projectId: p.id, issueTypeId: t.id })) });
      const doneRefs = new Set(r.statuses.filter((s) => s.statusCategory === 'DONE').map((s) => s.statusReference));
      for (const w of r.workflows) {
        if (w.isEditable === false) continue;
        const gated = w.transitions.filter((t) => doneRefs.has(t.toStatusReference) && t.type !== 'INITIAL');
        const missing = gated.filter((t) => !(t.validators || []).some((v) => v.parameters?.key === key));
        if (missing.length) {
          for (const t of missing) t.validators = [...(t.validators || []), { ruleKey, parameters: { key, config: '{}', disabled: 'false', tag: '' } }];
          const statuses = r.statuses.filter((s) => w.statuses.some((x) => x.statusReference === s.statusReference)).map(({ id, name, statusReference, statusCategory, description }) => ({ id, name, statusReference, statusCategory, description }));
          // eslint-disable-next-line no-await-in-loop
          await call(route`/rest/api/3/workflows/update`, { statuses, workflows: [{ id: w.id, version: w.version, description: w.description || '', statuses: w.statuses, transitions: w.transitions, ...(w.startPointLayout ? { startPointLayout: w.startPointLayout } : {}) }] });
        }
        done.set(w.id, { id: w.id, name: w.name, transitions: gated.length });
      }
    } catch (e) {
      skipped.push(`${p.key}: ${e.message}`);
    }
  }
  const saved = { workflows: [...done.values()], skipped: [...prev.skipped.filter((x) => !skipped.some((y) => y.split(':')[0] === x.split(':')[0])), ...skipped].slice(-20), at: new Date().toISOString() };
  await kvs.set('meta:doneGate', saved);
  return saved;
}

export async function doneGateStatus() {
  return (await kvs.get('meta:doneGate')) || null;
}
