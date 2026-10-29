import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDecisionCandidates } from '../src/lib/extract.js';
import { SAMPLE_PAGES } from './fixtures.js';

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const mention = (id, name) => ({ type: 'mention', attrs: { id, text: `@${name}` } });
const p = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? text(x) : x)) });
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const li = (...c) => ({ type: 'listItem', content: [p(...c)] });
const ul = (...items) => ({ type: 'bulletList', content: items });
const doc = (...content) => ({ type: 'doc', version: 1, content });
const cell = (...c) => ({ type: 'tableCell', content: [p(...c)] });
const th = (t) => ({ type: 'tableHeader', content: [p(t)] });
const tr = (...cells) => ({ type: 'tableRow', content: cells });

// A typical weekly sync page, written without Confluence's "/decision" element.
const MEETING_NOTES = doc(
  p(text('Attendees: ', [{ type: 'strong' }]), mention('acc-priya', 'Priya Shah'), ', ', mention('acc-sam', 'Sam Lee'), ', Dana Kim'),
  h(2, 'Discussion'),
  p('Checkout latency regressed after the last release. Sam walked through the traces.'),
  p(
    'After some back and forth we agreed that all new services publish domain events through Kafka instead of direct HTTP callbacks. Dana will write up the schema registry setup.',
  ),
  p('Maybe we should consider GraphQL?'),
  p('We might move search to OpenSearch later, to be decided next quarter.'),
  p('Going forward, every production deploy runs through Bitbucket Pipelines.'),
  p('Decision: the payments team owns the webhook retry queue — decided by Dana Kim'),
  // a native decision is harvested elsewhere; neither it nor its prose restatement is a candidate
  {
    type: 'decisionList',
    attrs: { localId: 'dl-1' },
    content: [{ type: 'decisionItem', attrs: { localId: 'di-1', state: 'DECIDED' }, content: [text('Keep refunds on the shared PostgreSQL cluster.')] }],
  },
  p('As noted above, we decided to keep refunds on the shared PostgreSQL cluster.'),
  h(2, 'Decisions'),
  ul(
    li('We will not use Jenkins for new pipelines — ', mention('acc-sam', 'Sam Lee')),
    li('Standardize on Stripe for all card payments, instead of Adyen.'),
    li('Should we drop IE11 support? TBD'),
    li('Customer PII must never be logged. — decided by Priya Shah'),
    li('Publish all new domain events through Kafka instead of direct HTTP callbacks.'),
  ),
  h(2, 'Action items'),
  {
    type: 'taskList',
    attrs: { localId: 'tl-1' },
    content: [
      { type: 'taskItem', attrs: { localId: 'ti-1', state: 'TODO' }, content: [mention('acc-dana', 'Dana Kim'), text(' to decide the Kafka retention policy by Friday')] },
    ],
  },
  { type: 'codeBlock', attrs: { language: 'bash' }, content: [text('# we agreed to pin node 20 in CI')] },
);

const EXISTING = [{ id: 'DEC-3', statement: 'Standardize on Stripe for card payments instead of Adyen.' }];

test('meeting notes: finds decisions, in confidence then page order', () => {
  const found = findDecisionCandidates(MEETING_NOTES, { existing: EXISTING });
  assert.deepEqual(
    found.map((c) => [c.confidence, c.statement]),
    [
      ['high', 'The payments team owns the webhook retry queue'],
      ['high', 'We will not use Jenkins for new pipelines'],
      ['high', 'Standardize on Stripe for all card payments, instead of Adyen.'],
      ['high', 'Customer PII must never be logged.'],
      ['high', 'Publish all new domain events through Kafka instead of direct HTTP callbacks.'],
      ['medium', 'Every production deploy runs through Bitbucket Pipelines.'],
    ],
  );
});

test('meeting notes: reasons, headings, owners, duplicates and guardrails', () => {
  const found = findDecisionCandidates(MEETING_NOTES, { existing: EXISTING });
  const get = (re) => found.find((c) => re.test(c.statement));

  const jenkins = get(/Jenkins/);
  assert.equal(jenkins.reason, 'Listed under “Decisions”');
  assert.equal(jenkins.heading, 'Decisions');
  assert.equal(jenkins.ownerName, 'Sam Lee');
  assert.equal(jenkins.ownerAccountId, 'acc-sam');
  assert.deepEqual(jenkins.guardrails.avoid.map((t) => t.text), ['Jenkins'], 'negation survives cleanup');

  const pii = get(/PII/);
  assert.equal(pii.ownerName, 'Priya Shah');
  assert.equal(pii.ownerAccountId, null);
  assert.equal(pii.title, 'Customer PII must never be logged');

  const webhook = get(/webhook/);
  assert.equal(webhook.reason, 'Starts with “Decision:”');
  assert.equal(webhook.heading, 'Discussion');
  assert.equal(webhook.ownerName, 'Dana Kim');

  // near-identical wording ("all", a comma) still matches the register entry
  assert.equal(get(/Stripe/).duplicateOf, 'DEC-3');
  assert.equal(jenkins.duplicateOf, null);

  // the Kafka sentence appears in Discussion ("we agreed") and under Decisions: kept once, as high
  const kafka = found.filter((c) => /Kafka/.test(c.statement));
  assert.equal(kafka.length, 1);
  assert.equal(kafka[0].confidence, 'high');

  const deploys = get(/Bitbucket/);
  assert.equal(deploys.reason, 'Says “going forward”');
  assert.equal(deploys.heading, 'Discussion');

  assert.ok(found.every((c) => /^[0-9a-z]{7}$/.test(c.key)));
  assert.equal(new Set(found.map((c) => c.key)).size, found.length);
});

