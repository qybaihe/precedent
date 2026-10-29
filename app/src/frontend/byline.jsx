// Confluence page byline: the decisions captured from this page and what is happening to them in Jira.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Stack, Inline, Text, Link, Spinner, Button, Icon, xcss } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { AGENT, cardStyle, DecisionId, DecisionStatus, Guardrails } from './ui';

const App = () => {
  const [items, setItems] = useState(null);
  const [rovoOn, setRovoOn] = useState(false);
  useEffect(() => {
    // page order (DEC-1, DEC-2, …) reads better here than newest-first
    const num = (x) => Number(String(x.decision.id).replace(/\D/g, '')) || 0;
    invoke('getPageDecisions').then((list) => setItems([...(list || [])].sort((a, b) => num(a) - num(b))));
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
  }, []);

  if (!items) return <Spinner label="Loading decisions" />;
  if (!items.length) {
    return (
      <Box xcss={xcss({ padding: 'space.200', width: '420px' })}>
        <Stack space="space.100">
          <Text weight="semibold">No decisions on this page yet</Text>
          <Text size="small" color="color.text.subtle">
            Type /decision in the editor to record one. Precedent will track it and flag Jira work that contradicts it.
          </Text>
        </Stack>
      </Box>
    );
  }
  return (
    <Box xcss={xcss({ padding: 'space.150', width: '480px' })}>
      <Stack space="space.150">
        <Inline space="space.075" alignBlock="center">
          <Icon glyph="decision" label="" color="color.icon.brand" />
          <Text weight="semibold">{`${items.length} decision${items.length > 1 ? 's' : ''} tracked by Precedent`}</Text>
        </Inline>
        {items.map(({ decision: d, conflicts, aligned }) => (
          <Box key={d.id} xcss={cardStyle}>
            <Stack space="space.075">
              <Inline space="space.075" alignBlock="center" shouldWrap>
                <DecisionId id={d.id} />
                <DecisionStatus status={d.status} />
              </Inline>
              <Text weight="medium">{d.title}</Text>
              <Guardrails decision={d} />
              {conflicts.length ? (
                <Stack space="space.050">
                  <Text size="small" weight="semibold" color="color.text.danger">
                    Contradicted by
                  </Text>
                  {conflicts.map((i) => (
                    <Inline key={i.key} space="space.050" alignBlock="center">
                      <Link href={i.url} openNewTab>
                        {i.key}
                      </Link>
                      <Text size="small" maxLines={1}>
                        {i.summary}
                      </Text>
                    </Inline>
                  ))}
                </Stack>
              ) : null}
              {aligned.length ? (
                <Text size="small" color="color.text.success">
                  {`Followed by ${aligned.map((i) => i.key).join(', ')}`}
                </Text>
              ) : null}
              {!conflicts.length && !aligned.length ? (
                <Text size="small" color="color.text.subtle">
                  No Jira work contradicts this decision.
                </Text>
              ) : null}
            </Stack>
          </Box>
        ))}
        {rovoOn ? (
          <Button iconBefore="rovo-chat" onClick={() => rovo.open({ ...AGENT, prompt: `Which Jira work items contradict the decisions on this page, and what should we do about each?` })}>
            Ask Precedent
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
