import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_DAYS, reviewDate, decisionHealth, teamHealth, gradeFor } from '../src/lib/health.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const GUARDED = { avoid: [{ text: 'MongoDB', tokens: ['mongodb'], required: ['mongodb'] }], prefer: [] };

function decision(extra = {}) {
  return {
    id: 'DEC-1',
    status: 'active',
    owner: { name: 'Priya Shah', accountId: 'acc-priya' },
    guardrails: GUARDED,
    decidedAt: '2026-09-01T00:00:00.000Z',
    exceptions: [],
    ...extra,
  };
}

const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

test('review date: explicit, else last review / decision / creation + 180 days', () => {
  assert.equal(REVIEW_DAYS, 180);
  assert.equal(reviewDate({ reviewBy: '2026-12-01' }), '2026-12-01T00:00:00.000Z');
  assert.equal(reviewDate({ decidedAt: '2025-09-13T00:00:00.000Z' }), '2026-03-12T00:00:00.000Z');
  assert.equal(reviewDate({ reviewedAt: '2026-06-01T00:00:00.000Z', decidedAt: '2025-01-01T00:00:00.000Z' }), '2026-11-28T00:00:00.000Z');
  assert.equal(reviewDate({ createdAt: '2026-01-01T00:00:00.000Z' }), '2026-06-30T00:00:00.000Z');
  assert.equal(reviewDate({}), null);
});

test('a well-kept decision is healthy, and followed work shows as a success signal', () => {
  const h = decisionHealth(decision(), undefined, NOW);
  assert.deepEqual(h, { score: 100, grade: 'healthy', reviewBy: '2027-02-28T00:00:00.000Z', reviewState: 'ok', signals: [] });
  const followed = decisionHealth(decision(), { conflicts: 0, aligned: 4, related: 2 }, NOW);
  assert.equal(followed.score, 100);
  assert.deepEqual(followed.signals, [{ kind: 'aligned', tone: 'success', label: '4 work items follow it', impact: 0 }]);
  assert.equal(decisionHealth(decision(), { aligned: 1 }, NOW).signals[0].label, '1 work item follows it');
});

test('conflicts and an overdue review make a decision at risk', () => {
  const h = decisionHealth(decision({ reviewBy: '2026-03-12' }), { conflicts: 3, aligned: 0, related: 0 }, NOW);
  assert.equal(h.score, 44);
  assert.equal(h.grade, 'at-risk');
  assert.equal(h.reviewState, 'overdue');
  assert.deepEqual(h.signals, [
    { kind: 'conflicts', tone: 'danger', label: '3 work items contradict it', impact: -36 },
    { kind: 'review', tone: 'danger', label: 'Review overdue since Mar 12, 2026', impact: -20 },
  ]);
  // conflicts are capped at three
  assert.equal(decisionHealth(decision(), { conflicts: 7 }, NOW).score, 64);
  assert.equal(decisionHealth(decision(), { conflicts: 1 }, NOW).signals[0].label, '1 work item contradicts it');
});

test('recent exceptions count, old ones do not', () => {
  const exceptions = [
    { issueKey: 'PAY-1', reason: 'spike', at: daysAgo(10) },
    { issueKey: 'PAY-2', reason: 'migration window', at: daysAgo(80) },
    { issueKey: 'PAY-3', reason: 'old', at: daysAgo(120) },
  ];
  const h = decisionHealth(decision({ exceptions }), undefined, NOW);
  assert.equal(h.score, 84);
  assert.deepEqual(h.signals, [{ kind: 'exceptions', tone: 'warning', label: '2 exceptions in 90 days — the rule may be bending', impact: -16 }]);
  assert.equal(decisionHealth(decision({ exceptions: exceptions.slice(0, 1) }), undefined, NOW).signals[0].label, '1 exception in 90 days');
  const many = Array.from({ length: 5 }, (_, i) => ({ issueKey: `PAY-${i}`, at: daysAgo(i + 1) }));
  assert.equal(decisionHealth(decision({ exceptions: many }), undefined, NOW).signals[0].impact, -24);
});

