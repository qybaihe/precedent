// Decision card (grid) and decision detail drawer, shared by the Decision Center and the Radar.
import React, { useEffect, useState } from 'react';
import { invoke, open, askRovo, flag } from '../api.js';
import { Icon } from './icons.jsx';
import {
  AsyncButton,
  Button,
  DecId,
  DecisionMeta,
  Field,
  Guardrails,
  HealthPill,
  Pill,
  Spinner,
  StatusPill,
  formatDate,
  sameText,
  plural,
  Banner,
} from './primitives.jsx';
import { ImpactBar, ScoreRing } from './charts.jsx';

const STATUS_OPTIONS = ['active', 'proposed', 'superseded', 'archived'];
const SIGNAL_ICON = { conflicts: 'alert', exceptions: 'flag', review: 'clock', owner: 'user', guardrails: 'shield', aligned: 'checkCircle' };
const TONE_COLOR = { danger: 'var(--red)', warning: 'var(--amber)', success: 'var(--green)' };

export function DecisionCard({ decision: d, impact, onOpen, delay = 0 }) {
  const grade = d.status === 'active' ? d.health?.grade || 'healthy' : d.status === 'superseded' ? 'superseded' : 'inactive';
  return (
    <div className={`card click accent ${grade} rise`} style={{ animationDelay: `${delay}ms`, paddingLeft: 20 }} onClick={() => onOpen(d.id)}>
      <div className="row spread top">
        <div className="col gap-6 grow">
          <div className="row gap-6 wrap">
            <DecId id={d.id} />
            <StatusPill status={d.status} />
            {d.health?.reviewState === 'overdue' && d.status === 'active' ? <Pill tone="overdue" icon="clock">Review overdue</Pill> : null}
            {d.health?.reviewState === 'soon' && d.status === 'active' ? <Pill tone="soon" icon="clock">Review soon</Pill> : null}
          </div>
          <div className="h3 clamp-2">{d.title}</div>
        </div>
        {d.status === 'active' ? <ScoreRing value={d.health?.score} /> : null}
      </div>
      {sameText(d.statement, d.title) ? null : <div className="small muted clamp-2 mt-8">{d.statement}</div>}
      <div className="mt-12">
        <Guardrails decision={d} limit={4} />
      </div>
      <div className="mt-12">
        <ImpactBar impact={impact} />
      </div>
      <div className="divider" />
      <DecisionMeta decision={d} />
    </div>
  );
}

