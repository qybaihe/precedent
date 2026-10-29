// Demo data for previewing the UI outside Atlassian (`npm run preview`, then ?surface=center|radar|issue|byline).
// Mirrors the Lumen Pay sample site; never loaded inside Forge.
const SITE = 'https://example.atlassian.net';
const PAGE = { title: 'Payments Architecture Review — 2026-03-12', url: `${SITE}/wiki/spaces/ENG/pages/1`, type: 'confluence', label: 'Confluence', kind: 'Decision in meeting notes' };
const g = (avoid = [], prefer = []) => ({ avoid: avoid.map((text) => ({ text })), prefer: prefer.map((text) => ({ text })) });
const dec = (n, title, owner, date, guard, extra = {}) => ({
  id: `DEC-${n}`,
  title,
  statement: extra.statement || `${title}.`,
  rationale: extra.rationale || '',
  status: extra.status || 'active',
  owner: owner ? { name: owner } : null,
  decidedAt: `${date}T00:00:00.000Z`,
  source: extra.source || PAGE,
  guardrails: guard,
  tags: extra.tags || [],
  exceptions: extra.exceptions || [],
  history: [{ at: `${date}T00:00:00.000Z`, kind: 'captured', what: 'Captured from Confluence' }, ...(extra.history || [])],
  assumptions: extra.assumptions || [],
  ...(extra.supersededBy ? { supersededBy: extra.supersededBy } : {}),
});

let decisions = [
  dec(1, 'Keep all transactional payment data in PostgreSQL', 'Priya Shah', '2026-03-12', g(['MongoDB', 'document stores']), {
    statement: 'Keep all transactional payment data in PostgreSQL. Do not introduce MongoDB or other document stores for payments.',
    rationale: 'Reconciliation needs multi-row ACID transactions and Finance runs SQL audits against the ledger every night. MongoDB would also add a second on-call runbook for a team of five.',
    tags: ['payments', 'database'],
    guard: { paths: ['services/payments/**', 'db/ledger/**'], packages: { deny: ['mongodb', 'mongoose', '@aws-sdk/client-dynamodb'], allow: ['pg', 'prisma'] }, keywords: ['DocumentDB'], jql: 'project = PAY' },
    assumptions: [{ id: 'a1', text: 'Reconciliation needs multi-row ACID transactions', status: 'holds', addedAt: '2026-10-20T09:00:00.000Z' }],
    history: [{ at: '2026-10-20T09:00:00.000Z', kind: 'assumption', what: 'Assumption tracked: “Reconciliation needs multi-row ACID transactions”' }],
  }),
  dec(2, 'All partner and public traffic must go through the API Gateway', 'Marco Rossi', '2026-03-12', g(['internal services directly'], ['API Gateway']), { tags: ['security'] }),
  dec(3, 'Standardize on Stripe for card payments instead of Adyen', 'Dana Kim', '2026-03-12', g(['Adyen'], ['Stripe']), {
    rationale: 'Stripe already covers our PCI scope and the reconciliation work; Stripe already covers every market on the 2026 roadmap, including the EU expansion.',
    exceptions: [{ issueKey: 'PAY-7', reason: 'Partner pilot in NL needs iDEAL via the incumbent processor until Q1.', at: '2026-09-30T10:00:00.000Z' }],
    history: [{ at: '2026-10-12T10:00:00.000Z', kind: 'reminder', what: 'Review reminder sent to Dana Kim' }],
  }),
  dec(4, 'Customer PII must never be logged', 'Priya Shah', '2026-03-12', g(['PII logging']), { tags: ['privacy'] }),
  dec(5, 'Feature flags go through LaunchDarkly', 'Sam Lee', '2026-04-02', g(['homegrown feature flags'], ['LaunchDarkly']), { source: { ...PAGE, title: 'Decision: Feature flags go through LaunchDarkly', kind: 'Decision page' } }),
  dec(6, 'ADR-007: React Native for the 2026 mobile rewrite', 'Ana Torres', '2026-05-18', g(['Flutter'], ['React Native']), {
    source: { ...PAGE, title: 'ADR-007: Mobile framework for the 2026 rewrite', kind: 'Decision page' },
    rationale: 'Two of three mobile engineers know React. We share the design system with the web checkout.',
    assumptions: [{ id: 'a2', text: 'Two of three mobile engineers know React', status: 'changed', note: 'the React engineers moved to the web team in October', changedAt: '2026-10-24T09:00:00.000Z' }],
    history: [{ at: '2026-10-24T09:00:00.000Z', kind: 'assumption', what: 'Assumption no longer holds: “Two of three mobile engineers know React” — the React engineers moved to the web team in October' }],
  }),
  dec(7, 'Phase out Jenkins by Q3 2026', 'Sam Lee', '2026-05-21', g(['Jenkins'], ['Bitbucket Pipelines']), { source: { ...PAGE, title: 'Platform Guild Sync — 2026-05-21' } }),
  dec(8, 'Caching goes through the shared Redis cluster managed by Platform', 'Sam Lee', '2026-05-21', g(['dedicated Redis'], ['shared Redis cluster']), { source: { ...PAGE, title: 'Platform Guild Sync — 2026-05-21' } }),
  dec(9, 'Use OpenTelemetry for all new tracing', 'Ana Torres', '2026-05-21', g(['Datadog APM agent'], ['OpenTelemetry']), { source: { ...PAGE, title: 'Platform Guild Sync — 2026-05-21' } }),
  dec(10, 'Guest checkout stays email-only', 'Leo Martin', '2026-06-04', g(['SMS checkout']), { source: { ...PAGE, title: 'Checkout Team Retro — 2026-06-04' } }),
  dec(11, 'We will not support 3DS1 in the merchant dashboard', null, '2026-06-04', g([]), { source: { ...PAGE, title: 'Checkout Team Retro — 2026-06-04' } }),
  dec(12, 'Partner settlement files are delivered via SFTP drop, never by email', 'he bai', '2026-10-29', g(['email'], ['SFTP drop']), { source: { type: 'jira', label: 'Jira', kind: 'Recorded on a work item', title: 'PAY-2', url: `${SITE}/browse/PAY-2` } }),
  dec(13, 'Mobile apps are built with Flutter', 'Ana Torres', '2026-01-20', g(['React Native']), { status: 'superseded', supersededBy: 'DEC-6', history: [{ at: '2026-05-18T00:00:00.000Z', kind: 'superseded', what: 'Superseded by DEC-6: the web and mobile teams share one design system' }] }),
];

