// Decision Log: the register of everything the team has decided, shown in Confluence and Jira.
import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  Stack,
  Inline,
  Heading,
  Text,
  Strong,
  Button,
  LoadingButton,
  Link,
  Lozenge,
  Spinner,
  SectionMessage,
  EmptyState,
  DynamicTable,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Textfield,
  Select,
  Label,
  HelperMessage,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Code,
  CodeBlock,
  Icon,
  List,
  ListItem,
  xcss,
} from '@forge/react';
import { invoke, rovo, view } from '@forge/bridge';
import { AGENT, APP_ID, cardStyle, subtleStyle, DecisionId, DecisionStatus, DecisionMeta, Guardrails, Quote, SectionTitle, Stat, formatDate } from './ui';

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Proposed', value: 'proposed' },
  { label: 'Archived', value: 'archived' },
];
const FILTERS = [{ label: 'All statuses', value: 'all' }, ...STATUS_OPTIONS];

const pageStyle = xcss({ padding: 'space.300', maxWidth: '1280px' });
const rowStyle = xcss({ paddingBlock: 'space.100' });
const filterStyle = xcss({ minWidth: '180px' });

/** Same words, ignoring case and punctuation (a statement that only repeats its title adds nothing). */
const sameText = (a, b) => {
  const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
};

const SOURCE_ICON = { confluence: 'page', jira: 'comment', rovo: 'rovo-chat', manual: 'edit' };

function sourceLabel(d) {
  const s = d.source || {};
  return s.kind || s.label || 'Recorded';
}

// ---------- decision detail ----------