function HealthBreakdown({ health }) {
  if (!health || health.grade === 'inactive') return null;
  return (
    <div className="card flat" style={{ background: 'var(--sunken)' }}>
      <div className="row gap-16">
        <ScoreRing value={health.score} size={56} />
        <div className="col gap-4 grow">
          <div className="row gap-6">
            <span className="strong">Decision health</span>
            <HealthPill health={health} />
          </div>
          <div className="small muted">
            Review {health.reviewState === 'overdue' ? 'overdue since' : 'due'} {formatDate(health.reviewBy)}
          </div>
        </div>
      </div>
      {health.signals?.length ? (
        <ul className="list-reset col gap-6 mt-12">
          {health.signals.map((s) => (
            <li key={s.kind + s.label} className="row gap-6 small">
              <Icon name={SIGNAL_ICON[s.kind] || 'info'} size={14} style={{ color: TONE_COLOR[s.tone] }} />
              <span className="grow">{s.label}</span>
              {s.impact ? <span className="tiny strong" style={{ color: TONE_COLOR[s.tone] }}>{s.impact > 0 ? `+${s.impact}` : s.impact}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="small muted mt-8">No warning signs: owned, enforced, recently reviewed, and nobody is working against it.</div>
      )}
    </div>
  );
}

const REL_TONE = { conflict: 'conflict', aligned: 'aligned', related: 'related', reviewed: 'reviewed' };

export function DecisionDrawer({ id, onClose, onChanged, rovoOn }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [note, setNote] = useState(null);

  const load = async () => {
    const r = await invoke('getDecision', { id });
    setData(r);
    if (r) {
      const g = r.decision.guardrails || {};
      setForm({
        status: r.decision.status,
        avoid: (g.avoid || []).map((t) => t.text).join(', '),
        prefer: (g.prefer || []).map((t) => t.text).join(', '),
        tags: (r.decision.tags || []).join(', '),
        ownerName: r.decision.owner?.name || '',
      });
    }
  };
  useEffect(() => {
    load();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  const d = data?.decision;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={d ? `${d.id} ${d.title}` : 'Decision'}>
        {!data ? (
          <Spinner label="Loading decision" />
        ) : !d ? (
          <div className="scroll">Decision not found.</div>
        ) : (
          <>
            <header>
              <div className="row spread">
                <div className="row gap-6">
                  <DecId id={d.id} />
                  <StatusPill status={d.status} />
                </div>
                <Button kind="subtle" size="sm" icon="x" onClick={onClose} title="Close" />
              </div>
              <h2 className="h1 mt-12" style={{ fontSize: 21 }}>
                {d.title}
              </h2>
              <div className="mt-8">
                <DecisionMeta decision={d} />
              </div>
            </header>
            <div className="scroll">
              {note ? <div className="mb-12" style={{ marginBottom: 12 }}><Banner tone={note.tone} title={note.title}>{note.text}</Banner></div> : null}
              <div className="quote">{d.statement}</div>
              {d.supersededBy ? (
                <div className="mt-16">
                  <Banner tone="warning" title={`Superseded by ${d.supersededBy}`}>Kept for history; no longer enforced.</Banner>
                </div>
              ) : null}
              <div className="section">
                <HealthBreakdown health={d.health} />
              </div>
              {d.rationale ? (
                <div className="section">
                  <div className="eyebrow">Why</div>
                  <div>{d.rationale}</div>
                </div>
              ) : null}
              <div className="section">
                <div className="eyebrow">
                  <Icon name="shield" size={13} /> Guardrails
                </div>
                {editing ? (
                  <div className="col gap-16">
                    <div className="grid two">
                      <Field label="Avoid">
                        <input className="input" value={form.avoid} onChange={set('avoid')} placeholder="comma separated" />
                      </Field>
                      <Field label="Prefer">
                        <input className="input" value={form.prefer} onChange={set('prefer')} placeholder="comma separated" />
                      </Field>
                    </div>
                    <div className="grid two">
                      <Field label="Status">
                        <select className="select" value={form.status} onChange={set('status')}>
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Owner">
                        <input className="input" value={form.ownerName} onChange={set('ownerName')} />
                      </Field>
                    </div>
                    <Field label="Tags" help="Curated guardrails are kept even when the source page changes.">
                      <input className="input" value={form.tags} onChange={set('tags')} />
                    </Field>
                  </div>
                ) : (
                  <>
                    <Guardrails decision={d} />
                    {!(d.guardrails?.avoid || []).length ? <div className="small faint mt-8">No explicit guardrails: Precedent shows this decision as related context only.</div> : null}
                  </>
                )}
              </div>
              <div className="section">
                <div className="eyebrow">
                  <Icon name="jira" size={13} /> Work items touching this decision <Pill>{data.workItems.length}</Pill>
                </div>
                {data.workItems.length ? (
                  <table className="table">
                    <tbody>
                      {data.workItems.map((w) => (
                        <tr key={w.issue.key} className="click" onClick={() => open(w.issue.url)}>
                          <td style={{ width: 82 }}>
                            <a className="mono strong small">{w.issue.key}</a>
                          </td>
                          <td>
                            <div className="small">{w.issue.summary}</div>
                            {w.evidence && !sameText(w.evidence, w.issue.summary) ? <div className="tiny faint clamp-1">{w.evidence}</div> : null}
                          </td>
                          <td style={{ width: 96 }}>
                            <Pill tone={REL_TONE[w.relation]}>{w.relation}</Pill>
                          </td>
                          <td style={{ width: 90 }} className="tiny muted">
                            {w.issue.status || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="small faint">No work items reference this decision yet.</div>
                )}
              </div>
              {(d.exceptions || []).length ? (
                <div className="section">
                  <div className="eyebrow">
                    <Icon name="flag" size={13} /> Exceptions <Pill>{d.exceptions.length}</Pill>
                  </div>
                  <ul className="list-reset col gap-6">
                    {d.exceptions.map((e) => (
                      <li key={e.issueKey + e.at} className="small">
                        <b className="mono">{e.issueKey}</b> — {e.reason} <span className="faint">({formatDate(e.at)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="section">
                <div className="eyebrow">
                  <Icon name="timeline" size={13} /> History
                </div>
                <ul className="steps">
                  {(d.history || []).map((h, i) => (
                    <li key={`${h.at}-${i}`} className="small">
                      <span className="faint">{formatDate(h.at)}</span> — {h.what}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <footer>
              {editing ? (
                <>
                  <Button kind="subtle" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <AsyncButton
                    kind="primary"
                    onClick={async () => {
                      await invoke('updateDecision', { id: d.id, patch: form });
                      setEditing(false);
                      await load();
                      onChanged?.();
                      flag(`${d.id} saved`, 'Work items are being re-checked against the new guardrails.');
                    }}
                  >
                    Save
                  </AsyncButton>
                </>
              ) : (
                <>
                  {rovoOn ? (
                    <Button kind="subtle" icon="chat" onClick={() => askRovo(`Tell me about ${d.id}: why we decided it, who owns it, and which work items contradict it.`)}>
                      Ask Precedent
                    </Button>
                  ) : null}
                  <span className="grow" />
                  {d.status === 'active' && d.owner?.name && d.source?.type === 'confluence' && d.health?.reviewState !== 'ok' ? (
                    <AsyncButton
                      icon="bell"
                      onClick={async () => {
                        const r = await invoke('remindOwner', { id: d.id });
                        setNote(r?.posted ? { tone: 'success', title: 'Reminder posted', text: r.where } : { tone: 'warning', title: 'Could not post a reminder', text: r?.error || 'Try again later.' });
                        await load();
                      }}
                    >
                      Remind owner
                    </AsyncButton>
                  ) : null}
                  {d.status === 'active' ? (
                    <AsyncButton
                      icon="shieldCheck"
                      onClick={async () => {
                        await invoke('reviewDecision', { id: d.id });
                        await load();
                        onChanged?.();
                        setNote({ tone: 'success', title: 'Marked as reviewed', text: 'Still valid. The next review is due in 6 months.' });
                      }}
                    >
                      Still valid
                    </AsyncButton>
                  ) : null}
                  <Button icon="edit" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                </>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

export { plural };
