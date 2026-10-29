// Decision Center (Jira and Confluence global page): team decision health, where decisions are
// being contradicted, how they age, and the full register.
import React, { useEffect, useMemo, useState } from 'react';
import { invoke, open, askRovo, rovoEnabled, getContext, flag, APP_ID } from '../api.js';
import { Icon, Logo } from '../components/icons.jsx';
import { AsyncButton, Banner, Button, DecId, Empty, Field, Kpi, Segmented, Spinner, Tabs, plural } from '../components/primitives.jsx';
import { DecisionMap, Gauge, GRADE_COLOR, Heatmap, Lifecycle } from '../components/charts.jsx';
import { DecisionCard, DecisionDrawer } from '../components/decision.jsx';
import { ChangeFeed } from '../components/lineage.jsx';

const SIGNAL_ICON = { conflicts: 'alert', exceptions: 'flag', review: 'clock', owner: 'user', guardrails: 'shield', assumption: 'alert' };

function NeedsAttention({ decisions, onOpen, onReviewed }) {
  const list = decisions
    .filter((d) => d.status === 'active' && d.health && d.health.grade !== 'healthy')
    .sort((a, b) => a.health.score - b.health.score)
    .slice(0, 6);
  if (!list.length) return <Empty art="ok" title="Every active decision is healthy">Owned, enforced, reviewed on time, and nobody is working against them.</Empty>;
  return (
    <ul className="list-reset col gap-6">
      {list.map((d, i) => (
        <li key={d.id} className={`card flat accent ${d.health.grade} rise`} style={{ padding: '10px 12px 10px 16px', animationDelay: `${i * 50}ms` }}>
          <div className="row gap-12">
            <div className="col gap-4 grow" style={{ minWidth: 0 }}>
              <div className="row gap-6" style={{ minWidth: 0 }}>
                <DecId id={d.id} onClick={() => onOpen(d.id)} />
                <a className="strong clamp-1" style={{ color: 'var(--text)' }} onClick={() => onOpen(d.id)}>
                  {d.title}
                </a>
              </div>
              <div className="row wrap gap-6 tiny">
                {d.health.signals
                  .filter((s) => s.impact < 0)
                  .slice(0, 3)
                  .map((s) => (
                    <span key={s.kind} className="row gap-4" style={{ color: s.tone === 'danger' ? 'var(--red)' : 'var(--amber)' }}>
                      <Icon name={SIGNAL_ICON[s.kind] || 'info'} size={12} />
                      {s.label}
                    </span>
                  ))}
              </div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: GRADE_COLOR[d.health.grade] }}>{d.health.score}</span>
              {d.health.reviewState !== 'ok' ? (
                <AsyncButton
                  size="xs"
                  kind="subtle"
                  icon="shieldCheck"
                  onClick={async () => {
                    await invoke('reviewDecision', { id: d.id });
                    await onReviewed();
                  }}
                >
                  Still valid
                </AsyncButton>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConflictHeatmap({ decisions, checks, siteUrl, onOpen }) {
  // only projects where something actually contradicts a decision
  const projects = [...new Set(checks.filter((c) => c.conflicts.some((k) => !k.acknowledged)).map((c) => c.issue?.projectKey).filter(Boolean))].sort();
  const counts = {};
  for (const c of checks)
    for (const x of c.conflicts.filter((k) => !k.acknowledged)) {
      const k = `${x.decision.id}|${c.issue.projectKey}`;
      (counts[k] ||= []).push(c.issue);
    }
  const rows = decisions
    .filter((d) => d.status === 'active')
    .map((d) => ({ id: d.id, label: d.title, total: projects.reduce((n, p) => n + (counts[`${d.id}|${p}`]?.length || 0), 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  if (!rows.length || !projects.length) return <Empty art="ok" title="No open conflicts">Nothing in Jira contradicts an active decision right now.</Empty>;
  return (
    <Heatmap
      rows={rows}
      cols={projects.map((p) => ({ key: p, label: p }))}
      cell={(id, p) => ({ count: counts[`${id}|${p}`]?.length || 0, items: counts[`${id}|${p}`] || [] })}
      rowHead={(r) => (
        <>
          <DecId id={r.id} onClick={() => onOpen(r.id)} />
          <span className="clamp-1 small" title={r.label}>
            {r.label}
          </span>
        </>
      )}
      onCell={(r, c, v) =>
        v.items.length === 1
          ? open(v.items[0].url)
          : open(`${siteUrl}/issues/?jql=${encodeURIComponent(`project = ${c.key} AND precedentDecisions ~ "${r.id}" AND precedentConflicts > 0`)}`)
      }
    />
  );
}

/** Coding agents: the brief Precedent keeps on work items, and the MCP tools. */
function AgentSetup({ appId, settings }) {
  const [opts, setOpts] = useState({ autoBrief: settings?.autoBrief !== false, briefTarget: settings?.briefTarget || 'comment' });
  const save = async (patch) => {
    setOpts({ ...opts, ...patch });
    await invoke('saveSettings', patch);
    flag('Saved', 'Briefs update the next time each work item is checked.');
  };
  return (
    <div className="card pad-lg">
      <div className="row gap-6">
        <Icon name="code" size={18} style={{ color: 'var(--link)' }} />
        <div className="h2">Coding agents</div>
      </div>
      <div className="small muted mt-8">
        Precedent keeps a short <b>Precedent brief</b> on every work item a decision governs: what to do, what not to do (including denied packages), the code paths each decision covers. Jira's <b>Open in coding tool</b> hands the work item to Claude Code, Cursor, Copilot, Codex or VS Code, so the agent starts out knowing what was decided.
      </div>
      <label className="row gap-8 small mt-12" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={opts.autoBrief} onChange={(e) => save({ autoBrief: e.target.checked })} style={{ width: 16, height: 16, accentColor: 'var(--brand)' }} />
        Keep a brief on governed work items automatically
      </label>
      <div className="mt-8">
        <Segmented
          value={opts.briefTarget}
          onChange={(v) => save({ briefTarget: v })}
          options={[
            { value: 'description', label: 'In the description' },
            { value: 'comment', label: 'As a comment' },
          ]}
        />
        <div className="tiny faint mt-8">
          {opts.briefTarget === 'description'
            ? 'A marked block at the end of the description: Open in coding tool always includes it. Precedent never checks or rewrites its own block.'
            : 'One comment, edited in place. Agents see it when they read the work item over the Atlassian MCP server.'}
        </div>
      </div>
      <div className="small muted mt-16">
        <b>MCP tools.</b> In <b>Rovo Studio</b>, add them to any agent under Tools → Connected apps → Precedent. For Claude Code and other MCP clients (Preview), an org admin enables them in Atlassian Administration → Apps → Sites → Connected apps, then:
      </div>
      <div className="code mt-8">{`claude mcp add --transport http precedent https://mcp.atlassian.com/forge/${appId || APP_ID}`}</div>
      <div className="tiny faint mt-8">precedent-preflight · guard-check · check-work-item · search-decisions · get-decision · record-decision · supersede-decision · log-exception · list-conflicts</div>
    </div>
  );
}

/** Precedent inside Jira's own flows: Create dialog hint, Done gate, Rovo reviewer. */
function JiraFlows({ createHints }) {
  const [status, setStatus] = useState(createHints);
  const [error, setError] = useState(null);
  return (
    <div className="card pad-lg">
      <div className="row gap-6">
        <Icon name="lock" size={18} style={{ color: 'var(--red)' }} />
        <div className="h2">Enforce in Jira</div>
      </div>
      <div className="col gap-12 small mt-12">
        <div>
          <b>1. “Already decided” while creating.</b> The Create dialog warns under the summary when a new work item contradicts a decision.{' '}
          {status?.projects ? <span className="pill aligned">{`On for ${plural(status.projects.length, 'project')}`}</span> : null}
          <div className="mt-8">
            <AsyncButton
              size="sm"
              icon={status ? 'refresh' : 'plus'}
              onClick={async () => {
                const r = await invoke('enableCreateHints');
                if (r?.error) setError(r.error);
                else {
                  setError(null);
                  setStatus(r);
                }
              }}
            >
              {status ? 'Update for new projects' : 'Turn on for all projects'}
            </AsyncButton>
          </div>
          {error ? <div className="mt-8"><Banner tone="error">{error}</Banner></div> : null}
        </div>
        <div>
          <b>2. Block Done while a conflict is open.</b> In the workflow editor, select the transition to Done → <b>Add rule</b> → <b>Validate details</b> → <i>No unresolved decision conflicts (Precedent)</i>. Reviewed conflicts and logged exceptions pass.
        </div>
        <div>
          <b>3. Precedent as a reviewer.</b> In Rovo Studio, open the <b>Precedent</b> agent → Surfaces → turn on <b>Work item</b>. Then assign work items to it, or add <b>Trigger agent action → Precedent</b> to the transition to In Review: it posts a PASS / BLOCKED verdict with the evidence.
        </div>
      </div>
    </div>
  );
}

function Setup({ appId, settings, graph, createHints, onLoaded }) {
  const [setup, setSetup] = useState(null);
  const [space, setSpace] = useState('');
  const [project, setProject] = useState('');
  const [done, setDone] = useState(null);
  useEffect(() => {
    invoke('getSetup').then(setSetup);
  }, []);
  return (
    <div className="grid two">
      <div className="col gap-16">
        <div className="card pad-lg">
          <div className="h2">How Precedent finds decisions</div>
          <ul className="col gap-6 small mt-12" style={{ paddingLeft: 18, margin: '12px 0' }}>
            <li><b>Confluence decision items</b>: type <code>/decision</code> in any page (meeting notes, architecture reviews).</li>
            <li><b>Meeting notes in plain prose</b>: on any page, open the <b>Precedent</b> byline and click <b>Find decisions on this page</b>.</li>
            <li><b>Decision pages</b> made from Confluence's Decision template (the <code>Outcome</code> row).</li>
            <li><b>Jira comments</b> that start with <code>Decision:</code>.</li>
            <li><b>Rovo and AI agents</b>: "record a decision…", or <code>record-decision</code> over MCP.</li>
          </ul>
          <AsyncButton
            icon="refresh"
            onClick={async () => {
              await invoke('scanConfluence');
              setDone('Scanning the 50 most recently updated Confluence pages in the background. Refresh in a minute.');
            }}
          >
            Scan Confluence now
          </AsyncButton>
        </div>
        <div className="card pad-lg">
          <div className="row gap-6">
            <Icon name="sparkles" size={18} style={{ color: 'var(--purple)' }} />
            <div className="h2">Try it with sample content</div>
          </div>
          <div className="small muted mt-8">
            Creates a <b>Payments Architecture Review</b> page with four decisions, a <b>Decision page</b> about feature flags, and seven work items, four of which quietly contradict those decisions.
          </div>
          {!setup ? (
            <Spinner />
          ) : (
            <div className="grid two mt-16" style={{ alignItems: 'end' }}>
              <Field label="Confluence space">
                <select className="select" value={space} onChange={(e) => setSpace(e.target.value)}>
                  <option value="">Pick a space</option>
                  {setup.spaces.map((s) => (
                    <option key={s.id} value={s.id}>{`${s.name} (${s.key})`}</option>
                  ))}
                </select>
              </Field>
              <Field label="Jira project">
                <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">Pick a project</option>
                  {setup.projects.map((p) => (
                    <option key={p.key} value={p.key}>{`${p.name} (${p.key})`}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="mt-16 btn-row">
            <AsyncButton
              kind="primary"
              icon="sparkles"
              disabled={!space && !project}
              onClick={async () => {
                const r = await invoke('createSampleData', { spaceId: space || undefined, projectKey: project || undefined });
                setDone(`Created ${plural(r.pages.length, 'page')} (${plural(r.decisions, 'decision')}) and ${plural(r.issues.length, 'work item')}: ${r.issues.join(', ')}. Conflict checks are running now.`);
                onLoaded();
              }}
            >
              Create sample content
            </AsyncButton>
          </div>
          {done ? <div className="mt-12"><Banner tone="success">{done}</Banner></div> : null}
        </div>
      </div>
      <div className="col gap-16">
        <AgentSetup appId={appId} settings={settings} />
        <JiraFlows createHints={createHints} />
        <div className="card pad-lg">
          <div className="row gap-6">
            <Icon name="graph" size={18} style={{ color: 'var(--purple)' }} />
            <div className="h2">Teamwork Graph</div>
            {graph?.connections ? <span className="pill aligned">Connected</span> : <span className="pill">Not connected</span>}
          </div>
          <div className="small muted mt-8">
            Every decision is published to Atlassian's Teamwork Graph as a document (statement, owner, guardrails, assumptions and the work that contradicts it), so Rovo Search and any agent on the graph can find it. Data never leaves Atlassian.
          </div>
          {graph?.connections ? (
            <div className="small mt-12">
              {graph.lastSync ? `Last sync ${new Date(graph.lastSync.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}: ${graph.lastSync.accepted} of ${graph.lastSync.objects} decisions accepted.` : 'Waiting for the first sync.'}
              <div className="mt-8">
                <AsyncButton size="sm" icon="refresh" onClick={() => invoke('syncGraph')}>
                  Sync now
                </AsyncButton>
              </div>
            </div>
          ) : (
            <div className="small mt-12">An org admin connects it once: Atlassian Administration → Apps → Sites → your site → Connected apps → Precedent → <b>Connections</b> → Teamwork Graph connectors → <b>Connect</b>.</div>
          )}
        </div>
        <div className="card pad-lg">
          <div className="row gap-6">
            <Icon name="search" size={18} style={{ color: 'var(--link)' }} />
            <div className="h2">Find conflicting work with JQL</div>
          </div>
          <div className="code mt-12">{'precedentConflicts > 0 ORDER BY updated DESC\nprecedentStatus = "conflict" AND project = PAY\nprecedentDecisions ~ "DEC-3"'}</div>
        </div>
        <div className="card pad-lg">
          <div className="row gap-6">
            <Icon name="clock" size={18} style={{ color: 'var(--amber)' }} />
            <div className="h2">Review cadence</div>
          </div>
          <div className="small muted mt-8">
            Every decision is due for review {settings?.reviewDays || 180} days after it was made or last confirmed. Overdue decisions lower the health score; <b>Still valid</b> restarts the clock, and <b>Remind owner</b> posts a comment on the source page that mentions the owner.
          </div>
        </div>
      </div>
    </div>
  );
}

const SORTS = [
  { value: 'risk', label: 'Most at risk' },
  { value: 'new', label: 'Newest' },
  { value: 'id', label: 'ID' },
];

export default function DecisionCenter() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [openId, setOpenId] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [appId, setAppId] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('risk');

  const load = async () => setData(await invoke('getOverview'));
  useEffect(() => {
    load();
    rovoEnabled().then(setRovoOn);
    getContext()
      .then((c) => setAppId((c.localId || '').split('/')[1] || APP_ID))
      .catch(() => setAppId(APP_ID));
  }, []);

  const decisions = data?.decisions || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = decisions.filter(
      (d) => (status === 'all' || d.status === status) && (!q || `${d.id} ${d.title} ${d.statement} ${(d.tags || []).join(' ')} ${d.owner?.name || ''}`.toLowerCase().includes(q)),
    );
    const num = (d) => Number(d.id.split('-')[1]);
    if (sort === 'risk') return list.sort((a, b) => (a.health?.score ?? 101) - (b.health?.score ?? 101) || num(a) - num(b));
    if (sort === 'new') return list.sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || '') || num(b) - num(a));
    return list.sort((a, b) => num(a) - num(b));
  }, [decisions, query, status, sort]);

  if (!data) return <Spinner label="Loading the decision register" />;

  const { refs, checks, team } = data;
  const active = decisions.filter((d) => d.status === 'active');
  const openConflicts = Object.values(refs).reduce((n, r) => n + r.conflicts, 0);
  const aligned = Object.values(refs).reduce((n, r) => n + r.aligned, 0);
  const countBy = (s) => decisions.filter((d) => s === 'all' || d.status === s).length;

  return (
    <div className="page">
      <section className="hero rise">
        <div className="row spread wrap gap-20">
          <div className="col gap-12 grow" style={{ minWidth: 320 }}>
            <div className="row gap-12">
              <Logo />
              <div>
                <div className="eyebrow">Precedent</div>
                <h1 className="h1">Decision Log</h1>
              </div>
            </div>
            <div className="muted" style={{ maxWidth: 620, fontSize: 14.5 }}>
              What your team has already decided, captured from Confluence, Jira and Rovo, checked against every new work item, and kept healthy with reviews.
            </div>
            <div className="btn-row mt-8">
              {rovoOn ? (
                <Button kind="primary" icon="chat" onClick={() => askRovo('Which decisions are being contradicted right now, by which work items, and which decisions are due for review?')}>
                  Ask Precedent
                </Button>
              ) : null}
              <AsyncButton icon="refresh" onClick={load}>
                Refresh
              </AsyncButton>
            </div>
          </div>
          <div className="row gap-20">
            <Gauge value={team.score} light label="Team health" size={176} />
            <div className="col gap-6 small">
              <span className="legend" style={{ color: '#fff' }}><i style={{ background: GRADE_COLOR.healthy }} /><b>{team.healthy}</b>&nbsp;healthy</span>
              <span className="legend" style={{ color: '#fff' }}><i style={{ background: GRADE_COLOR.watch }} /><b>{team.watch}</b>&nbsp;to watch</span>
              <span className="legend" style={{ color: '#fff' }}><i style={{ background: GRADE_COLOR['at-risk'] }} /><b>{team.atRisk}</b>&nbsp;at risk</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid kpis mt-16">
        <Kpi label="Active decisions" value={active.length} hint={`${decisions.length - active.length} superseded or archived`} accent="related" delay={40} />
        <Kpi label="Open conflicts" value={openConflicts} tone={openConflicts ? 'danger' : 'success'} accent={openConflicts ? 'conflict' : 'aligned'} hint={openConflicts ? 'work items contradicting decisions' : 'nothing contradicts a decision'} delay={80} />
        <Kpi label="Work items aligned" value={aligned} tone={aligned ? 'success' : ''} accent="aligned" hint="removing or replacing what a decision rules out" delay={120} />
        <Kpi label="Possibly outdated" value={team.outdated} tone={team.outdated ? 'warning' : 'success'} accent="reviewed" hint={team.outdated ? 'an assumption changed or the revisit date passed' : 'every decision confirmed and current'} delay={160} />
        <Kpi label="From Confluence" value={decisions.filter((d) => d.source?.type === 'confluence').length} accent="superseded" hint="captured where teams already write" delay={200} />
      </div>

      <Tabs
        value={decisions.length ? tab : 'setup'}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'pulse' },
          { id: 'decisions', label: 'Decisions', icon: 'list', count: decisions.length },
          { id: 'map', label: 'Map', icon: 'graph' },
          { id: 'setup', label: 'Setup & integrations', icon: 'settings' },
        ]}
      />

      {!decisions.length || tab === 'setup' ? (
        <>
          {!decisions.length ? (
            <div className="card pad-lg" style={{ marginBottom: 16 }}>
              <Empty title="No decisions captured yet">Scan Confluence, write a /decision in any page, or create the sample content below to see Precedent in action.</Empty>
            </div>
          ) : null}
          <Setup appId={appId} settings={data.settings} graph={data.teamworkGraph} createHints={data.createHints} onLoaded={load} />
        </>
      ) : tab === 'overview' ? (
        <div className="col gap-16">
          <div className="grid two">
            <div className="card pad-lg rise">
              <div className="card-title">
                <div>
                  <div className="h2">Conflict heatmap</div>
                  <div className="small faint">Open conflicts per decision and project. Click a cell to see the work items.</div>
                </div>
                <Icon name="grid" size={18} className="faint" />
              </div>
              <ConflictHeatmap decisions={decisions} checks={checks} siteUrl={data.siteUrl} onOpen={setOpenId} />
            </div>
            <div className="card pad-lg rise" style={{ animationDelay: '60ms' }}>
              <div className="card-title">
                <div>
                  <div className="h2">Needs attention</div>
                  <div className="small faint">Lowest health first: conflicts, exceptions, overdue reviews, missing owners or guardrails.</div>
                </div>
                <Icon name="alert" size={18} className="faint" />
              </div>
              <NeedsAttention decisions={decisions} onOpen={setOpenId} onReviewed={load} />
            </div>
          </div>
          <div className="card pad-lg rise" style={{ animationDelay: '120ms' }}>
            <div className="card-title">
              <div>
                <div className="h2">Decision lifecycle</div>
                <div className="small faint">When each decision was made, when it is due for review, and the work that contradicts it.</div>
              </div>
              <Icon name="timeline" size={18} className="faint" />
            </div>
            <Lifecycle decisions={decisions} checks={checks} onSelect={setOpenId} />
          </div>
          <div className="card pad-lg rise" style={{ animationDelay: '160ms' }}>
            <div className="card-title">
              <div>
                <div className="h2">What changed</div>
                <div className="small faint">Supersessions, exceptions, assumptions that stopped holding, and reviews: the decision register's audit trail.</div>
              </div>
              <Icon name="layers" size={18} className="faint" />
            </div>
            <ChangeFeed decisions={decisions} onOpen={setOpenId} />
          </div>
        </div>
      ) : tab === 'decisions' ? (
        <div className="col gap-16">
          <div className="row wrap gap-12">
            <div className="search grow" style={{ minWidth: 260 }}>
              <Icon name="search" size={16} />
              <input className="input" placeholder="Search topic, owner, DEC id…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Segmented
              value={status}
              onChange={setStatus}
              options={['active', 'superseded', 'archived', 'all'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), count: countBy(s) }))}
            />
            <Segmented value={sort} onChange={setSort} options={SORTS} />
          </div>
          {filtered.length ? (
            <div className="grid cards">
              {filtered.map((d, i) => (
                <DecisionCard key={d.id} decision={d} impact={refs[d.id]} onOpen={setOpenId} delay={Math.min(i, 12) * 30} />
              ))}
            </div>
          ) : (
            <Empty title="No decisions match">Try another word, or switch the status filter to All.</Empty>
          )}
        </div>
      ) : (
        <div className="card pad-lg rise">
          <div className="card-title">
            <div>
              <div className="h2">Decision map</div>
              <div className="small faint">Every decision and the work items touching it. Hover to trace, click to open.</div>
            </div>
          </div>
          <DecisionMap decisions={decisions} checks={checks} teamScore={team.score} onSelect={setOpenId} onIssue={(i) => open(i.url)} />
        </div>
      )}

      {openId ? <DecisionDrawer id={openId} rovoOn={rovoOn} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </div>
  );
}
