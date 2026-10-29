// Runs assumption tripwires (hourly, and on demand from the Decision Log): measures each one in
// Jira, marks tripped assumptions as no longer holding, and tells the decision owner where the
// decision was made. The decision then shows as possibly outdated everywhere (Radar, issue panel,
// agent briefs, Rovo answers) until someone confirms or supersedes it.

import { listDecisions, saveDecision } from './lib/store.js';
import { evaluateTripwire, applyReading } from './lib/tripwire.js';
import { countIssues, getIssue, addPageComment, addComment } from './lib/products.js';
import { enqueueRecheck } from './lib/checker.js';

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function measure(tw) {
  if (tw.kind === 'jql') return { count: await countIssues(tw.jql) };
  if (tw.kind === 'issue') {
    const i = await getIssue(tw.issueKey);
    return { status: i.fields?.status?.name, statusCategory: i.fields?.status?.statusCategory?.key };
  }
  return { now: new Date() };
}

async function tellOwner(d, a, detail) {
  const text = `an assumption behind ${d.id} “${d.title}” no longer holds: “${a.text}” (${detail}). Please review the decision: confirm it (Still valid), or supersede it in Precedent's Decision Log.`;
  try {
    if (d.source?.type === 'confluence' && d.source.pageId) {
      const who = d.owner?.accountId ? `<ac:link><ri:user ri:account-id="${escapeHtml(d.owner.accountId)}" /></ac:link>` : escapeHtml(d.owner?.name || 'Decision owner');
      await addPageComment(d.source.pageId, `<p><strong>Precedent: decision needs review.</strong> ${who}, ${escapeHtml(text)}</p>`);
    } else if (d.source?.issueKey) {
      await addComment(d.source.issueKey, { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Precedent: decision needs review. ', marks: [{ type: 'strong' }] }, { type: 'text', text }] }] });
    }
  } catch (e) {
    console.warn(`could not notify the owner of ${d.id}: ${e.message}`);
  }
}

/** Measure every tripwire (or one decision's). Returns { checked, tripped: [{ id, text, detail }] }. */
export async function runTripwires({ only } = {}) {
  const decisions = await listDecisions();
  const tripped = [];
  let checked = 0;
  for (const d of decisions) {
    if (d.status !== 'active' || (only && d.id !== only)) continue;
    if (!(d.assumptions || []).some((a) => a.tripwire)) continue;
    const history = [...(d.history || [])];
    const assumptions = [];
    for (const a of d.assumptions) {
      if (!a.tripwire) {
        assumptions.push(a);
        continue;
      }
      checked++;
      try {
        // eslint-disable-next-line no-await-in-loop
        const reading = evaluateTripwire(a.tripwire, await measure(a.tripwire));
        const r = applyReading(a, reading);
        assumptions.push(r.assumption);
        if (r.trippedNow) {
          history.push({ at: new Date().toISOString(), kind: 'assumption', what: `Assumption no longer holds: “${a.text}” — tripwire: ${reading.detail}` });
          tripped.push({ id: d.id, text: a.text, detail: reading.detail });
          // eslint-disable-next-line no-await-in-loop
          await tellOwner(d, a, reading.detail);
        }
      } catch (e) {
        assumptions.push({ ...a, lastCheck: { at: new Date().toISOString(), error: e.message.slice(0, 200) } });
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await saveDecision({ ...d, assumptions, history });
  }
  // briefs, the Radar and the Teamwork Graph copy all say "possibly outdated" now
  if (tripped.length) await enqueueRecheck();
  if (checked) console.log(`tripwires: ${checked} checked, ${tripped.length} tripped${tripped.length ? `: ${tripped.map((t) => t.id).join(', ')}` : ''}`);
  return { checked, tripped };
}

/** scheduledTrigger handler */
export async function hourlyTripwires() {
  await runTripwires();
}
