// Development-only web trigger used by scripts/e2e.mjs to exercise the Rovo actions (the same
// functions exposed as MCP tools) without a browser. It is disabled unless the SELFTEST_TOKEN
// environment variable is set, which is only done in the development environment.

import * as actions from './actions.js';
import { recheck } from './lib/checker.js';
import { listDecisions, resetAll } from './lib/store.js';
import { harvestConfluencePage } from './lib/harvest.js';

const OPS = {
  'search-decisions': actions.searchDecisions,
  'get-decision': actions.getDecisionDetails,
  'check-work-item': actions.checkWorkItem,
  'record-decision': actions.recordDecision,
  'supersede-decision': actions.supersedeDecision,
  'log-exception': actions.logException,
  'list-conflicts': actions.listConflicts,
  recheck: (p) => recheck(p),
  harvest: (p) => harvestConfluencePage(p.pageId),
  'list-all': () => listDecisions(),
  reset: () => resetAll().then(() => ({ reset: true })),
};

export async function selftest(request) {
  const token = process.env.SELFTEST_TOKEN;
  const given = (request.headers?.['x-selftest-token'] || [])[0];
  if (!token || given !== token) return { statusCode: 404, body: 'Not found' };
  try {
    const { op, payload } = JSON.parse(request.body || '{}');
    const fn = OPS[op];
    if (!fn) return { statusCode: 400, body: `Unknown op ${op}` };
    const result = await fn(payload || {}, { principal: { accountId: 'selftest' } });
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(result ?? null) };
  } catch (e) {
    return { statusCode: 500, body: String(e.stack || e) };
  }
}
