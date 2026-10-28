// Generated from src/sample.js (pure data part) for unit tests. Regenerate: npm run fixtures
const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? text(c) : c)) });
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const decision = (id, t) => ({
  type: 'decisionList',
  attrs: { localId: `dl-${id}` },
  content: [{ type: 'decisionItem', attrs: { localId: `di-${id}`, state: 'DECIDED' }, content: [text(t)] }],
});
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
];

