import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecisionItems, parseDecisionTemplate, extractCommentDecision, splitOwner, titleFrom } from '../src/lib/adf.js';
import { extractGuardrails } from '../src/lib/guardrails.js';

// sample.js imports Forge runtime modules, so rebuild the fixtures from its exported data lazily
const { SAMPLE_PAGES } = await import('./fixtures.js');

test('finds decision items with heading, owner and rationale', () => {
  const items = extractDecisionItems(SAMPLE_PAGES[0].adf);
  assert.equal(items.length, 4);
  assert.equal(items[0].heading, 'Payout ledger storage');
  assert.equal(items[0].ownerName, 'Priya Shah');
  assert.match(items[0].statement, /^Keep all transactional payment data in PostgreSQL\. Do not introduce MongoDB/);
  assert.doesNotMatch(items[0].statement, /decided by/);
  assert.match(items[0].rationale, /ACID/);
  assert.equal(titleFrom(items[0].statement), 'Keep all transactional payment data in PostgreSQL');
  assert.deepEqual(extractGuardrails(items[2].statement).avoid.map((t) => t.text), ['Adyen']);
});

test('parses the Confluence decision template', () => {
  const t = parseDecisionTemplate(SAMPLE_PAGES[1].adf);
  assert.equal(t.status, 'active');
  assert.equal(t.ownerName, 'Sam Lee');
  assert.equal(t.decidedAt.slice(0, 10), '2026-04-02');
  assert.match(t.statement, /LaunchDarkly/);
  assert.match(t.rationale, /checkout incident/);
  assert.equal(parseDecisionTemplate(SAMPLE_PAGES[0].adf), null);
});

test('comment decisions and owner suffixes', () => {
  assert.equal(
    extractCommentDecision('Thanks all.\nDecision: refunds stay on the shared Postgres cluster until Q1 2027.'),
    'Refunds stay on the shared Postgres cluster until Q1 2027.',
  );
  assert.equal(extractCommentDecision('No decision yet, still discussing'), null);
  assert.deepEqual(splitOwner('Use Stripe (owner: Dana Kim)'), { statement: 'Use Stripe', ownerName: 'Dana Kim' });
});
