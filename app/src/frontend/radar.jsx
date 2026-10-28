// Decision Radar (Jira project page): which work in this project contradicts team decisions?
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Heading,
  Text,
  Button,
  LoadingButton,
  Link,
  Lozenge,
  Spinner,
  SectionMessage,
  DynamicTable,
  DonutChart,
  Icon,
  xcss,
} from '@forge/react';
import { invoke, rovo, router } from '@forge/bridge';
import { AGENT, cardStyle, DecisionId, Guardrails, SectionTitle, Stat, formatDate, ago } from './ui';

const pageStyle = xcss({ padding: 'space.300', maxWidth: '1280px' });
const chartBox = xcss({ minWidth: '320px', width: '360px' });

const App = () => {
  const [data, setData] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => setData(await invoke('getRadar'));
  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
  }, []);

  if (!data) return <Spinner label="Loading Decision Radar" />;

  const { projectKey, decisions, checks } = data;
  const conflicts = checks.filter((c) => c.status === 'conflict');
  const counts = {
    Conflict: conflicts.length,
    Reviewed: checks.filter((c) => c.status === 'acknowledged').length,
    'Related / aligned': checks.filter((c) => c.status === 'related').length,
    'No decision applies': checks.filter((c) => c.status === 'clear').length,
  };
  const chartData = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value }));

  // which decisions are hit most in this project
  const hits = {};
  for (const c of conflicts) for (const x of c.conflicts.filter((y) => !y.acknowledged)) hits[x.decision.id] = (hits[x.decision.id] || 0) + 1;

  const rows = conflicts
    .sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''))
    .map((c) => ({
      key: c.issue.key,
      cells: [
        {
          key: 'issue',
          content: (
            <Stack space="space.025">
              <Link href={c.issue.url} openNewTab>
                {c.issue.key}
              </Link>
              <Text size="small" maxLines={2}>
                {c.issue.summary}
              </Text>
            </Stack>
          ),
        },
        {
          key: 'decisions',
          content: (
            <Stack space="space.050">
              {c.conflicts
                .filter((x) => !x.acknowledged)
                .map((x) => (
                  <Inline key={x.decision.id} space="space.050" alignBlock="center">
                    <DecisionId id={x.decision.id} />
                    <Text size="small" maxLines={1}>
                      {x.decision.title}
                    </Text>
                  </Inline>
                ))}
            </Stack>
          ),
        },
        {
          key: 'evidence',
          content: (
            <Text size="small" maxLines={3}>
              {`“${c.conflicts.find((x) => !x.acknowledged)?.evidence || ''}”`}
            </Text>
          ),
        },
        { key: 'status', content: <Lozenge>{c.issue.status || '—'}</Lozenge> },
        { key: 'assignee', content: <Text size="small">{c.issue.assignee?.displayName || 'Unassigned'}</Text> },
        { key: 'checked', content: <Text size="small">{ago(c.checkedAt)}</Text> },
      ],
    }));

  return (
    <Box xcss={pageStyle}>
      <Stack space="space.300">
        <Inline spread="space-between" alignBlock="center" shouldWrap>
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center">
              <Icon glyph="target" label="" size="large" color="color.icon.brand" />
              <Heading size="large">{`Decision Radar · ${projectKey}`}</Heading>
            </Inline>
            <Text color="color.text.subtle">Work in this project that quietly contradicts what the team already decided — caught when the work item is written, not after it ships.</Text>
          </Stack>
          <Inline space="space.100">
            {rovoOn ? (
              <Button iconBefore="rovo-chat" onClick={() => rovo.open({ ...AGENT, prompt: `Summarise the open decision conflicts in project ${projectKey} and suggest who each one should be discussed with.` })}>
                Ask Precedent
              </Button>
            ) : null}
            <Button
              appearance="subtle"
              iconBefore="search"
              onClick={() => router.navigate(`/issues/?jql=${encodeURIComponent(`project = ${projectKey} AND precedentConflicts > 0 ORDER BY updated DESC`)}`)}
            >
              Open in JQL
            </Button>
            <LoadingButton
              appearance="subtle"
              iconBefore="refresh"
              isLoading={busy}
              onClick={async () => {
                setBusy(true);
                await invoke('rescanProject');
                setQueued(true);
                setBusy(false);
              }}
            >
              Re-scan project
            </LoadingButton>
          </Inline>
        </Inline>

        {queued ? (
          <SectionMessage appearance="information" title="Re-scan queued">
            <Text>Every work item in {projectKey} is being re-checked in the background. Refresh in a minute.</Text>
            <Button appearance="link" onClick={load}>
              Refresh now
            </Button>
          </SectionMessage>
        ) : null}

        <Inline space="space.200" shouldWrap>
          <Stat label="Open conflicts" value={conflicts.length} tone={conflicts.length ? 'danger' : 'success'} />
          <Stat label="Work items checked" value={checks.length} />
          <Stat label="Decisions that apply here" value={decisions.length} />
          <Stat label="Reviewed / excepted" value={counts.Reviewed} />
        </Inline>

        <Inline space="space.300" shouldWrap alignBlock="start">
          <Box xcss={xcss({ flexGrow: 1, minWidth: '520px', width: '62%' })}>
            <Stack space="space.150">
              <SectionTitle count={rows.length}>Work items contradicting decisions</SectionTitle>
              {rows.length ? (
                <DynamicTable
                  head={{
                    cells: [
                      { key: 'issue', content: 'Work item', width: 24 },
                      { key: 'decisions', content: 'Contradicts', width: 28 },
                      { key: 'evidence', content: 'Evidence', width: 26 },
                      { key: 'status', content: 'Status', width: 8 },
                      { key: 'assignee', content: 'Assignee', width: 8 },
                      { key: 'checked', content: 'Checked', width: 6 },
                    ],
                  }}
                  rows={rows}
                  rowsPerPage={10}
                />
              ) : (
                <SectionMessage appearance="success" title="No open conflicts">
                  <Text>Nothing in {projectKey} contradicts an active decision right now.</Text>
                </SectionMessage>
              )}
            </Stack>
          </Box>
          <Box xcss={chartBox}>
            <Stack space="space.150">
              <SectionTitle>Checked work items</SectionTitle>
              {chartData.length ? (
                <DonutChart data={chartData} colorAccessor="label" labelAccessor="label" valueAccessor="value" showMarkLabels height={260} />
              ) : (
                <Text color="color.text.subtle">No work items checked yet.</Text>
              )}
            </Stack>
          </Box>
        </Inline>

        <Stack space="space.150">
          <SectionTitle count={decisions.length}>{`Decisions that apply to ${projectKey}`}</SectionTitle>
          <Inline space="space.150" shouldWrap>
            {decisions.slice(0, 9).map((d) => (
              <Box key={d.id} xcss={xcss({ width: '380px' })}>
                <Box xcss={cardStyle}>
                  <Stack space="space.075">
                    <Inline space="space.075" alignBlock="center">
                      <DecisionId id={d.id} />
                      {hits[d.id] ? <Lozenge appearance="removed">{`${hits[d.id]} conflict${hits[d.id] > 1 ? 's' : ''}`}</Lozenge> : null}
                    </Inline>
                    <Text weight="semibold" maxLines={2}>
                      {d.title}
                    </Text>
                    <Text size="small" color="color.text.subtle">
                      {[d.owner?.name, formatDate(d.decidedAt)].filter(Boolean).join(' · ')}
                    </Text>
                    <Guardrails decision={d} />
                  </Stack>
                </Box>
              </Box>
            ))}
          </Inline>
        </Stack>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
