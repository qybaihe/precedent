// "Try it with sample data": creates a realistic architecture-review page, a Decision page and
// a handful of work items so a new installation shows Precedent working within a minute.
// The same content is used by scripts/seed-demo.mjs for the demo site.

import { createPage, createIssue } from './lib/products.js';
import { harvestConfluencePage } from './lib/harvest.js';
import { enqueueRecheck } from './lib/checker.js';
import { listDecisions, saveDecision } from './lib/store.js';
import { normalizeGuard } from './lib/guard.js';

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? text(c) : c)) });
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const decision = (id, t) => ({
  type: 'decisionList',
  attrs: { localId: `dl-${id}` },
  content: [{ type: 'decisionItem', attrs: { localId: `di-${id}`, state: 'DECIDED' }, content: [text(t)] }],
});
const li = (t) => ({ type: 'listItem', content: [p(t)] });
const row = (k, v) => ({
  type: 'tableRow',
  content: [
    { type: 'tableHeader', content: [p(k)] },
    { type: 'tableCell', content: [p(...(Array.isArray(v) ? v : [v]))] },
  ],
});

export const SAMPLE_PAGES = [
  {
    title: 'Payments Architecture Review — 2026-03-12',
    adf: {
      type: 'doc',
      version: 1,
      content: [
        p(text('Attendees: ', [{ type: 'strong' }]), 'Priya Shah (Payments lead), Marco Rossi (Security), Dana Kim (Finance Eng), Sam Lee (Platform)'),
        p('Goal: settle the open architecture questions for the payout ledger before the Q2 build starts.'),
        h(2, 'Payout ledger storage'),
        p('We compared MongoDB and PostgreSQL for the new payout ledger. Reconciliation needs multi-row ACID transactions, and Finance runs SQL audits against the ledger every night. MongoDB would also add a second on-call runbook for the team.'),
        decision('ledger', 'Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments. — decided by Priya Shah'),
        h(2, 'Partner bank access'),
        p('Two partner banks asked to call the ledger service directly to pull settlement files. Security flagged this: internal services have no rate limiting, WAF or partner-level auth.'),
        decision('gateway', 'All partner and public traffic must go through the API Gateway; do not expose internal services directly to the internet. — decided by Marco Rossi'),
        h(2, 'Card processing'),
        p('Running two card processors doubles PCI scope and reconciliation work. Stripe already covers every market on the 2026 roadmap.'),
        decision('stripe', 'Standardize on Stripe for card payments instead of Adyen. — decided by Dana Kim'),
        h(2, 'Logging'),
        p('A January incident leaked customer emails into the log pipeline, which is retained for 400 days and readable by 60+ engineers.'),
        decision('pii', 'Customer PII must never be logged; use the redaction middleware for request logs. — decided by Priya Shah'),
        h(2, 'Action items'),
        p('Sam to publish the gateway onboarding guide for partner integrations.'),
      ],
    },
  },
  {
    title: 'Decision: Feature flags go through LaunchDarkly',
    adf: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'table',
          attrs: { isNumberColumnEnabled: false, layout: 'default' },
          content: [
            row('Status', [{ type: 'status', attrs: { text: 'DECIDED', color: 'green', localId: 'st-1' } }]),
            row('Owner', 'Sam Lee'),
            row('Decided on', '2026-04-02'),
            row('Outcome', 'Use LaunchDarkly for all feature flags — no homegrown feature flag systems.'),
          ],
        },
        h(2, 'Background'),
        p('Three teams had built their own flag toggles (env vars, a JSON file in S3, a database table). During the March checkout incident nobody could tell which flags were on in production. LaunchDarkly gives us audit logs, kill switches and per-segment rollouts.'),
        h(2, 'Options considered'),
        p('1. Keep team-owned flag systems  2. Build a shared internal flag service  3. LaunchDarkly (chosen)'),
      ],
    },
  },
];

// Meeting notes where the decisions are written in prose, not as /decision items: open the page's
// Precedent byline and click "Find decisions on this page".
SAMPLE_PAGES.push({
  title: 'Payments Sync — 2026-10-27',
  adf: {
    type: 'doc',
    version: 1,
    content: [
      p(text('Attendees: ', [{ type: 'strong' }]), 'Priya Shah, Marco Rossi, Dana Kim, Sam Lee'),
      h(2, 'Discussion'),
      p('Marco walked through the two settlement-file incidents from September. After some back and forth we agreed that refund webhooks are retried for 72 hours before they move to the dead-letter queue.'),
      p('Maybe we should consider GraphQL for the partner API? Parked until Q1.'),
      p('Dana confirmed the EU card rollout is on track for December.'),
      h(2, 'Decisions'),
      {
        type: 'bulletList',
        content: [
          li('All new payment services publish domain events through Kafka instead of direct HTTP callbacks — decided by Marco Rossi'),
          li('Going forward, settlement reports are generated in the data warehouse, not in the payments database.'),
        ],
      },
      h(2, 'Action items'),
      { type: 'taskList', attrs: { localId: 'tl-1' }, content: [{ type: 'taskItem', attrs: { localId: 'ti-1', state: 'TODO' }, content: [text('Marco to draft the Kafka topic naming guide')] }] },
    ],
  },
});

