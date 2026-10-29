// The "Already decided" hint shown under the summary in Jira's Create dialog. Plain text: the
// field description doesn't render markup. Pure, so it is unit tested.
import { checkWork } from './check.js';
import { preferredAlternative } from './fix.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

/** A few words for the summary label: "⚠ Already decided in DEC-1". */
export function createFlagFor(hint) {
  const m = /^(⚠|ℹ) (?:Already decided|Related decision): (DEC-\d+)/.exec(hint || '');
  if (!m) return null;
  return m[1] === '⚠' ? `⚠ Already decided in ${m[2]}` : `ℹ See ${m[2]}`;
}

/** The hint shown under the summary while someone creates a work item (plain text). */
export function createHintFor(summary, decisions, projectKey) {
  const r = checkWork({ text: summary, projectKey }, decisions);
  const c = r.conflicts[0];
  if (c) {
    const d = c.decision;
    const who = [d.owner?.name, fmtDate(d.decidedAt)].filter(Boolean).join(', ');
    const more = r.conflicts.length > 1 ? ` (+${r.conflicts.length - 1} more)` : '';
    const prefer = preferredAlternative(d);
    return `⚠ Already decided: ${d.id} “${d.title}” rules out ${c.terms.join(', ')}${who ? ` (${who})` : ''}${more}. ${prefer ? `Use ${prefer} instead, or ask` : 'Ask'} the owner before filing this.`;
  }
  const rel = r.related[0];
  if (rel) return `ℹ Related decision: ${rel.decision.id} “${rel.decision.title}”. Check it before you start.`;
  return '';
}

