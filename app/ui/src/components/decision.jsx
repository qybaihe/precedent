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
import { LineageTimeline } from './lineage.jsx';

const STATUS_OPTIONS = ['active', 'proposed', 'superseded', 'archived'];
const SIGNAL_ICON = { conflicts: 'alert', exceptions: 'flag', review: 'clock', owner: 'user', guardrails: 'shield', aligned: 'checkCircle', assumption: 'alert' };
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
            {d.health?.outdated?.possibly ? <Pill tone="overdue" icon="clock">Possibly outdated</Pill> : null}
            {!d.health?.outdated?.possibly && d.health?.reviewState === 'soon' && d.status === 'active' ? <Pill tone="soon" icon="clock">Review soon</Pill> : null}
            {(d.assumptions || []).length ? <Pill tone="info">{`${d.assumptions.length} assumption${d.assumptions.length > 1 ? 's' : ''}`}</Pill> : null}
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
            Revisit {health.reviewState === 'overdue' ? 'overdue since' : 'by'} {formatDate(health.reviewBy)}
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

/** Sentences of the rationale that read like premises ("Finance runs SQL audits every night"). */
function suggestedAssumptions(d) {
  const tracked = new Set((d.assumptions || []).map((a) => a.text.toLowerCase()));
  return (d.rationale || '')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim().replace(/[.;]$/, ''))
    .filter((x) => x.length >= 20 && x.length <= 180 && !tracked.has(x.toLowerCase()))
    .filter((x) => !/^(we|the team)\s+(compared|discussed|looked at|evaluated|reviewed|considered|talked)/i.test(x))
    .slice(0, 3);
}

