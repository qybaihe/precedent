// Assumption tripwires: machine-checkable conditions that say when a premise stops holding.
//
//   { kind: 'jql', jql: 'project = PAY AND labels = perf AND created >= -30d', op: '>', threshold: 5 }
//   { kind: 'date', date: '2027-01-31' }                       holds until that day
//   { kind: 'issue', issueKey: 'PAY-42' }                      holds until that work item is done
//
// A scheduled job measures each one (JQL count, today's date, the work item's status category)
// and, when it trips, marks the assumption as no longer holding: the decision becomes "possibly
// outdated" and needs review. Pure helpers here; the Jira calls live in checker.js.

const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b };
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/** Validate a tripwire from a form or agent. Returns { tripwire } or { error }. */
export function normalizeTripwire(input) {
  if (!input || !input.kind) return { tripwire: null };
  if (input.kind === 'jql') {
    const jql = String(input.jql || '').trim().slice(0, 500);
    const threshold = Number(input.threshold);
    const op = OPS[input.op] ? input.op : '>';
    if (!jql) return { error: 'Add the JQL query to count.' };
    if (!Number.isFinite(threshold) || threshold < 0) return { error: 'The threshold must be a number.' };
    return { tripwire: { kind: 'jql', jql, op, threshold } };
  }
  if (input.kind === 'date') {
    const d = new Date(input.date);
    if (Number.isNaN(d.getTime())) return { error: 'Pick a date.' };
    return { tripwire: { kind: 'date', date: d.toISOString().slice(0, 10) } };
  }
  if (input.kind === 'issue') {
    const issueKey = String(input.issueKey || '').trim().toUpperCase();
    if (!ISSUE_KEY.test(issueKey)) return { error: 'Use a work item key like PAY-42.' };
    return { tripwire: { kind: 'issue', issueKey } };
  }
  return { error: `Unknown tripwire kind “${input.kind}”.` };
}

/** "more than 5 work items match …", "after Jan 31, 2027", "once PAY-42 is done" */
export function describeTripwire(tw) {
  if (!tw) return '';
  if (tw.kind === 'jql') {
    const words = { '>': 'more than', '>=': 'at least', '<': 'fewer than', '<=': 'at most' };
    return `Trips when ${words[tw.op]} ${tw.threshold} work items match ${tw.jql}`;
  }
  if (tw.kind === 'date') return `Trips after ${new Date(`${tw.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  if (tw.kind === 'issue') return `Trips once ${tw.issueKey} is done`;
  return '';
}

/**
 * Decide from a measurement. `m`: { count } for jql, { now } for date, { statusCategory, status }
 * for issue. Returns { tripped, value, detail }.
 */
export function evaluateTripwire(tw, m = {}) {
  if (tw.kind === 'jql') {
    const tripped = OPS[tw.op](m.count, tw.threshold);
    return { tripped, value: m.count, detail: `${m.count} work item${m.count === 1 ? '' : 's'} match ${tw.jql} (tripwire: ${tw.op} ${tw.threshold})` };
  }
  if (tw.kind === 'date') {
    const now = new Date(m.now || Date.now());
    const end = new Date(`${tw.date}T23:59:59.999Z`);
    return { tripped: now > end, value: now.toISOString().slice(0, 10), detail: `${tw.date} has passed` };
  }
  if (tw.kind === 'issue') {
    const done = m.statusCategory === 'done';
    return { tripped: done, value: m.status || null, detail: `${tw.issueKey} is ${m.status || (done ? 'done' : 'not done')}` };
  }
  return { tripped: false, value: null, detail: '' };
}

/**
 * Apply one measurement to an assumption: a tripped tripwire marks a holding assumption as
 * changed (once); every run records the last reading. A snoozed tripwire (the team said "holds
 * again" while it was tripped) stays quiet until the condition clears. Returns { assumption, trippedNow }.
 */
export function applyReading(assumption, reading, now = new Date()) {
  const at = new Date(now).toISOString();
  const next = { ...assumption, lastCheck: { at, value: reading.value, tripped: reading.tripped, detail: reading.detail } };
  // someone confirmed it holds although the condition was met: re-arm only once it clears
  if (assumption.snoozed) {
    if (!reading.tripped) delete next.snoozed;
    return { assumption: next, trippedNow: false };
  }
  if (reading.tripped && assumption.status !== 'changed') {
    return { assumption: { ...next, status: 'changed', changedAt: at, note: `Tripwire: ${reading.detail}`, trippedAt: at }, trippedNow: true };
  }
  return { assumption: next, trippedNow: false };
}
