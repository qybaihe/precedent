import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTripwire, describeTripwire, evaluateTripwire, applyReading } from '../src/lib/tripwire.js';
import { outdated } from '../src/lib/health.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const PERF = { kind: 'jql', jql: 'project = PAY AND labels = perf AND created >= -30d', op: '>', threshold: 5 };

test('normalizeTripwire validates each kind', () => {
  assert.deepEqual(normalizeTripwire({ kind: 'jql', jql: ' project = PAY ', threshold: '5' }), { tripwire: { kind: 'jql', jql: 'project = PAY', op: '>', threshold: 5 } });
  assert.match(normalizeTripwire({ kind: 'jql', jql: '', threshold: 5 }).error, /JQL/);
  assert.match(normalizeTripwire({ kind: 'jql', jql: 'x', threshold: 'lots' }).error, /number/);
  assert.deepEqual(normalizeTripwire({ kind: 'date', date: '2027-01-31' }), { tripwire: { kind: 'date', date: '2027-01-31' } });
  assert.deepEqual(normalizeTripwire({ kind: 'issue', issueKey: 'pay-42' }), { tripwire: { kind: 'issue', issueKey: 'PAY-42' } });
  assert.match(normalizeTripwire({ kind: 'issue', issueKey: 'nope' }).error, /PAY-42/);
  assert.deepEqual(normalizeTripwire(null), { tripwire: null });
});

test('describe and evaluate', () => {
  assert.equal(describeTripwire(PERF), 'Trips when more than 5 work items match project = PAY AND labels = perf AND created >= -30d');
  assert.equal(describeTripwire({ kind: 'date', date: '2027-01-31' }), 'Trips after Jan 31, 2027');
  assert.equal(evaluateTripwire(PERF, { count: 5 }).tripped, false);
  const six = evaluateTripwire(PERF, { count: 6 });
  assert.equal(six.tripped, true);
  assert.equal(six.detail, '6 work items match project = PAY AND labels = perf AND created >= -30d (tripwire: > 5)');
  assert.equal(evaluateTripwire({ kind: 'date', date: '2026-10-29' }, { now: NOW }).tripped, false, 'holds through the whole day');
  assert.equal(evaluateTripwire({ kind: 'date', date: '2026-10-28' }, { now: NOW }).tripped, true);
  assert.equal(evaluateTripwire({ kind: 'issue', issueKey: 'PAY-42' }, { statusCategory: 'done', status: 'Done' }).detail, 'PAY-42 is Done');
});

test('a tripped tripwire marks the assumption changed once, making the decision possibly outdated', () => {
  const a = { id: 'a1', text: 'Fewer than 5 perf bugs a month', status: 'holds', tripwire: PERF };
  const first = applyReading(a, evaluateTripwire(PERF, { count: 6 }), NOW);
  assert.equal(first.trippedNow, true);
  assert.equal(first.assumption.status, 'changed');
  assert.match(first.assumption.note, /^Tripwire: 6 work items match/);
  const again = applyReading(first.assumption, evaluateTripwire(PERF, { count: 7 }), NOW);
  assert.equal(again.trippedNow, false, 'only trips once');
  assert.equal(again.assumption.lastCheck.value, 7);
  const d = { status: 'active', decidedAt: '2026-10-01T00:00:00Z', assumptions: [first.assumption] };
  assert.equal(outdated(d, NOW).possibly, true);
  assert.match(outdated(d, NOW).reasons[0], /Fewer than 5 perf bugs a month/);
});

test('a snoozed tripwire stays quiet until the condition clears, then re-arms', () => {
  const a = { id: 'a1', text: 'x', status: 'holds', tripwire: PERF, snoozed: true };
  const still = applyReading(a, evaluateTripwire(PERF, { count: 9 }), NOW);
  assert.equal(still.trippedNow, false);
  assert.equal(still.assumption.snoozed, true);
  const cleared = applyReading(still.assumption, evaluateTripwire(PERF, { count: 2 }), NOW);
  assert.equal(cleared.assumption.snoozed, undefined);
  assert.equal(applyReading(cleared.assumption, evaluateTripwire(PERF, { count: 6 }), NOW).trippedNow, true);
});
