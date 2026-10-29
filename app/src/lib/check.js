// Conflict detection: compares a piece of work (a Jira work item, or a free-text plan from a
// coding agent) with the decision register and explains every finding.
//
//  - conflict: the work mentions something an active decision explicitly avoids
//  - aligned:  the work mentions an avoided thing but is removing/replacing it
//  - related:  no guardrail hit, but the decision is clearly about the same topic (BM25)

import { tokenize, sentences, snippet, stem } from './text.js';

const WINDOW = 10; // max token distance between the words of a multi-word guardrail

// Words that, right before a guardrail term, mean the work is *removing* it.
const REMOVAL_CUES = new Set(
  `remove removing drop dropping migrate migrating deprecate replace replacing decommission sunset eliminate delete
  without instead longer stop retire mask redact scrub anonymize anonymise encrypt tokenize tokenise strip ban block
  prevent avoid disable phase purge clean off away rid kill`
    .split(/\s+/)
    .filter(Boolean)
    .map(stem),
);

/** Tokens with positions (stopwords kept so distances reflect the real sentence). */
function positionalTokens(text) {
  return tokenize(text, { keepStopwords: true });
}

/** Does `term` appear in `toks`? Returns the index of the earliest matched token, or -1. */
export function matchTerm(term, toks) {
  const positions = new Map();
  toks.forEach((t, i) => {
    if (!positions.has(t)) positions.set(t, []);
    positions.get(t).push(i);
  });
  const required = term.required && term.required.length ? term.required : null;
  const candidates = required || term.tokens;
  const present = candidates.filter((t) => positions.has(t));

  if (required) {
    if (present.length !== required.length) return -1;
  } else if (term.tokens.length <= 2) {
    // short generic phrase: every word must appear
    const nonVerb = term.tokens.filter((t) => positions.has(t));
    if (nonVerb.length !== term.tokens.length) return -1;
  } else if (present.length < Math.ceil(term.tokens.length * 0.66)) {
    return -1;
  }
  // all matched tokens must sit within a small window of each other
  const firsts = present.map((t) => positions.get(t));
  if (firsts.length === 1) return firsts[0][0];
  for (const anchor of firsts[0]) {
    const ok = firsts.slice(1).every((ps) => ps.some((p) => Math.abs(p - anchor) <= WINDOW));
    if (ok) return Math.min(anchor, ...firsts.slice(1).map((ps) => ps.find((p) => Math.abs(p - anchor) <= WINDOW)));
  }
  return -1;
}

// Words right before a term that make it the thing being *introduced* ("move the ledger to MongoDB").
const DESTINATION = new Set(['to', 'into', 'onto', 'with', 'on', 'in', 'using', 'via', 'adopt', 'introduc', 'add', 'us', 'install', 'enabl', 'run', 'spin', 'build', 'creat', 'deploy', 'integrat'].map(stem));
const MOVEMENT = new Set(['migrat', 'move', 'switch', 'transfer', 'port', 'shift'].map(stem));
const SKIPPABLE = new Set(['a', 'an', 'the', 'new', 'our', 'their', 'its', 'separate', 'own', 'last', 'remaining', 'all', 'old', 'legacy', 'existing', 'two', 'three', 'four', 'five', 'few', 'some', 'of', 'any']);

/**
 * Is the matched term at `idx` being removed rather than introduced? Walks backwards from the
 * term to the nearest meaningful word:
 *   "remove MongoDB", "drop the Mongo dependency", "migrate refunds off MongoDB",
 *   "migrate the last Jenkins jobs to Pipelines"                             -> removal
 *   "migrate the ledger to MongoDB", "replace Postgres with MongoDB", "add a Datadog agent" -> introduction
 */
function isRemoval(toks, idx) {
  for (let i = idx - 1; i >= Math.max(0, idx - 7); i--) {
    const t = toks[i];
    if (SKIPPABLE.has(t)) continue;
    if (t === 'from' || t === 'off' || t === 'away' || t === 'without') return true;
    if (DESTINATION.has(t)) return false;
    if (MOVEMENT.has(t)) return true; // the term is what's being moved away
    if (REMOVAL_CUES.has(t)) return true;
  }
  return false;
}

