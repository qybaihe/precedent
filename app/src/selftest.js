// Development-only web trigger used by scripts/e2e.mjs to exercise the Rovo actions (the same
// functions exposed as MCP tools) without a browser. It is disabled unless the SELFTEST_TOKEN
// environment variable is set, which is only done in the development environment.

import * as actions from './actions.js';
import { recheck } from './lib/checker.js';
import { listDecisions, resetAll, deleteDecision, getDecision, saveDecision } from './lib/store.js';
import { checkIssue } from './lib/checker.js';
import { harvestConfluencePage } from './lib/harvest.js';
import { createSampleData } from './sample.js';

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
  sample: (p) => createSampleData(p),
  reset: () => resetAll().then(() => ({ reset: true })),
  // undo what scripts/e2e.mjs created
  cleanup: async ({ removeIds = [], clearExceptions = {} }) => {
    for (const id of removeIds) await deleteDecision(id);
    for (const [id, issueKey] of Object.entries(clearExceptions)) {
      const d = await getDecision(id);
      if (d) await saveDecision({ ...d, exceptions: (d.exceptions || []).filter((e) => e.issueKey !== issueKey), history: (d.history || []).filter((h) => !/E2E/.test(h.what)) });
      await checkIssue(issueKey);
    }
    return { ok: true };
  },
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
