// The Precedent brief: the decisions a coding agent (or a new teammate) must respect before working
// on something, short enough to sit in a prompt (~600 tokens). One model, two renderings:
//   - markdown, returned by the precedent-preflight tool (MCP / Rovo)
//   - ADF, posted as a single Jira comment, so Jira's "Open in coding tool" hands it to Claude
//     Code, Cursor, VS Code or Rovo Dev together with the work item
// Pure: no Forge APIs.

import { normalizeGuard } from './guard.js';
import { outdated } from './health.js';

export const BRIEF_MARKER = '🧭 Precedent brief';
const MAX_DECISIONS = 5;
const uniq = (list) => list.filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
/** Whole sentences up to `n` characters (at least the first one, cut at a word if it's very long). */
const clip = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  let out = '';
  for (const sentence of s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [s]) {
    if (out && (out + sentence).length > n) break;
    out += sentence;
  }
  out = out.trim();
  return out.length <= n * 1.3 ? out : `${out.slice(0, n).replace(/\s+\S*$/, '')}…`;
};

/**
 * Build the brief model from a check result.
 *   result: checkWork/checkIssue output (conflicts, aligned, related, governing)
 *   decisions: full decision records (for rationale, guard, exceptions)
 */
export function buildBrief({ issueKey = null, result, decisions, logUrl = null, now = new Date() }) {
  const byId = Object.fromEntries(decisions.map((d) => [d.id, d]));
  const order = [];
  const why = {};
  const add = (id, reason) => {
    if (!byId[id] || byId[id].status !== 'active') return;
    if (!order.includes(id)) order.push(id);
    (why[id] ||= []).push(reason);
  };
  const open = result.conflicts.filter((c) => !c.acknowledged);
  for (const c of open) add(c.decision.id, 'conflict');
  for (const c of result.conflicts.filter((x) => x.acknowledged)) add(c.decision.id, 'reviewed');
  for (const g of result.governing || []) add(g.decision.id, g.paths.length ? 'files' : 'scope');
  for (const a of result.aligned) add(a.decision.id, 'follows');
  for (const r of result.related) add(r.decision.id, 'related');

  const items = order.slice(0, MAX_DECISIONS).map((id) => {
    const d = byId[id];
    const g = normalizeGuard(d.guard) || { paths: [], packages: { deny: [], allow: [] }, keywords: [] };
    const conflict = open.find((c) => c.decision.id === id);
    const stale = outdated(d, now);
    return {
      id,
      title: d.title,
      statement: d.statement,
      owner: d.owner?.name || null,
      decidedOn: day(d.decidedAt),
      why: clip(d.rationale, 200) || null,
      do: (d.guardrails?.prefer || []).map((t) => t.text),
      dont: uniq([...(d.guardrails?.avoid || []).map((t) => t.text), ...g.keywords]),
      usePackages: g.packages.allow,
      deniedPackages: g.packages.deny,
      paths: g.paths,
      exceptions: (d.exceptions || []).filter((e) => issueKey && e.issueKey === issueKey).map((e) => e.reason),
      outdated: stale.possibly ? stale.reasons : [],
      conflict: conflict ? { terms: conflict.terms || [conflict.term], evidence: conflict.evidence, fix: conflict.fix?.advice || null } : null,
      reasons: why[id],
      url: d.source?.url || logUrl,
      source: d.source?.title || null,
    };
  });
  const ids = items.map((i) => i.id);
  return {
    issueKey,
    items,
    more: Math.max(0, order.length - items.length),
    conflicts: items.filter((i) => i.conflict).map((i) => i.id),
    // changes when anything the brief says changes: decides whether to refresh the Jira comment
    signature: JSON.stringify(items.map((i) => [i.id, i.title, i.dont, i.do, i.usePackages, i.deniedPackages, i.paths, Boolean(i.conflict), i.outdated.length, i.exceptions.length])),
    ids,
  };
}

const RULES = [
  'Treat these as binding team decisions. Do not work around them.',
  'If the task cannot be done without breaking one, stop and say so: propose an exception or a superseding decision for the owner to approve (Precedent tools: log-exception, supersede-decision).',
  'Before you finish, call guard-check with the files you changed and the packages you added.',
];

function headline(b) {
  if (!b.items.length) return 'No recorded team decision applies to this work.';
  const n = b.items.length + b.more;
  return `${n === 1 ? '1 team decision applies' : `${n} team decisions apply`} to this work${b.conflicts.length ? `, and it currently contradicts ${b.conflicts.join(', ')}` : ''}.`;
}

