// Atlassian Document Format (ADF) helpers: flatten to text and find decisions inside
// Confluence pages and Jira comments.

/** Flatten an ADF node into readable text. */
export function adfToText(node) {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(adfToText).join('');
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'mention':
      return (node.attrs?.text || '').replace(/^@/, '');
    case 'date':
      return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : '';
    case 'status':
      return node.attrs?.text || '';
    case 'emoji':
      return node.attrs?.text || '';
    case 'inlineCard':
      return node.attrs?.url || '';
    case 'hardBreak':
      return '\n';
    case 'paragraph':
    case 'heading':
    case 'listItem':
    case 'decisionItem':
    case 'taskItem':
    case 'tableRow':
      return `${adfToText(node.content)}\n`;
    case 'tableCell':
    case 'tableHeader':
      return `${adfToText(node.content).trim()} | `;
    default:
      return adfToText(node.content);
  }
}

export function collect(node, type, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, type, out));
    return out;
  }
  if (node.type === type) out.push(node);
  collect(node.content, type, out);
  return out;
}

const OWNER_RE = /\s*[—–(-]*\s*\b(?:decided by|owner|driver|approver|approved by)\s*:?\s*([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)\)?\.?\s*$/;

/** Pull "decided by Priya Shah" style attributions off the end of a statement. */
export function splitOwner(text) {
  const m = text.match(OWNER_RE);
  if (!m) return { statement: text.trim(), ownerName: null };
  return { statement: text.slice(0, m.index).trim().replace(/[—–-]\s*$/, '').trim(), ownerName: m[1] };
}

/** First sentence, capped, used as a human-friendly title. */
export function titleFrom(statement) {
  const first = capitalize(statement.split(/(?<=[.!?;])\s|\s[—–]\s|;\s/)[0].replace(/[.;,]+$/, ''));
  return first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first;
}

export function capitalize(text) {
  const t = String(text || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** "Payments Architecture Review — 2026-03-12" -> 2026-03-12T00:00:00.000Z (meeting date). */
export function dateFromTitle(title) {
  const m = String(title || '').match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).toISOString() : null;
}

/**
 * Find native Confluence decision items ("/decision" in the editor).
 * Returns the heading each decision sits under and the surrounding prose as rationale.
 */
export function extractDecisionItems(doc) {
  const results = [];
  const blocks = doc?.content || [];
  let heading = null;
  let sectionText = [];

  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === 'heading') {
        heading = adfToText(node).trim();
        sectionText = [];
        continue;
      }
      if (node.type === 'decisionList') {
        for (const item of node.content || []) {
          if (item.type !== 'decisionItem') continue;
          if (item.attrs?.state && item.attrs.state !== 'DECIDED') continue;
          const raw = adfToText(item.content).replace(/\s+/g, ' ').trim();
          if (!raw) continue;
          const mentions = collect(item, 'mention').map((m) => ({ accountId: m.attrs?.id, name: (m.attrs?.text || '').replace(/^@/, '') }));
          const dates = collect(item, 'date').map((d) => Number(d.attrs?.timestamp)).filter(Boolean);
          const { statement, ownerName } = splitOwner(raw);
          results.push({
            localId: item.attrs?.localId || `${results.length}`,
            statement,
            ownerName: ownerName || mentions[0]?.name || null,
            ownerAccountId: mentions[0]?.accountId || null,
            decidedAt: dates[0] ? new Date(dates[0]).toISOString() : null,
            heading,
            rationale: sectionText.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600),
          });
        }
        continue;
      }
      if (['paragraph', 'bulletList', 'orderedList', 'panel', 'blockquote'].includes(node.type)) {
        sectionText.push(adfToText(node));
        continue;
      }
      if (node.content && ['layoutSection', 'layoutColumn', 'expand', 'nestedExpand'].includes(node.type)) walk(node.content);
    }
  };
  walk(blocks);
  return results;
}

/**
 * Parse Confluence's "Decision" template: a table with Status / Owner / Outcome rows, plus a
 * "Background" section. Returns null when the page doesn't look like a decision page.
 */
export function parseDecisionTemplate(doc) {
  const rows = collect(doc, 'tableRow');
  const fields = {};
  for (const row of rows) {
    const cells = (row.content || []).filter((c) => c.type === 'tableCell' || c.type === 'tableHeader');
    if (cells.length < 2) continue;
    const key = adfToText(cells[0].content).trim().toLowerCase().replace(/[:*]/g, '');
    fields[key] = cells[1];
  }
  const outcomeCell = fields.outcome || fields.decision || fields['final decision'];
  if (!outcomeCell) return null;
  const outcome = adfToText(outcomeCell.content).replace(/\s+/g, ' ').trim();
  if (!outcome) return null;

  const ownerCell = fields.owner || fields.driver || fields.approver || fields['decision owner'];
  const ownerMention = ownerCell ? collect(ownerCell, 'mention')[0] : null;
  const statusText = fields.status ? adfToText(fields.status.content).trim().toLowerCase() : '';
  const dateCell = fields['decided on'] || fields.date || fields['due date'] || fields.decided;
  const dateNode = dateCell ? collect(dateCell, 'date')[0] : null;
  const dateText = dateCell ? adfToText(dateCell.content).trim() : '';

  // Background / Context section text
  let background = '';
  const blocks = doc?.content || [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && /background|context|why/i.test(adfToText(b))) {
      for (let j = i + 1; j < blocks.length && blocks[j].type !== 'heading'; j++) background += `${adfToText(blocks[j])} `;
      break;
    }
  }

  return {
    statement: outcome,
    status: /superseded|replaced/.test(statusText)
      ? 'superseded'
      : /not started|in progress|draft|open|proposed/.test(statusText)
        ? 'proposed'
        : 'active',
    ownerName: ownerMention ? (ownerMention.attrs?.text || '').replace(/^@/, '') : ownerCell ? adfToText(ownerCell.content).trim() || null : null,
    ownerAccountId: ownerMention?.attrs?.id || null,
    decidedAt: dateNode?.attrs?.timestamp
      ? new Date(Number(dateNode.attrs.timestamp)).toISOString()
      : /^\d{4}-\d{2}-\d{2}/.test(dateText)
        ? new Date(dateText.slice(0, 10)).toISOString()
        : null,
    rationale: background.replace(/\s+/g, ' ').trim().slice(0, 800),
  };
}

/** "Decision: we keep refunds on the shared Postgres cluster" inside a Jira comment. */
export function extractCommentDecision(body) {
  const text = typeof body === 'string' ? body : adfToText(body);
  const m = text.match(/(?:^|\n)\s*(?:✅\s*)?(?:decision|decided|we decided)\s*[:：-]\s*([\s\S]+)/i);
  if (!m) return null;
  const statement = capitalize(m[1].split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim());
  return statement.length >= 8 ? statement : null;
}