export const SAMPLE_ISSUES = [
  {
    summary: 'Store payout ledger in MongoDB for flexible schemas',
    description: 'The payout ledger schema changes every sprint. Move the ledger to MongoDB so we can iterate without writing migrations.\n\nAcceptance: ledger writes and reads go through the new Mongo collection.',
    labels: ['payments', 'ledger'],
  },
  {
    summary: 'Give partner banks direct access to the ledger service',
    description: 'Expose the ledger service directly to partner banks so they can pull settlement files without waiting on the gateway team.',
    labels: ['partners'],
  },
  {
    summary: 'Add request body logging to the checkout API',
    description: 'Log full request bodies, including customer email and other PII, to debug intermittent checkout failures.',
    labels: ['checkout', 'observability'],
  },
  {
    summary: 'Build a homegrown feature flag service for checkout experiments',
    description: 'Checkout wants to run pricing experiments next sprint. Build a small homegrown feature flag service backed by Redis.',
    labels: ['checkout'],
  },
  {
    summary: 'Remove MongoDB from the refunds service',
    description: 'Migrate the remaining refund records from MongoDB to the payments PostgreSQL cluster and drop the Mongo dependency.',
    labels: ['payments', 'tech-debt'],
  },
  {
    summary: 'Speed up payout reports with a PostgreSQL index',
    description: 'Payout reports for large merchants take 40s. Add a composite index on the payments transactional tables in PostgreSQL.',
    labels: ['payments', 'performance'],
  },
  {
    summary: 'Retry webhook deliveries with exponential backoff',
    description: 'Merchants miss webhooks during short outages. Retry failed deliveries up to 8 times with exponential backoff and jitter.',
    labels: ['webhooks'],
  },
  {
    // contradicts the Kafka decision in the meeting notes once that decision is tracked
    summary: 'Notify the ledger of settled refunds with direct HTTP callbacks',
    description: 'When a refund settles, the refunds service calls the ledger service with direct HTTP callbacks so merchant balances update immediately.',
    labels: ['payments', 'refunds'],
  },
];

/** Create sample content in a chosen Confluence space and Jira project. */
export async function createSampleData({ spaceId, projectKey }) {
  const out = { pages: [], issues: [], decisions: 0 };
  if (spaceId) {
    for (const page of SAMPLE_PAGES) {
      // Page titles are unique per space, so number repeated sample runs.
      let created = null;
      for (let attempt = 1; !created && attempt <= 5; attempt++) {
        const title = attempt === 1 ? `${page.title} (sample)` : `${page.title} (sample ${attempt})`;
        try {
          // eslint-disable-next-line no-await-in-loop
          created = await createPage({ spaceId, title, adf: page.adf });
        } catch (e) {
          if (e.status !== 400 || attempt === 5) throw e;
        }
      }
      out.pages.push({ id: created.id, title: created.title });
      // Harvest right away instead of waiting for the page trigger, so the log fills instantly.
      // eslint-disable-next-line no-await-in-loop
      const r = await harvestConfluencePage(created.id);
      out.decisions += r.created;
      // the ledger decision gets a guard and its premises, so briefs and agent checks show them
      // eslint-disable-next-line no-await-in-loop
      const ledger = (await listDecisions()).find((d) => d.source?.pageId === String(created.id) && /PostgreSQL/.test(d.statement));
      if (ledger && !ledger.guard) {
        // eslint-disable-next-line no-await-in-loop
        await saveDecision({
          ...ledger,
          guard: normalizeGuard({ paths: 'services/payments/**, db/ledger/**', packages: { deny: 'mongodb, mongoose, @aws-sdk/client-dynamodb', allow: 'pg, prisma' }, keywords: 'DocumentDB, Cosmos DB' }),
          assumptions: [
            { id: 'a-sample-1', text: 'Reconciliation needs multi-row ACID transactions', status: 'holds', addedAt: new Date().toISOString() },
            { id: 'a-sample-2', text: 'Finance audits the ledger with SQL every night', status: 'holds', addedAt: new Date().toISOString() },
          ],
        });
      }
    }
  }
  if (projectKey) {
    for (const issue of SAMPLE_ISSUES) {
      // eslint-disable-next-line no-await-in-loop
      const created = await createIssue({ projectKey, ...issue });
      out.issues.push(created.key);
    }
  }
  await enqueueRecheck(projectKey ? `project = "${projectKey}" ORDER BY created DESC` : undefined);
  return out;
}
