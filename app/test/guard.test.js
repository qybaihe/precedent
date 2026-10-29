import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGuard,
  globToRegExp,
  matchPath,
  matchPackage,
  packageName,
  packagesFromText,
  pathsFromText,
  evaluateGuard,
  describeGuard,
} from '../src/lib/guard.js';
import { checkWork } from '../src/lib/check.js';
import { extractGuardrails } from '../src/lib/guardrails.js';

const LEDGER = {
  id: 'DEC-1',
  status: 'active',
  title: 'Keep all transactional payment data in PostgreSQL',
  statement: 'Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments.',
  guardrails: extractGuardrails('Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments.'),
  guard: { paths: ['services/payments/**', 'db/ledger'], packages: { deny: ['mongodb', 'mongoose', '@aws-sdk/client-dynamodb'], allow: ['pg'] }, keywords: ['DocumentDB'], jql: 'project = PAY' },
};

test('normalizeGuard cleans form input and returns null when empty', () => {
  assert.equal(normalizeGuard(null), null);
  assert.equal(normalizeGuard({ paths: ' ', keywords: [] }), null);
  const g = normalizeGuard({ paths: './services/payments/**, db/ledger', denyPackages: 'Mongoose@^8, mongodb, mongodb', keywords: 'DocumentDB\nCosmos', jql: ' project = PAY ' });
  assert.deepEqual(g, {
    paths: ['services/payments/**', 'db/ledger'],
    packages: { deny: ['mongoose', 'mongodb'], allow: [] },
    keywords: ['DocumentDB', 'Cosmos'],
    jql: 'project = PAY',
  });
});

test('package names drop versions and quotes, keep scopes', () => {
  assert.equal(packageName('Lodash@^4.17.0'), 'lodash');
  assert.equal(packageName('@aws-sdk/client-dynamodb@3'), '@aws-sdk/client-dynamodb');
  assert.equal(packageName('"redis",'), 'redis');
  assert.equal(packageName('requests>=2.0'), 'requests');
});

test('globs: ** any depth, * one segment, braces, bare directories', () => {
  assert.ok(matchPath('services/payments/**', 'services/payments/ledger/store.ts'));
  assert.ok(matchPath('services/payments/**', 'services/payments/index.ts'));
  assert.ok(!matchPath('services/payments/**', 'services/checkout/index.ts'));
  assert.ok(matchPath('src/*.ts', 'src/a.ts'));
  assert.ok(!matchPath('src/*.ts', 'src/deep/a.ts'));
  assert.ok(matchPath('**/*.{sql,prisma}', 'db/schema.prisma'));
  assert.ok(matchPath('db/ledger', 'db/ledger/001_init.sql'), 'a bare directory governs what is below it');
  assert.ok(matchPath('./db/ledger', 'db/ledger'));
  assert.ok(globToRegExp('a.b/c').test('a.b/c'));
  assert.ok(!globToRegExp('a.b/c').test('aXb/c'), 'dots are literal');
});

test('package patterns: exact or glob', () => {
  assert.ok(matchPackage('mongoose', 'Mongoose@8'));
  assert.ok(matchPackage('@aws-sdk/*', '@aws-sdk/client-dynamodb'));
  assert.ok(matchPackage('moment*', 'moment-timezone'));
  assert.ok(!matchPackage('mongo', 'mongoose'));
});

test('packages and paths are read from plans and diff summaries', () => {
  const plan = 'Run npm install mongoose@8 zod --save, then pip install redis==5.0\n+  "kafkajs": "^2.2.4",\n+redis-py==1.0\nEdit services/payments/ledger.ts and +++ b/db/ledger/002.sql';
  assert.deepEqual(packagesFromText(plan).sort(), ['kafkajs', 'mongoose', 'redis', 'redis-py', 'zod']);
  assert.deepEqual(pathsFromText(plan).sort(), ['db/ledger/002.sql', 'services/payments/ledger.ts']);
});

