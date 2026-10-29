// Jira issue panel: does this work item contradict anything the team already decided — and if so,
// what is the compliant version of it?
import React, { useEffect, useState } from 'react';
import { invoke, askRovo, rovoEnabled, getContext, flag } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { AsyncButton, Banner, Button, DecId, DecisionMeta, Field, Pill, Spinner, plural, sameText } from '../components/primitives.jsx';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wrap every occurrence of `terms` in a highlight. */
export function Highlight({ text, terms = [], tone = '' }) {
  const words = terms.filter(Boolean).flatMap((t) => [t, ...t.split(/\s+/).filter((w) => w.length > 3)]);
  if (!words.length || !text) return text || null;
  const re = new RegExp(`(${[...new Set(words)].sort((a, b) => b.length - a.length).map(esc).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className={`mark ${tone}`}>{part}</mark> : part));
}

const VERDICT = {
  conflict: { icon: 'alert', title: (n) => `Contradicts ${plural(n, 'team decision')}`, sub: 'Something here is ruled out by an active decision. Fix it in one click, or talk to the owner before building.' },
  acknowledged: { icon: 'flag', title: () => 'Conflicts reviewed by the team', sub: 'Every conflict on this work item has been reviewed.' },
  aligned: { icon: 'shieldCheck', title: () => 'Aligned with team decisions', sub: 'This work removes or replaces something a decision rules out.' },
  related: { icon: 'info', title: () => 'Consistent with team decisions', sub: 'Worth a read before you start.' },
  clear: { icon: 'checkCircle', title: () => 'No recorded decision covers this', sub: 'If you make a call here, record it so the next person knows.' },
};

function FixCard({ fix, decision, onApply, rovoOn, issueKey }) {
  if (!fix) return null;
  if (fix.kind === 'rewrite') {
    const descN = fix.description?.length || 0;
    return (
      <div className="fix rise">
        <div className="row gap-6">
          <Icon name="wand" size={15} style={{ color: 'var(--purple)' }} />
          <span className="strong small">Compliant alternative</span>
          <Pill tone="magic">one click</Pill>
        </div>
        <div className="diff">
          {fix.summary ? (
            <>
              <div className="before">
                <Highlight text={fix.summary.before} terms={[fix.from]} tone="del" />
              </div>
              <div className="arrow">becomes</div>
              <div className="strong">
                <Highlight text={fix.summary.after} terms={[fix.to]} tone="good" />
              </div>
            </>
          ) : (
            <div className="small">
              Replace <mark className="mark del">{fix.from}</mark> with <mark className="mark good">{fix.to}</mark>
            </div>
          )}
          {descN ? <div className="tiny faint">{`…and ${plural(descN, 'sentence')} in the description`}</div> : null}
        </div>
        <div className="btn-row">
          <AsyncButton kind="magic" size="sm" icon="wand" onClick={() => onApply(decision.id)}>
            {`Apply: use ${fix.to}`}
          </AsyncButton>
          <span className="tiny faint">Re-checked automatically; a comment records the change.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="fix rise">
      <div className="row gap-6">
        <Icon name="wand" size={15} style={{ color: 'var(--purple)' }} />
        <span className="strong small">How to comply</span>
      </div>
      <div className="small mt-8">{fix.advice}</div>
      {rovoOn ? (
        <div className="mt-8">
          <Button size="sm" icon="chat" onClick={() => askRovo(`Suggest a compliant way to do ${issueKey} that respects ${decision.id} (“${decision.title}”).`)}>
            Ask Precedent for options
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExceptionForm({ decision, onCancel, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <div className="card flat fade" style={{ background: 'var(--sunken)' }}>
      <Field label={`Why may this work item deviate from ${decision.id}?`} help="Recorded on the decision's history; clears this conflict for this work item only.">
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Throwaway spike for the partner demo; deleted before GA." autoFocus />
      </Field>
      <div className="btn-row mt-12">
        <AsyncButton kind="warning" size="sm" disabled={reason.trim().length < 5} onClick={() => onSubmit(reason.trim())}>
          Log exception
        </AsyncButton>
        <Button kind="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ConflictCard({ conflict, fix, issueKey, rovoOn, onAck, onException, onApply }) {
  const d = conflict.decision;
  const [excepting, setExcepting] = useState(false);
  return (
    <div className={`card accent ${conflict.acknowledged ? 'reviewed' : 'conflict'} rise`} style={{ paddingLeft: 18 }}>
      <div className="row gap-6 wrap">
        <DecId id={d.id} />
        {conflict.acknowledged ? <Pill tone="reviewed">reviewed</Pill> : <Pill tone="conflict" icon="ban">conflict</Pill>}
      </div>
      <div className="h3 mt-8">{d.title}</div>
      {sameText(d.statement, d.title) ? null : <div className="quote small mt-8">{d.statement}</div>}
      <div className="mt-12 col gap-4">
        <div className="tiny strong" style={{ color: 'var(--red)', letterSpacing: 0.3 }}>
          {`TRIPS GUARDRAIL · AVOID ${conflict.terms.join(', ').toUpperCase()}`}
        </div>
        <div className="small">
          “<Highlight text={conflict.evidence} terms={conflict.terms} />”
        </div>
      </div>
      <div className="mt-12">
        <DecisionMeta decision={d} />
      </div>
      {!conflict.acknowledged && fix ? (
        <div className="mt-12">
          <FixCard fix={fix} decision={d} onApply={onApply} rovoOn={rovoOn} issueKey={issueKey} />
        </div>
      ) : null}
      <div className="btn-row mt-12">
        {rovoOn ? (
          <Button
            kind="primary"
            size="sm"
            icon="chat"
            onClick={() => askRovo(`Explain how ${issueKey} conflicts with ${d.id} (“${d.title}”): why was it decided, who should I talk to, and what are my options?`)}
          >
            Ask Precedent
          </Button>
        ) : null}
        <AsyncButton size="sm" icon={conflict.acknowledged ? 'refresh' : 'check'} onClick={() => onAck(d.id, conflict.acknowledged)}>
          {conflict.acknowledged ? 'Reopen' : 'Mark reviewed'}
        </AsyncButton>
        {!excepting ? (
          <Button size="sm" kind="subtle" icon="flag" onClick={() => setExcepting(true)}>
            Log exception
          </Button>
        ) : null}
      </div>
      {excepting ? (
        <div className="mt-12">
          <ExceptionForm decision={d} onCancel={() => setExcepting(false)} onSubmit={(reason) => onException(d.id, reason)} />
        </div>
      ) : null}
    </div>
  );
}

function MiniDecision({ decision, note, tone }) {
  return (
    <div className={`card flat accent ${tone} mini-decision`} style={{ paddingLeft: 16 }}>
      <div className="row gap-6">
        <DecId id={decision.id} />
        <span className="strong small clamp-1">{decision.title}</span>
      </div>
      {note ? <div className="tiny muted mt-8">{note}</div> : null}
    </div>
  );
}

function RecordForm({ projectKey, onCancel, onSaved }) {
  const [form, setForm] = useState({ statement: '', rationale: '', avoid: '', prefer: '', tags: '', ownerName: '', projectOnly: false });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="card fade col gap-12">
      <div className="h3">Record a decision</div>
      <Field label="Decision" help="Write it as an instruction. Precedent extracts what to avoid and prefer.">
        <textarea className="textarea" value={form.statement} onChange={set('statement')} placeholder="e.g. Refunds stay on the shared PostgreSQL cluster; do not create a separate refunds database." autoFocus />
      </Field>
      <Field label="Why">
        <textarea className="textarea" style={{ minHeight: 48 }} value={form.rationale} onChange={set('rationale')} />
      </Field>
      <div className="grid two">
        <Field label="Avoid (optional)">
          <input className="input" value={form.avoid} onChange={set('avoid')} placeholder="comma separated" />
        </Field>
        <Field label="Prefer (optional)">
          <input className="input" value={form.prefer} onChange={set('prefer')} placeholder="comma separated" />
        </Field>
      </div>
      <div className="grid two">
        <Field label="Owner">
          <input className="input" value={form.ownerName} onChange={set('ownerName')} />
        </Field>
        <Field label="Tags">
          <input className="input" value={form.tags} onChange={set('tags')} placeholder="payments, security" />
        </Field>
      </div>
      {projectKey ? (
        <label className="check small">
          <input type="checkbox" checked={form.projectOnly} onChange={() => setForm({ ...form, projectOnly: !form.projectOnly })} />
          Only applies to project {projectKey}
        </label>
      ) : null}
      <div className="btn-row">
        <AsyncButton kind="primary" size="sm" disabled={form.statement.trim().length < 8} onClick={async () => onSaved(await invoke('recordDecision', form))}>
          Record decision
        </AsyncButton>
        <Button kind="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function IssuePanel() {
  const [ctx, setCtx] = useState(null);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = async () => {
    try {
      const r = await invoke('getIssueCheck');
      if (r?.error) setError(r.error);
      else setCheck(r);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    getContext().then(setCtx).catch(() => setCtx({}));
    load();
    rovoEnabled().then(setRovoOn);
  }, []);

  if (error) return <Banner tone="error" title="Precedent could not check this work item">{error}</Banner>;
  if (!check) return <Spinner label="Checking team decisions" />;

  const issueKey = ctx?.extension?.issue?.key || check.issue?.key;
  const projectKey = ctx?.extension?.project?.key || check.issue?.projectKey;
  const open = check.conflicts.filter((c) => !c.acknowledged);
  const view = check.status === 'related' && check.aligned.length && !check.related.length ? 'aligned' : check.status;
  const v = VERDICT[view] || VERDICT.clear;

  const onApply = async (decisionId) => {
    const r = await invoke('applyFix', { decisionId });
    if (r?.error) {
      setNotice({ tone: 'error', title: 'Could not apply the fix', text: r.error });
      return;
    }
    setCheck(r.check);
    setNotice({ tone: 'success', title: `Updated to comply with ${decisionId}`, text: `“${r.applied.from}” → “${r.applied.to}”. A comment on the work item records the change.` });
    flag(`${issueKey} now complies with ${decisionId}`, `Replaced ${r.applied.from} with ${r.applied.to}. Refresh the page to see the new summary.`);
  };

  return (
    <div className="panel col gap-12">
      <div className={`verdict ${view} rise`}>
        <div className="row gap-12 top">
          <div className="icon">
            <Icon name={v.icon} size={19} stroke={2.4} />
          </div>
          <div className="grow">
            <div className="title">{v.title(open.length || check.conflicts.length)}</div>
            <div className="sub">
              {view === 'related' ? `${plural(check.related.length + check.aligned.length, 'decision')} relevant to this work. ${v.sub}` : v.sub}
            </div>
          </div>
        </div>
      </div>

      {notice ? <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner> : null}

      {check.conflicts.map((c) => (
        <ConflictCard
          key={c.decision.id}
          conflict={c}
          fix={check.fixes?.[c.decision.id]}
          issueKey={issueKey}
          rovoOn={rovoOn}
          onApply={onApply}
          onAck={async (decisionId, undo) => setCheck(await invoke('acknowledge', { decisionId, undo }))}
          onException={async (decisionId, reason) => setCheck(await invoke('logException', { decisionId, reason }))}
        />
      ))}

      {check.aligned.length ? (
        <div className="col gap-6">
          <div className="eyebrow">Aligned · {check.aligned.length}</div>
          {check.aligned.map((a) => (
            <MiniDecision key={a.decision.id} decision={a.decision} note={a.reason} tone="aligned" />
          ))}
        </div>
      ) : null}

      {check.related.length ? (
        <div className="col gap-6">
          <div className="eyebrow">Related decisions · {check.related.length}</div>
          {check.related.map((r) => (
            <MiniDecision key={r.decision.id} decision={r.decision} note={sameText(r.decision.statement, r.decision.title) ? null : r.decision.statement} tone="related" />
          ))}
        </div>
      ) : null}

      {recording ? (
        <RecordForm
          projectKey={projectKey}
          onCancel={() => setRecording(false)}
          onSaved={(d) => {
            setRecording(false);
            setNotice({ tone: 'success', title: `Recorded ${d.id}`, text: d.title });
            load();
          }}
        />
      ) : null}

      <div className="btn-row">
        {!recording ? (
          <Button size="sm" icon="plus" onClick={() => setRecording(true)}>
            Record a decision
          </Button>
        ) : null}
        {rovoOn && !check.conflicts.length ? (
          <Button size="sm" kind="subtle" icon="chat" onClick={() => askRovo(`Which team decisions should I know about before working on ${issueKey}?`)}>
            Ask Precedent
          </Button>
        ) : null}
        <AsyncButton size="sm" kind="subtle" icon="refresh" onClick={load}>
          Re-check
        </AsyncButton>
      </div>
      <div className="row gap-6 tiny faint">
        <Icon name="search" size={12} /> JQL: <code>precedentConflicts &gt; 0</code>
      </div>
    </div>
  );
}
