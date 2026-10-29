// One-click fixes: when a work item contradicts a decision, propose the compliant version.
//
//   "Store payout ledger in MongoDB"  vs  DEC-1 "Keep all transactional payment data in PostgreSQL…"
//     -> rewrite: "Store payout ledger in PostgreSQL"
//
// A rewrite is only offered for a concrete swap (one product or vendor for another), and only
// after the rewritten text passes the same check that flagged it. Everything else (generic
// phrases, "PII must never be logged", sentences that already compare both options) gets one
// line of advice instead, so the button never produces nonsense.

import { tokenize, sentences, snippet, ALIASES } from './text.js';
import { extractGuardrails, termsFromList, takeObject, splitAlternatives, GENERIC_ACRONYMS } from './guardrails.js';
import { adfToText } from './adf.js';
import { checkWork } from './check.js';

// ---------- the decision's preferred option ----------

// Cues that introduce the option a decision wants, most specific first.
//   "Keep all transactional payment data in PostgreSQL", "Sessions live in Redis",
//   "Standardize on Stripe", "Traffic must go through the API Gateway", "Use LaunchDarkly", "Only Stripe"
const ALTERNATIVE_CUES = [
  /\b(?:keeps?|kept|stays?|remains?|stores?|stored|lives?|runs?)\b(?:\s+\S+){0,8}?\s+(?:in|on)\s+(.+)/i,
  /\bstandardi[sz](?:e|es|ed|ing)\s+on\s+(.+)/i,
  /\b(?:go|goes|going)\s+through\s+(.+)/i,
  /\buses?\s+(.+)/i,
  /\bonly\s+(.+)/i,
];
// "Stripe only", "Bitbucket Pipelines only"
const X_ONLY = /((?:[A-Z][\w.+#-]*\s+){0,2}[A-Z][\w.+#-]*)\s+only\b/;
// A cue right after a negation is the thing being ruled out: "never run cron jobs on Jenkins".
const NEGATED_BEFORE = /(?:\b(?:not|never|no longer|cannot|avoid|stop|without)|n't)\b[^,;]{0,30}$/i;

// Alias spellings that name a product (ALIASES also folds generic words like "db" -> "database").
const NOT_PRODUCTS = new Set(['database', 'pii', 'llm', 'ai', 'ml', 'featureflag', 'thirdparty', 'opensource']);
const PRODUCT_ALIAS_TOKENS = new Set(
  Object.entries(ALIASES)
    .flat()
    .flatMap((w) => tokenize(w, { keepStopwords: true }))
    .filter((t) => !NOT_PRODUCTS.has(t)),
);
// Categories of data, not products: swapping "PII" for anything is never a fix.
const DATA_CATEGORIES = new Set(
  tokenize('PII PHI PCI SSN GDPR HIPAA password passwords secret secrets credential credentials personal'),
);

/** Product / vendor / tech-like: a short phrase with a named word (or a known alias spelling). */
function looksConcrete(phrase, maxWords = 3) {
  const words = String(phrase || '').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > maxWords) return false;
  const named = words.some((w) => {
    const bare = w.replace(/[^A-Za-z0-9+#.]/g, '');
    if (!bare) return false;
    if (/^[A-Z0-9]{2,}s?$/.test(bare) && /[A-Z]/.test(bare)) return !GENERIC_ACRONYMS.has(bare.toUpperCase());
    return /^[A-Z]/.test(bare) || /[a-z][A-Z]/.test(bare) || (/[A-Za-z]/.test(bare) && /\d/.test(bare));
  });
  return named || tokenize(phrase).some((t) => PRODUCT_ALIAS_TOKENS.has(t));
}

function guardrailsOf(decision, conflict) {
  return decision?.guardrails || conflict?.decision?.guardrails || extractGuardrails(decision?.statement || '');
}

const sameTokens = (a, b) => a.length && a.join(' ') === b.join(' ');

// "shared Redis cluster managed (by Platform)" -> "shared Redis cluster": the object phrase stops
// at "by", leaving a participle that reads badly once swapped into a sentence.
const tidy = (option) => option.replace(/(\S)\s+[a-z]+ed$/, '$1');

/** The decision's preferred option: guardrails.prefer[0].text, else parsed from statement/title. */
export function preferredAlternative(decision) {
  if (!decision) return null;
  const guardrails = guardrailsOf(decision);
  const preferred = (guardrails.prefer || [])[0]?.text;
  if (preferred) return tidy(preferred);

  const avoided = (guardrails.avoid || []).map((t) => t.tokens || []);
  for (const sentence of sentences(`${decision.statement || ''}\n${decision.title || ''}`)) {
    const hits = ALTERNATIVE_CUES.map((re) => sentence.match(re)).filter(Boolean);
    const only = sentence.match(X_ONLY);
    for (const m of hits) {
      if (NEGATED_BEFORE.test(sentence.slice(0, m.index))) continue;
      const option = splitAlternatives(takeObject(m[1]))[0];
      if (option && looksConcrete(option, 4) && !avoided.some((a) => sameTokens(a, tokenize(option)))) return tidy(option);
    }
    if (only && !NEGATED_BEFORE.test(sentence.slice(0, only.index)) && looksConcrete(only[1], 4)) return only[1];
  }
  return null;
}

// ---------- surface forms: the words in the work item that tripped the guardrail ----------

// Word-ish spans: keeps "Node.js", "react-native" and "IE11" whole; splits "MongoDB's" at the quote.
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9+#]*(?:[.-][A-Za-z0-9+#]+)*/g;

/**
 * Every phrase of `text` that tokenizes to exactly the term's tokens, as written:
 * "MongoDB", "Mongo" and "mongo" are all surface forms of the MongoDB guardrail.
 */
function surfaceForms(text, term) {
  const want = term?.tokens || [];
  if (!want.length) return [];
  const spans = [...String(text || '').matchAll(WORD_RE)].map((m) => [m.index, m.index + m[0].length]);
  const maxWords = Math.min(5, String(term.text || '').split(/\s+/).length + 1);
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    for (let n = 1; n <= maxWords && i + n <= spans.length; n++) {
      // multi-word forms ("React Native") must not straddle punctuation
      if (n > 1 && !/^\s+$/.test(text.slice(spans[i + n - 2][1], spans[i + n - 1][0]))) break;
      const phrase = text.slice(spans[i][0], spans[i + n - 1][1]);
      if (sameTokens(tokenize(phrase, { keepStopwords: true }), want)) {
        out.push(phrase);
        i += n - 1;
        break;
      }
    }
  }
  return out;
}

function uniqueCaseInsensitive(list) {
  const seen = new Set();
  return list.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Can this avoided term be fixed by swapping words? Concrete, single-concept, not a data category. */
function isSwappable(term) {
  if (!term?.tokens?.length || !looksConcrete(term.text)) return false;
  // Fuzzy terms have no decisive word: "team-owned Redis instances" when the decision also prefers Redis.
  if (!(term.required || []).length) return false;
  const own = new Set([...term.tokens, ...term.text.split(/\s+/).flatMap((w) => tokenize(w))]);
  // "Customer PII must never be logged" requires PII *and* logging: no single swap fixes that.
  if ((term.required || []).some((t) => !own.has(t))) return false;
  return !tokenize(term.text).some((t) => DATA_CATEGORIES.has(t));
}

/** Does `text` already mention `phrase` (any alias spelling)? */
function mentions(text, phrase) {
  const want = tokenize(phrase);
  if (!want.length) return false;
  const have = new Set(tokenize(text));
  return want.every((t) => have.has(t));
}

// ---------- applying replacements ----------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(replacements) {
  const list = (replacements || []).filter((r) => r && r.find && typeof r.replace === 'string');
  if (!list.length) return null;
  const alternation = [...list]
    .sort((a, b) => b.find.length - a.find.length)
    .map((r) => escapeRe(r.find))
    .join('|');
  return {
    re: new RegExp(`(?<![A-Za-z0-9])(?:${alternation})(?![A-Za-z0-9])`, 'gi'),
    lookup: new Map(list.map((r) => [r.find.toLowerCase(), r.replace])),
  };
}

/** [start, end) of each sentence, split exactly like text.js `sentences`. */
function sentenceRanges(text) {
  const out = [];
  const re = /(?<=[.!?;])\s+|\n+/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push([start, m.index]);
    start = m.index + m[0].length;
  }
  out.push([start, text.length]);
  return out;
}

/**
 * Planned edits for `text`: every whole-word match, except in sentences that already mention the
 * replacement ("move from PostgreSQL to MongoDB" must not become "PostgreSQL to PostgreSQL").
 */
function planEdits(text, compiled) {
  if (!compiled || !text) return [];
  const ranges = sentenceRanges(text);
  const edits = [];
  for (const m of text.matchAll(compiled.re)) {
    const replace = compiled.lookup.get(m[0].toLowerCase());
    const range = ranges.find(([s, e]) => m.index >= s && m.index < e) || [0, text.length];
    if (replace === undefined || mentions(text.slice(range[0], range[1]), replace)) continue;
    edits.push({ start: m.index, end: m.index + m[0].length, replace });
  }
  return edits;
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replace + out.slice(e.end);
  return out;
}

/** Swap each `find` (whole word, case-insensitive) for `replace` in plain text. */
export function applyReplacementsToText(text, replacements) {
  const t = String(text ?? '');
  return applyEdits(t, planEdits(t, compile(replacements)));
}

/** Rewrite one run of inline nodes (a paragraph's content) in place; true when something changed. */
function rewriteInline(nodes, compiled) {
  // Sentences can span several text nodes (bold words, mentions), so plan on the joined text.
  const parts = nodes.map((n) => (n.type === 'text' ? n.text || '' : adfToText(n)));
  const full = parts.join('');
  const edits = planEdits(full, compiled);
  if (!edits.length) return false;
  let changed = false;
  let offset = 0;
  nodes.forEach((node, i) => {
    const start = offset;
    const end = offset + parts[i].length;
    offset = end;
    if (node.type !== 'text') return;
    // edits that straddle two text nodes (half-bold words) are left alone
    const mine = edits.filter((e) => e.start >= start && e.end <= end).map((e) => ({ ...e, start: e.start - start, end: e.end - start }));
    if (!mine.length) return;
    node.text = applyEdits(node.text, mine);
    changed = true;
  });
  return changed;
}

/**
 * Same swap on an ADF document. Deep-copies; only text nodes change (marks, mentions and links are
 * kept). Code blocks are left untouched so connection strings and snippets never get rewritten.
 * @returns {{adf: object, changed: boolean}}
 */
export function applyReplacementsToAdf(adf, replacements) {
  const copy = adf ? JSON.parse(JSON.stringify(adf)) : adf;
  const compiled = compile(replacements);
  let changed = false;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'codeBlock') return;
    const content = Array.isArray(node.content) ? node.content : null;
    if (!content) return;
    if (content.some((c) => c?.type === 'text')) {
      if (rewriteInline(content, compiled)) changed = true;
      return;
    }
    content.forEach(walk);
  };
  if (compiled) walk(copy);
  return { adf: copy, changed };
}

// ---------- the suggestion ----------

function adviceText({ id, from, to, statement, quoted }) {
  const thing = quoted ? `“${from}”` : from;
  const alternative = to ? ` — use ${to} instead` : '';
  return `Rework this so it no longer relies on ${thing}${alternative}. ${id}: “${snippet(statement, 140)}”`;
}

/**
 * suggestFix({ summary, description }, conflict, decision) -> {
 *   kind: 'rewrite' | 'advice', decisionId, from, to,
 *   summary: { before, after } | null, description: [{ before, after }],
 *   replacements: [{ find, replace }], advice
 * }
 * `description` is plain text; `conflict` is one entry of checkWork(...).conflicts. Optional
 * `work.labels` take part in the verification check (a label can keep the conflict alive).
 */
export function suggestFix(work, conflict, decision) {
  const summary = String(work?.summary || '');
  const description = String(work?.description || '');
  const d = decision || conflict?.decision || {};
  const id = d.id || conflict?.decision?.id || 'This decision';
  const guardrails = guardrailsOf(decision, conflict);

  const termTexts = conflict?.terms?.length ? conflict.terms : [conflict?.term].filter(Boolean);
  const terms = termTexts
    .map((text) => (guardrails.avoid || []).find((t) => t.text === text) || termsFromList([text])[0])
    .filter(Boolean);
  const to = preferredAlternative(d);
  const surfaces = uniqueCaseInsensitive(terms.flatMap((t) => [...surfaceForms(summary, t), ...surfaceForms(description, t)]));
  const from = surfaces[0] || termTexts[0] || 'it';

  const advice = () => ({
    kind: 'advice',
    decisionId: id,
    from,
    to,
    summary: null,
    description: [],
    replacements: [],
    advice: adviceText({ id, from, to, statement: d.statement || d.title || '', quoted: !surfaces.length && !looksConcrete(from) }),
  });

  if (!to || !terms.length || !surfaces.length || !terms.every(isSwappable)) return advice();
  // The "alternative" must not itself trip the guardrail (bad extraction, or prefer == avoid).
  const toTokens = tokenize(to);
  if (terms.some((t) => t.tokens.every((x) => toTokens.includes(x)))) return advice();

  const replacements = surfaces.map((find) => ({ find, replace: to }));
  const compiled = compile(replacements);
  // Verify against the decision as if it applied everywhere, so a rewrite is never "fixed" by scope.
  const strict = [{ ...d, id, status: 'active', scope: undefined, exceptions: [], guardrails }];
  const verdict = (text, labels) => checkWork({ text, labels }, strict);

  // "Drop the Mongo dependency" would become "Drop the PostgreSQL dependency": removal sentences
  // need a human, not a swap.
  for (const s of [...sentences(summary), ...sentences(description)]) {
    if (!planEdits(s, compiled).length) continue;
    const r = verdict(s);
    if (r.aligned.some((a) => a.decision.id === id) && !r.conflicts.some((c) => c.decision.id === id)) return advice();
  }

  const afterSummary = applyReplacementsToText(summary, replacements);
  const afterDescription = applyReplacementsToText(description, replacements);
  if (afterSummary === summary && afterDescription === description) return advice();
  // Re-run the check that flagged the item: the fix has to actually clear it.
  if (verdict(`${afterSummary}\n${afterDescription}`, work?.labels).conflicts.some((c) => c.decision.id === id)) return advice();

  return {
    kind: 'rewrite',
    decisionId: id,
    from,
    to,
    summary: afterSummary !== summary ? { before: summary, after: afterSummary } : null,
    description: sentences(description)
      .map((before) => ({ before, after: applyReplacementsToText(before, replacements) }))
      .filter((x) => x.before !== x.after),
    replacements,
    advice: `Use ${to} instead of ${from}, as ${id} requires.`,
  };
}
