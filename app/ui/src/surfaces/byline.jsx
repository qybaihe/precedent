// Confluence page byline: the decisions captured from this page, what Jira work is doing to them,
// and one click to find decisions written in plain prose ("we agreed that…").
import React, { useEffect, useState } from 'react';
import { invoke, open, askRovo, rovoEnabled, flag } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { AsyncButton, Banner, Button, DecId, Guardrails, Pill, Spinner, StatusPill, plural } from '../components/primitives.jsx';
import { ScoreRing } from '../components/charts.jsx';

function Tracked({ item, delay }) {
  const { decision: d, conflicts, aligned } = item;
  const tone = conflicts.length ? 'conflict' : d.status !== 'active' ? 'inactive' : aligned.length ? 'aligned' : 'related';
  return (
    <div className={`card accent ${tone} rise`} style={{ padding: '12px 14px 12px 18px', animationDelay: `${delay}ms` }}>
      <div className="row spread top gap-12">
        <div className="col gap-6 grow" style={{ minWidth: 0 }}>
          <div className="row wrap gap-6">
            <DecId id={d.id} />
            <StatusPill status={d.status} />
            {conflicts.length ? <Pill tone="conflict" icon="alert">{plural(conflicts.length, 'conflict')}</Pill> : null}
          </div>
          <div className="strong">{d.title}</div>
        </div>
        {d.status === 'active' ? <ScoreRing value={d.health?.score} size={34} /> : null}
      </div>
      <div className="mt-8">
        <Guardrails decision={d} limit={3} />
      </div>
      {conflicts.length ? (
        <div className="col gap-4 mt-8">
          <div className="tiny strong" style={{ color: 'var(--red)' }}>CONTRADICTED BY</div>
          {conflicts.map((i) => (
            <div key={i.key} className="row gap-6 small" style={{ minWidth: 0 }}>
              <a className="mono strong" style={{ flex: 'none', whiteSpace: 'nowrap' }} onClick={() => open(i.url)}>{i.key}</a>
              <span className="clamp-1 muted">{i.summary}</span>
            </div>
          ))}
        </div>
      ) : null}
      {aligned.length ? (
        <div className="small mt-8" style={{ color: 'var(--green)' }}>
          <Icon name="checkCircle" size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> Followed by {aligned.map((i) => i.key).join(', ')}
        </div>
      ) : null}
      {!conflicts.length && !aligned.length ? <div className="tiny faint mt-8">No Jira work contradicts this decision.</div> : null}
    </div>
  );
}

