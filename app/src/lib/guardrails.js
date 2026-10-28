// Guardrail extraction: turns a decision written in plain English into explicit
// "avoid" / "prefer" terms that can be matched against new work without an LLM.
//
//   "Use PostgreSQL for transactional data. Do not introduce MongoDB or other document stores."
//     -> prefer: [PostgreSQL]   avoid: [MongoDB, document stores]
//
// Each term carries the canonical tokens used for matching plus the subset of tokens that
// must be present for a match (`required`). Named technologies and acronyms (MongoDB, PII,
// IE11) are decisive on their own; generic phrases need most of their words to show up.

import { sentences, tokenize } from './text.js';

const NEG =
  "(?:do not|don't|does not|doesn't|must not|mustn't|should not|shouldn't|will not|won't|shall not|cannot|can't|may not|must never|should never|will never|never|are not allowed to|is not allowed to|not allowed to|are not permitted to|no longer)";
const VERBS =
  '(?:use|using|introduce|add|adopt|store|log|call|expose|deploy|build|write|create|support|ship|depend on|rely on|run|put|send|keep|allow|enable|hard-?code|roll out|bring in|integrate|implement|choose|pick|go with|move to|migrate to|switch to|buy|accept|merge|release|copy|share|persist|cache|query|hold|host|schedule|launch|start|open|grant|give|offer|charge|email|contact|collect|track|retain|process)';
const STOP_CUES =
  '(?:avoid|ban|prohibit|forbid|deprecate|drop|sunset|retire|stop using|stop|move away from|migrate off|migrate away from|phase out|get rid of|eliminate|no more)';
const PREFER_CUES =
  '(?:standardi[sz]e on|standardi[sz]ed on|must use|must go through|goes through|go through|routed through|prefer|choose|chose|go with|went with|we use|use|adopt|pick|select|only use|always use)';
const CHOICE_VERBS = /\b(choose|chose|chosen|use|prefer|pick|picked|select|selected|adopt|go with|went with|standardi[sz]e on)\b/i;

// Words that end an object phrase ("MongoDB for payments" -> "MongoDB").
const BOUNDARY_WORDS = new Set(
  `to for in on at from with without unless until when whenever because so that which while during by as beyond outside inside
  within across through via over except instead rather than if where whose unless after before since per against until
  is are was were be been being will would should must can could may might`
    .split(/\s+/)
    .filter(Boolean),
);
const LEADING_FILLER = new Set(
  'any other new additional the a an our more extra separate own another further yet any_other also even ever'.split(' '),
);
// Acronyms that are too generic to be decisive on their own.
const GENERIC_ACRONYMS = new Set(
  'API APIS UI UX URL URLS HTTP HTTPS SDK DB ID IDS QA PR PRS CI CD SLA SLAS MVP OK IT HR US EU UK Q1 Q2 Q3 Q4 TBD FYI'.split(' '),
);

const MAX_OBJECT_WORDS = 6;