const issue = (key, summary, status, cat, assignee) => ({ key, summary, projectKey: key.split('-')[0], status, statusCategory: cat, assignee: assignee ? { displayName: assignee } : null, url: `${SITE}/browse/${key}` });
const ref = (id) => {
  const d = decisions.find((x) => x.id === id);
  return { id, title: d.title, statement: d.statement, status: d.status, owner: d.owner, decidedAt: d.decidedAt, source: d.source, guardrails: d.guardrails };
};
const FIX = { 'DEC-1': ['rewrite', 'MongoDB', 'PostgreSQL'], 'DEC-3': ['rewrite', 'Adyen', 'Stripe'], 'DEC-7': ['rewrite', 'Jenkins', 'Bitbucket Pipelines'], 'DEC-2': ['advice', 'internal services directly', 'API Gateway'], 'DEC-4': ['advice', 'PII logging', null] };
const fixFor = (id) => {
  const f = FIX[id];
  if (!f) return null;
  return { kind: f[0], from: f[1], to: f[2], advice: f[0] === 'rewrite' ? `Use ${f[2]} instead of ${f[1]}, as ${id} requires.` : f[2] ? `Route it through ${f[2]} instead of relying on ${f[1]} (${id}).` : `Rework this so it no longer relies on ${f[1]} (${id}).` };
};
const C = (i, id, term, evidence, ack = false) => ({ issue: i, status: ack ? 'acknowledged' : 'conflict', conflicts: [{ decision: ref(id), term, terms: [term], evidence, acknowledged: ack, fix: fixFor(id) }], aligned: [], related: [], checkedAt: '2026-10-29T08:10:00.000Z' });
const A = (i, id, reason) => ({ issue: i, status: 'related', conflicts: [], aligned: [{ decision: ref(id), reason }], related: [], checkedAt: '2026-10-29T08:10:00.000Z' });
const R = (i, id) => ({ issue: i, status: 'related', conflicts: [], aligned: [], related: [{ decision: ref(id), score: 4.2 }], checkedAt: '2026-10-29T08:10:00.000Z' });
const N = (i) => ({ issue: i, status: 'clear', conflicts: [], aligned: [], related: [], checkedAt: '2026-10-29T08:10:00.000Z' });

