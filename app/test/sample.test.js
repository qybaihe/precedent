import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecisionItems, parseDecisionTemplate, titleFrom } from '../src/lib/adf.js';
import { extractGuardrails } from '../src/lib/guardrails.js';
import { checkWork } from '../src/lib/check.js';
import { SAMPLE_PAGES, SAMPLE_ISSUES } from './fixtures.js';

const decisions = [];
let n = 0;
for (const item of extractDecisionItems(SAMPLE_PAGES[0].adf)) {
  decisions.push({ id: `DEC-${++n}`, title: titleFrom(item.statement), statement: item.statement, status: 'active', tags: ['payments'], guardrails: extractGuardrails(item.statement) });
}
const t = parseDecisionTemplate(SAMPLE_PAGES[1].adf);
decisions.push({ id: `DEC-${++n}`, title: 'Feature flags go through LaunchDarkly', statement: t.statement, status: 'active', tags: [], guardrails: extractGuardrails(t.statement) });

const expected = ['conflict', 'conflict', 'conflict', 'conflict', 'related', 'related', 'clear'];

test('sample work items produce the intended verdicts', () => {
  SAMPLE_ISSUES.forEach((issue, i) => {
    const r = checkWork({ text: `${issue.summary}\n${issue.description}`, labels: issue.labels }, decisions);
    const got = r.status === 'related' && r.aligned.length ? 'related' : r.status;
    assert.equal(got, expected[i], `${issue.summary}: ${JSON.stringify(r.conflicts.map((c) => c.decision.id))}`);
  });
});
