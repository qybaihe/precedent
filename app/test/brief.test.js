import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, briefMarkdown, briefAdf, guardVerdicts, BRIEF_MARKER } from '../src/lib/brief.js';
import { checkWork } from '../src/lib/check.js';
import { extractGuardrails } from '../src/lib/guardrails.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const mk = (id, statement, extra = {}) => ({ id, status: 'active', title: statement.split('.')[0], statement, guardrails: extractGuardrails(statement), decidedAt: '2026-09-08T00:00:00.000Z', ...extra });

const LEDGER = mk('DEC-1', 'Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments.', {
  owner: { name: 'Priya Shah' },
  rationale: 'Reconciliation needs multi-row ACID transactions, and Finance runs SQL audits every night.',
  guard: { paths: ['services/payments/**'], packages: { deny: ['mongoose'], allow: ['pg'] } },
  source: { title: 'Payments Architecture Review', url: 'https://example.atlassian.net/wiki/x' },
});
const STRIPE = mk('DEC-3', 'Standardize on Stripe for card payments instead of Adyen.', { assumptions: [{ text: 'Stripe covers every 2026 market', status: 'changed', note: 'Brazil launch' }] });
const FLAGS = mk('DEC-5', 'Use LaunchDarkly for all feature flags; no homegrown feature flag systems.', { guard: { jql: 'project = PAY' } });
const ALL = [LEDGER, STRIPE, FLAGS];