let checks = [
  C(issue('PAY-1', 'Store payout ledger in MongoDB for flexible schemas', 'In Progress', 'indeterminate', 'he bai'), 'DEC-1', 'MongoDB', 'Store payout ledger in MongoDB for flexible schemas'),
  C(issue('PAY-2', 'Give partner banks direct access to the ledger service', 'To Do', 'new', 'he bai'), 'DEC-2', 'internal services directly', 'Expose the ledger service directly to partner banks so they can pull settlement files.'),
  C(issue('PAY-3', 'Evaluate Adyen as a second card processor for EU', 'To Do', 'new'), 'DEC-3', 'Adyen', 'Evaluate Adyen as a second card processor for EU'),
  C(issue('PAY-9', 'Integrate Adyen for EU card payments', 'To Do', 'new'), 'DEC-3', 'Adyen', 'Integrate Adyen for EU card payments'),
  A(issue('PAY-4', 'Remove MongoDB from the refunds service', 'In Progress', 'indeterminate', 'he bai'), 'DEC-1', 'Removes or replaces “MongoDB”'),
  R(issue('PAY-5', 'Speed up payout reports with a PostgreSQL index', 'To Do', 'new'), 'DEC-1'),
  N(issue('PAY-6', 'Update payout email copy', 'Done', 'done')),
  C(issue('CHK-1', 'Log full checkout request payloads for debugging', 'Done', 'done', 'Leo Martin'), 'DEC-4', 'PII logging', 'Log the full request payload, including customer email and address, to debug failed checkouts.'),
  C(issue('CHK-2', 'Homegrown feature flag table for checkout experiments', 'In Progress', 'indeterminate'), 'DEC-5', 'homegrown feature flags', 'Add a homegrown feature flag table for checkout experiments.'),
  C(issue('CHK-3', 'Guest checkout via SMS one-time code', 'To Do', 'new'), 'DEC-10', 'SMS checkout', 'Let guests check out with an SMS one-time code.', true),
  A(issue('CHK-4', 'Redact PII from checkout logs', 'Done', 'done'), 'DEC-4', 'Removes or replaces “PII logging”'),
  C(issue('PLF-1', 'Add a Jenkins job for the nightly ledger export', 'To Do', 'new'), 'DEC-7', 'Jenkins', 'Add a Jenkins job for the nightly ledger export.'),
  C(issue('PLF-2', 'Spin up a dedicated Redis for the checkout service', 'In Progress', 'indeterminate'), 'DEC-8', 'dedicated Redis', 'Spin up a dedicated Redis for the checkout service.'),
  A(issue('PLF-3', 'Migrate the last Jenkins jobs to Bitbucket Pipelines', 'Done', 'done'), 'DEC-7', 'Removes or replaces “Jenkins”'),
  R(issue('PLF-4', 'Trace checkout latency end to end', 'To Do', 'new'), 'DEC-9'),
];