test('meeting notes: questions, hedges, tasks, code and native decisions are skipped', () => {
  const statements = findDecisionCandidates(MEETING_NOTES).map((c) => c.statement).join('\n');
  assert.doesNotMatch(statements, /GraphQL/);
  assert.doesNotMatch(statements, /OpenSearch/);
  assert.doesNotMatch(statements, /IE11/);
  assert.doesNotMatch(statements, /retention policy/);
  assert.doesNotMatch(statements, /pin node/);
  assert.doesNotMatch(statements, /refunds/i);
  assert.doesNotMatch(statements, /latency|Attendees/);
});

test('the Kafka sentence on its own is a medium candidate with the lead-in stripped', () => {
  const [c] = findDecisionCandidates(
    doc(
      h(2, 'Discussion'),
      p('After some back and forth we agreed that all new services publish domain events through Kafka instead of direct HTTP callbacks.'),
    ),
  );
  assert.equal(c.confidence, 'medium');
  assert.equal(c.reason, 'Says “we agreed”');
  assert.equal(c.statement, 'All new services publish domain events through Kafka instead of direct HTTP callbacks.');
  assert.deepEqual(c.guardrails.avoid.map((t) => t.text), ['direct HTTP callbacks']);
});

test('statement cleanup keeps the meaning', () => {
  const one = (sentence) => findDecisionCandidates(doc(p(sentence)))[0];
  assert.equal(one('We decided to use Kafka for all domain events.').statement, 'Use Kafka for all domain events.');
  assert.equal(one('The team agreed that refunds stay on PostgreSQL.').statement, 'Refunds stay on PostgreSQL.');
  assert.equal(one("Let's go with Stripe for card payments.").statement, 'Go with Stripe for card payments.');
  assert.equal(one('We’re standardizing on OpenTelemetry for tracing.').statement, 'Standardize on OpenTelemetry for tracing.');
  // a condition is content, not filler
  assert.equal(one('If latency spikes, we agreed to add a Redis cache.').statement, 'If latency spikes, we agreed to add a Redis cache.');
  // negations stay negative
  const notJenkins = one('We agreed not to use Jenkins for new pipelines.');
  assert.equal(notJenkins.statement, 'Do not use Jenkins for new pipelines.');
  assert.deepEqual(notJenkins.guardrails.avoid.map((t) => t.text), ['Jenkins']);
  const redux = one('We decided against Redux for the admin app.');
  assert.equal(redux.statement, 'Avoid Redux for the admin app.');
  assert.deepEqual(redux.guardrails.avoid.map((t) => t.text), ['Redux']);
  // no cue, too short, or a question
  assert.equal(one('Sam walked through the checkout traces.'), undefined);
  assert.equal(one('We agreed.'), undefined);
  assert.equal(one('So we agreed on Kafka, right?'), undefined);
});

test('decision sections: sub-headings, intro lines, "Open questions"', () => {
  const found = findDecisionCandidates(
    doc(
      h(2, 'Outcomes'),
      p('We landed on the following:'),
      h(3, 'Payments'),
      ul(li('Card payments go through Stripe only.')),
      h(3, 'Open questions'),
      ul(li('Whether partner banks get SFTP access next quarter.')),
      h(2, 'Decisions needed'),
      ul(li('Pick a search engine for the help center.')),
    ),
  );
  assert.deepEqual(found.map((c) => c.statement), ['Card payments go through Stripe only.']);
  assert.equal(found[0].reason, 'Listed under “Outcomes”');
  assert.equal(found[0].heading, 'Payments');
});

test('decision log tables: the Decision column, with its Owner column', () => {
  const [c, ...rest] = findDecisionCandidates(
    doc(
      h(2, 'Log'),
      {
        type: 'table',
        content: [
          tr(th('Date'), th('Decision'), th('Owner')),
          tr(cell('2026-10-01'), cell('Mobile apps are built with React Native over Flutter.'), cell(mention('acc-lee', 'Sam Lee'))),
          tr(cell('2026-10-08'), cell('Partner files go out via SFTP only.'), cell('Marco Rossi')),
        ],
      },
    ),
  );
  assert.equal(c.statement, 'Mobile apps are built with React Native over Flutter.');
  assert.equal(c.reason, 'In the “Decision” column');
  assert.equal(c.ownerName, 'Sam Lee');
  assert.equal(c.ownerAccountId, 'acc-lee');
  assert.equal(rest[0].ownerName, 'Marco Rossi');
});

test('existing decisions and harvested sample pages', () => {
  // the sample review only uses native decision items: nothing new to suggest
  assert.deepEqual(findDecisionCandidates(SAMPLE_PAGES[0].adf), []);
  // normalised-equal statements are duplicates even with different punctuation/case
  const [c] = findDecisionCandidates(doc(p('Decision: keep all transactional payment data in PostgreSQL')), {
    existing: [{ id: 'DEC-1', statement: 'Keep all transactional payment data in PostgreSQL.' }],
  });
  assert.equal(c.duplicateOf, 'DEC-1');
  assert.deepEqual(findDecisionCandidates(null), []);
});

test('at most 15 candidates, high first', () => {
  const many = doc(
    ...Array.from({ length: 12 }, (_, i) => p(`Going forward, service ${i + 1} publishes its audit events to topic number ${i + 1}.`)),
    h(2, 'Decisions'),
    ul(...Array.from({ length: 8 }, (_, i) => li(`Team ${i + 1} owns the on-call rota for component ${i + 1}.`))),
  );
  const found = findDecisionCandidates(many);
  assert.equal(found.length, 15);
  assert.ok(found.slice(0, 8).every((c) => c.confidence === 'high'));
  assert.ok(found.slice(8).every((c) => c.confidence === 'medium'));
  assert.match(found[8].statement, /^Service 1 publishes/);
});