test('brief: conflicts first, then governing and related decisions, with do/don’t and rules', () => {
  const result = checkWork({ text: 'Move the payout ledger to MongoDB', issueKey: 'PAY-21', paths: ['services/payments/ledger.ts'], jqlScope: { 'DEC-5': true } }, ALL);
  result.conflicts[0].fix = { advice: 'Use PostgreSQL instead of MongoDB.' };
  const b = buildBrief({ issueKey: 'PAY-21', result, decisions: ALL, now: NOW });
  assert.deepEqual(b.ids, ['DEC-1', 'DEC-5']);
  assert.deepEqual(b.conflicts, ['DEC-1']);
  const md = briefMarkdown(b);
  assert.match(md, new RegExp(`^## ${BRIEF_MARKER} for PAY-21`));
  assert.match(md, /2 team decisions apply to this work, and it currently contradicts DEC-1/);
  assert.match(md, /⛔ CONFLICT: this work mentions “MongoDB”\. Compliant alternative: Use PostgreSQL instead of MongoDB\./);
  assert.match(md, /Use packages: `pg`/);
  assert.match(md, /Don't: MongoDB, document stores\n/);
  assert.match(md, /Denied packages: `mongoose`/);
  assert.match(md, /Governs: `services\/payments\/\*\*`/);
  assert.match(md, /Why: Reconciliation needs multi-row ACID transactions, and Finance runs SQL audits every night\.\n/);
  assert.match(md, /call guard-check/);
  assert.ok(md.length < 2600, `brief stays prompt-sized (${md.length} chars)`);
});

test('brief: possibly outdated decisions say so; no decision means an empty brief', () => {
  const result = checkWork({ text: 'Add Adyen as a second card processor', issueKey: 'CHK-9' }, ALL);
  const b = buildBrief({ issueKey: 'CHK-9', result, decisions: ALL, now: NOW });
  assert.match(briefMarkdown(b), /Possibly outdated: Assumption no longer holds: “Stripe covers every 2026 market” \(Brazil launch\)/);
  const none = buildBrief({ result: checkWork({ text: 'Fix a typo in the footer' }, ALL), decisions: ALL, now: NOW });
  assert.equal(none.items.length, 0);
  assert.match(briefMarkdown(none), /No recorded team decision applies/);
});

test('brief ADF: marker first, error panel for conflicts, ordered list of decisions', () => {
  const result = checkWork({ text: 'Move the payout ledger to MongoDB', issueKey: 'PAY-21' }, ALL);
  const adf = briefAdf(buildBrief({ issueKey: 'PAY-21', result, decisions: ALL, now: NOW }), { refreshedAt: NOW });
  assert.equal(adf.type, 'doc');
  assert.equal(adf.content[0].content[0].text, BRIEF_MARKER);
  assert.equal(adf.content[1].type, 'panel');
  assert.equal(adf.content[1].attrs.panelType, 'error');
  const list = adf.content.find((n) => n.type === 'orderedList');
  assert.equal(list.content[0].content[0].content[0].marks[0].attrs.href, 'https://example.atlassian.net/wiki/x');
  // every text node is non-empty (Jira rejects empty text nodes)
  const walk = (n) => (n.type === 'text' ? assert.ok(n.text.length > 0) : (n.content || []).forEach(walk));
  walk(adf);
});

test('signature changes only when what the brief says changes', () => {
  const r1 = checkWork({ text: 'Move the payout ledger to MongoDB', issueKey: 'PAY-21' }, ALL);
  const r2 = checkWork({ text: 'Move the payout ledger to MongoDB now', issueKey: 'PAY-21' }, ALL);
  const r3 = checkWork({ text: 'Move the payout ledger to PostgreSQL JSONB', issueKey: 'PAY-21' }, ALL);
  const sig = (r) => buildBrief({ issueKey: 'PAY-21', result: r, decisions: ALL, now: NOW }).signature;
  assert.equal(sig(r1), sig(r2));
  assert.notEqual(sig(r1), sig(r3));
});

test('guard verdicts: fail on violations, warn on related or outdated, pass when governed and clean', () => {
  const bad = checkWork({ text: 'Payout events', paths: ['services/payments/events.ts'], packages: ['mongoose'] }, ALL);
  const v = guardVerdicts(bad, ALL, NOW);
  assert.equal(v.overall, 'fail');
  assert.equal(v.decisions[0].id, 'DEC-1');
  assert.match(v.decisions[0].reasons[0], /Adds the package “mongoose”/);

  const ok = guardVerdicts(checkWork({ text: 'Payout events in Postgres', paths: ['services/payments/events.ts'], packages: ['pg'] }, ALL), ALL, NOW);
  assert.equal(ok.overall, 'pass');
  assert.match(ok.decisions[0].reasons[0], /Governs services\/payments\/events\.ts; no violation found/);

  const nothing = guardVerdicts(checkWork({ text: 'Footer typo', paths: ['web/footer.tsx'] }, ALL), ALL, NOW);
  assert.deepEqual(nothing, { overall: 'pass', decisions: [] });
});

test('description block: appended once, replaced in place, stripped for checking', async () => {
  const { withBriefBlock, stripBrief } = await import('../src/lib/brief.js');
  const { adfToText } = await import('../src/lib/adf.js');
  const desc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Move the payout ledger to MongoDB.' }] }] };
  const result = checkWork({ text: 'Move the payout ledger to MongoDB', issueKey: 'PAY-21' }, ALL);
  const b = buildBrief({ issueKey: 'PAY-21', result, decisions: ALL, now: NOW });
  const once = withBriefBlock(desc, b, { refreshedAt: NOW });
  assert.deepEqual(once.content.map((n) => n.type), ['paragraph', 'rule', 'panel']);
  assert.ok(!JSON.stringify(once).includes('"type":"panel","attrs":{"panelType":"error"}'), 'no nested panels');
  const twice = withBriefBlock(once, b, { refreshedAt: NOW });
  assert.deepEqual(twice, once, 'replacing keeps exactly one block');
  const stripped = stripBrief(twice);
  assert.equal(stripped.had, true);
  assert.deepEqual(stripped.adf, desc);
  assert.equal(adfToText(stripped.adf).trim(), 'Move the payout ledger to MongoDB.');
  assert.deepEqual(withBriefBlock(once, { items: [] }), desc, 'no decision: block removed');
  assert.equal(withBriefBlock(null, b).content.length, 2, 'empty description gets just the block');
  assert.deepEqual(stripBrief(null), { adf: null, had: false });
});