// ---------- health (same rules as app/src/lib/health.js) ----------
const DAY = 86400000;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function refsFor() {
  const refs = {};
  for (const c of checks) {
    for (const x of c.conflicts) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).conflicts += x.acknowledged ? 0 : 1;
    for (const x of c.aligned) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).aligned += 1;
    for (const x of c.related) (refs[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).related += 1;
  }
  return refs;
}
function health(d, impact = {}) {
  const reviewBy = d.reviewBy || new Date(Date.parse(d.reviewedAt || d.decidedAt) + 180 * DAY).toISOString();
  const left = (Date.parse(reviewBy) - NOW) / DAY;
  const reviewState = left < 0 ? 'overdue' : left <= 14 ? 'soon' : 'ok';
  if (d.status !== 'active') return { score: null, grade: 'inactive', reviewBy, reviewState: 'ok', signals: [], outdated: { possibly: false, reasons: [] } };
  const s = [];
  const changed = (d.assumptions || []).filter((a) => a.status === 'changed');
  changed.forEach((a) => s.push({ kind: 'assumption', tone: 'danger', label: `Assumption no longer holds: “${a.text}”`, impact: -25 }));
  if (impact.conflicts) s.push({ kind: 'conflicts', tone: 'danger', label: `${impact.conflicts} work item${impact.conflicts > 1 ? 's' : ''} contradict it`, impact: -Math.min(36, 12 * impact.conflicts) });
  const ex = (d.exceptions || []).filter((e) => NOW - Date.parse(e.at) < 90 * DAY).length;
  if (ex) s.push({ kind: 'exceptions', tone: 'warning', label: `${ex} exception${ex > 1 ? 's' : ''} in 90 days — the rule may be bending`, impact: -Math.min(24, 8 * ex) });
  if (reviewState === 'overdue') s.push({ kind: 'review', tone: 'danger', label: `Review overdue since ${fmt(reviewBy)}`, impact: -20 });
  if (reviewState === 'soon') s.push({ kind: 'review', tone: 'warning', label: `Review due in ${Math.ceil(left)} days`, impact: -5 });
  if (!d.owner?.name) s.push({ kind: 'owner', tone: 'warning', label: 'No owner to ask', impact: -10 });
  if (!(d.guardrails?.avoid || []).length) s.push({ kind: 'guardrails', tone: 'warning', label: 'No guardrails — shown as context only', impact: -10 });
  if (impact.aligned) s.push({ kind: 'aligned', tone: 'success', label: `${impact.aligned} work item${impact.aligned > 1 ? 's' : ''} follow it`, impact: 0 });
  const score = Math.max(0, Math.min(100, 100 + s.reduce((n, x) => n + x.impact, 0)));
  const reasons = [...changed.map((a) => `Assumption no longer holds: “${a.text}”${a.note ? ` (${a.note})` : ''}`), ...(reviewState === 'overdue' ? [`Not reconfirmed since its revisit date, ${fmt(reviewBy)}`] : [])];
  return { score, grade: score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'at-risk', reviewBy, reviewState, signals: s.sort((a, b) => a.impact - b.impact), outdated: { possibly: reasons.length > 0, reasons } };
}
function withHealth() {
  const refs = refsFor();
  return decisions.map((d) => ({ ...d, health: health(d, refs[d.id]), preferred: d.guardrails.prefer[0]?.text || (d.id === 'DEC-1' ? 'PostgreSQL' : null) }));
}
function team(ds) {
  const act = ds.filter((d) => d.status === 'active');
  const score = act.length ? Math.round(act.reduce((n, d) => n + d.health.score, 0) / act.length) : 100;
  return {
    score,
    grade: score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'at-risk',
    active: act.length,
    healthy: act.filter((d) => d.health.grade === 'healthy').length,
    watch: act.filter((d) => d.health.grade === 'watch').length,
    atRisk: act.filter((d) => d.health.grade === 'at-risk').length,
    overdue: act.filter((d) => d.health.reviewState === 'overdue').length,
    dueSoon: act.filter((d) => d.health.reviewState === 'soon').length,
    outdated: act.filter((d) => d.health.outdated.possibly).length,
  };
}

// ---------- issue panel state ----------
let current = 'PAY-9';
const fixes = {
  'PAY-9': { 'DEC-3': { kind: 'rewrite', decisionId: 'DEC-3', from: 'Adyen', to: 'Stripe', summary: { before: 'Integrate Adyen for EU card payments', after: 'Integrate Stripe for EU card payments' }, description: [], replacements: [{ find: 'Adyen', replace: 'Stripe' }], advice: 'Use Stripe instead of Adyen, as DEC-3 requires.' } },
  'PAY-1': { 'DEC-1': { kind: 'rewrite', decisionId: 'DEC-1', from: 'MongoDB', to: 'PostgreSQL', summary: { before: 'Store payout ledger in MongoDB for flexible schemas', after: 'Store payout ledger in PostgreSQL for flexible schemas' }, description: [{}, {}], replacements: [], advice: 'Use PostgreSQL instead of MongoDB, as DEC-1 requires.' } },
};
let inbox = [
  {
    pageId: '4227074',
    title: 'Payments Sync — 2026-10-27',
    url: '#',
    at: '2026-10-29T12:58:00.000Z',
    items: [
      { key: 'k1', statement: 'We agreed to sunset the legacy payout CSV export by Q1 2027 and point Finance at the SQL views instead.', title: 'Sunset the legacy payout CSV export', confidence: 'high', reason: '“we agreed”', ownerName: 'Dana Kim', heading: 'Finance tooling' },
      { key: 'k2', statement: 'Going forward, ledger services will stay on PostgreSQL 16; no new document stores for payments.', title: 'Ledger services stay on PostgreSQL 16', confidence: 'high', reason: '“going forward”', duplicateOf: 'DEC-1' },
    ],
  },
];
let briefs = { 'PAY-1': { commentId: '10042', ids: ['DEC-1', 'DEC-5'], conflicts: ['DEC-1'], at: '2026-10-29T12:20:00.000Z' } };
const issueCheck = () => {
  const c = checks.find((x) => x.issue.key === current);
  return { ...c, fixes: fixes[current] || {}, brief: briefs[current] || null };
};
const BRIEF_MD = `## 🧭 Precedent brief for PAY-1
2 team decisions apply to this work, and it currently contradicts DEC-1.

1. **DEC-1 · Keep all transactional payment data in PostgreSQL** (Priya Shah, 2026-03-12)
   - ⛔ CONFLICT: this work mentions “MongoDB”. Compliant alternative: Use PostgreSQL instead of MongoDB, as DEC-1 requires.
   - Do: \`pg\`, \`prisma\`
   - Don't: MongoDB, document stores, DocumentDB, \`mongodb\`, \`mongoose\`
   - Governs: \`services/payments/**\`, \`db/ledger/**\`
   - Why: Reconciliation needs multi-row ACID transactions and Finance runs SQL audits against the ledger every night.

**Rules for coding agents**
- Treat these as binding team decisions. Do not work around them.
- Before you finish, call guard-check with the files you changed and the packages you added.`;

