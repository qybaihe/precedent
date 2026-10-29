// Decision mining for free-form meeting notes. Most teams never use Confluence's "/decision"
// element: they write "we agreed…" in a paragraph or list outcomes under a "Decisions" heading.
// This finds those statements so a human can promote them to the register with one click.
//
//   high:   items under a "Decisions" / "Outcomes" heading, "Decision: …" lines, a "Decision" table column
//   medium: single sentences that say "we agreed", "going forward", "let's go with" …
//
// Native decision items, action items and code are skipped, and so are questions and hedges
// ("maybe", "TBD", "should we…"): a false "decision" is worse than a missed one.

import { adfToText, splitOwner, titleFrom, capitalize, collect, extractDecisionItems } from './adf.js';
import { extractGuardrails } from './guardrails.js';
import { tokenize } from './text.js';

const MAX_CANDIDATES = 15;
const MIN_LENGTH = 12;
const MAX_LENGTH = 400;
const DUPLICATE_JACCARD = 0.8;

// Harvested natively (decisions), or not decisions at all (action items, code).
const SKIP = new Set(['decisionList', 'decisionItem', 'taskList', 'taskItem', 'blockTaskItem', 'codeBlock']);
const LISTS = new Set(['bulletList', 'orderedList']);

const DECISION_HEADING = /\b(?:decisions?|decided|outcomes?|agreements?|agreed|resolutions?|resolved|conclusions?)\b/i;
// "Open decisions", "Decisions needed" list what is *not* decided yet…
const NOT_YET_HEADING = /\b(?:open|pending|needed|to make|to be made|proposed|upcoming|outstanding|undecided)\b/i;
// …and "Open questions" or "Next steps" nested under "Decisions" ends the decided part.
const OTHER_HEADING = /\b(?:questions?|action items?|next steps|to-?dos?|discussion|notes)\b/i;
const DECISION_COLUMN = /^(?:decisions?|outcomes?|agreements?|resolutions?|decided|what we decided)$/i;
const OWNER_COLUMN = /^(?:owner|driver|decided by|approver|approved by|dri)$/i;

const PREFIX = /^\s*(?:[✅✔☑]️?\s*)?(decision|decided|agreed|resolution|outcome)\s*[:：]\s*/i;
const HEDGE =
  /\b(?:maybe|might|consider|propos(?:e|ed|es|al|als|ing)|should we|tbd|open questions?|not (?:yet )?decided|undecided|to be decided|to (?:be )?discuss(?:ed)?|pending)\b/i;

// Phrases that mark a sentence as a decision outside a "Decisions" section.
const CUES = [
  /\bwe(?:'ve| have)?\s+(?:decided|agreed|chose|settled on)\b/i,
  /\bwe(?:'re| are|'ll| will)\s+standardi[sz](?:ing|e)\s+on\b/i,
  /\bwe(?:'ll| will)\s+no longer\b|\bwe(?:'ll| will) not\b|\bwe won't\b/i,
  /\bthe team\s+(?:has\s+)?(?:decided|agreed)\b/i,
  /\b(?:it\s+)?was\s+(?:agreed|decided)\b/i,
  /\bgoing forward\b/i,
  /\bfrom now on\b/i,
  /\blet's\s+(?:go with|standardi[sz]e on|use|stick with)\b/i,
  /\bwe(?:'re| are)\s+going with\b|\bwe(?:'ll| will)\s+go with\b/i,
];

// Lead-ins that can go once the remainder is a full instruction.
const LEAD = '^(?:(.{0,80}?)[\\s,]+)?';
const CLEANUPS = [
  // "After some back and forth we agreed that X" -> "X"; "We decided to use X" -> "Use X"
  [new RegExp(`${LEAD}\\b(?:we(?:'ve)?|the team|everyone)\\s+(?:have\\s+|has\\s+)?(?:decided|agreed)\\s+(that|to|not to)\\s+`, 'i'), (c) => (c === 'not to' ? 'Do not ' : '')],
  [new RegExp(`${LEAD}\\bit\\s+(?:was|has been)\\s+(?:agreed|decided)\\s+(that|to|not to)\\s+`, 'i'), (c) => (c === 'not to' ? 'Do not ' : '')],
  // "We decided against Redux" -> "Avoid Redux" (keeps the negative meaning for the guardrails)
  [new RegExp(`${LEAD}\\b(?:we(?:'ve)?|the team)\\s+(?:have\\s+|has\\s+)?decided\\s+against\\s+()`, 'i'), () => 'Avoid '],
  [new RegExp(`${LEAD}\\bwe(?:'re| are|'ll| will)\\s+standardi([sz])(?:ing|e)\\s+on\\s+`, 'i'), (z) => `Standardi${z}e on `],
  [new RegExp(`${LEAD}\\b(?:we(?:'re| are)\\s+going|we(?:'ll| will)\\s+go)\\s+with\\s+()`, 'i'), () => 'Go with '],
  [new RegExp(`${LEAD}\\blet's\\s+(?=go with|standardi[sz]e on|use|stick with)()`, 'i'), () => ''],
  [/^(?:going forward|from now on|moving forward)\s*,?\s+()/i, () => ''],
];

// Lead-ins that change the meaning ("If latency spikes, we agreed to…", "For refunds we decided…").
const SCOPING_LEAD = /^(?:if|when|whenever|unless|until|while|where|once|for|except|only|provided|as long as|in case)\b/i;

const normalizeQuotes = (s) => String(s || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
const words = (s) => s.split(/\s+/).filter(Boolean);

/** "After some back and forth we agreed that all services…" -> "All services…" */
function cleanStatement(text) {
  let s = text.replace(/\s+/g, ' ').trim();
  for (const [re, replacement] of CLEANUPS) {
    const m = s.match(re);
    if (!m) continue;
    // only filler goes ("After some back and forth"); conditions and long clauses are content
    if (m[1] && (words(m[1]).length > 10 || SCOPING_LEAD.test(m[1].trim()))) continue;
    const rest = s.slice(m[0].length);
    if (words(rest).length < 3) continue;
    s = replacement(m[2]) + rest;
    break;
  }
  s = s.replace(/,?\s+(?:going forward|from now on)(?=[.!]?$)/i, '');
  return capitalize(s);
}

/** Sentence split for prose: terminal punctuation followed by a capital, or a line break. */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|approx|incl|cf)\.)\s+(?=["(]?[A-Z0-9@])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cueIn(sentence) {
  for (const re of CUES) {
    const m = sentence.match(re);
    if (m) return m[0].toLowerCase().replace(/\s+/g, ' ');
  }
  return null;
}

/** 'decisions' for "Decisions" / "Key outcomes", 'undecided' for "Open questions", else null. */
function headingKind(text) {
  if (DECISION_HEADING.test(text) && !NOT_YET_HEADING.test(text)) return 'decisions';
  return NOT_YET_HEADING.test(text) || OTHER_HEADING.test(text) ? 'undecided' : null;
}
const normalizeStatement = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => b.has(t) && shared++);
  return shared / (a.size + b.size - shared);
}

