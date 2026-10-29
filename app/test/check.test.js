import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGuardrails } from '../src/lib/guardrails.js';
import { checkWork } from '../src/lib/check.js';
import { stem, tokenize } from '../src/lib/text.js';

function decision(id, title, statement, extra = {}) {
  return { id, title, statement, status: 'active', guardrails: extractGuardrails(statement), tags: [], ...extra };
}

const decisions = [
  decision(
    'DEC-1',
    'Transactional data stays in PostgreSQL',
    'Use PostgreSQL for all transactional data. Do not introduce MongoDB or other document stores for payments.',
    { tags: ['payments', 'data'] },
  ),
  decision(
    'DEC-2',
    'Public traffic goes through the API Gateway',
    'All public traffic must go through the API Gateway; do not expose internal services directly to the internet.',
  ),
  decision('DEC-3', 'No PII in logs', 'Customer PII must never be logged.'),
  decision('DEC-4', 'Feature flags', 'Use LaunchDarkly for all feature flags — no homegrown feature flag systems.'),
  decision('DEC-5', 'Mobile framework', 'We chose React Native over Flutter for the mobile rewrite.'),
  decision('DEC-6', 'Old decision', 'Do not use Redis for sessions.', { status: 'superseded' }),
  decision('DEC-7', 'Card processor', 'Standardize on Stripe for card payments instead of Adyen.', { scope: { projects: ['PAY'] } }),
];

test('stemmer is consistent across word forms', () => {
  assert.equal(stem('stored'), stem('store'));
  assert.equal(stem('storing'), stem('stores'));
  assert.equal(stem('logging'), stem('logged'));
  assert.equal(stem('services'), stem('service'));
  const [a, b] = tokenize('PostgreSQL and Postgres');
  assert.equal(a, b);
});

test('extracts avoid and prefer terms', () => {
  const g = extractGuardrails(decisions[0].statement);
  assert.deepEqual(
    g.avoid.map((t) => t.text),
    ['MongoDB', 'document stores'],
  );
  assert.deepEqual(
    g.prefer.map((t) => t.text),
    ['PostgreSQL'],
  );
  assert.deepEqual(extractGuardrails('We will not support IE11.').avoid.map((t) => t.text), ['IE11']);
  assert.deepEqual(extractGuardrails('Standardize on Stripe instead of Adyen.').avoid.map((t) => t.text), ['Adyen']);
  assert.deepEqual(extractGuardrails('Phase out Jenkins by Q3.').avoid.map((t) => t.text), ['Jenkins']);
});

test('flags a work item that contradicts a decision', () => {
  const r = checkWork(
    { text: 'Store payout ledger in MongoDB\nWe want flexible schemas for the new payout ledger, so let us put it in MongoDB.' },
    decisions,
  );
  assert.equal(r.status, 'conflict');
  assert.equal(r.conflicts[0].decision.id, 'DEC-1');
  assert.match(r.conflicts[0].evidence, /MongoDB/);
});

test('removing the avoided thing is aligned, not a conflict', () => {
  const r = checkWork({ text: 'Remove MongoDB from the refunds service and migrate data to Postgres' }, decisions);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.aligned[0].decision.id, 'DEC-1');
});

test('passive prohibitions need both subject and verb', () => {
  assert.equal(checkWork({ text: 'Log full request bodies including customer PII for debugging' }, decisions).conflicts[0]?.decision.id, 'DEC-3');
  assert.equal(checkWork({ text: 'Show PII badge on the customer profile' }, decisions).conflicts.length, 0);
  assert.equal(checkWork({ text: 'Redact PII from application logs' }, decisions).conflicts.length, 0);
});

test('fuzzy generic guardrails', () => {
  const r = checkWork({ text: 'Expose the ledger service directly to partner banks to cut latency' }, decisions);
  assert.equal(r.conflicts[0]?.decision.id, 'DEC-2');
  const r2 = checkWork({ text: 'Build a homegrown feature flag service for the checkout team' }, decisions);
  assert.equal(r2.conflicts[0]?.decision.id, 'DEC-4');
});