const DecisionModal = ({ id, onClose, onChanged, rovoOn }) => {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const r = await invoke('getDecision', { id });
    setData(r);
    if (r) {
      setForm({
        status: r.decision.status,
        avoid: (r.decision.guardrails?.avoid || []).map((t) => t.text).join(', '),
        prefer: (r.decision.guardrails?.prefer || []).map((t) => t.text).join(', '),
        tags: (r.decision.tags || []).join(', '),
        ownerName: r.decision.owner?.name || '',
      });
    }
  };
  useEffect(() => {
    load();
  }, [id]);

  if (!data) {
    return (
      <Modal onClose={onClose} width="large">
        <ModalBody>
          <Spinner label="Loading decision" />
        </ModalBody>
      </Modal>
    );
  }
  const d = data.decision;
  const rows = data.workItems.map((w) => ({
    key: w.issue.key,
    cells: [
      { key: 'k', content: <Link href={w.issue.url} openNewTab>{w.issue.key}</Link> },
      { key: 's', content: <Text>{w.issue.summary}</Text> },
      {
        key: 'r',
        content: (
          <Lozenge appearance={w.relation === 'conflict' ? 'removed' : w.relation === 'aligned' ? 'success' : w.relation === 'reviewed' ? 'moved' : 'default'}>
            {w.relation}
          </Lozenge>
        ),
      },
      { key: 'st', content: <Text size="small">{w.issue.status || ''}</Text> },
    ],
  }));

  const save = async () => {
    setSaving(true);
    await invoke('updateDecision', { id: d.id, patch: form });
    setSaving(false);
    setEditing(false);
    await load();
    onChanged();
  };

  return (
    <Modal onClose={onClose} width="x-large">
      <ModalHeader>
        <Inline space="space.100" alignBlock="center">
          <DecisionId id={d.id} />
          <ModalTitle>{d.title}</ModalTitle>
          <DecisionStatus status={d.status} />
        </Inline>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.250">
          <Quote>{d.statement}</Quote>
          <DecisionMeta decision={d} />
          {d.supersededBy ? (
            <SectionMessage appearance="warning" title={`Superseded by ${d.supersededBy}`}>
              <Text>This decision is kept for history and is no longer enforced.</Text>
            </SectionMessage>
          ) : null}
          {d.rationale ? (
            <Stack space="space.075">
              <SectionTitle>Why</SectionTitle>
              <Text>{d.rationale}</Text>
            </Stack>
          ) : null}

          <Stack space="space.100">
            <SectionTitle>Guardrails</SectionTitle>
            {editing ? (
              <Stack space="space.150">
                <Inline space="space.150" grow="fill">
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="avoid">Avoid</Label>
                    <Textfield id="avoid" value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value })} />
                  </Stack>
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="prefer">Prefer</Label>
                    <Textfield id="prefer" value={form.prefer} onChange={(e) => setForm({ ...form, prefer: e.target.value })} />
                  </Stack>
                </Inline>
                <Inline space="space.150" grow="fill">
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="status">Status</Label>
                    <Select
                      inputId="status"
                      options={STATUS_OPTIONS}
                      value={STATUS_OPTIONS.find((o) => o.value === form.status)}
                      onChange={(o) => setForm({ ...form, status: o.value })}
                    />
                  </Stack>
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="owner">Owner</Label>
                    <Textfield id="owner" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
                  </Stack>
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="tags">Tags</Label>
                    <Textfield id="tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                  </Stack>
                </Inline>
                <HelperMessage>Curated guardrails are kept even when the source page changes.</HelperMessage>
              </Stack>
            ) : (
              <Stack space="space.075">
                <Guardrails decision={d} />
                {!(d.guardrails?.avoid || []).length ? (
                  <Text size="small" color="color.text.subtle">
                    No explicit guardrails — Precedent will surface this decision as related context only.
                  </Text>
                ) : null}
              </Stack>
            )}
          </Stack>

          <Stack space="space.100">
            <SectionTitle count={rows.length}>Work items touching this decision</SectionTitle>
            {rows.length ? (
              <DynamicTable
                head={{ cells: [{ key: 'k', content: 'Key' }, { key: 's', content: 'Summary' }, { key: 'r', content: 'Relation' }, { key: 'st', content: 'Status' }] }}
                rows={rows}
              />
            ) : (
              <Text color="color.text.subtle">No work items reference this decision yet.</Text>
            )}
          </Stack>

          {(d.exceptions || []).length ? (
            <Stack space="space.075">
              <SectionTitle count={d.exceptions.length}>Exceptions</SectionTitle>
              <List type="unordered">
                {d.exceptions.map((e) => (
                  <ListItem key={e.issueKey}>
                    <Text>
                      <Strong>{e.issueKey}</Strong> — {e.reason} ({formatDate(e.at)})
                    </Text>
                  </ListItem>
                ))}
              </List>
            </Stack>
          ) : null}

          <Stack space="space.075">
            <SectionTitle>History</SectionTitle>
            <List type="unordered">
              {(d.history || []).map((h, i) => (
                <ListItem key={`${h.at}-${i}`}>
                  <Text size="small">
                    {formatDate(h.at)} — {h.what}
                  </Text>
                </ListItem>
              ))}
            </List>
          </Stack>
        </Stack>
      </ModalBody>
      <ModalFooter>
        {rovoOn ? (
          <Button iconBefore="rovo-chat" appearance="subtle" onClick={() => rovo.open({ ...AGENT, prompt: `Tell me about ${d.id}: why we decided it, who owns it, and which work items contradict it.` })}>
            Ask Precedent
          </Button>
        ) : null}
        {editing ? (
          <>
            <Button appearance="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <LoadingButton appearance="primary" isLoading={saving} onClick={save}>
              Save
            </LoadingButton>
          </>
        ) : (
          <>
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button appearance="primary" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

// ---------- setup tab ----------

const Setup = ({ onLoaded, appId }) => {
  const [setup, setSetup] = useState(null);
  const [space, setSpace] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    invoke('getSetup').then(setSetup);
  }, []);

  const spaceOptions = (setup?.spaces || []).map((s) => ({ label: `${s.name} (${s.key})`, value: s.id }));
  const projectOptions = (setup?.projects || []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));

  return (
    <Stack space="space.300">
      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">How Precedent finds decisions</Heading>
          <List type="unordered">
            <ListItem>
              <Text>
                <Strong>Confluence decision items</Strong> — type <Code>/decision</Code> in any page (meeting notes, architecture reviews). Each item becomes a tracked decision.
              </Text>
            </ListItem>
            <ListItem>
              <Text>
                <Strong>Decision pages</Strong> — pages made from Confluence's Decision template (the <Code>Outcome</Code> row is the decision).
              </Text>
            </ListItem>
            <ListItem>
              <Text>
                <Strong>Jira comments</Strong> — start a comment with <Code>Decision:</Code>.
              </Text>
            </ListItem>
            <ListItem>
              <Text>
                <Strong>Rovo and AI agents</Strong> — tell the Precedent agent “record a decision…”, or let your coding agent call <Code>record-decision</Code> over MCP.
              </Text>
            </ListItem>
          </List>
          <Inline space="space.100">
            <LoadingButton
              isLoading={busy === 'scan'}
              onClick={async () => {
                setBusy('scan');
                await invoke('scanConfluence');
                setBusy(null);
                setDone('Scanning the 50 most recently updated Confluence pages in the background. Refresh in a minute.');
              }}
            >
              Scan Confluence now
            </LoadingButton>
          </Inline>
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Try it with sample content</Heading>
          <Text>
            Creates a <Strong>Payments Architecture Review</Strong> page with four decisions, a <Strong>Decision page</Strong> about feature flags, and seven work items — four of which quietly contradict those decisions.
          </Text>
          {!setup ? (
            <Spinner />
          ) : (
            <Inline space="space.150" grow="fill" alignBlock="end">
              <Stack space="space.050" grow="fill">
                <Label labelFor="space">Confluence space</Label>
                <Select inputId="space" options={spaceOptions} value={space} onChange={setSpace} placeholder="Pick a space" />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Label labelFor="project">Jira project</Label>
                <Select inputId="project" options={projectOptions} value={project} onChange={setProject} placeholder="Pick a project" />
              </Stack>
              <LoadingButton
                appearance="primary"
                isLoading={busy === 'sample'}
                isDisabled={!space && !project}
                onClick={async () => {
                  setBusy('sample');
                  const r = await invoke('createSampleData', { spaceId: space?.value, projectKey: project?.value });
                  setBusy(null);
                  setDone(`Created ${r.pages.length} pages (${r.decisions} decisions) and ${r.issues.length} work items: ${r.issues.join(', ')}. Conflict checks are running now.`);
                  onLoaded();
                }}
              >
                Create sample content
              </LoadingButton>
            </Inline>
          )}
          {done ? (
            <SectionMessage appearance="success">
              <Text>{done}</Text>
            </SectionMessage>
          ) : null}
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Use Precedent from your AI tools (MCP)</Heading>
          <Text>
            Precedent exposes its actions as MCP tools. In Rovo Studio, add them to any custom agent under <Strong>Tools → Connected apps</Strong>. For Claude Code, Cursor and other MCP clients, an org admin first enables the tools in Atlassian Administration → Apps → Sites → Connected apps, then:
          </Text>
          <CodeBlock language="bash" text={`claude mcp add --transport http precedent https://mcp.atlassian.com/forge/${appId || '<app-id>'}`} />
          <Text size="small" color="color.text.subtle">
            Tools: search-decisions, get-decision, check-work-item, record-decision, supersede-decision, log-exception, list-conflicts.
          </Text>
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.100">
          <Heading size="small">Find conflicting work with JQL</Heading>
          <CodeBlock language="sql" text={'precedentConflicts > 0 ORDER BY updated DESC\nprecedentStatus = "conflict" AND project = PAY\nprecedentDecisions ~ "DEC-3"'} />
        </Stack>
      </Box>
    </Stack>
  );
};

