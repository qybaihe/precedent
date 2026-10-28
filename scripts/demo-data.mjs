// Demo content for the Lumen Pay engineering org (used by seed-demo.mjs and offline checks).
// ---------- ADF helpers ----------
const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const strong = (t) => text(t, [{ type: 'strong' }]);
const p = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? text(x) : x)) });
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const bullets = (...items) => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
let n = 0;
const decision = (t) => ({
  type: 'decisionList',
  attrs: { localId: `dl-${++n}` },
  content: [{ type: 'decisionItem', attrs: { localId: `di-${n}`, state: 'DECIDED' }, content: [text(t)] }],
});
const task = (t) => ({
  type: 'taskList',
  attrs: { localId: `tl-${++n}` },
  content: [{ type: 'taskItem', attrs: { localId: `ti-${n}`, state: 'TODO' }, content: [text(t)] }],
});
const row = (k, v) => ({
  type: 'tableRow',
  content: [
    { type: 'tableHeader', content: [p(k)] },
    { type: 'tableCell', content: [p(...(Array.isArray(v) ? v : [v]))] },
  ],
});
const table = (...rows) => ({ type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows });
const status = (t, color) => ({ type: 'status', attrs: { text: t, color, localId: `st-${++n}` } });
const panel = (type, ...content) => ({ type: 'panel', attrs: { panelType: type }, content });
const doc = (...content) => ({ type: 'doc', version: 1, content });

// ---------- Confluence pages ----------
export const PAGES = [
  {
    title: 'Payments Architecture Review — 2026-03-12',
    labels: ['architecture', 'payments', 'meeting-notes'],
    adf: doc(
      p(strong('Attendees: '), 'Priya Shah (Payments lead), Marco Rossi (Security), Dana Kim (Finance Engineering), Sam Lee (Platform)'),
      p('Goal: settle the open architecture questions for the payout ledger before the Q2 build starts.'),
      h(2, 'Payout ledger storage'),
      p('We compared MongoDB and PostgreSQL for the new payout ledger. Reconciliation needs multi-row ACID transactions, and Finance runs SQL audits against the ledger every night. MongoDB would also add a second on-call runbook for a team of five.'),
      decision('Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments. — decided by Priya Shah'),
      h(2, 'Partner bank access'),
      p('Two partner banks asked to call the ledger service directly to pull settlement files. Security flagged it: internal services have no rate limiting, no WAF and no partner-level auth.'),
      decision('All partner and public traffic must go through the API Gateway; do not expose internal services directly to the internet. — decided by Marco Rossi'),
      h(2, 'Card processing'),
      p('Running two card processors doubles our PCI scope and the reconciliation work. Stripe already covers every market on the 2026 roadmap, including the EU expansion.'),
      decision('Standardize on Stripe for card payments instead of Adyen. — decided by Dana Kim'),
      h(2, 'Logging'),
      p('The January incident leaked customer emails into the log pipeline, which is retained for 400 days and readable by 60+ engineers.'),
      decision('Customer PII must never be logged; use the redaction middleware for request logs. — decided by Priya Shah'),
      h(2, 'Action items'),
      task('Sam to publish the gateway onboarding guide for partner integrations'),
      task('Priya to add the redaction middleware to the service template'),
    ),
  },
  {
    title: 'Decision: Feature flags go through LaunchDarkly',
    labels: ['decision', 'platform'],
    adf: doc(
      table(
        row('Status', [status('DECIDED', 'green')]),
        row('Owner', 'Sam Lee'),
        row('Decided on', '2026-04-02'),
        row('Stakeholders', 'Checkout, Payments, Mobile'),
        row('Outcome', 'Use LaunchDarkly for all feature flags — no homegrown feature flag systems.'),
      ),
      h(2, 'Background'),
      p('Three teams had built their own flag toggles (environment variables, a JSON file in S3, a database table). During the March checkout incident nobody could tell which flags were on in production. LaunchDarkly gives us audit logs, kill switches and per-segment rollouts.'),
      h(2, 'Options considered'),
      bullets('Keep team-owned flag systems', 'Build a shared internal flag service', 'LaunchDarkly (chosen)'),
      h(2, 'Action items'),
      task('Migrate checkout flags by end of April'),
    ),
  },
  {
    title: 'ADR-007: Mobile framework for the 2026 rewrite',
    labels: ['decision', 'mobile', 'adr'],
    adf: doc(
      table(
        row('Status', [status('DECIDED', 'green')]),
        row('Owner', 'Ana Torres'),
        row('Decided on', '2026-02-10'),
        row('Outcome', 'We chose React Native over Flutter for the mobile rewrite.'),
      ),
      h(2, 'Background'),
      p('The merchant app is two native codebases maintained by four engineers. We need one codebase. The web team already ships TypeScript and React, so React Native lets us share validation logic, design tokens and people across web and mobile.'),
      h(2, 'Consequences'),
      bullets('New mobile features are built in React Native only', 'The Flutter prototype is archived'),
    ),
  },
  {
    title: 'Platform Guild Sync — 2026-05-21',
    labels: ['platform', 'meeting-notes'],
    adf: doc(
      p(strong('Attendees: '), 'Sam Lee, Ana Torres, Leo Martin, Priya Shah'),
      h(2, 'CI/CD'),
      p('Jenkins costs us a full-time engineer in maintenance and its plugins are three major versions behind. Bitbucket Pipelines already runs 70% of our builds.'),
      decision('Phase out Jenkins by Q3 2026; all new pipelines run on Bitbucket Pipelines. — decided by Sam Lee'),
      h(2, 'Caching'),
      p('We found five team-owned Redis instances, two of them without backups or TLS. Platform now runs a managed, shared Redis cluster with per-team namespaces.'),
      decision('Caching goes through the shared Redis cluster managed by Platform; do not run team-owned Redis instances. — decided by Sam Lee'),
      h(2, 'Observability'),
      p('We are consolidating tracing on OpenTelemetry so traces flow into one backend regardless of vendor. New APM agents lock us in and double the bill.'),
      decision('Use OpenTelemetry for all new tracing; do not add new Datadog APM agents. — decided by Ana Torres'),
      h(2, 'Action items'),
      task('Leo to send the Redis namespace request form to all teams'),
    ),
  },
  {
    title: 'Checkout Team Retro — 2026-06-04',
    labels: ['checkout', 'meeting-notes', 'retro'],
    adf: doc(
      p(strong('Attendees: '), 'Leo Martin (Checkout lead), Ana Torres, Dana Kim'),
      h(2, 'What went well'),
      bullets('Apple Pay launch hit conversion targets', 'Fewer flaky end-to-end tests'),
      h(2, 'Guest checkout'),
      p('The phone-number experiment cut guest conversion by 9% with no measurable fraud reduction. Fraud is handled by Stripe Radar instead.'),
      decision('Guest checkout stays email-only; do not require phone numbers at checkout. — decided by Leo Martin'),
      h(2, 'Browser support'),
      p('IE11 is 0.04% of merchant dashboard sessions and blocks us from using modern CSS.'),
      decision('We will not support IE11 in the merchant dashboard. — decided by Leo Martin'),
    ),
  },
  {
    title: 'Payments Onboarding Guide',
    labels: ['onboarding', 'payments'],
    adf: doc(
      panel('info', p('Start here if you just joined the Payments team.')),
      h(2, 'Systems you will touch'),
      bullets('Ledger service (PostgreSQL)', 'Payout scheduler', 'Stripe integration', 'API Gateway partner routes'),
      h(2, 'Where decisions live'),
      p('Architecture decisions are recorded with /decision in meeting notes and Decision pages. Precedent tracks them and flags Jira work that contradicts them.'),
    ),
  },
];

