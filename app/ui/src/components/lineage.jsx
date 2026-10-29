// Decision lineage: what happened to a decision over time (captured, contradicted, excepted,
// reviewed, assumptions changing, superseded) and the chains of decisions that replaced each other.
import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { DecId, Segmented, formatDate } from './primitives.jsx';

const KIND = {
  captured: { icon: 'doc', color: '#1d7afc', label: 'Captured' },
  exception: { icon: 'flag', color: '#e2a203', label: 'Exception' },
  superseded: { icon: 'layers', color: '#8f7ee7', label: 'Superseded' },
  supersedes: { icon: 'layers', color: '#8f7ee7', label: 'Supersedes' },
  review: { icon: 'shieldCheck', color: '#22a06b', label: 'Reviewed' },
  reminder: { icon: 'bell', color: '#6c5ce7', label: 'Reminder' },
  assumption: { icon: 'info', color: '#2898bd', label: 'Assumption' },
  'assumption-changed': { icon: 'alert', color: '#e2483d', label: 'Assumption changed' },
  status: { icon: 'edit', color: '#8590a2', label: 'Status' },
};

/** History entries written before events had a `kind`: infer it from the text. */
function kindOf(h) {
  if (h.kind === 'assumption') return /no longer holds/i.test(h.what) ? 'assumption-changed' : 'assumption';
  if (h.kind) return h.kind;
  const w = h.what || '';
  if (/^superseded by/i.test(w)) return 'superseded';
  if (/^exception logged/i.test(w)) return 'exception';
  if (/^review(ed)?\b|still valid|revisit/i.test(w)) return 'review';
  if (/reminder/i.test(w)) return 'reminder';
  if (/^status changed/i.test(w)) return 'status';
  if (/^(captured|recorded|found in)/i.test(w)) return 'captured';
  return 'status';
}

/** Every event of one decision, oldest first, with DEC ids it points to. */
export function decisionEvents(d) {
  const out = [];
  for (const h of d.history || []) {
    const kind = kindOf(h);
    if (kind === 'exception') continue; // exceptions come from the structured list below
    out.push({ at: h.at, kind, text: h.what, refs: (h.what.match(/DEC-\d+/g) || []).filter((x) => x !== d.id), id: d.id });
  }
  for (const e of d.exceptions || []) out.push({ at: e.at, kind: 'exception', text: `Exception for ${e.issueKey}: ${e.reason}`, refs: [], id: d.id, issueKey: e.issueKey });
  if (d.supersedes) out.push({ at: d.createdAt || d.decidedAt, kind: 'supersedes', text: `Supersedes ${d.supersedes}`, refs: [d.supersedes], id: d.id });
  return out.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at));
}

function EventRow({ e, onOpen, showId }) {
  const k = KIND[e.kind] || KIND.status;
  const text = e.text.replace(/DEC-\d+/g, (m) => `\u0000${m}\u0000`).split('\u0000');
  return (
    <li className="lin-row">
      <span className="lin-node" style={{ background: k.color }}>
        <Icon name={k.icon} size={12} stroke={2.6} />
      </span>
      <div className="col gap-4" style={{ minWidth: 0 }}>
        <div className="row wrap gap-6 tiny">
          <span className="strong" style={{ color: k.color }}>{k.label.toUpperCase()}</span>
          <span className="faint">{formatDate(e.at)}</span>
          {showId ? <DecId id={e.id} onClick={onOpen ? () => onOpen(e.id) : undefined} /> : null}
        </div>
        <div className="small">
          {text.map((part, i) => (/^DEC-\d+$/.test(part) && onOpen ? <a key={i} className="mono strong" onClick={() => onOpen(part)}>{part}</a> : <span key={i}>{part}</span>))}
        </div>
      </div>
    </li>
  );
}

/** Vertical timeline for one decision (drawer). */
export function LineageTimeline({ decision, onOpen }) {
  const events = decisionEvents(decision);
  if (!events.length) return <div className="small faint">Nothing has happened to this decision yet.</div>;
  return (
    <ul className="lin list-reset">
      {events.map((e, i) => (
        <EventRow key={`${e.at}-${i}`} e={e} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/** Supersession chains, oldest decision first: DEC-13 → DEC-6. */
export function chains(decisions) {
  const byId = Object.fromEntries(decisions.map((d) => [d.id, d]));
  const heads = decisions.filter((d) => d.supersededBy && !decisions.some((x) => x.supersededBy === d.id));
  return heads.map((h) => {
    const chain = [h];
    let cur = h;
    while (cur.supersededBy && byId[cur.supersededBy] && chain.length < 8) {
      cur = byId[cur.supersededBy];
      chain.push(cur);
    }
    return chain;
  });
}

const FILTERS = [
  { value: 'all', label: 'All', kinds: null },
  { value: 'superseded', label: 'Supersessions', kinds: ['superseded', 'supersedes'] },
  { value: 'exception', label: 'Exceptions', kinds: ['exception'] },
  { value: 'assumption', label: 'Assumptions', kinds: ['assumption', 'assumption-changed'] },
  { value: 'review', label: 'Reviews', kinds: ['review', 'reminder'] },
];

/** The register's change log: supersessions, exceptions, assumption changes and reviews across decisions. */
export function ChangeFeed({ decisions, onOpen, limit = 12 }) {
  const [filter, setFilter] = useState('all');
  const all = useMemo(
    () =>
      decisions
        .flatMap((d) => decisionEvents(d))
        .filter((e) => e.kind !== 'captured' && e.kind !== 'status')
        .sort((a, b) => b.at.localeCompare(a.at)),
    [decisions],
  );
  const kinds = FILTERS.find((f) => f.value === filter).kinds;
  const shown = all.filter((e) => !kinds || kinds.includes(e.kind)).slice(0, limit);
  const cs = chains(decisions);
  const count = (f) => all.filter((e) => !f.kinds || f.kinds.includes(e.kind)).length;
  return (
    <div className="col gap-12">
      {cs.length ? (
        <div className="col gap-6">
          {cs.map((c) => (
            <div key={c[0].id} className="chain">
              {c.map((d, i) => (
                <React.Fragment key={d.id}>
                  {i ? <Icon name="arrowRight" size={16} className="faint" /> : null}
                  <button className={`chain-node ${d.status}`} onClick={() => onOpen(d.id)} title={d.title}>
                    <span className="mono strong">{d.id}</span>
                    <span className="clamp-1">{d.title}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: count(f) }))} />
      {shown.length ? (
        <ul className="lin list-reset">
          {shown.map((e, i) => (
            <EventRow key={`${e.id}-${e.at}-${i}`} e={e} onOpen={onOpen} showId />
          ))}
        </ul>
      ) : (
        <div className="small faint">Nothing of this kind yet.</div>
      )}
    </div>
  );
}
