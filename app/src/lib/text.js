// Text utilities shared by guardrail extraction, search and conflict detection.
// Everything here is deterministic and dependency-free so it can be unit tested with `node --test`.

// Common English words that carry no meaning for decision matching.
export const STOPWORDS = new Set(
  `a an the and or but if then else of for to in on at by with from into onto over under via per as is are was were be been
  being this that these those it its we our us you your they their them he she his her i me my mine will would shall should
  can could may might must do does did done have has had having not no so such than too very just also only all any each
  every some more most other another same own new about after before because while when where which who whom what why how
  there here up down out off again further once both few nor yet let lets get got make made use using used work item items
  ticket issue task story epic bug need needs want wants please add adds adding team teams go goes going went through
  via stay stays keep keeps see sees next last first like within without per across still already etc`
    .split(/\s+/)
    .filter(Boolean),
);

// Spelling variants that should be treated as the same concept.
export const ALIASES = {
  postgresql: 'postgres',
  psql: 'postgres',
  pg: 'postgres',
  mongo: 'mongodb',
  db: 'database',
  dbs: 'database',
  k8s: 'kubernetes',
  'node.js': 'nodejs',
  js: 'javascript',
  ts: 'typescript',
  gql: 'graphql',
  'internet explorer': 'ie11',
  pii: 'pii',
  llm: 'llm',
  ai: 'ai',
  ml: 'ml',
  'feature flag': 'featureflag',
  'feature flags': 'featureflag',
  'feature-flag': 'featureflag',
  'api gateway': 'apigateway',
  'api-gateway': 'apigateway',
  'react native': 'reactnative',
  'react-native': 'reactnative',
  'third party': 'thirdparty',
  'third-party': 'thirdparty',
  'open source': 'opensource',
  'open-source': 'opensource',
};

// Multi-word aliases are applied on the raw lowercased string before tokenising.
const PHRASE_ALIASES = Object.entries(ALIASES)
  .filter(([k]) => /[\s.-]/.test(k))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Very small suffix stripper. Good enough to match "stores"/"stored"/"storing"/"store" and
 * "logging"/"logged"/"log". Both sides of every comparison go through it, so consistency
 * matters more than linguistic accuracy.
 */
// Product names whose stem would collide with a verb ("Stripe" -> "strip", a removal cue).
const KEEP_WHOLE = new Map([
  ['stripe', 'stripe'],
  ['stripes', 'stripe'],
]);

export function stem(word) {
  let w = word;
  if (KEEP_WHOLE.has(w)) return KEEP_WHOLE.get(w);
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3));
  else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2));
  else if (/(ch|sh|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

function undouble(w) {
  return /(.)\1$/.test(w) && !/(ll|ss|zz)$/.test(w) ? w.slice(0, -1) : w;
}

/** Lowercase and fold multi-word aliases ("React Native" -> "reactnative"). */
export function normalize(text) {
  let t = ` ${String(text || '').toLowerCase()} `;
  t = t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  for (const [phrase, canonical] of PHRASE_ALIASES) {
    t = t.split(phrase).join(` ${canonical} `);
  }
  // hyphenated compounds are one concept: "team-owned" -> "teamowned", "email-only" -> "emailonly"
  t = t.replace(/([a-z0-9])-(?=[a-z])/g, '$1');
  return t;
}

/**
 * Split text into canonical tokens. Keeps stopwords when `keepStopwords` is set, which the
 * phrase matcher needs so token positions line up with the original sentence.
 */
export function tokenize(text, { keepStopwords = false } = {}) {
  const raw = normalize(text).match(/[a-z0-9][a-z0-9+#]*(?:\.[a-z0-9]+)*/g) || [];
  const out = [];
  for (let tok of raw) {
    tok = tok.replace(/\./g, '');
    if (ALIASES[tok]) tok = ALIASES[tok];
    if (!keepStopwords && STOPWORDS.has(tok)) continue;
    out.push(stem(tok));
  }
  return out;
}

/** Content tokens of a short phrase (used for guardrail terms). */
export function termTokens(term) {
  return tokenize(term);
}

/** Split prose into sentences/clauses for the extractor. */
export function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Collapse whitespace and cap length for UI snippets. */
export function snippet(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