function similar(x, y) {
  return x.norm === y.norm || jaccard(x.toks, y.toks) >= DUPLICATE_JACCARD;
}

/** FNV-1a: a short, stable id for a statement (safe in KVS keys). */
function hashKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

function mentionsIn(nodes) {
  return collect(nodes, 'mention')
    .map((m) => ({ name: (m.attrs?.text || '').replace(/^@/, '').trim(), accountId: m.attrs?.id || null }))
    .filter((m) => m.name || m.accountId);
}

/** Owner from an "Owner" table cell: a mention, or a short plain-text name. */
function ownerFromCell(cell) {
  if (!cell) return null;
  const mention = mentionsIn(cell.content)[0];
  if (mention) return mention;
  const name = adfToText(cell.content).trim();
  return /^[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2}$/.test(name) ? { name, accountId: null } : null;
}

/**
 * Find decision-like statements in free-form Confluence meeting notes.
 * @param {object} adf Confluence page body (atlas_doc_format)
 * @param {{existing?: Array<{id: string, statement: string}>}} opts decisions already in the register
 * @returns {Array<{key, statement, title, confidence, reason, heading, ownerName, ownerAccountId, duplicateOf, guardrails}>}
 */
export function findDecisionCandidates(adf, { existing = [] } = {}) {
  const found = [];
  const headings = []; // stack of { level, text, kind }
  const currentHeading = () => headings[headings.length - 1]?.text || null;
  // Innermost classified heading wins: "Decisions > Payments" is decided, "Decisions > Open questions" is not.
  const decisionSection = () => {
    const h = [...headings].reverse().find((x) => x.kind);
    return h?.kind === 'decisions' ? h : null;
  };

  const add = (text, { confidence, reason, mentions = [], owner = null }) => {
    if (/\?\s*$/.test(text) || HEDGE.test(text)) return;
    const { statement: withoutOwner, ownerName } = splitOwner(text.replace(PREFIX, ''));
    const who = owner || mentions[0] || (ownerName ? { name: ownerName, accountId: null } : null);
    let statement = cleanStatement(withoutOwner);
    // a trailing "— @Priya Shah" is attribution, not part of the rule
    if (who?.name) statement = statement.replace(new RegExp(`\\s*[—–(,-]*\\s*${who.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)?\\.?$`), '').trim();
    // "We agreed on the following:" introduces the list, it isn't a decision itself
    if (statement.length < MIN_LENGTH || statement.length > MAX_LENGTH || /:$/.test(statement)) return;
    found.push({
      statement,
      confidence,
      reason,
      heading: currentHeading(),
      ownerName: who?.name || null,
      ownerAccountId: who?.accountId || null,
      order: found.length,
    });
  };

  // One block of prose: a paragraph, a list item's own text, a table cell.
  const consider = (nodes, ctx = {}) => {
    const raw = normalizeQuotes(adfToText(nodes)).trim();
    if (!raw) return;
    const mentions = mentionsIn(nodes);
    const section = decisionSection();
    for (const line of raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      const lineMentions = mentions.filter((m) => !m.name || line.includes(m.name));
      if (ctx.reason || section) {
        add(line, { confidence: 'high', reason: ctx.reason || `Listed under “${section.text}”`, mentions: lineMentions, owner: ctx.owner });
        continue;
      }
      const prefix = line.match(PREFIX);
      if (prefix) {
        add(line, { confidence: 'high', reason: `Starts with “${capitalize(prefix[1].toLowerCase())}:”`, mentions: lineMentions });
        continue;
      }
      for (const sentence of splitSentences(line)) {
        const cue = cueIn(sentence);
        if (cue) add(sentence, { confidence: 'medium', reason: `Says “${cue}”`, mentions: lineMentions.filter((m) => sentence.includes(m.name)) });
      }
    }
  };

  const visitTable = (table) => {
    const rows = (table.content || []).filter((r) => r.type === 'tableRow');
    const cellsOf = (row) => (row.content || []).filter((c) => c.type === 'tableCell' || c.type === 'tableHeader');
    const first = rows[0] ? cellsOf(rows[0]) : [];
    const header = first.length && first.every((c) => c.type === 'tableHeader') ? first.map((c) => adfToText(c.content).trim()) : null;
    const decisionCol = header ? header.findIndex((h) => DECISION_COLUMN.test(h)) : -1;
    const ownerCol = header ? header.findIndex((h) => OWNER_COLUMN.test(h)) : -1;
    for (const row of header ? rows.slice(1) : rows) {
      const cells = cellsOf(row);
      const dataCells = cells.filter((c) => c.type === 'tableCell');
      if (decisionCol >= 0 && cells[decisionCol]) {
        // a decision log: one row = one decision
        consider(cells[decisionCol].content, {
          reason: `In the “${header[decisionCol]}” column`,
          owner: ownerFromCell(cells[ownerCol]) || mentionsIn(row.content)[0] || null,
        });
      } else if (decisionSection() && dataCells.length) {
        // a table under "Decisions": the longest cell is the statement, the rest is metadata
        const longest = [...dataCells].sort((a, b) => adfToText(b.content).length - adfToText(a.content).length)[0];
        consider(longest.content, { reason: `Listed under “${decisionSection().text}”`, owner: mentionsIn(row.content)[0] || null });
      } else {
        dataCells.forEach((c) => visit(c.content));
      }
    }
  };

  const visitNode = (node) => {
    if (!node || SKIP.has(node.type)) return;
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level || 1;
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        const text = adfToText(node).trim();
        headings.push({ level, text, kind: headingKind(text) });
        return;
      }
      case 'paragraph':
        consider(node);
        return;
      case 'listItem': {
        // the item's own text is one unit; nested lists are visited as their own items
        const children = node.content || [];
        consider(children.filter((c) => !LISTS.has(c.type) && !SKIP.has(c.type)));
        visit(children.filter((c) => LISTS.has(c.type)));
        return;
      }
      case 'table':
        visitTable(node);
        return;
      default:
        visit(node.content);
    }
  };
  const visit = (nodes) => (nodes || []).forEach(visitNode);
  visit(adf?.content || []);

  // Dedup: high beats medium, earlier beats later. Native decision items on the same page are
  // harvested anyway, so a prose restatement of one is dropped rather than offered twice.
  const signature = (statement) => ({ norm: normalizeStatement(statement), toks: new Set(tokenize(statement)) });
  const native = extractDecisionItems(adf).map((i) => signature(i.statement));
  const known = (existing || []).filter((d) => d?.statement).map((d) => ({ id: d.id, ...signature(d.statement) }));
  const rank = (c) => (c.confidence === 'high' ? 0 : 1);
  const kept = [];
  for (const c of [...found].sort((a, b) => rank(a) - rank(b) || a.order - b.order)) {
    const sig = signature(c.statement);
    if (kept.some((k) => similar(k.sig, sig)) || native.some((n) => similar(n, sig))) continue;
    kept.push({ ...c, sig });
  }

  return kept.slice(0, MAX_CANDIDATES).map(({ sig, order, ...c }) => {
    const dup = known.filter((k) => similar(k, sig)).sort((a, b) => jaccard(b.toks, sig.toks) - jaccard(a.toks, sig.toks))[0];
    return {
      key: hashKey(sig.norm),
      statement: c.statement,
      title: titleFrom(c.statement),
      confidence: c.confidence,
      reason: c.reason,
      heading: c.heading,
      ownerName: c.ownerName,
      ownerAccountId: c.ownerAccountId,
      duplicateOf: dup?.id || null,
      guardrails: extractGuardrails(c.statement),
    };
  });
}