/** The sentence of `text` that best shows the match, for display. */
function evidence(text, term) {
  const wanted = term.required && term.required.length ? term.required : term.tokens;
  let best = null;
  let bestHits = 0;
  for (const s of sentences(text)) {
    const st = new Set(tokenize(s, { keepStopwords: true }));
    const hits = wanted.filter((t) => st.has(t)).length;
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return snippet(best || text, 180);
}

// ---------- BM25 relevance ----------

function decisionDocument(d) {
  const heading = d.source?.heading || '';
  return [d.title, d.title, heading, heading, d.statement, d.rationale || '', (d.tags || []).join(' '), (d.tags || []).join(' ')].join(' ');
}

// Light query expansion so "payments database" finds the PostgreSQL decision.
const EXPANSIONS = {
  databas: ['postgres', 'mongodb', 'sql', 'storag'],
  storag: ['stor', 'databas'],
  stor: ['storag'],
  cach: ['redis'],
  flag: ['featureflag', 'launchdarkly'],
  featureflag: ['launchdarkly'],
  log: ['logg'],
  tracing: ['opentelemetry', 'apm'],
  trac: ['opentelemetry', 'apm'],
  ci: ['jenkin', 'pipelin'],
  mobil: ['reactnative', 'flutter'],
  card: ['strip', 'adyen'],
  processor: ['strip', 'adyen'],
};

export function buildIndex(decisions) {
  const docs = decisions.map((d) => ({ d, toks: tokenize(decisionDocument(d)) }));
  const df = new Map();
  docs.forEach(({ toks }) => new Set(toks).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const avgLen = docs.reduce((n, x) => n + x.toks.length, 0) / Math.max(1, docs.length);
  return { docs, df, avgLen, n: docs.length };
}

export function bm25(index, queryText, { k1 = 1.2, b = 0.75, expand = false } = {}) {
  const base = [...new Set(tokenize(queryText))];
  const extra = expand ? base.flatMap((t) => EXPANSIONS[t] || []).filter((t) => !base.includes(t)) : [];
  const weights = new Map([...base.map((t) => [t, 1]), ...extra.map((t) => [t, 0.5])]);
  const q = [...weights.keys()];
  return index.docs
    .map(({ d, toks }) => {
      const tf = new Map();
      toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      let score = 0;
      const overlap = [];
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        if (weights.get(t) === 1) overlap.push(t);
        const df = index.df.get(t) || 0;
        const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
        score += weights.get(t) * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / index.avgLen)));
      }
      return { decision: d, score, overlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score);
}

// ---------- the check itself ----------

// Words too generic in engineering text to make two items "about the same topic" on their own
// ("data" + "storage" would otherwise relate a privacy guideline to a database decision).
const WEAK_OVERLAP = new Set(
  tokenize('data document documents storage store stores service services system systems team teams user users customer customers process feature product page pages new support'),
);

function inScope(decision, work) {
  const projects = decision.scope?.projects || [];
  if (projects.length && work.projectKey && !projects.includes(work.projectKey)) return false;
  return true;
}

function summarizeDecision(d) {
  return {
    id: d.id,
    title: d.title,
    statement: d.statement,
    status: d.status,
    owner: d.owner || null,
    decidedAt: d.decidedAt || null,
    source: d.source || null,
    tags: d.tags || [],
    guardrails: d.guardrails || { avoid: [], prefer: [] },
  };
}

/**
 * @param {{text: string, projectKey?: string, labels?: string[], issueKey?: string}} work
 * @param {Array} decisions full decision objects
 * @param {{acknowledged?: string[]}} options decisions already reviewed for this work item
 */
export function checkWork(work, decisions, { acknowledged = [] } = {}) {
  const text = [work.text || '', (work.labels || []).join(' ')].join('\n');
  const toks = positionalTokens(text);
  const active = decisions.filter((d) => d.status === 'active' && inScope(d, work));

  const conflicts = [];
  const aligned = [];
  const hitIds = new Set();

  for (const d of active) {
    const exceptions = (d.exceptions || []).filter((e) => work.issueKey && e.issueKey === work.issueKey);
    for (const term of d.guardrails?.avoid || []) {
      const idx = matchTerm(term, toks);
      if (idx < 0) continue;
      const entry = { decision: summarizeDecision(d), term: term.text, evidence: evidence(text, term) };
      if (isRemoval(toks, idx)) {
        if (!aligned.some((a) => a.decision.id === d.id)) aligned.push({ ...entry, reason: `Removes or replaces “${term.text}”` });
      } else if (exceptions.length) {
        if (!aligned.some((a) => a.decision.id === d.id))
          aligned.push({ ...entry, reason: `Exception approved: ${exceptions[0].reason}` });
      } else {
        const existing = conflicts.find((c) => c.decision.id === d.id);
        if (existing) existing.terms.push(term.text);
        else conflicts.push({ ...entry, terms: [term.text], acknowledged: acknowledged.includes(d.id) });
      }
      hitIds.add(d.id);
    }
  }

  // Topic relevance for everything that didn't trip a guardrail.
  const index = buildIndex(active);
  const ranked = bm25(index, text);
  const top = ranked[0]?.score || 0;
  const related = ranked
    .filter(
      (r) =>
        !hitIds.has(r.decision.id) &&
        r.overlap.filter((t) => !WEAK_OVERLAP.has(t)).length >= 2 &&
        r.score >= Math.max(3, top * 0.6),
    )
    .slice(0, 4)
    .map((r) => ({ decision: summarizeDecision(r.decision), score: Number(r.score.toFixed(2)), overlap: r.overlap }));

  const openConflicts = conflicts.filter((c) => !c.acknowledged);
  return {
    status: openConflicts.length ? 'conflict' : conflicts.length ? 'acknowledged' : related.length || aligned.length ? 'related' : 'clear',
    conflicts,
    aligned,
    related,
    checkedAt: new Date().toISOString(),
  };
}
