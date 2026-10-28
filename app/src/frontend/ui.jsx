// Shared UI Kit building blocks for every Precedent surface.
import React from 'react';
import { Box, Inline, Stack, Text, Strong, Em, Link, Lozenge, Icon, Tooltip, xcss } from '@forge/react';

export const AGENT = { type: 'forge', agentKey: 'precedent-agent', agentName: 'Precedent' };
export const APP_ID = '92a37583-d5ab-4554-97dd-8e6d41617e28';

export const cardStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
  backgroundColor: 'elevation.surface',
});

export const conflictCardStyle = xcss({
  borderColor: 'color.border.danger',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
  backgroundColor: 'elevation.surface',
});

export const quoteStyle = xcss({
  borderLeftColor: 'color.border.bold',
  borderLeftWidth: 'border.width.outline',
  borderLeftStyle: 'solid',
  paddingLeft: 'space.100',
});

export const evidenceStyle = xcss({
  backgroundColor: 'color.background.danger',
  borderRadius: 'border.radius',
  padding: 'space.075',
});

export const subtleStyle = xcss({
  backgroundColor: 'color.background.neutral.subtle',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
});

export const statStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.200',
  minWidth: '150px',
  backgroundColor: 'elevation.surface',
});

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ago(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

const STATUS_APPEARANCE = { active: 'success', superseded: 'moved', archived: 'default', proposed: 'new' };

export const DecisionStatus = ({ status }) => (
  <Lozenge appearance={STATUS_APPEARANCE[status] || 'default'}>{status || 'active'}</Lozenge>
);

export const DecisionId = ({ id }) => (
  <Lozenge appearance="inprogress" isBold>
    {id}
  </Lozenge>
);

/** "Priya Shah · Mar 12, 2026 · Payments Architecture Review ↗" */
export const DecisionMeta = ({ decision }) => {
  const src = decision.source || {};
  return (
    <Inline space="space.100" shouldWrap alignBlock="center">
      {decision.owner?.name ? (
        <Inline space="space.050" alignBlock="center">
          <Icon glyph="person" label="Owner" size="small" color="color.icon.subtle" />
          <Text size="small" color="color.text.subtle">
            {decision.owner.name}
          </Text>
        </Inline>
      ) : null}
      {decision.decidedAt ? (
        <Text size="small" color="color.text.subtle">
          {formatDate(decision.decidedAt)}
        </Text>
      ) : null}
      {src.url ? (
        <Tooltip content={src.kind || src.label || 'Source'}>
          <Link href={src.url} openNewTab>
            <Text size="small">{src.title || 'Source'}</Text>
          </Link>
        </Tooltip>
      ) : src.title ? (
        <Text size="small" color="color.text.subtle">
          {src.title}
        </Text>
      ) : null}
    </Inline>
  );
};

export const Quote = ({ children }) => (
  <Box xcss={quoteStyle}>
    <Text>
      <Em>{children}</Em>
    </Text>
  </Box>
);

export const SectionTitle = ({ children, count }) => (
  <Inline space="space.075" alignBlock="center">
    <Text weight="semibold" size="small" color="color.text.subtle">
      {String(children).toUpperCase()}
    </Text>
    {count !== undefined ? <Lozenge>{String(count)}</Lozenge> : null}
  </Inline>
);

export const Stat = ({ label, value, tone }) => (
  <Box xcss={statStyle}>
    <Stack space="space.050">
      <Text size="small" color="color.text.subtle">
        {label}
      </Text>
      <Text size="large" weight="bold" color={tone === 'danger' ? 'color.text.danger' : tone === 'success' ? 'color.text.success' : 'color.text'}>
        {String(value)}
      </Text>
    </Stack>
  </Box>
);

export const Guardrails = ({ decision }) => {
  const avoid = decision.guardrails?.avoid || [];
  const prefer = decision.guardrails?.prefer || [];
  if (!avoid.length && !prefer.length) return null;
  return (
    <Inline space="space.075" shouldWrap alignBlock="center">
      {prefer.map((t) => (
        <Lozenge key={`p-${t.text}`} appearance="success">
          {`prefer ${t.text}`}
        </Lozenge>
      ))}
      {avoid.map((t) => (
        <Lozenge key={`a-${t.text}`} appearance="removed">
          {`avoid ${t.text}`}
        </Lozenge>
      ))}
    </Inline>
  );
};

export const Bold = ({ children }) => <Strong>{children}</Strong>;