test('superseded decisions and out-of-scope decisions are ignored', () => {
  assert.equal(checkWork({ text: 'Move sessions to Redis' }, decisions).conflicts.length, 0);
  assert.equal(checkWork({ text: 'Integrate Adyen for card payments', projectKey: 'MOB' }, decisions).conflicts.length, 0);
  assert.equal(checkWork({ text: 'Integrate Adyen for card payments', projectKey: 'PAY' }, decisions).conflicts[0].decision.id, 'DEC-7');
});

test('acknowledged conflicts and exceptions', () => {
  const r = checkWork({ text: 'Prototype the settings screen in Flutter' }, decisions, { acknowledged: ['DEC-5'] });
  assert.equal(r.status, 'acknowledged');
  const withException = decisions.map((d) =>
    d.id === 'DEC-5' ? { ...d, exceptions: [{ issueKey: 'MOB-9', reason: 'Throwaway spike' }] } : d,
  );
  const r2 = checkWork({ text: 'Prototype the settings screen in Flutter', issueKey: 'MOB-9' }, withException);
  assert.equal(r2.conflicts.length, 0);
  assert.match(r2.aligned[0].reason, /Exception/);
});

test('related decisions surface by topic without false conflicts', () => {
  const r = checkWork({ text: 'Add an index to the payments transactional tables in PostgreSQL to speed up payout reports' }, decisions);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.related[0]?.decision.id, 'DEC-1');
  assert.equal(checkWork({ text: 'Update the footer copyright year' }, decisions).status, 'clear');
});

test('direction matters: migrating TO the avoided thing is a conflict', () => {
  assert.equal(checkWork({ text: 'Migrate the payout ledger to MongoDB' }, decisions).conflicts[0]?.decision.id, 'DEC-1');
  assert.equal(checkWork({ text: 'Replace PostgreSQL with MongoDB for the ledger' }, decisions).conflicts[0]?.decision.id, 'DEC-1');
  assert.equal(checkWork({ text: 'Migrate refund records off MongoDB' }, decisions).conflicts.length, 0);
  assert.equal(checkWork({ text: 'Move the last collections from MongoDB to Postgres' }, decisions).aligned[0]?.decision.id, 'DEC-1');
});

test('gerund objects after "never by"', () => {
  const g = extractGuardrails('Partner settlement files are delivered via SFTP drop, never by giving partners database credentials.');
  assert.deepEqual(g.avoid.map((t) => t.text), ['giving partners database credentials']);
  const d = [{ id: 'DEC-9', title: 'SFTP', statement: 'x', status: 'active', guardrails: g }];
  assert.equal(checkWork({ text: 'Give partner banks read-only DB credentials for reconciliation' }, d).conflicts[0]?.decision.id, 'DEC-9');
});

test('a technology the decision also prefers is not decisive on its own', () => {
  const d = [decision('DEC-8', 'Shared Redis', 'Caching goes through the shared Redis cluster managed by Platform; do not run team-owned Redis instances.')];
  assert.equal(checkWork({ text: 'Spin up a team-owned Redis instance for search autocomplete' }, d).conflicts[0]?.decision.id, 'DEC-8');
  assert.equal(checkWork({ text: 'Build a feature flag service backed by Redis' }, d).conflicts.length, 0);
});

test('generic words alone do not make work "related" to a decision', () => {
  // seen on a real site: an anonymization task shared only "data" and "document" with DEC-1
  const r = checkWork({ text: 'Develop data anonymization protocols\nAnonymize personal data in every exported document.' }, decisions);
  assert.equal(r.status, 'clear');
  assert.deepEqual(r.related, []);
  // …while a genuinely related item still is
  const r2 = checkWork({ text: 'Speed up payout reports with a PostgreSQL index on the transactional tables' }, decisions);
  assert.ok(r2.related.some((x) => x.decision.id === 'DEC-1'));
});
