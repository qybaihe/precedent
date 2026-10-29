import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecisionItems, titleFrom, adfToText } from '../src/lib/adf.js';
import { extractGuardrails } from '../src/lib/guardrails.js';
import { checkWork } from '../src/lib/check.js';
import { preferredAlternative, suggestFix, applyReplacementsToText, applyReplacementsToAdf } from '../src/lib/fix.js';
import { SAMPLE_PAGES, SAMPLE_ISSUES } from './fixtures.js';

// The sample architecture review: DEC-1 PostgreSQL/MongoDB, DEC-2 API Gateway, DEC-3 Stripe/Adyen, DEC-4 PII
const decisions = extractDecisionItems(SAMPLE_PAGES[0].adf).map((item, i) => ({
  id: `DEC-${i + 1}`,
  title: titleFrom(item.statement),
  statement: item.statement,
  status: 'active',
  guardrails: extractGuardrails(item.statement),
}));
const byId = (id) => decisions.find((d) => d.id === id);

function decision(id, statement, extra = {}) {
  return { id, title: titleFrom(statement), statement, status: 'active', guardrails: extractGuardrails(statement), ...extra };
}

/** Check the work item, then suggest a fix for its conflict with `d`. */
function fixFor(work, d) {
  const r = checkWork({ text: `${work.summary}\n${work.description || ''}` }, [d]);
  const conflict = r.conflicts.find((c) => c.decision.id === d.id);
  assert.ok(conflict, `expected "${work.summary}" to conflict with ${d.id}`);
  return suggestFix(work, conflict, d);
}

test('preferred alternative: guardrail first, then parsed from the statement', () => {
  assert.equal(preferredAlternative(byId('DEC-1')), 'PostgreSQL'); // "Keep … in PostgreSQL" (no prefer guardrail)
  assert.equal(preferredAlternative(byId('DEC-2')), 'API Gateway');
  assert.equal(preferredAlternative(byId('DEC-3')), 'Stripe');
  const parsed = (statement) => preferredAlternative({ statement, guardrails: { avoid: [], prefer: [] } });
  assert.equal(parsed('Sessions live in Redis. Do not use Memcached.'), 'Redis');
  assert.equal(parsed('All partner traffic must go through the API Gateway.'), 'API Gateway');
  assert.equal(parsed('Standardise on Bitbucket Pipelines for CI.'), 'Bitbucket Pipelines');
  assert.equal(parsed('Card payments: Stripe only.'), 'Stripe');
  // negated cues and generic objects are not alternatives
  assert.equal(parsed('Never run cron jobs on Jenkins.'), null);
  assert.equal(parsed('Customer PII must never be logged.'), null);
  assert.equal(parsed('Keep it simple and stay on budget.'), null);
  assert.equal(preferredAlternative(null), null);
});

test('MongoDB payout ledger is rewritten to PostgreSQL, alias "Mongo" included', () => {
  const work = SAMPLE_ISSUES[0];
  const fix = fixFor(work, byId('DEC-1'));
  assert.equal(fix.kind, 'rewrite');
  assert.equal(fix.decisionId, 'DEC-1');
  assert.equal(fix.from, 'MongoDB');
  assert.equal(fix.to, 'PostgreSQL');
  assert.deepEqual(fix.summary, {
    before: 'Store payout ledger in MongoDB for flexible schemas',
    after: 'Store payout ledger in PostgreSQL for flexible schemas',
  });
  assert.deepEqual(fix.description, [
    {
      before: 'Move the ledger to MongoDB so we can iterate without writing migrations.',
      after: 'Move the ledger to PostgreSQL so we can iterate without writing migrations.',
    },
    {
      before: 'Acceptance: ledger writes and reads go through the new Mongo collection.',
      after: 'Acceptance: ledger writes and reads go through the new PostgreSQL collection.',
    },
  ]);
  assert.deepEqual(fix.replacements, [
    { find: 'MongoDB', replace: 'PostgreSQL' },
    { find: 'Mongo', replace: 'PostgreSQL' },
  ]);
  assert.equal(fix.advice, 'Use PostgreSQL instead of MongoDB, as DEC-1 requires.');

  // applying the replacements gives the previewed text, and the item no longer conflicts
  const description = applyReplacementsToText(work.description, fix.replacements);
  assert.equal(
    description,
    'The payout ledger schema changes every sprint. Move the ledger to PostgreSQL so we can iterate without writing migrations.\n\nAcceptance: ledger writes and reads go through the new PostgreSQL collection.',
  );
  const after = checkWork({ text: `${applyReplacementsToText(work.summary, fix.replacements)}\n${description}`, labels: work.labels }, decisions);
  assert.equal(after.conflicts.length, 0);
});

