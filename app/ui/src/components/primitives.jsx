// Building blocks shared by every Precedent surface.
import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { open } from '../api.js';

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // date-only values are stored as UTC midnight: show that calendar day in every time zone
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

export function ago(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Same words, ignoring case and punctuation (a statement that only repeats its title adds nothing). */
export const sameText = (a, b) => {
  const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
};

const AVATAR_COLORS = ['#4c6ef5', '#7950f2', '#e64980', '#f76707', '#0ca678', '#1098ad', '#d6336c', '#5f3dc4', '#2b8a3e', '#c2255c'];
export function Avatar({ name, size = 24 }) {
  if (!name) return null;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const color = AVATAR_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }} title={name}>
      {initials}
    </span>
  );
}

export function Spinner({ label }) {
  return (
    <div className="center-load">
      <div className="spin" />
      {label ? <div className="small">{label}</div> : null}
    </div>
  );
}

export function Button({ children, icon, kind = '', size = '', loading = false, disabled, onClick, title, type = 'button', className = '' }) {
  return (
    <button type={type} className={`btn ${kind} ${size} ${className}`} disabled={disabled || loading} onClick={onClick} title={title}>
      {loading ? <span className="spin" /> : icon ? <Icon name={icon} size={size === 'xs' ? 13 : 15} /> : null}
      {children}
    </button>
  );
}

/** Button that runs an async action and shows a spinner meanwhile. */
export function AsyncButton({ onClick, ...rest }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...rest}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export const Pill = ({ tone = '', children, icon }) => (
  <span className={`pill ${tone}`}>
    {icon ? <Icon name={icon} size={11} stroke={2.6} /> : null}
    {children}
  </span>
);

export const DecId = ({ id, onClick }) =>
  onClick ? (
    <button className="decid" onClick={onClick} title={`Open ${id}`}>
      {id}
    </button>
  ) : (
    <span className="decid">{id}</span>
  );

const STATUS_TONE = { active: 'active', superseded: 'superseded', archived: '', proposed: 'proposed' };
export const StatusPill = ({ status }) => <Pill tone={STATUS_TONE[status] || ''}>{status || 'active'}</Pill>;

const GRADE = { healthy: 'Healthy', watch: 'Watch', 'at-risk': 'At risk', inactive: 'Inactive' };
export const HealthPill = ({ health }) =>
  health && health.grade !== 'inactive' ? (
    <Pill tone={health.grade} icon={health.grade === 'healthy' ? 'pulse' : 'alert'}>
      {`${GRADE[health.grade]} · ${health.score}`}
    </Pill>
  ) : null;

export function Guardrails({ decision, limit }) {
  const prefer = decision.guardrails?.prefer || [];
  const avoid = decision.guardrails?.avoid || [];
  const all = [...prefer.map((t) => ['prefer', t.text]), ...avoid.map((t) => ['avoid', t.text])];
  if (!all.length) return null;
  const shown = limit ? all.slice(0, limit) : all;
  return (
    <div className="chips">
      {shown.map(([kind, text]) => (
        <span key={`${kind}-${text}`} className={`chip ${kind}`}>
          <Icon name={kind === 'avoid' ? 'ban' : 'check'} size={12} stroke={2.6} />
          {kind} {text}
        </span>
      ))}
      {limit && all.length > limit ? <span className="chip tag">+{all.length - limit}</span> : null}
    </div>
  );
}

/** "Priya Shah · Mar 12, 2026 · Payments Architecture Review ↗" */
export function DecisionMeta({ decision, compact }) {
  const src = decision.source || {};
  return (
    <div className="row wrap small muted" style={{ columnGap: 14, rowGap: 4 }}>
      <span className="row gap-6">
        {decision.owner?.name ? (
          <>
            <Avatar name={decision.owner.name} size={20} />
            <span>{decision.owner.name}</span>
          </>
        ) : (
          <span className="faint">No owner</span>
        )}
        {decision.decidedAt ? <span className="faint">· {formatDate(decision.decidedAt)}</span> : null}
      </span>
      {!compact && (src.url || src.title) ? (
        <span className="row gap-4" style={{ minWidth: 0, maxWidth: '100%' }}>
          <Icon name={src.type === 'jira' ? 'jira' : src.type === 'rovo' ? 'chat' : 'doc'} size={13} className="faint" />
          {src.url ? (
            <a className="clamp-1" onClick={() => open(src.url)} title={src.kind || src.label}>
              {src.title || 'Source'}
            </a>
          ) : (
            <span className="clamp-1">{src.title}</span>
          )}
        </span>
      ) : null}
    </div>
  );
}

export function Kpi({ label, value, hint, tone = '', accent, delay = 0 }) {
  return (
    <div className={`card kpi accent ${accent || ''} tone-${tone} rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="eyebrow">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon ? <Icon name={t.icon} size={15} /> : null}
          {t.label}
          {t.count !== undefined ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Banner({ tone = 'info', title, children, icon }) {
  return (
    <div className={`banner ${tone} fade`}>
      <Icon name={icon || (tone === 'success' ? 'checkCircle' : tone === 'error' || tone === 'warning' ? 'alert' : 'info')} size={18} />
      <div className="col gap-4 grow">
        {title ? <div className="strong">{title}</div> : null}
        {children ? <div className="body small">{children}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, help, children }) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export function Empty({ title, children, art = 'inbox' }) {
  return (
    <div className="empty">
      <div className="art">
        <svg viewBox="0 0 120 84" width="120" height="84" aria-hidden>
          <defs>
            <linearGradient id="eg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#6c5ce7" stopOpacity="0.25" />
              <stop offset="1" stopColor="#1d7afc" stopOpacity="0.12" />
            </linearGradient>
          </defs>
          <rect x="18" y="10" width="84" height="64" rx="12" fill="url(#eg)" />
          <rect x="30" y="24" width="44" height="6" rx="3" fill="#6c5ce7" opacity="0.55" />
          <rect x="30" y="36" width="60" height="5" rx="2.5" fill="#1d7afc" opacity="0.3" />
          <rect x="30" y="47" width="52" height="5" rx="2.5" fill="#1d7afc" opacity="0.22" />
          <circle cx="92" cy="62" r="13" fill="#22a06b" opacity={art === 'ok' ? 0.9 : 0} />
          {art === 'ok' ? <path d="m86 62 4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </svg>
      </div>
      {title ? <div className="h3" style={{ color: 'var(--text)' }}>{title}</div> : null}
      {children ? <div className="small mt-8">{children}</div> : null}
    </div>
  );
}

/** Lightweight hover tooltip that follows the mouse (charts). */
export function useTooltip() {
  const [tip, setTip] = useState(null);
  const bind = (content) => ({
    onMouseEnter: (e) => setTip({ content, x: e.clientX, y: e.clientY }),
    onMouseMove: (e) => setTip({ content, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setTip(null),
  });
  const node = tip ? (
    <div className="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 290), top: tip.y + 14 }}>
      {tip.content}
    </div>
  ) : null;
  return [bind, node];
}