test('evaluateGuard: scope by paths and JQL, violations by package', () => {
  const inside = evaluateGuard(LEDGER, { paths: ['services/payments/payout.ts', 'README.md'], packages: ['mongoose', 'zod'] });
  assert.equal(inside.applies, true);
  assert.deepEqual(inside.governed, ['services/payments/payout.ts']);
  assert.deepEqual(inside.violations, [{ rule: 'package', item: 'mongoose', pattern: 'mongoose' }]);
  assert.equal(evaluateGuard(LEDGER, { paths: ['web/app.tsx'], packages: ['mongoose'] }).applies, false, 'files outside the guarded paths');
  assert.equal(evaluateGuard(LEDGER, { jqlScope: { 'DEC-1': false } }).applies, false, 'work item outside the guard JQL');
  assert.equal(evaluateGuard(LEDGER, {}).applies, true, 'unknown files: the decision still applies');
  assert.deepEqual(evaluateGuard({ id: 'DEC-2' }, { packages: ['x'] }), { applies: true, governed: [], violations: [], byJql: false });
  assert.equal(evaluateGuard(LEDGER, { jqlScope: { 'DEC-1': true } }).byJql, true);
});

test('checkWork: denied packages and guard keywords become conflicts; paths make a decision governing', () => {
  const r = checkWork({ text: 'Store payout events', paths: ['services/payments/events.ts'], packages: ['@aws-sdk/client-dynamodb'] }, [LEDGER]);
  assert.equal(r.status, 'conflict');
  assert.equal(r.conflicts[0].rule, 'package');
  assert.deepEqual(r.conflicts[0].terms, ['@aws-sdk/client-dynamodb']);
  assert.equal(r.governing[0].decision.id, 'DEC-1');

  const kw = checkWork({ text: 'Move payout events to Amazon DocumentDB' }, [LEDGER]);
  assert.equal(kw.status, 'conflict', 'guard keyword matched in plain text');
  const pkgText = checkWork({ text: 'Add mongoose models for the payout ledger' }, [LEDGER]);
  assert.equal(pkgText.status, 'conflict', 'a denied package named in text');

  const elsewhere = checkWork({ text: 'Add mongoose to the analytics sandbox', paths: ['analytics/sandbox/db.ts'] }, [LEDGER]);
  assert.equal(elsewhere.status, 'clear', 'outside the guarded paths the decision does not apply');

  const touching = checkWork({ text: 'Tidy up logging', paths: ['services/payments/log.ts'] }, [LEDGER]);
  assert.equal(touching.status, 'related');
  assert.equal(touching.conflicts.length, 0);
});

test('exceptions also cover package violations', () => {
  const d = { ...LEDGER, exceptions: [{ issueKey: 'PAY-7', reason: 'spike' }] };
  const r = checkWork({ text: 'Spike', issueKey: 'PAY-7', packages: ['mongodb'] }, [d]);
  assert.equal(r.status, 'related');
  assert.match(r.aligned[0].reason, /Exception approved/);
});

test('describeGuard', () => {
  assert.equal(describeGuard(LEDGER.guard), 'files services/payments/**, db/ledger · no mongodb, mongoose, @aws-sdk/client-dynamodb · use pg · flags “DocumentDB” · work items: project = PAY');
  assert.equal(describeGuard(null), '');
});

test('create-dialog hint: already decided, related, or nothing', async () => {
  const { createHintFor, createFlagFor } = await import('../src/lib/hint.js');
  const d = { ...LEDGER, owner: { name: 'Priya Shah' }, decidedAt: '2026-03-12T00:00:00.000Z' };
  assert.equal(
    createHintFor('Move the payout ledger to MongoDB', [d], 'PAY'),
    '⚠ Already decided: DEC-1 “Keep all transactional payment data in PostgreSQL” rules out MongoDB (Priya Shah, Mar 12, 2026). Use PostgreSQL instead, or ask the owner before filing this.',
  );
  assert.equal(createHintFor('Update the footer copy', [d], 'PAY'), '');
  assert.equal(createFlagFor(createHintFor('Move the payout ledger to MongoDB', [d], 'PAY')), '⚠ Already decided in DEC-1');
  assert.equal(createFlagFor('ℹ Related decision: DEC-4 “x”.'), 'ℹ See DEC-4');
  assert.equal(createFlagFor(''), null);
});
