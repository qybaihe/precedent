// Jira issue context panel: does this work item contradict anything the team already decided?
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Text,
  Strong,
  Button,
  LoadingButton,
  SectionMessage,
  Spinner,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  TextArea,
  Textfield,
  Label,
  HelperMessage,
  Checkbox,
  Lozenge,
  Icon,
  useProductContext,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import {
  AGENT,
  cardStyle,
  conflictCardStyle,
  evidenceStyle,
  DecisionId,
  DecisionMeta,
  Quote,
  SectionTitle,
} from './ui';

const VERDICT = {
  conflict: { appearance: 'error', title: (n) => `Contradicts ${n} team decision${n > 1 ? 's' : ''}` },
  acknowledged: { appearance: 'warning', title: () => 'Conflicts reviewed by the team' },
  related: { appearance: 'information', title: () => 'Consistent with team decisions' },
  clear: { appearance: 'success', title: () => 'No recorded decision covers this work' },
};

const ConflictCard = ({ conflict, issueKey, onAck, onException, rovoOn, busy }) => {
  const d = conflict.decision;
  return (
    <Box xcss={conflictCardStyle}>
      <Stack space="space.100">
        <Inline space="space.075" alignBlock="center" shouldWrap>
          <DecisionId id={d.id} />
          {conflict.acknowledged ? <Lozenge appearance="moved">reviewed</Lozenge> : <Lozenge appearance="removed">conflict</Lozenge>}
        </Inline>
        <Text weight="semibold">{d.title}</Text>
        <Quote>{d.statement}</Quote>
        <Box xcss={evidenceStyle}>
          <Stack space="space.050">
            <Text size="small" weight="semibold" color="color.text.danger">
              {`Trips guardrail: avoid ${conflict.terms.join(', ')}`}
            </Text>
            <Text size="small">{`“${conflict.evidence}”`}</Text>
          </Stack>
        </Box>
        <DecisionMeta decision={d} />
        <Inline space="space.075" shouldWrap>
          {rovoOn ? (
            <Button
              appearance="primary"
              iconBefore="rovo-chat"
              onClick={() =>
                rovo.open({
                  ...AGENT,
                  prompt: `Explain how ${issueKey} conflicts with ${d.id} (“${d.title}”): why was it decided, who should I talk to, and what are my options?`,
                })
              }
            >
              Ask Precedent
            </Button>
          ) : null}
          {conflict.acknowledged ? (
            <LoadingButton isLoading={busy === `ack-${d.id}`} onClick={() => onAck(d.id, true)}>
              Reopen
            </LoadingButton>
          ) : (
            <LoadingButton isLoading={busy === `ack-${d.id}`} onClick={() => onAck(d.id, false)}>
              Mark reviewed
            </LoadingButton>
          )}
          <Button appearance="subtle" onClick={() => onException(d)}>
            Log exception
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
};

const SmallDecision = ({ decision, note, tone }) => (
  <Box xcss={cardStyle}>
    <Stack space="space.075">
      <Inline space="space.075" alignBlock="center" shouldWrap>
        <DecisionId id={decision.id} />
        {tone === 'aligned' ? <Lozenge appearance="success">aligned</Lozenge> : null}
        <Text weight="medium">{decision.title}</Text>
      </Inline>
      {note ? (
        <Text size="small" color="color.text.subtle">
          {note}
        </Text>
      ) : null}
      <DecisionMeta decision={decision} />
    </Stack>
  </Box>
);

const ExceptionModal = ({ decision, onClose, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>{`Log an exception to ${decision.id}`}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Quote>{decision.statement}</Quote>
          <Stack space="space.050">
            <Label labelFor="reason">Why is it OK for this work item to deviate?</Label>
            <TextArea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Throwaway spike for the partner demo; deleted before GA." />
            <HelperMessage>The exception is recorded on the decision's history and clears this conflict for this work item only.</HelperMessage>
          </Stack>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          Cancel
        </Button>
        <LoadingButton
          appearance="warning"
          isLoading={saving}
          isDisabled={reason.trim().length < 5}
          onClick={async () => {
            setSaving(true);
            await onSubmit(reason.trim());
            setSaving(false);
          }}
        >
          Log exception
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

const RecordModal = ({ onClose, onSaved, projectKey }) => {
  const [form, setForm] = useState({ statement: '', rationale: '', avoid: '', prefer: '', tags: '', ownerName: '', projectOnly: false });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal onClose={onClose} width="medium">
      <ModalHeader>
        <ModalTitle>Record a decision</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Stack space="space.050">
            <Label labelFor="statement">Decision</Label>
            <TextArea id="statement" value={form.statement} onChange={set('statement')} placeholder="e.g. Refunds stay on the shared PostgreSQL cluster; do not create a separate refunds database." />
            <HelperMessage>Write it as an instruction. Precedent extracts what to avoid and prefer automatically.</HelperMessage>
          </Stack>
          <Stack space="space.050">
            <Label labelFor="rationale">Why</Label>
            <TextArea id="rationale" value={form.rationale} onChange={set('rationale')} />
          </Stack>
          <Inline space="space.150" grow="fill">
            <Stack space="space.050" grow="fill">
              <Label labelFor="avoid">Avoid (optional)</Label>
              <Textfield id="avoid" value={form.avoid} onChange={set('avoid')} placeholder="comma separated" />
            </Stack>
            <Stack space="space.050" grow="fill">
              <Label labelFor="prefer">Prefer (optional)</Label>
              <Textfield id="prefer" value={form.prefer} onChange={set('prefer')} placeholder="comma separated" />
            </Stack>
          </Inline>
          <Inline space="space.150" grow="fill">
            <Stack space="space.050" grow="fill">
              <Label labelFor="owner">Owner</Label>
              <Textfield id="owner" value={form.ownerName} onChange={set('ownerName')} />
            </Stack>
            <Stack space="space.050" grow="fill">
              <Label labelFor="tags">Tags</Label>
              <Textfield id="tags" value={form.tags} onChange={set('tags')} placeholder="payments, security" />
            </Stack>
          </Inline>
          {projectKey ? (
            <Checkbox
              isChecked={form.projectOnly}
              onChange={() => setForm({ ...form, projectOnly: !form.projectOnly })}
              label={`Only applies to project ${projectKey}`}
            />
          ) : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          Cancel
        </Button>
        <LoadingButton
          appearance="primary"
          isLoading={saving}
          isDisabled={form.statement.trim().length < 8}
          onClick={async () => {
            setSaving(true);
            const d = await invoke('recordDecision', form);
            setSaving(false);
            onSaved(d);
          }}
        >
          Record decision
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

const App = () => {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  const projectKey = context?.extension?.project?.key;
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [exceptionFor, setExceptionFor] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);

  const load = async () => {
    setBusy('load');
    try {
      const r = await invoke('getIssueCheck');
      if (r?.error) setError(r.error);
      else setCheck(r);
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  useEffect(() => {
    load();
    rovo
      .isEnabled()
      .then(setRovoOn)
      .catch(() => setRovoOn(false));
  }, []);

  const onAck = async (decisionId, undo) => {
    setBusy(`ack-${decisionId}`);
    setCheck(await invoke('acknowledge', { decisionId, undo }));
    setBusy(null);
  };

  if (error) return <SectionMessage appearance="error" title="Precedent could not check this work item"><Text>{error}</Text></SectionMessage>;
  if (!check) return <Spinner label="Checking team decisions" />;

  const open = check.conflicts.filter((c) => !c.acknowledged);
  const verdict = VERDICT[check.status] || VERDICT.clear;

  return (
    <Stack space="space.200">
      <SectionMessage appearance={verdict.appearance} title={verdict.title(open.length || check.conflicts.length)}>
        <Text>
          {check.status === 'conflict'
            ? 'This work item mentions something an active decision rules out. Check with the decision owner before building it.'
            : check.status === 'acknowledged'
              ? 'Every conflict on this work item has been reviewed.'
              : check.status === 'related'
                ? `${check.related.length + check.aligned.length} decision${check.related.length + check.aligned.length === 1 ? '' : 's'} relevant to this work — worth a read before you start.`
                : 'Nothing in the decision register covers this. If you make a call here, record it.'}
        </Text>
      </SectionMessage>

      {check.conflicts.length ? (
        <Stack space="space.100">
          <SectionTitle count={check.conflicts.length}>Conflicts</SectionTitle>
          {check.conflicts.map((c) => (
            <ConflictCard key={c.decision.id} conflict={c} issueKey={issueKey} onAck={onAck} onException={setExceptionFor} rovoOn={rovoOn} busy={busy} />
          ))}
        </Stack>
      ) : null}

      {check.aligned.length ? (
        <Stack space="space.100">
          <SectionTitle count={check.aligned.length}>Aligned</SectionTitle>
          {check.aligned.map((a) => (
            <SmallDecision key={a.decision.id} decision={a.decision} note={a.reason} tone="aligned" />
          ))}
        </Stack>
      ) : null}

      {check.related.length ? (
        <Stack space="space.100">
          <SectionTitle count={check.related.length}>Related decisions</SectionTitle>
          {check.related.map((r) => (
            <SmallDecision key={r.decision.id} decision={r.decision} note={r.decision.statement} />
          ))}
        </Stack>
      ) : null}

      {recorded ? (
        <SectionMessage appearance="success" title={`Recorded ${recorded.id}`}>
          <Text>{recorded.title}</Text>
        </SectionMessage>
      ) : null}

      <Inline space="space.100" shouldWrap alignBlock="center">
        <Button iconBefore="decision" onClick={() => setRecording(true)}>
          Record a decision
        </Button>
        {rovoOn && !check.conflicts.length ? (
          <Button
            appearance="subtle"
            iconBefore="rovo-chat"
            onClick={() => rovo.open({ ...AGENT, prompt: `Which team decisions should I know about before working on ${issueKey}?` })}
          >
            Ask Precedent
          </Button>
        ) : null}
        <LoadingButton appearance="subtle" isLoading={busy === 'load'} onClick={load}>
          Re-check
        </LoadingButton>
      </Inline>
      <Inline space="space.050" alignBlock="center">
        <Icon glyph="search" label="" size="small" color="color.icon.subtle" />
        <Text size="small" color="color.text.subtle">
          JQL:
        </Text>
        <Text size="small">
          <Strong>precedentConflicts &gt; 0</Strong>
        </Text>
      </Inline>

      <ModalTransition>
        {exceptionFor ? (
          <ExceptionModal
            decision={exceptionFor}
            onClose={() => setExceptionFor(null)}
            onSubmit={async (reason) => {
              setCheck(await invoke('logException', { decisionId: exceptionFor.id, reason }));
              setExceptionFor(null);
            }}
          />
        ) : null}
        {recording ? (
          <RecordModal
            projectKey={projectKey}
            onClose={() => setRecording(false)}
            onSaved={(d) => {
              setRecording(false);
              setRecorded(d);
              load();
            }}
          />
        ) : null}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