export function context() {
  const surface = new URLSearchParams(location.search).get('surface') || 'center';
  current = new URLSearchParams(location.search).get('issue') || current;
  const moduleKey = { center: 'precedent-jira-log', radar: 'precedent-radar', issue: 'precedent-issue-context', byline: 'precedent-byline' }[surface];
  return { moduleKey, localId: 'ari:cloud:ecosystem::extension/92a37583-d5ab-4554-97dd-8e6d41617e28/x', extension: { issue: { key: current }, project: { key: 'PAY' } } };
}

let candidates = [
  { key: 'k1', statement: 'All new services publish domain events through Kafka instead of direct HTTP callbacks.', title: 'All new services publish domain events through Kafka', confidence: 'high', reason: 'Listed under “Decisions”', ownerName: 'Marco Rossi', duplicateOf: null, guardrails: g(['direct HTTP callbacks'], ['Kafka']) },
  { key: 'k2', statement: 'We will not use Jenkins for any new pipelines.', title: 'We will not use Jenkins for any new pipelines', confidence: 'medium', reason: 'Says “we will not”', ownerName: null, duplicateOf: 'DEC-7', guardrails: g(['Jenkins']) },
  { key: 'k3', statement: 'Going forward, settlement reports are generated in the data warehouse, not in the payments database.', title: 'Settlement reports are generated in the data warehouse', confidence: 'medium', reason: 'Says “going forward”', ownerName: 'Priya Shah', duplicateOf: null, guardrails: g(['payments database'], ['data warehouse']) },
];