function Assumptions({ decision: d, onSaved }) {
  const [text, setText] = useState('');
  const [changing, setChanging] = useState(null);
  const [note, setNote] = useState('');
  const call = async (payload) => onSaved(await invoke('updateAssumptions', { id: d.id, ...payload }));
  const list = d.assumptions || [];
  const suggestions = suggestedAssumptions(d);
  return (
    <div className="col gap-8">
      {list.map((a) => (
        <div key={a.id} className={`assumption ${a.status === 'changed' ? 'changed' : ''}`}>
          <Icon name={a.status === 'changed' ? 'alert' : 'checkCircle'} size={16} style={{ color: a.status === 'changed' ? 'var(--red)' : 'var(--green)', marginTop: 2 }} />
          <div className="col gap-4">
            <div className="small" style={{ color: 'var(--text)' }}>{a.text}</div>
            {a.status === 'changed' ? <div className="tiny" style={{ color: 'var(--red)' }}>No longer holds{a.note ? `: ${a.note}` : ''} · {formatDate(a.changedAt)}</div> : <div className="tiny faint">Holds{a.changedAt ? ` · confirmed ${formatDate(a.changedAt)}` : ''}</div>}
            {changing === a.id ? (
              <div className="row gap-6 mt-8">
                <input className="input" style={{ height: 30 }} placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                <AsyncButton size="xs" kind="danger" onClick={async () => { await call({ op: 'set', assumptionId: a.id, status: 'changed', note }); setChanging(null); setNote(''); }}>
                  Mark changed
                </AsyncButton>
                <Button size="xs" kind="subtle" onClick={() => setChanging(null)}>Cancel</Button>
              </div>
            ) : null}
          </div>
          <div className="row gap-4">
            {a.status === 'changed' ? (
              <AsyncButton size="xs" icon="check" onClick={() => call({ op: 'set', assumptionId: a.id, status: 'holds' })}>Holds again</AsyncButton>
            ) : changing !== a.id ? (
              <Button size="xs" icon="alert" onClick={() => setChanging(a.id)}>It changed</Button>
            ) : null}
            <AsyncButton size="xs" kind="subtle" icon="x" title="Stop tracking" onClick={() => call({ op: 'remove', assumptionId: a.id })} />
          </div>
        </div>
      ))}
      {suggestions.length ? (
        <div className="col gap-6">
          <div className="tiny faint">Suggested from the rationale:</div>
          <div className="row wrap gap-6">
            {suggestions.map((t) => (
              <button key={t} className="suggest" onClick={() => call({ op: 'add', text: t })}>
                <Icon name="plus" size={12} /> {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="row gap-6">
        <input className="input" style={{ height: 32 }} placeholder="This decision holds while…" value={text} onChange={(e) => setText(e.target.value)} />
        <AsyncButton size="sm" icon="plus" disabled={text.trim().length < 6} onClick={async () => { await call({ op: 'add', text }); setText(''); }}>
          Track
        </AsyncButton>
      </div>
    </div>
  );
}

function SupersedeForm({ decision: d, onCancel, onDone }) {
  const [form, setForm] = useState({ statement: '', reason: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="card flat fade col gap-12" style={{ background: 'var(--purple-bg)', borderColor: 'transparent' }}>
      <div className="row gap-6"><Icon name="layers" size={16} style={{ color: 'var(--purple)' }} /><span className="strong">{`Supersede ${d.id}`}</span></div>
      <Field label="The new decision" help="Precedent extracts the new guardrails; work items are re-checked against it.">
        <textarea className="textarea" value={form.statement} onChange={set('statement')} placeholder="e.g. Keep payment data in PostgreSQL; ledger analytics move to the data warehouse." autoFocus />
      </Field>
      <Field label="Why it changed">
        <input className="input" value={form.reason} onChange={set('reason')} placeholder="e.g. Finance now audits from the warehouse." />
      </Field>
      <div className="btn-row">
        <AsyncButton kind="primary" size="sm" disabled={form.statement.trim().length < 8} onClick={async () => onDone(await invoke('supersede', { id: d.id, ...form }))}>
          Supersede
        </AsyncButton>
        <Button kind="subtle" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function DecisionDrawer({ id: initialId, onClose, onChanged, rovoOn }) {
  const [id, setId] = useState(initialId);
  const [data, setData] = useState(null);
  const [superseding, setSuperseding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [note, setNote] = useState(null);

  const load = async () => {
    const r = await invoke('getDecision', { id });
    setData(r);
    if (r) {
      const g = r.decision.guardrails || {};
      setForm({
        title: r.decision.title,
        status: r.decision.status,
        avoid: (g.avoid || []).map((t) => t.text).join(', '),
        prefer: (g.prefer || []).map((t) => t.text).join(', '),
        tags: (r.decision.tags || []).join(', '),
        ownerName: r.decision.owner?.name || '',
        reviewBy: (r.decision.health?.reviewBy || '').slice(0, 10),
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
              {d.health?.outdated?.possibly ? (
                <div style={{ marginBottom: 14 }}>
                  <Banner tone="warning" title="Possibly outdated" icon="clock">
                    {d.health.outdated.reasons.join(' · ')}. Confirm it with the owner (Still valid), or supersede it.
                  </Banner>
                </div>
              ) : null}
              {superseding ? (
                <div style={{ marginBottom: 14 }}>
                  <SupersedeForm
                    decision={d}
                    onCancel={() => setSuperseding(false)}
                    onDone={async (r) => {
                      setSuperseding(false);
                      if (r?.error) return setNote({ tone: 'error', title: 'Could not supersede', text: r.error });
                      onChanged?.();
                      flag(`${r.replacement.id} supersedes ${d.id}`, 'Work items are being re-checked against the new decision.');
                      setId(r.replacement.id);
                    }}
                  />
                </div>
              ) : null}
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
              {d.status === 'active' ? (
                <div className="section">
                  <div className="eyebrow">
                    <Icon name="info" size={13} /> Assumptions <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>— if one stops holding, the decision is flagged as possibly outdated</span>
                  </div>
                  <Assumptions
                    decision={d}
                    onSaved={async (saved) => {
                      if (saved?.error) return setNote({ tone: 'error', title: 'Could not update assumptions', text: saved.error });
                      await load();
                      onChanged?.();
                    }}
                  />
                </div>
              ) : null}
              <div className="section">
                <div className="eyebrow">
                  <Icon name="shield" size={13} /> Guardrails
                </div>
                {editing ? (
                  <div className="col gap-16">
                    <Field label="Title">
                      <input className="input" value={form.title} onChange={set('title')} />
                    </Field>
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
                    <div className="grid two">
                      <Field label="Tags" help="Curated guardrails are kept even when the source page changes.">
                        <input className="input" value={form.tags} onChange={set('tags')} />
                      </Field>
                      <Field label="Revisit by" help="After this date the decision is flagged as possibly outdated until someone confirms it.">
                        <input className="input" type="date" value={form.reviewBy} onChange={set('reviewBy')} />
                      </Field>
                    </div>
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
                  <Icon name="timeline" size={13} /> Lineage
                </div>
                <LineageTimeline decision={d} onOpen={(x) => setId(x)} />
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
                      const unchanged = form.reviewBy === (d.health?.reviewBy || '').slice(0, 10);
                      await invoke('updateDecision', { id: d.id, patch: { ...form, reviewBy: unchanged ? undefined : form.reviewBy } });
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
                  {d.status === 'active' && !superseding ? (
                    <Button icon="layers" onClick={() => setSuperseding(true)}>
                      Supersede
                    </Button>
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