function Finder({ onRecorded }) {
  const [state, setState] = useState(null); // null | 'loading' | { candidates }
  const [picked, setPicked] = useState({});
  const find = async () => {
    setState('loading');
    const r = await invoke('findPageDecisions');
    setState(r);
    setPicked(Object.fromEntries((r.candidates || []).map((c) => [c.key, !c.duplicateOf && c.confidence === 'high'])));
  };
  if (!state)
    return (
      <div className="fix">
        <div className="row gap-6">
          <Icon name="sparkles" size={16} style={{ color: 'var(--purple)' }} />
          <span className="strong">Decisions hiding in the prose?</span>
        </div>
        <div className="small muted mt-8">Meeting notes often say "we agreed…" without a /decision item. Precedent can find them, show the guardrails it would enforce, and track the ones you pick.</div>
        <div className="mt-12">
          <Button kind="magic" size="sm" icon="sparkles" onClick={find}>
            Find decisions on this page
          </Button>
        </div>
      </div>
    );
  if (state === 'loading') return <Spinner label="Reading the page" />;
  const cands = state.candidates || [];
  if (!cands.length)
    return <Banner tone="info" title="Nothing new found">No untracked decisions on this page. Phrases like "we agreed", "we decided" or a "Decisions" heading are what Precedent looks for.</Banner>;
  const n = Object.values(picked).filter(Boolean).length;
  return (
    <div className="col gap-8">
      <div className="row spread">
        <div className="row gap-6">
          <Icon name="sparkles" size={15} style={{ color: 'var(--purple)' }} />
          <span className="strong">{`Found ${plural(cands.length, 'possible decision')}`}</span>
        </div>
        <Button kind="subtle" size="xs" onClick={() => setState(null)}>
          Close
        </Button>
      </div>
      {cands.map((c, i) => (
        <label key={c.key} className={`card flat rise ${c.duplicateOf ? '' : 'click'}`} style={{ padding: '10px 12px', display: 'block', animationDelay: `${i * 40}ms`, opacity: c.duplicateOf ? 0.6 : 1 }}>
          <div className="row top gap-12">
            <input type="checkbox" style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--brand)' }} disabled={Boolean(c.duplicateOf)} checked={Boolean(picked[c.key])} onChange={() => setPicked({ ...picked, [c.key]: !picked[c.key] })} />
            <div className="col gap-6 grow" style={{ minWidth: 0 }}>
              <div className="small" style={{ color: 'var(--text)' }}>{c.statement}</div>
              <div className="row wrap gap-6">
                <Pill tone={c.confidence === 'high' ? 'aligned' : 'reviewed'}>{c.confidence}</Pill>
                <span className="tiny faint">{c.reason}</span>
                {c.ownerName ? <span className="tiny muted">· {c.ownerName}</span> : null}
                {c.duplicateOf ? <Pill tone="info">{`already ${c.duplicateOf}`}</Pill> : null}
              </div>
              <Guardrails decision={c} limit={4} />
            </div>
          </div>
        </label>
      ))}
      <div className="btn-row">
        <AsyncButton
          kind="primary"
          size="sm"
          icon="plus"
          disabled={!n}
          onClick={async () => {
            const items = cands.filter((c) => picked[c.key]);
            const r = await invoke('recordPageDecisions', { items });
            flag(`Tracking ${plural(r.recorded.length, 'new decision')}`, r.recorded.map((d) => d.id).join(', ') + ' — Jira work is being checked against them now.');
            setState(null);
            onRecorded(r.recorded);
          }}
        >
          {`Track ${plural(n, 'decision')}`}
        </AsyncButton>
        <span className="tiny faint">Jira work is re-checked right away.</span>
      </div>
    </div>
  );
}

export default function Byline() {
  const [items, setItems] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const load = async () => {
    const num = (x) => Number(String(x.decision.id).replace(/\D/g, '')) || 0;
    const list = await invoke('getPageDecisions');
    setItems([...(list || [])].sort((a, b) => num(a) - num(b)));
  };
  useEffect(() => {
    load();
    rovoEnabled().then(setRovoOn);
  }, []);
  if (!items) return <div className="byline"><Spinner label="Loading decisions" /></div>;
  const conflicts = items.reduce((n, i) => n + i.conflicts.length, 0);
  return (
    <div className="byline col gap-12">
      <div className="row spread">
        <div className="row gap-6">
          <div className="logo" style={{ width: 28, height: 28, borderRadius: 8 }}>
            <Icon name="shieldCheck" size={16} style={{ color: '#fff' }} />
          </div>
          <div>
            <div className="strong">{items.length ? `${plural(items.length, 'decision')} tracked by Precedent` : 'No decisions tracked on this page yet'}</div>
            <div className="tiny faint">{items.length ? (conflicts ? `${plural(conflicts, 'Jira work item')} contradict them` : 'No Jira work contradicts them') : 'Type /decision in the editor, or let Precedent find them below.'}</div>
          </div>
        </div>
      </div>
      {recorded ? <Banner tone="success" title={`Now tracking ${recorded.map((d) => d.id).join(', ')}`}>Precedent checks every new and edited Jira work item against them.</Banner> : null}
      {items.map((it, i) => (
        <Tracked key={it.decision.id} item={it} delay={i * 40} />
      ))}
      <Finder
        onRecorded={(ds) => {
          setRecorded(ds);
          load();
        }}
      />
      {rovoOn && items.length ? (
        <Button icon="chat" onClick={() => askRovo('Which Jira work items contradict the decisions on this page, and what should we do about each?')}>
          Ask Precedent
        </Button>
      ) : null}
    </div>
  );
}
