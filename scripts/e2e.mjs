// End-to-end checks against the live development installation (seeded with scripts/seed-demo.mjs).
// Exercises every Rovo action / MCP tool through the development-only selftest web trigger, plus
// JQL over the indexed issue property. Leaves the data as it found it.
//   SELFTEST_URL_FILE=… SELFTEST_TOKEN_FILE=… node scripts/e2e.mjs
import assert from 'node:assert/strict';
import { op } from './selftest.mjs';
import { call, sleep } from './lib.mjs';

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]);
  }
}

await step('register has the 12 seeded decisions', async () => {
  const all = await op('list-all');
  assert.ok(all.length >= 12, `found ${all.length}`);
  assert.ok(all.some((d) => d.source?.type === 'jira'), 'decision harvested from a Jira comment');
});

await step('search-decisions ranks the PostgreSQL decision first for "payments database"', async () => {
  const r = await op('search-decisions', { query: 'payments database storage' });
  assert.equal(r.decisions[0].id, 'DEC-1');
  assert.equal(r.decisions[0].owner, 'Priya Shah');
  assert.match(r.decisions[0].source.url, /\/wiki\/spaces\/ENG\/pages\//);
});

await step('get-decision returns rationale and touching work items', async () => {
  const d = await op('get-decision', { decisionId: 'dec-1' });
  assert.match(d.rationale, /ACID/);
  assert.ok(d.workItemsTouchingIt.some((w) => w.key === 'PAY-1' && w.verdict === 'conflict'));
  assert.ok(d.workItemsTouchingIt.some((w) => w.key === 'PAY-4' && w.verdict === 'aligned'));
});

await step('list-conflicts finds the 8 seeded conflicts', async () => {
  const r = await op('list-conflicts');
  const keys = r.items.map((i) => i.workItem.key).sort();
  assert.deepEqual(keys, ['CHK-1', 'CHK-2', 'CHK-3', 'PAY-1', 'PAY-2', 'PAY-3', 'PLAT-1', 'PLAT-2']);
});

await step('check-work-item on an issue key', async () => {
  const r = await op('check-work-item', { issueKey: 'PLAT-3' });
  assert.equal(r.verdict, 'related');
  assert.equal(r.aligned[0].decision.id, 'DEC-7', 'migrating off Jenkins is aligned');
});

await step('check-work-item on a free-text plan (coding agent)', async () => {
  const r = await op('check-work-item', { plan: 'Add the Datadog APM agent to the refunds service to profile slow queries' });
  assert.equal(r.verdict, 'conflict');
  assert.equal(r.conflicts[0].decision.id, 'DEC-9');
  const ok = await op('check-work-item', { plan: 'Instrument the refunds service with OpenTelemetry traces' });
  assert.notEqual(ok.verdict, 'conflict');
});

await step('JQL precedentConflicts > 0 returns the conflicting work items', async () => {
  const r = await call('POST', '/rest/api/3/search/jql', { jql: 'precedentConflicts > 0 ORDER BY key ASC', fields: ['summary'], maxResults: 50 });
  const keys = r.issues.map((i) => i.key).sort();
  assert.deepEqual(keys, ['CHK-1', 'CHK-2', 'CHK-3', 'PAY-1', 'PAY-2', 'PAY-3', 'PLAT-1', 'PLAT-2']);
});

let recorded;
await step('record-decision → new work contradicting it is flagged', async () => {
  const r = await op('record-decision', {
    statement: 'Do not use GraphQL subscriptions for merchant notifications; use webhooks.',
    tags: 'notifications',
    ownerName: 'E2E Bot',
  });
  recorded = r.recorded.id;
  assert.deepEqual(r.recorded.avoid, ['GraphQL subscriptions']);
  const c = await op('check-work-item', { plan: 'Push payout updates to merchants with GraphQL subscriptions' });
  assert.equal(c.conflicts[0]?.decision.id, recorded);
});

await step('supersede-decision retires the old decision', async () => {
  const r = await op('supersede-decision', {
    decisionId: recorded,
    newStatement: 'Merchant notifications use webhooks or GraphQL subscriptions.',
    reason: 'E2E test',
  });
  const old = await op('get-decision', { decisionId: recorded });
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy, r.replacement.id);
  const c = await op('check-work-item', { plan: 'Push payout updates to merchants with GraphQL subscriptions' });
  assert.notEqual(c.verdict, 'conflict');
  recorded = [recorded, r.replacement.id];
});

await step('log-exception clears one work item only', async () => {
  const r = await op('log-exception', { decisionId: 'DEC-10', issueKey: 'CHK-3', reason: 'E2E exception' });
  assert.notEqual(r.newVerdict, 'conflict');
});

// ---------- restore ----------
await step('cleanup', async () => {
  // remove the exception and the test decisions, then re-check CHK-3
  const all = await op('list-all');
  const dec10 = all.find((d) => d.id === 'DEC-10');
  assert.ok(dec10);
  await op('cleanup', { removeIds: recorded, clearExceptions: { 'DEC-10': 'CHK-3' } });
  await sleep(500);
  const r = await op('check-work-item', { issueKey: 'CHK-3' });
  assert.equal(r.verdict, 'conflict');
});

for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
