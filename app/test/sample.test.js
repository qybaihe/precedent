import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecisionItems, parseDecisionTemplate, titleFrom } from '../src/lib/adf.js';
import { extractGuardrails } from '../src/lib/guardrails.js';
import { checkWork } from '../src/lib/check.js';
import { findDecisionCandidates } from '../src/lib/extract.js';
import { SAMPLE_PAGES, SAMPLE_ISSUES } from './fixtures.js';

const decisions = [];
let n = 0;
for (const item of extractDecisionItems(SAMPLE_PAGES[0].adf)) {
  decisions.push({ id: `DEC-${++n}`, title: titleFrom(item.statement), statement: item.statement, status: 'active', tags: ['payments'], guardrails: extractGuardrails(item.statement) });
}
const t = parseDecisionTemplate(SAMPLE_PAGES[1].adf);
decisions.push({ id: `DEC-${++n}`, title: 'Feature flags go through LaunchDarkly', statement: t.statement, status: 'active', tags: [], guardrails: extractGuardrails(t.statement) });

// the last one only conflicts once the Kafka decision in the meeting notes is tracked (see below)
const expected = ['conflict', 'conflict', 'conflict', 'conflict', 'related', 'related', 'clear', 'clear'];

test('sample work items produce the intended verdicts', () => {
  SAMPLE_ISSUES.forEach((issue, i) => {
    const r = checkWork({ text: `${issue.summary}\n${issue.description}`, labels: issue.labels }, decisions);
    const got = r.status === 'related' && r.aligned.length ? 'related' : r.status;
    assert.equal(got, expected[i], `${issue.summary}: ${JSON.stringify(r.conflicts.map((c) => c.decision.id))}`);
  });
});

test('decisions written in prose in the sample meeting notes are found, and then enforced', () => {
  const notes = SAMPLE_PAGES.find((pg) => pg.title.startsWith('Payments Sync'));
  const found = findDecisionCandidates(notes.adf, { existing: decisions });
  const kafka = found.find((c) => /Kafka/.test(c.statement));
  assert.equal(kafka.confidence, 'high');
  assert.equal(kafka.ownerName, 'Marco Rossi');
  assert.deepEqual(kafka.guardrails.prefer.map((t) => t.text), ['Kafka']);
  assert.ok(!found.some((c) => /GraphQL|naming guide/.test(c.statement)), 'hedges and action items are skipped');
  const tracked = [...decisions, { id: 'DEC-9', title: kafka.title, statement: kafka.statement, status: 'active', tags: [], guardrails: kafka.guardrails }];
  const issue = SAMPLE_ISSUES.at(-1);
  const r = checkWork({ text: `${issue.summary}\n${issue.description}` }, tracked);
  assert.equal(r.status, 'conflict');
  assert.equal(r.conflicts[0].decision.id, 'DEC-9');
});