// ---------- Jira work items ----------
export const ISSUES = [
  // Payments
  { project: 'PAY', summary: 'Store payout ledger in MongoDB for flexible schemas', description: 'The payout ledger schema changes every sprint. Move the ledger to MongoDB so we can iterate without writing migrations.\n\nAcceptance: ledger writes and reads go through the new Mongo collection.', labels: ['payments', 'ledger'], status: 'In Progress' },
  { project: 'PAY', summary: 'Give partner banks direct access to the ledger service', description: 'Expose the ledger service directly to partner banks so they can pull settlement files without waiting on the gateway team.', labels: ['partners'], comment: 'Synced with Security and the partner team.\n\nDecision: partner settlement files are delivered via SFTP drop, never by giving partners database credentials.' },
  { project: 'PAY', summary: 'Evaluate Adyen as a second card processor for EU merchants', description: 'Some EU merchants asked for Adyen. Spike: integrate Adyen for card payments behind the processor interface and compare fees.', labels: ['payments', 'eu'] },
  { project: 'PAY', summary: 'Remove MongoDB from the refunds service', description: 'Migrate the remaining refund records from MongoDB to the payments PostgreSQL cluster and drop the Mongo dependency.', labels: ['payments', 'tech-debt'], status: 'In Progress' },
  { project: 'PAY', summary: 'Speed up payout reports with a PostgreSQL index', description: 'Payout reports for large merchants take 40s. Add a composite index on the payments transactional tables in PostgreSQL.', labels: ['payments', 'performance'] },
  { project: 'PAY', summary: 'Retry webhook deliveries with exponential backoff', description: 'Merchants miss webhooks during short outages. Retry failed deliveries up to 8 times with exponential backoff and jitter.', labels: ['webhooks'], status: 'Done' },
  // Checkout
  { project: 'CHK', summary: 'Add request body logging to the checkout API', description: 'Log full request bodies, including customer email and other PII, to debug intermittent checkout failures.', labels: ['checkout', 'observability'], status: 'In Progress' },
  { project: 'CHK', summary: 'Build a homegrown feature flag service for checkout experiments', description: 'Checkout wants to run pricing experiments next sprint. Build a small homegrown feature flag service backed by a database table.', labels: ['checkout', 'experiments'] },
  { project: 'CHK', summary: 'Require phone number for guest checkout to reduce fraud', description: 'Fraud team suggests we require phone numbers at checkout for guest users above $500.', labels: ['checkout', 'fraud'] },
  { project: 'CHK', summary: 'Redact PII from checkout error logs', description: 'Apply the redaction middleware so customer emails and addresses are masked in checkout error logs.', labels: ['checkout', 'security'], status: 'Done' },
  { project: 'CHK', summary: 'Show saved cards on the payment step', description: 'Returning customers should see their saved Stripe cards on the payment step.', labels: ['checkout'] },
  // Platform
  { project: 'PLAT', summary: 'Spin up a team-owned Redis instance for search autocomplete', description: 'Search needs a low-latency cache for autocomplete. Run a team-owned Redis instance on the search hosts.', labels: ['search', 'caching'] },
  { project: 'PLAT', summary: 'Add Datadog APM agent to the ledger service', description: 'Install the Datadog APM agent on the ledger service to get flame graphs for slow payout queries.', labels: ['observability'] },
  { project: 'PLAT', summary: 'Migrate the last three Jenkins jobs to Bitbucket Pipelines', description: 'Move the nightly reconciliation, the iOS build and the data export off Jenkins so we can decommission it.', labels: ['ci'], status: 'In Progress' },
  { project: 'PLAT', summary: 'Upgrade services to the Node.js 24 runtime', description: 'Node 20 reaches end of life. Upgrade all services and the service template to Node.js 24.', labels: ['maintenance'] },
];