// ---------- main ----------

const App = () => {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(FILTERS[1]);
  const [openId, setOpenId] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  const [appId, setAppId] = useState(null);
  const [tab, setTab] = useState(0);

  const load = async () => setData(await invoke('listDecisions'));
  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
    view
      .getContext()
      .then((c) => setAppId((c.localId || '').split('/')[1] || APP_ID))
      .catch(() => setAppId(APP_ID));
  }, []);

  const decisions = data?.decisions || [];
  const refs = data?.refs || {};
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decisions.filter(
      (d) =>
        (status.value === 'all' || d.status === status.value) &&
        (!q || `${d.id} ${d.title} ${d.statement} ${(d.tags || []).join(' ')} ${d.owner?.name || ''}`.toLowerCase().includes(q)),
    );
  }, [decisions, query, status]);

  if (!data) return <Spinner label="Loading decisions" />;

  const active = decisions.filter((d) => d.status === 'active');
  const openConflicts = Object.values(refs).reduce((n, r) => n + r.conflicts, 0);
  const aligned = Object.values(refs).reduce((n, r) => n + r.aligned, 0);
  const fromConfluence = decisions.filter((d) => d.source?.type === 'confluence').length;

  const rows = filtered.map((d) => {
    const r = refs[d.id] || { conflicts: 0, aligned: 0, related: 0 };
    return {
      key: d.id,
      cells: [
        {
          key: 'id',
          content: (
            <Button appearance="subtle" onClick={() => setOpenId(d.id)}>
              {d.id}
            </Button>
          ),
        },
        {
          key: 'decision',
          content: (
            <Box xcss={rowStyle}>
              <Stack space="space.050">
                <Text weight="semibold">{d.title}</Text>
                {sameText(d.statement, d.title) ? null : (
                  <Text size="small" color="color.text.subtle" maxLines={2}>
                    {d.statement}
                  </Text>
                )}
                <Guardrails decision={d} />
              </Stack>
            </Box>
          ),
        },
        { key: 'owner', content: <Text>{d.owner?.name || '—'}</Text> },
        { key: 'date', content: <Text size="small">{formatDate(d.decidedAt)}</Text> },
        {
          key: 'source',
          content: (
            <Inline space="space.050" alignBlock="center">
              <Icon glyph={SOURCE_ICON[d.source?.type] || 'decision'} label="" size="small" color="color.icon.subtle" />
              {d.source?.url ? (
                <Link href={d.source.url} openNewTab>
                  <Text size="small" maxLines={1}>
                    {d.source.title}
                  </Text>
                </Link>
              ) : (
                <Text size="small">{sourceLabel(d)}</Text>
              )}
            </Inline>
          ),
        },
        {
          key: 'impact',
          content: (
            <Inline space="space.050" shouldWrap>
              {r.conflicts ? <Lozenge appearance="removed">{`${r.conflicts} conflict${r.conflicts > 1 ? 's' : ''}`}</Lozenge> : null}
              {r.aligned ? <Lozenge appearance="success">{`${r.aligned} aligned`}</Lozenge> : null}
              {!r.conflicts && !r.aligned ? <DecisionStatus status={d.status} /> : null}
            </Inline>
          ),
        },
      ],
    };
  });

  return (
    <Box xcss={pageStyle}>
      <Stack space="space.300">
        <Inline spread="space-between" alignBlock="center" shouldWrap>
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center">
              <Icon glyph="decision" label="" size="large" color="color.icon.brand" />
              <Heading size="large">Decision Log</Heading>
            </Inline>
            <Text color="color.text.subtle">What your team has already decided — captured from Confluence, Jira and Rovo, and checked against new work automatically.</Text>
          </Stack>
          <Inline space="space.100">
            {rovoOn ? (
              <Button iconBefore="rovo-chat" onClick={() => rovo.open({ ...AGENT, prompt: 'Which decisions are being contradicted right now, and by which work items?' })}>
                Ask Precedent
              </Button>
            ) : null}
            <Button appearance="subtle" iconBefore="refresh" onClick={load}>
              Refresh
            </Button>
          </Inline>
        </Inline>

        <Inline space="space.200" shouldWrap>
          <Stat label="Active decisions" value={active.length} />
          <Stat label="Open conflicts" value={openConflicts} tone={openConflicts ? 'danger' : undefined} />
          <Stat label="Work items aligned" value={aligned} tone={aligned ? 'success' : undefined} />
          <Stat label="Captured from Confluence" value={fromConfluence} />
        </Inline>

        <Tabs id="log-tabs" selected={decisions.length ? tab : 1} onChange={setTab}>
          <TabList>
            <Tab>{`Decisions (${decisions.length})`}</Tab>
            <Tab>Setup &amp; integrations</Tab>
          </TabList>
          <TabPanel>
            <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
              <Stack space="space.200">
                <Inline space="space.150" alignBlock="end" grow="fill">
                  <Stack space="space.050" grow="fill">
                    <Label labelFor="q">Search</Label>
                    <Textfield id="q" value={query} placeholder="Topic, owner, DEC id…" onChange={(e) => setQuery(e.target.value)} />
                  </Stack>
                  <Box xcss={filterStyle}>
                    <Stack space="space.050">
                      <Label labelFor="status-filter">Status</Label>
                      <Select inputId="status-filter" options={FILTERS} value={status} onChange={setStatus} />
                    </Stack>
                  </Box>
                </Inline>
                <DynamicTable
                  head={{
                    cells: [
                      { key: 'id', content: 'ID', width: 8 },
                      { key: 'decision', content: 'Decision', width: 42 },
                      { key: 'owner', content: 'Owner', width: 11 },
                      { key: 'date', content: 'Decided', width: 10 },
                      { key: 'source', content: 'Source', width: 17 },
                      { key: 'impact', content: 'Impact', width: 12 },
                    ],
                  }}
                  rows={rows}
                  rowsPerPage={12}
                  emptyView={<Text>No decisions match.</Text>}
                />
              </Stack>
            </Box>
          </TabPanel>
          <TabPanel>
            <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
              {decisions.length ? null : (
                <Box xcss={subtleStyle}>
                  <EmptyState header="No decisions captured yet" description="Scan Confluence, write a /decision in any page, or create the sample content below to see Precedent in action." />
                </Box>
              )}
              <Setup onLoaded={load} appId={appId} />
            </Box>
          </TabPanel>
        </Tabs>
      </Stack>
      <ModalTransition>
        {openId ? <DecisionModal id={openId} rovoOn={rovoOn} onClose={() => setOpenId(null)} onChanged={load} /> : null}
      </ModalTransition>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
