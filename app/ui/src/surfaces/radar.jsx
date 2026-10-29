// Decision Radar (Jira project page): which work in this project contradicts team decisions,
// how far along that work is, and what the compliant alternative would be.
import React, { useEffect, useState } from 'react';
import { invoke, open, navigate, askRovo, rovoEnabled } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { AsyncButton, Avatar, Banner, Button, DecId, Empty, Kpi, Pill, Spinner, ago, plural } from '../components/primitives.jsx';
import { Donut, Gauge, Heatmap, RELATION_COLOR } from '../components/charts.jsx';
import { DecisionCard, DecisionDrawer } from '../components/decision.jsx';
import { Highlight } from './issue.jsx';

// Contradicting work is more urgent the further it has got.
const STAGES = [
  { key: 'new', label: 'Planned', title: 'To do' },
  { key: 'indeterminate', label: 'In progress', title: 'In progress' },
  { key: 'done', label: 'Shipped', title: 'Done' },
];

function ConflictRow({ check, decisions, onOpenDecision, delay }) {
  const open_ = check.conflicts.filter((x) => !x.acknowledged);
  const first = open_[0];
  const fix = first?.fix;
  const stage = check.issue.statusCategory;
  return (
    <div className="card accent conflict rise" style={{ paddingLeft: 20, animationDelay: `${delay}ms` }}>
      <div className="row spread top gap-12">
        <div className="col gap-4 grow" style={{ minWidth: 0 }}>
          <div className="row gap-6">
            <a className="mono strong" onClick={() => open(check.issue.url)}>
              {check.issue.key}
            </a>
            <Pill tone={stage === 'done' ? 'conflict' : stage === 'indeterminate' ? 'reviewed' : ''}>{check.issue.status || '—'}</Pill>
            <span className="tiny faint">checked {ago(check.checkedAt)}</span>
          </div>
          <div className="h3">{check.issue.summary}</div>
        </div>
        <div className="row gap-6 small muted">
          {check.issue.assignee ? <Avatar name={check.issue.assignee.displayName} /> : null}
          <span>{check.issue.assignee?.displayName || 'Unassigned'}</span>
        </div>
      </div>
      <div className="row wrap gap-12 mt-12 top">
        <div className="col gap-6 grow" style={{ minWidth: 260 }}>
          {open_.map((x) => (
            <div key={x.decision.id} className="row gap-6" style={{ minWidth: 0 }}>
              <span className="tiny strong" style={{ color: 'var(--red)' }}>CONTRADICTS</span>
              <DecId id={x.decision.id} onClick={() => onOpenDecision(x.decision.id)} />
              <span className="small clamp-1">{x.decision.title}</span>
              {x.outdated?.length ? <Pill tone="overdue" icon="clock">possibly outdated</Pill> : null}
            </div>
          ))}
          <div className="small muted">
            “<Highlight text={first?.evidence} terms={first?.terms} />”
          </div>
        </div>
        {fix ? (
          <div className="card flat" style={{ background: 'var(--purple-bg)', borderColor: 'transparent', padding: '8px 12px', maxWidth: 340 }}>
            <div className="row gap-6 tiny strong" style={{ color: 'var(--purple)' }}>
              <Icon name="wand" size={13} /> {fix.kind === 'rewrite' ? 'ONE-CLICK FIX' : 'HOW TO COMPLY'}
            </div>
            <div className="small mt-8" style={{ color: 'var(--text)' }}>
              {fix.kind === 'rewrite' ? (
                <>
                  Use <b>{fix.to}</b> instead of <b>{fix.from}</b>. Apply it from the work item's Precedent panel.
                </>
              ) : (
                fix.advice
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Radar() {
  const [data, setData] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [queued, setQueued] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = async () => setData(await invoke('getRadar'));
  useEffect(() => {
    load();
    rovoEnabled().then(setRovoOn);
  }, []);
  if (!data) return <Spinner label="Loading Decision Radar" />;

  const { projectKey, decisions, checks } = data;
  const conflicts = checks.filter((c) => c.status === 'conflict').sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''));
  const counts = {
    conflict: conflicts.length,
    reviewed: checks.filter((c) => c.status === 'acknowledged').length,
    related: checks.filter((c) => c.status === 'related').length,
    clear: checks.filter((c) => c.status === 'clear').length,
  };
  const alignment = checks.length ? Math.round(((checks.length - counts.conflict) / checks.length) * 100) : 100;

  // severity heatmap: decision × how far the contradicting work has got
  const cells = {};
  for (const c of conflicts)
    for (const x of c.conflicts.filter((k) => !k.acknowledged)) (cells[`${x.decision.id}|${c.issue.statusCategory || 'new'}`] ||= []).push(c.issue);
  const hitIds = [...new Set(conflicts.flatMap((c) => c.conflicts.filter((k) => !k.acknowledged).map((k) => k.decision.id)))];
  const heatRows = hitIds.map((id) => ({ id, label: decisions.find((d) => d.id === id)?.title || id }));
  const impact = {};
  for (const c of checks) {
    for (const x of c.conflicts) (impact[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).conflicts += x.acknowledged ? 0 : 1;
    for (const x of c.aligned) (impact[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).aligned += 1;
    for (const x of c.related) (impact[x.decision.id] ||= { conflicts: 0, aligned: 0, related: 0 }).related += 1;
  }

  // tripped tripwires first, then other premises that changed, then overdue reviews
  const rank = (d) => (d.health.outdated.reasons.some((r) => /Tripwire/.test(r)) ? 0 : d.health.outdated.reasons.some((r) => /^Assumption/.test(r)) ? 1 : 2);
  const review = decisions.filter((d) => d.health?.outdated?.possibly && rank(d) < 2).sort((a, b) => rank(a) - rank(b));

  return (
    <div className="page">
      <section className="hero rise">
        <div className="row spread wrap gap-20">
          <div className="col gap-12 grow" style={{ minWidth: 320 }}>
            <div className="row gap-12">
              <div className="logo">
                <Icon name="target" size={22} style={{ color: '#fff' }} />
              </div>
              <div>
                <div className="eyebrow">Precedent · {projectKey}</div>
                <h1 className="h1">Decision Radar</h1>
              </div>
            </div>
            <div className="muted" style={{ maxWidth: 620, fontSize: 14.5 }}>
              Work in this project that quietly contradicts what the team already decided, caught when the work item is written, not after it ships.
            </div>
            <div className="btn-row mt-8">
              {rovoOn ? (
                <Button kind="primary" icon="chat" onClick={() => askRovo(`Summarise the open decision conflicts in project ${projectKey} and suggest who each one should be discussed with.`)}>
                  Ask Precedent
                </Button>
              ) : null}
              <Button icon="search" onClick={() => navigate(`/issues/?jql=${encodeURIComponent(`project = ${projectKey} AND precedentConflicts > 0 ORDER BY updated DESC`)}`)}>
                Open in JQL
              </Button>
              <AsyncButton
                icon="refresh"
                onClick={async () => {
                  await invoke('rescanProject');
                  setQueued(true);
                }}
              >
                Re-scan project
              </AsyncButton>
            </div>
          </div>
          <Gauge value={alignment} light label="Alignment" size={170} />
        </div>
      </section>

      {queued ? (
        <div className="mt-16">
          <Banner tone="info" title="Re-scan queued">
            Every work item in {projectKey} is being re-checked in the background.{' '}
            <a onClick={load}>Refresh now</a>
          </Banner>
        </div>
      ) : null}

      {review.length ? (
        <div className="needs-review mt-16 rise">
          <div className="row gap-8">
            <span className="pulse-dot" />
            <span className="strong">{`${plural(review.length, 'decision')} ${review.length === 1 ? 'needs' : 'need'} review`}</span>
            <span className="small" style={{ opacity: 0.85 }}>The world changed under {review.length === 1 ? 'it' : 'them'}: work is still being checked against {review.length === 1 ? 'it' : 'them'}.</span>
          </div>
          <div className="col gap-6 mt-8">
            {review.map((d) => (
              <button key={d.id} className="review-row" onClick={() => setOpenId(d.id)}>
                <span className="mono strong">{d.id}</span>
                <span className="strong clamp-1" style={{ flex: '0 1 auto' }}>{d.title}</span>
                <span className="clamp-1 small" style={{ opacity: 0.9 }}>{d.health.outdated.reasons[0]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid kpis mt-16">
        <Kpi label="Open conflicts" value={counts.conflict} tone={counts.conflict ? 'danger' : 'success'} accent={counts.conflict ? 'conflict' : 'aligned'} hint={`${conflicts.filter((c) => c.issue.statusCategory !== 'new').length} already in progress or shipped`} delay={40} />
        <Kpi label="Work items checked" value={checks.length} accent="related" hint="every create and edit is checked" delay={80} />
        <Kpi label="Decisions that apply" value={decisions.length} accent="superseded" hint={`of ${data.totalDecisions} in the register`} delay={120} />
        <Kpi label="Reviewed / excepted" value={counts.reviewed} accent="reviewed" hint="deliberate, recorded deviations" delay={160} />
      </div>

      <div className="grid two mt-16">
        <div className="card pad-lg rise">
          <div className="card-title">
            <div>
              <div className="h2">Conflict severity</div>
              <div className="small faint">The further contradicting work has got, the costlier it is to undo.</div>
            </div>
            <Icon name="grid" size={18} className="faint" />
          </div>
          {heatRows.length ? (
            <Heatmap
              rows={heatRows}
              cols={STAGES}
              cell={(id, stage) => ({ count: cells[`${id}|${stage}`]?.length || 0, items: cells[`${id}|${stage}`] || [] })}
              rowHead={(r) => (
                <>
                  <DecId id={r.id} onClick={() => setOpenId(r.id)} />
                  <span className="clamp-1 small" title={r.label}>{r.label}</span>
                </>
              )}
              onCell={(r, c, v) => open(v.items[0].url)}
            />
          ) : (
            <Empty art="ok" title="No open conflicts">Nothing in {projectKey} contradicts an active decision right now.</Empty>
          )}
        </div>
        <div className="card pad-lg rise" style={{ animationDelay: '60ms' }}>
          <div className="card-title">
            <div className="h2">Checked work items</div>
            <Icon name="pulse" size={18} className="faint" />
          </div>
          {checks.length ? (
            <Donut
              segments={[
                { label: 'Contradicts a decision', value: counts.conflict, color: RELATION_COLOR.conflict },
                { label: 'Conflict reviewed', value: counts.reviewed, color: RELATION_COLOR.reviewed },
                { label: 'Related or aligned', value: counts.related, color: RELATION_COLOR.related },
                { label: 'No decision applies', value: counts.clear, color: '#8590a2' },
              ]}
            />
          ) : (
            <Empty title="No work items checked yet">Create or edit a work item, or re-scan the project.</Empty>
          )}
        </div>
      </div>

      <div className="mt-24">
        <div className="row spread">
          <div className="h2">Work items contradicting decisions</div>
          <Pill tone={conflicts.length ? 'conflict' : 'aligned'}>{plural(conflicts.length, 'open conflict')}</Pill>
        </div>
        <div className="col gap-12 mt-12">
          {conflicts.length ? (
            conflicts.map((c, i) => <ConflictRow key={c.issue.key} check={c} decisions={decisions} onOpenDecision={setOpenId} delay={i * 50} />)
          ) : (
            <div className="card">
              <Empty art="ok" title="All clear">Nothing in {projectKey} contradicts an active decision right now.</Empty>
            </div>
          )}
        </div>
      </div>

      <div className="mt-24">
        <div className="h2">{`Decisions that apply to ${projectKey}`}</div>
        <div className="grid cards mt-12">
          {decisions.slice(0, 9).map((d, i) => (
            <DecisionCard key={d.id} decision={d} impact={impact[d.id]} onOpen={setOpenId} delay={i * 30} />
          ))}
        </div>
      </div>

      {openId ? <DecisionDrawer id={openId} rovoOn={rovoOn} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </div>
  );
}