export function invoke(name, p) {
  switch (name) {
    case 'getOverview': {
      const ds = withHealth();
      return { inboxCount: inbox.reduce((n, e) => n + e.items.length, 0), decisions: ds, refs: refsFor(), checks, team: team(ds), settings: { reviewDays: 180 }, siteUrl: SITE, teamworkGraph: { connections: 1, lastSync: { at: '2026-10-29T12:24:30.000Z', accepted: 14, objects: 14 } } };
    }
    case 'getDecision': {
      const d = withHealth().find((x) => x.id === p.id);
      const workItems = checks.flatMap((c) => {
        const x = c.conflicts.find((k) => k.decision.id === p.id);
        const a = c.aligned.find((k) => k.decision.id === p.id);
        const r = c.related.find((k) => k.decision.id === p.id);
        return x || a || r ? [{ issue: c.issue, relation: x ? (x.acknowledged ? 'reviewed' : 'conflict') : a ? 'aligned' : 'related', evidence: x?.evidence || a?.reason || '' }] : [];
      });
      return { decision: d, workItems };
    }
    case 'reviewDecision':
      decisions = decisions.map((d) => (d.id === p.id ? { ...d, reviewedAt: new Date(NOW).toISOString(), reviewBy: undefined, history: [...d.history, { at: new Date(NOW).toISOString(), what: 'Reviewed — still valid' }] } : d));
      return decisions.find((d) => d.id === p.id);
    case 'updateAssumptions': {
      decisions = decisions.map((d) => {
        if (d.id !== p.id) return d;
        let list = [...(d.assumptions || [])];
        if (p.op === 'add') list.push({ id: `a${Date.now()}`, text: p.text, status: 'holds', addedAt: new Date(NOW).toISOString() });
        if (p.op === 'remove') list = list.filter((a) => a.id !== p.assumptionId);
        if (p.op === 'set') list = list.map((a) => (a.id === p.assumptionId ? { ...a, status: p.status, note: p.note || '', changedAt: new Date(NOW).toISOString() } : a));
        return { ...d, assumptions: list, history: [...d.history, { at: new Date(NOW).toISOString(), kind: 'assumption', what: p.op === 'set' && p.status === 'changed' ? 'Assumption no longer holds' : 'Assumption tracked' }] };
      });
      return decisions.find((d) => d.id === p.id);
    }
    case 'supersede': {
      const old = decisions.find((d) => d.id === p.id);
      const next = { ...dec(decisions.length + 1, p.statement.split('.')[0], old.owner?.name, '2026-10-29', g([])), statement: p.statement, supersedes: old.id };
      decisions = [...decisions.map((d) => (d.id === p.id ? { ...d, status: 'superseded', supersededBy: next.id, history: [...d.history, { at: new Date(NOW).toISOString(), kind: 'superseded', what: `Superseded by ${next.id}: ${p.reason}` }] } : d)), next];
      return { superseded: old.id, replacement: { id: next.id } };
    }
    case 'remindOwner':
      return { posted: true, where: 'Comment posted on “Payments Architecture Review — 2026-03-12”, mentioning the owner.' };
    case 'updateDecision':
      if (p.patch?.guard) decisions = decisions.map((d) => (d.id === p.id ? { ...d, guard: p.patch.guard } : d));
      return decisions.find((d) => d.id === p.id);
    case 'getSetup':
      return { spaces: [{ id: '1', key: 'ENG', name: 'Engineering' }], projects: [{ key: 'PAY', name: 'Payments' }] };
    case 'getRadar': {
      const ds = withHealth().filter((d) => d.status === 'active');
      return { projectKey: 'PAY', decisions: ds, checks: checks.filter((c) => c.issue.projectKey === 'PAY'), totalDecisions: decisions.length };
    }
    case 'getIssueCheck':
      return issueCheck();
    case 'getInbox':
      return inbox;
    case 'inboxAction':
      inbox = inbox.map((e) => ({ ...e, items: e.items.filter((i) => i.key !== p.key) })).filter((e) => e.items.length);
      return p.op === 'accept' ? { recorded: [{ id: 'DEC-16' }] } : { ok: true };
    case 'getAgentBrief':
      return { markdown: BRIEF_MD.replace(/PAY-1/g, current), ids: ['DEC-1', 'DEC-5'] };
    case 'attachBrief':
      briefs = { ...briefs, [current]: { commentId: '10043', ids: ['DEC-3'], conflicts: [], at: new Date().toISOString() } };
      return issueCheck();
    case 'applyFix': {
      const f = fixes[current][p.decisionId];
      checks = checks.map((c) => (c.issue.key === current ? { ...A({ ...c.issue, summary: f.summary.after }, p.decisionId, `Uses “${f.to}”, as ${p.decisionId} prefers`) } : c));
      delete fixes[current][p.decisionId];
      return { check: issueCheck(), applied: { from: f.from, to: f.to } };
    }
    case 'acknowledge':
    case 'logException':
      checks = checks.map((c) => (c.issue.key === current ? { ...c, status: 'acknowledged', conflicts: c.conflicts.map((x) => ({ ...x, acknowledged: !p.undo })) } : c));
      return issueCheck();
    case 'recordDecision':
      return { id: 'DEC-14', title: p.statement };
    case 'getPageDecisions': {
      const ds = withHealth().filter((d) => ['DEC-1', 'DEC-2', 'DEC-3', 'DEC-4'].includes(d.id) || d.extracted);
      return ds.map((d) => ({
        decision: d,
        conflicts: checks.filter((c) => c.conflicts.some((x) => x.decision.id === d.id && !x.acknowledged)).map((c) => c.issue),
        aligned: checks.filter((c) => c.aligned.some((x) => x.decision.id === d.id)).map((c) => c.issue),
      }));
    }
    case 'findPageDecisions':
      return { candidates };
    case 'recordPageDecisions': {
      const recorded = p.items.map((c, i) => ({ ...dec(14 + i, c.title, c.ownerName, '2026-10-29', c.guardrails, { statement: c.statement }), extracted: true }));
      decisions = [...decisions, ...recorded];
      candidates = candidates.filter((c) => !p.items.some((x) => x.key === c.key));
      return { recorded };
    }
    default:
      return { queued: true };
  }
}