test('Adyen becomes Stripe', () => {
  const fix = fixFor({ summary: 'Integrate Adyen for EU card payments', description: '' }, byId('DEC-3'));
  assert.equal(fix.kind, 'rewrite');
  assert.equal(fix.summary.after, 'Integrate Stripe for EU card payments');
  assert.deepEqual(fix.description, []);
  assert.deepEqual(fix.replacements, [{ find: 'Adyen', replace: 'Stripe' }]);
  assert.equal(fix.advice, 'Use Stripe instead of Adyen, as DEC-3 requires.');
});

test('generic or multi-concept guardrails get advice, never a word swap', () => {
  const pii = fixFor(SAMPLE_ISSUES[2], byId('DEC-4'));
  assert.equal(pii.kind, 'advice');
  assert.equal(pii.summary, null);
  assert.deepEqual(pii.description, []);
  assert.deepEqual(pii.replacements, []);
  assert.match(pii.advice, /^Rework this so it no longer relies on Customer PII — use redaction middleware instead\. DEC-4: “Customer PII must never be logged/);

  const gateway = fixFor(SAMPLE_ISSUES[1], byId('DEC-2'));
  assert.equal(gateway.kind, 'advice');
  assert.equal(gateway.to, 'API Gateway');
  assert.match(gateway.advice, /“internal services directly” — use API Gateway instead\. DEC-2:/);

  // "PII" alone is concrete-looking, but it's a data category: swapping it for the preferred tool is nonsense
  const d = decision('DEC-20', 'Do not log PII; use the Vault tokenizer for request logs.');
  const fix = fixFor({ summary: 'Log request bodies with PII', description: '' }, d);
  assert.equal(fix.kind, 'advice');

  // the decision prefers Redis too, so "team-owned Redis instances" has no decisive word to swap
  const redis = decision('DEC-8', 'Caching goes through the shared Redis cluster managed by Platform; do not run team-owned Redis instances.');
  assert.equal(preferredAlternative(redis), 'shared Redis cluster');
  const redisFix = fixFor({ summary: 'Spin up a team-owned Redis instance for search autocomplete', description: '' }, redis);
  assert.equal(redisFix.kind, 'advice');
  assert.equal(redisFix.from, 'team-owned Redis instance'); // as written in the work item
  assert.match(redisFix.advice, /relies on team-owned Redis instance — use shared Redis cluster instead\./);

  const flags = decision('DEC-5', 'Use LaunchDarkly for all feature flags — no homegrown feature flag systems.');
  assert.equal(fixFor(SAMPLE_ISSUES[3], flags).kind, 'advice');
});

test('no preferred alternative -> advice that quotes the decision', () => {
  const d = decision('DEC-21', 'Do not introduce MongoDB.');
  const fix = fixFor({ summary: 'Cache sessions in MongoDB', description: '' }, d);
  assert.equal(fix.kind, 'advice');
  assert.equal(fix.to, null);
  assert.equal(fix.from, 'MongoDB');
  assert.equal(fix.advice, 'Rework this so it no longer relies on MongoDB. DEC-21: “Do not introduce MongoDB.”');
});