/** Grab the object phrase that starts at `rest` (text right after a cue). */
function takeObject(rest) {
  const words = rest.split(/\s+/);
  // "never by giving partners credentials" -> skip the leading "by"
  while (words.length && BOUNDARY_WORDS.has(words[0].toLowerCase())) words.shift();
  const out = [];
  for (const raw of words) {
    if (!raw) continue;
    const bare = raw.replace(/^["'(\[]+/, '');
    const lower = bare.toLowerCase().replace(/[^a-z0-9+#.\-/]/g, '');
    if (out.length && BOUNDARY_WORDS.has(lower)) break;
    const clean = bare.replace(/[,.;:!?)"'\]]+$/, '');
    if (clean) out.push(clean);
    if (/[,.;:!?)\]—–]$/.test(bare) || out.length >= MAX_OBJECT_WORDS) break;
    if (/^[—–-]$/.test(raw)) break;
  }
  return out.join(' ').replace(/\s[—–-]\s?$/, '').trim();
}

/** "MongoDB or other document stores" -> ["MongoDB", "document stores"] */
function splitAlternatives(phrase) {
  return phrase
    .split(/\s*(?:,|\/|\bor\b|\band\b|\bnor\b|&)\s*/i)
    .map((p) =>
      p
        .split(/\s+/)
        .filter((w, i, arr) => !(LEADING_FILLER.has(w.toLowerCase()) && i < arr.length - 1))
        .join(' ')
        .trim(),
    )
    .filter((p) => p && tokenize(p).length > 0);
}

/** Decisive tokens: proper nouns / product names / non-generic acronyms / words with digits. */
function keyTokens(phrase, { atSentenceStart = false } = {}) {
  const keys = [];
  phrase.split(/\s+/).forEach((word, idx) => {
    const bare = word.replace(/[^A-Za-z0-9+#.]/g, '');
    if (!bare) return;
    const isAcronym = /^[A-Z0-9]{2,}s?$/.test(bare) && /[A-Z]/.test(bare);
    const hasInnerCap = /[a-z][A-Z]/.test(bare) || /^[A-Z][a-z]+[A-Z]/.test(bare);
    const isCapitalised = /^[A-Z][a-z0-9]/.test(bare) && !(atSentenceStart && idx === 0);
    const hasDigit = /[A-Za-z]/.test(bare) && /\d/.test(bare);
    if (isAcronym && GENERIC_ACRONYMS.has(bare.toUpperCase())) return;
    if (isAcronym || hasInnerCap || isCapitalised || hasDigit) {
      keys.push(...tokenize(bare));
    }
  });
  return [...new Set(keys)];
}

function makeTerm(text, { verb = null, passive = false, atSentenceStart = false } = {}) {
  const tokens = tokenize(text);
  if (!tokens.length) return null;
  const keys = keyTokens(text, { atSentenceStart });
  const verbStem = verb ? tokenize(verb, { keepStopwords: true }).pop() : null;
  let required;
  if (passive && verbStem) {
    // "Customer PII must never be logged" -> PII + log must both appear.
    required = [...new Set([...(keys.length ? keys : tokens), verbStem])];
  } else if (keys.length) {
    required = keys;
  } else {
    required = []; // fuzzy: most tokens must appear (see matcher)
  }
  const allTokens = [...new Set(verbStem && !passive && !keys.length ? [verbStem, ...tokens] : tokens)];
  return { text: text.trim(), tokens: allTokens, required };
}

function addTerm(list, term) {
  if (!term) return;
  const sig = term.tokens.join(' ');
  if (!list.some((t) => t.tokens.join(' ') === sig)) list.push(term);
}

/**
 * Extract guardrails from decision text.
 * @returns {{avoid: Array<{text,tokens,required}>, prefer: Array<{text,tokens,required}>}}
 */
export function extractGuardrails(text) {
  const avoid = [];
  const prefer = [];

  for (const sentence of sentences(text)) {
    // Explicit "Avoid: X, Y" / "Prefer: Z" lines written by people who know the convention.
    const explicit = sentence.match(/^\s*(avoid|don't|do not|prefer|use)\s*:\s*(.+)$/i);
    if (explicit) {
      const target = /^(prefer|use)$/i.test(explicit[1]) ? prefer : avoid;
      splitAlternatives(explicit[2]).forEach((p) => addTerm(target, makeTerm(p)));
      continue;
    }

    // 1. Negated verbs: "do not introduce MongoDB", "never log PII", "we will not support IE11".
    const negRe = new RegExp(`\\b${NEG}\\s+(?:(?:be\\s+)?(${VERBS})\\s+)?(.+)`, 'gi');
    let m;
    while ((m = negRe.exec(sentence))) {
      const verb = m[1];
      let rest = m[2];
      // Passive voice: "<subject> must never be logged" — handled separately below.
      if (/^be\s/i.test(rest)) break;
      if (!verb && /^(be|been)\b/i.test(rest)) break;
      // "Card numbers are never stored ..." is passive too: the object is the subject.
      if (!verb && /^\w+(ed|en)\b/i.test(rest)) break;
      const obj = takeObject(rest);
      splitAlternatives(obj).forEach((p) => addTerm(avoid, makeTerm(p, { verb })));
      break;
    }

    // 2. Passive prohibitions: "Customer PII must never be logged", "Card data is not stored".
    const passive = sentence.match(
      new RegExp(
        `([A-Za-z0-9+#.\\- ]{2,60}?)\\s+(?:must|should|will|shall|may|can|is|are)?\\s*(?:never|not)\\s+(?:be\\s+)?(\\w+ed|sent|written|kept|held|shown|built|run)\\b`,
        'i',
      ),
    );
    if (passive) {
      const subjectWords = passive[1].trim().split(/\s+/).slice(-4);
      while (subjectWords.length && BOUNDARY_WORDS.has(subjectWords[0].toLowerCase())) subjectWords.shift();
      const subject = subjectWords.join(' ');
      const atStart = sentence.trim().startsWith(subjectWords[0] || '');
      splitAlternatives(subject).forEach((p) =>
        addTerm(avoid, makeTerm(p, { verb: passive[2], passive: true, atSentenceStart: atStart })),
      );
    }

    // 3. Stop/ban verbs: "avoid Redux", "deprecate the v1 SOAP API", "phase out Jenkins".
    const stopRe = new RegExp(`\\b${STOP_CUES}\\s+(.+)`, 'i');
    const stop = sentence.match(stopRe);
    if (stop) splitAlternatives(takeObject(stop[1])).forEach((p) => addTerm(avoid, makeTerm(p)));

    // 4. "No X": "no homegrown feature flag systems", "no direct database access".
    const noRe = /(?:^|[\s(—–-])no\s+(?!longer\b|one\b|later\b|exceptions?\b)(.+)/i;
    const no = sentence.match(noRe);
    if (no) splitAlternatives(takeObject(no[1])).forEach((p) => addTerm(avoid, makeTerm(p)));

    // 5. Alternatives that lost: "instead of Adyen", "rather than Flutter", "React Native over Flutter".
    const insteadRe = /\b(?:instead of|rather than|in place of)\s+(.+)/i;
    const instead = sentence.match(insteadRe);
    if (instead) splitAlternatives(takeObject(instead[1])).forEach((p) => addTerm(avoid, makeTerm(p)));
    if (CHOICE_VERBS.test(sentence)) {
      const over = sentence.match(/\bover\s+(.+)/i);
      if (over) splitAlternatives(takeObject(over[1])).forEach((p) => addTerm(avoid, makeTerm(p)));
    }

    // 6. Preferences (informational, used to explain alignment).
    const preferRe = new RegExp(`\\b${PREFER_CUES}\\s+(.+)`, 'i');
    const pref = sentence.match(preferRe);
    if (pref && !new RegExp(`${NEG}\\s+(?:${VERBS}\\s+)?$`, 'i').test(sentence.slice(0, pref.index + 1))) {
      const before = sentence.slice(0, pref.index).toLowerCase();
      if (!/(not|never|n't)\s*$/.test(before)) {
        splitAlternatives(takeObject(pref[1])).forEach((p) => addTerm(prefer, makeTerm(p)));
      }
    }
  }

  // A term can't be both preferred and avoided; avoid wins only if it never appears as preferred.
  const preferSigs = new Set(prefer.map((t) => t.tokens.join(' ')));
  return {
    avoid: avoid.filter((t) => !preferSigs.has(t.tokens.join(' '))),
    prefer,
  };
}

/** Build terms from a comma separated list typed by a human or provided by Rovo. */
export function termsFromList(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(/[,;\n]/);
  const out = [];
  items
    .map((s) => String(s).trim())
    .filter(Boolean)
    .forEach((s) => addTerm(out, makeTerm(s)));
  return out;
}