test('review due soon, no owner, no guardrails', () => {
  const soon = decisionHealth(decision({ reviewBy: '2026-11-07' }), undefined, NOW);
  assert.equal(soon.reviewState, 'soon');
  assert.deepEqual(soon.signals, [{ kind: 'review', tone: 'warning', label: 'Review due in 9 days', impact: -5 }]);
  assert.equal(decisionHealth(decision({ reviewBy: '2026-11-20' }), undefined, NOW).reviewState, 'ok');

  const bare = decisionHealth(decision({ owner: null, guardrails: { avoid: [], prefer: [{ text: 'Stripe' }] } }), undefined, NOW);
  assert.equal(bare.score, 80);
  assert.equal(bare.grade, 'healthy');
  assert.deepEqual(
    bare.signals.map((s) => [s.kind, s.label, s.impact]),
    [
      ['owner', 'No owner to ask', -10],
      ['guardrails', 'No guardrails — shown as context only', -10],
    ],
  );
  assert.equal(decisionHealth(decision({ owner: 'Dana Kim' }), undefined, NOW).score, 100);
});

test('score clamps at 0 and signals are sorted most negative first', () => {
  const worst = decision({
    owner: null,
    guardrails: undefined,
    reviewBy: '2026-01-05',
    exceptions: Array.from({ length: 4 }, (_, i) => ({ issueKey: `PAY-${i}`, at: daysAgo(5) })),
  });
  const h = decisionHealth(worst, { conflicts: 5, aligned: 2, related: 0 }, NOW);
  assert.equal(h.score, 0);
  assert.equal(h.grade, 'at-risk');
  assert.deepEqual(h.signals.map((s) => s.impact), [-36, -24, -20, -10, -10, 0]);
  assert.equal(h.signals.at(-1).tone, 'success');
});

test('grades: 80 healthy, 55 watch, below that at risk', () => {
  assert.equal(gradeFor(80), 'healthy');
  assert.equal(gradeFor(79), 'watch');
  assert.equal(gradeFor(55), 'watch');
  assert.equal(gradeFor(54), 'at-risk');
  // 2 conflicts (-24) + 2 exceptions (-16) + review due soon (-5) = 55
  const h = decisionHealth(
    decision({ reviewBy: '2026-11-01', exceptions: [{ at: daysAgo(1) }, { at: daysAgo(2) }] }),
    { conflicts: 2 },
    NOW,
  );
  assert.equal(h.score, 55);
  assert.equal(h.grade, 'watch');
});

test('inactive decisions are not scored or penalised', () => {
  const h = decisionHealth(decision({ status: 'superseded', owner: null, reviewBy: '2025-01-01' }), { conflicts: 4 }, NOW);
  assert.deepEqual(h, { score: null, grade: 'inactive', reviewBy: '2025-01-01T00:00:00.000Z', reviewState: 'ok', signals: [] });
});

test('team health averages active decisions', () => {
  const decisions = [
    decision({ id: 'DEC-1' }), // 100
    decision({ id: 'DEC-2', reviewBy: '2026-03-12' }), // 80, overdue
    decision({ id: 'DEC-3', reviewBy: '2026-11-07', owner: null }), // 85, due soon
    decision({ id: 'DEC-4', guardrails: { avoid: [], prefer: [] } }), // 90 (-10 guardrails) - 36 conflicts = 54
    decision({ id: 'DEC-5', status: 'archived' }),
  ];
  const t = teamHealth(decisions, { 'DEC-4': { conflicts: 3, aligned: 0, related: 0 } }, NOW);
  assert.equal(t.score, 80); // mean 79.75, rounded
  assert.equal(t.grade, 'healthy');
  assert.equal(t.active, 4);
  assert.deepEqual([t.healthy, t.watch, t.atRisk, t.overdue, t.dueSoon], [3, 0, 1, 1, 1]);
  assert.equal(t.byId['DEC-4'].grade, 'at-risk');
  assert.equal(t.byId['DEC-5'].grade, 'inactive');
  assert.deepEqual(Object.keys(t.byId), ['DEC-1', 'DEC-2', 'DEC-3', 'DEC-4', 'DEC-5']);

  const empty = teamHealth([], {}, NOW);
  assert.deepEqual(empty, { score: 100, grade: 'healthy', active: 0, healthy: 0, watch: 0, atRisk: 0, overdue: 0, dueSoon: 0, byId: {} });
});