test('a sentence that already mentions the preferred option is never rewritten', () => {
  // the only mention compares both options: a swap would read "PostgreSQL with PostgreSQL"
  const replace = fixFor({ summary: 'Replace PostgreSQL with MongoDB for the ledger', description: '' }, byId('DEC-1'));
  assert.equal(replace.kind, 'advice');
  assert.deepEqual(replace.replacements, []);

  // the summary is rewritten, the migration sentence is left alone, and the result passes the check
  const work = { summary: 'Store payout ledger in MongoDB', description: 'Later, move the archive from MongoDB to PostgreSQL.' };
  const fix = fixFor(work, byId('DEC-1'));
  assert.equal(fix.kind, 'rewrite');
  assert.equal(fix.summary.after, 'Store payout ledger in PostgreSQL');
  assert.deepEqual(fix.description, []);
  assert.equal(applyReplacementsToText(work.description, fix.replacements), work.description);

  // alias spellings count as mentions too
  assert.equal(
    applyReplacementsToText('Move from Postgres to MongoDB. Store it in MongoDB.', [{ find: 'MongoDB', replace: 'PostgreSQL' }]),
    'Move from Postgres to MongoDB. Store it in PostgreSQL.',
  );
});

test('removal sentences and failed verification fall back to advice', () => {
  // "drop the Mongo dependency" would turn into "drop the PostgreSQL dependency"
  const removal = fixFor({ summary: 'Store ledger in MongoDB', description: 'Then drop the Mongo dependency from refunds.' }, byId('DEC-1'));
  assert.equal(removal.kind, 'advice');

  // a label keeps the conflict alive, so the rewrite would not clear it
  const d = byId('DEC-1');
  const work = { summary: 'Store payout ledger in MongoDB for flexible schemas', description: '', labels: ['mongodb'] };
  const r = checkWork({ text: work.summary, labels: work.labels }, [d]);
  const fix = suggestFix(work, r.conflicts[0], d);
  assert.equal(fix.kind, 'advice');
  assert.equal(fix.summary, null);
  assert.deepEqual(fix.replacements, []);
  // …while the same item without the label is a clean rewrite
  assert.equal(suggestFix({ ...work, labels: [] }, r.conflicts[0], d).kind, 'rewrite');
});

test('replacements are whole-word and case-insensitive', () => {
  const swap = [{ find: 'Mongo', replace: 'PostgreSQL' }];
  assert.equal(applyReplacementsToText('use mongo and MONGO, not Mongoose', swap), 'use PostgreSQL and PostgreSQL, not Mongoose');
  assert.equal(applyReplacementsToText("Mongo's driver", swap), "PostgreSQL's driver");
  assert.equal(applyReplacementsToText('nothing to do', []), 'nothing to do');
  assert.equal(applyReplacementsToText(null, swap), '');
});

test('ADF rewrite touches only text nodes and keeps marks, mentions and code', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Move the ledger to ' },
          { type: 'text', text: 'MongoDB', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ping ' },
          { type: 'mention', attrs: { id: 'acc-1', text: '@Mongo Team' } },
          { type: 'text', text: ' about the Mongo collection.' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Later, move the archive from MongoDB to PostgreSQL.' }] },
      { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'export URL=mongodb://localhost' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reads go through Mongo' }] }] }] },
    ],
  };
  const original = JSON.stringify(adf);
  const replacements = [
    { find: 'MongoDB', replace: 'PostgreSQL' },
    { find: 'Mongo', replace: 'PostgreSQL' },
  ];
  const { adf: out, changed } = applyReplacementsToAdf(adf, replacements);
  assert.equal(changed, true);
  assert.equal(JSON.stringify(adf), original, 'input is not mutated');

  const [para, migration, code, list] = out.content;
  assert.deepEqual(para.content[1], { type: 'text', text: 'PostgreSQL', marks: [{ type: 'strong' }] });
  assert.deepEqual(para.content[3], adf.content[0].content[3], 'mention untouched');
  assert.equal(para.content[4].text, ' about the PostgreSQL collection.');
  assert.equal(migration.content[0].text, 'Later, move the archive from MongoDB to PostgreSQL.');
  assert.equal(code.content[0].text, 'export URL=mongodb://localhost');
  assert.equal(list.content[0].content[0].content[0].text, 'Reads go through PostgreSQL');
  // same result as the plain-text apply on the flattened document (code aside)
  assert.match(adfToText(out), /Move the ledger to PostgreSQL and ping Mongo Team about the PostgreSQL collection\./);

  const noop = applyReplacementsToAdf(adf, [{ find: 'Cassandra', replace: 'PostgreSQL' }]);
  assert.equal(noop.changed, false);
  assert.deepEqual(noop.adf, adf);
  assert.notEqual(noop.adf, adf, 'always a copy');
});