/** Markdown for agents (preflight tool output, copy-to-clipboard). */
export function briefMarkdown(b) {
  const out = [`## ${BRIEF_MARKER}${b.issueKey ? ` for ${b.issueKey}` : ''}`, headline(b)];
  b.items.forEach((i, n) => {
    out.push('');
    out.push(`${n + 1}. **${i.id} · ${i.title}**${[i.owner, i.decidedOn].filter(Boolean).length ? ` (${[i.owner, i.decidedOn].filter(Boolean).join(', ')})` : ''}`);
    if (i.conflict) out.push(`   - ⛔ CONFLICT: this work mentions ${i.conflict.terms.map((t) => `“${t}”`).join(', ')}${i.conflict.fix ? `. Compliant alternative: ${i.conflict.fix}` : ''}`);
    if (i.do.length) out.push(`   - Do: ${i.do.join(', ')}`);
    if (i.dont.length) out.push(`   - Don't: ${i.dont.join(', ')}`);
    if (i.usePackages.length) out.push(`   - Use packages: ${i.usePackages.map((p) => `\`${p}\``).join(', ')}`);
    if (i.deniedPackages.length) out.push(`   - Denied packages: ${i.deniedPackages.map((p) => `\`${p}\``).join(', ')}`);
    if (i.paths.length) out.push(`   - Governs: ${i.paths.map((p) => `\`${p}\``).join(', ')}`);
    if (i.why) out.push(`   - Why: ${i.why}`);
    for (const e of i.exceptions) out.push(`   - Exception approved for this work item: ${e}`);
    for (const r of i.outdated) out.push(`   - ⚠ Possibly outdated: ${r}. Confirm with ${i.owner || 'the owner'} before relying on it.`);
    if (i.url) out.push(`   - Source: ${i.url}`);
  });
  if (b.more) out.push('', `…and ${b.more} more (search-decisions).`);
  if (b.items.length) out.push('', '**Rules for coding agents**', ...RULES.map((r) => `- ${r}`));
  return out.join('\n');
}

// ---------- ADF (Jira comment) ----------

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const strong = (text) => t(text, [{ type: 'strong' }]);
const code = (text) => t(text, [{ type: 'code' }]);
const link = (text, href) => t(text, [{ type: 'link', attrs: { href } }]);
const para = (...content) => ({ type: 'paragraph', content: content.filter(Boolean) });
const bullets = (rows) => ({ type: 'bulletList', content: rows.map((r) => ({ type: 'listItem', content: [para(...r)] })) });
const words = (list) => list.flatMap((x, i) => [i ? t(', ') : null, /^`.*`$/.test(x) ? code(x.slice(1, -1)) : t(x)]).filter(Boolean);

/** The Jira comment. Leads with the marker so people (and Precedent) recognise it. */
export function briefAdf(b, { refreshedAt = new Date() } = {}) {
  const content = [para(strong(BRIEF_MARKER), t(` · ${headline(b)}`))];
  const conflicts = b.items.filter((i) => i.conflict);
  if (conflicts.length) {
    content.push({
      type: 'panel',
      attrs: { panelType: 'error' },
      content: conflicts.map((i) => para(strong(`Conflicts with ${i.id}: `), t(`mentions ${i.conflict.terms.map((x) => `“${x}”`).join(', ')}.`), i.conflict.fix ? t(` Compliant alternative: ${i.conflict.fix}`) : null)),
    });
  }
  content.push({
    type: 'orderedList',
    attrs: { order: 1 },
    content: b.items.map((i) => {
      const rows = [];
      if (i.do.length) rows.push([strong('Do: '), ...words(i.do)]);
      if (i.dont.length) rows.push([strong("Don't: "), ...words(i.dont)]);
      if (i.usePackages.length) rows.push([strong('Use packages: '), ...words(i.usePackages.map((p) => `\`${p}\``))]);
      if (i.deniedPackages.length) rows.push([strong('Denied packages: '), ...words(i.deniedPackages.map((p) => `\`${p}\``))]);
      if (i.paths.length) rows.push([strong('Governs: '), ...words(i.paths.map((p) => `\`${p}\``))]);
      if (i.why) rows.push([strong('Why: '), t(i.why)]);
      for (const e of i.exceptions) rows.push([strong('Exception approved: '), t(e)]);
      for (const r of i.outdated) rows.push([strong('⚠ Possibly outdated: '), t(r)]);
      const head = para(i.url ? link(`${i.id} · ${i.title}`, i.url) : strong(`${i.id} · ${i.title}`), [i.owner, i.decidedOn].some(Boolean) ? t(` — ${[i.owner, i.decidedOn].filter(Boolean).join(', ')}`) : null);
      return { type: 'listItem', content: rows.length ? [head, bullets(rows)] : [head] };
    }),
  });
  if (b.more) content.push(para(t(`…and ${b.more} more in the Precedent Decision Log.`)));
  content.push(para(strong('For coding agents: '), t(RULES.join(' '))));
  content.push(para(t(`Kept up to date by Precedent · ${refreshedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, [{ type: 'em' }])));
  return { type: 'doc', version: 1, content };
}

/** Per-decision verdicts for guard-check: fail (violates), warn (related or possibly outdated), pass. */
export function guardVerdicts(result, decisions, now = new Date()) {
  const byId = Object.fromEntries(decisions.map((d) => [d.id, d]));
  const rows = [];
  const seen = new Set();
  const row = (id, verdict, reasons, extra = {}) => {
    if (seen.has(id) || !byId[id]) return;
    seen.add(id);
    const d = byId[id];
    const stale = outdated(d, now);
    rows.push({ id, title: d.title, verdict: verdict === 'pass' && stale.possibly ? 'warn' : verdict, reasons: stale.possibly ? [...reasons, ...stale.reasons.map((r) => `Possibly outdated: ${r}`)] : reasons, owner: d.owner?.name || null, ...extra });
  };
  for (const c of result.conflicts.filter((x) => !x.acknowledged)) {
    row(c.decision.id, 'fail', [c.rule === 'package' ? c.evidence : `Mentions ${(c.terms || [c.term]).map((x) => `“${x}”`).join(', ')}: ${c.evidence}`], { doInstead: c.fix?.advice || null });
  }
  for (const c of result.conflicts.filter((x) => x.acknowledged)) row(c.decision.id, 'pass', ['Conflict already reviewed by the team']);
  for (const a of result.aligned) row(a.decision.id, 'pass', [a.reason]);
  for (const g of result.governing || []) row(g.decision.id, 'pass', [`Governs ${g.paths.length ? g.paths.join(', ') : `work items matching ${g.jql}`}; no violation found`]);
  for (const r of result.related) row(r.decision.id, 'warn', [`Same topic (${r.overlap.join(', ')}); check the change respects it`]);
  const overall = rows.some((r) => r.verdict === 'fail') ? 'fail' : rows.some((r) => r.verdict === 'warn') ? 'warn' : 'pass';
  return { overall, decisions: rows };
}

// ---------- the brief as a block in the work item description ----------
// Jira's "Open in coding tool" hands the summary and description to the coding agent (comments
// only if the agent goes and fetches them over MCP), so teams can keep the brief there instead.

const hasMarker = (n) => JSON.stringify(n).includes(BRIEF_MARKER);

/** The description without Precedent's brief block (and the rule that separates it). */
export function stripBrief(adf) {
  if (!adf?.content) return { adf, had: false };
  const content = [];
  let had = false;
  for (const n of adf.content) {
    if (n.type === 'panel' && hasMarker(n)) {
      had = true;
      if (content[content.length - 1]?.type === 'rule') content.pop();
      continue;
    }
    content.push(n);
  }
  return { adf: { ...adf, content }, had };
}

/** The brief as one note panel (panels can't nest, so conflicts are paragraphs here). */
export function briefBlockAdf(b, { refreshedAt = new Date() } = {}) {
  const full = briefAdf(b, { refreshedAt });
  const inner = full.content.flatMap((n) => (n.type === 'panel' ? n.content.map((p) => ({ ...p, content: [t('⛔ '), ...p.content] })) : [n]));
  return [{ type: 'rule' }, { type: 'panel', attrs: { panelType: 'note' }, content: inner }];
}

/** Description with the brief block replaced (or removed when no decision applies). */
export function withBriefBlock(adf, b, options) {
  const base = stripBrief(adf).adf || { type: 'doc', version: 1, content: [] };
  const content = [...(base.content || [])];
  if (b?.items?.length) content.push(...briefBlockAdf(b, options));
  return { type: 'doc', version: 1, ...base, content };
}
