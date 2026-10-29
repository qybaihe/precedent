// Hand-drawn SVG charts: health gauge, donut, conflict heatmap, decision lifecycle timeline and the
// decision ↔ work item relationship map. No chart library, no external assets.
import React, { useEffect, useMemo, useState } from 'react';
import { formatDate, useTooltip, plural } from './primitives.jsx';

export const GRADE_COLOR = { healthy: '#22a06b', watch: '#e2a203', 'at-risk': '#e2483d', inactive: '#8590a2' };
export const RELATION_COLOR = { conflict: '#e2483d', reviewed: '#e2a203', aligned: '#22a06b', related: '#1d7afc' };
export const gradeOf = (score) => (score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'at-risk');

/** Animate from 0 to `value` once on mount. */
function useCountUp(value, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

// ---------- gauge ----------

export function Gauge({ value = 0, size = 168, label = 'Decision health', light = false }) {
  const shown = useCountUp(value);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const grade = gradeOf(value);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);
  const offset = mounted ? arc * (1 - value / 100) : arc;
  const id = `g-${grade}-${size}`;
  const stops = { healthy: ['#4bce97', '#22a06b'], watch: ['#f5cd47', '#e2a203'], 'at-risk': ['#f87168', '#e2483d'] }[grade];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value} out of 100`}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="1" stopColor={stops[1]} />
        </linearGradient>
      </defs>
      <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? 'rgba(255,255,255,0.18)' : 'var(--neutral)'} strokeWidth="12" strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="12"
          strokeDasharray={`${arc} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.2, 0.7, 0.2, 1)' }}
        />
      </g>
      <text x="50%" y="49%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.27} fontWeight="800" fill={light ? '#fff' : 'var(--text)'} style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>
        {shown}
      </text>
      <text x="50%" y="67%" textAnchor="middle" fontSize={Math.min(11.5, (size * 0.95) / (label.length * 0.78))} fontWeight="700" fill={light ? 'rgba(255,255,255,0.75)' : 'var(--subtlest)'} letterSpacing="0.6">
        {label.toUpperCase()}
      </text>
    </svg>
  );
}

/** Small score ring for cards. */
export function ScoreRing({ value, size = 38 }) {
  if (value === null || value === undefined) return null;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const color = GRADE_COLOR[gradeOf(value)];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Health ${value}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--neutral)" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${(c * value) / 100} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.32} fontWeight="800" fill="var(--text)">
        {value}
      </text>
    </svg>
  );
}

// ---------- donut ----------

export function Donut({ segments, size = 170, label = 'checked' }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const shown = useCountUp(total);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const [bind, tip] = useTooltip();
  return (
    <div className="row gap-20 wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--neutral)" strokeWidth="18" />
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (c * s.value) / Math.max(1, total);
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="18"
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-acc}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                {...bind(`${s.label}: ${s.value}`)}
              />
            );
            acc += len;
            return el;
          })}
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fontSize="30" fontWeight="800" fill="var(--text)">
          {shown}
        </text>
        <text x="50%" y="63%" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--subtlest)" letterSpacing="0.6">
          {label.toUpperCase()}
        </text>
      </svg>
      <div className="col gap-6">
        {segments.map((s) => (
          <span key={s.label} className="legend">
            <i style={{ background: s.color }} />
            <span style={{ minWidth: 120 }}>{s.label}</span>
            <b style={{ color: 'var(--text)' }}>{s.value}</b>
          </span>
        ))}
      </div>
      {tip}
    </div>
  );
}

// ---------- impact bar ----------

export function ImpactBar({ impact }) {
  const parts = [
    ['conflicts', impact?.conflicts || 0, RELATION_COLOR.conflict],
    ['aligned', impact?.aligned || 0, RELATION_COLOR.aligned],
    ['related', impact?.related || 0, RELATION_COLOR.related],
  ];
  const total = parts.reduce((n, p) => n + p[1], 0);
  if (!total) return <div className="tiny faint">No work items touch this yet</div>;
  return (
    <div className="col gap-4">
      <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', background: 'var(--neutral)' }}>
        {parts.map(([k, v, color]) => (v ? <div key={k} style={{ width: `${(v / total) * 100}%`, background: color }} /> : null))}
      </div>
      <div className="row gap-6 tiny muted wrap">
        {parts.map(([k, v, color]) =>
          v ? (
            <span key={k} className="row gap-4">
              <i style={{ width: 7, height: 7, borderRadius: 2, background: color, display: 'inline-block' }} />
              {v} {k === 'conflicts' && v === 1 ? 'conflict' : k}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

// ---------- heatmap ----------

/**
 * rows: [{ id, label, sub }], cols: [{ key, label }], cell(rowId, colKey) -> { count, items: [{key, summary}] }
 */
export function Heatmap({ rows, cols, cell, onCell, rowHead }) {
  const [bind, tip] = useTooltip();
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => cell(r.id, c.key).count)));
  const color = (n) => {
    if (!n) return null;
    const t = 0.35 + 0.65 * (n / max);
    return `rgba(226, 72, 61, ${t.toFixed(2)})`;
  };
  return (
    <div className="heat" style={{ gridTemplateColumns: `minmax(180px, 1.6fr) repeat(${cols.length}, minmax(44px, 1fr))` }}>
      <div />
      {cols.map((c) => (
        <div key={c.key} className="colhead" title={c.title || c.label}>
          {c.label}
        </div>
      ))}
      {rows.map((r) => (
        <React.Fragment key={r.id}>
          <div className="rowhead">{rowHead ? rowHead(r) : r.label}</div>
          {cols.map((c) => {
            const v = cell(r.id, c.key);
            const bg = color(v.count);
            return (
              <div
                key={c.key}
                className={`cell ${v.count ? 'hot' : ''}`}
                style={bg ? { background: bg } : undefined}
                onClick={v.count && onCell ? () => onCell(r, c, v) : undefined}
                {...(v.count
                  ? bind(
                      <div>
                        <b>
                          {r.id} × {c.label}: {plural(v.count, 'open conflict')}
                        </b>
                        {v.items.slice(0, 4).map((i) => (
                          <div key={i.key} style={{ opacity: 0.85 }}>
                            {i.key} · {i.summary}
                          </div>
                        ))}
                      </div>,
                    )
                  : {})}
              >
                {v.count || '·'}
              </div>
            );
          })}
        </React.Fragment>
      ))}
      {tip}
    </div>
  );
}

// ---------- decision lifecycle timeline ----------

const DAY = 86400000;
/**
 * One row per decision: a bar from the decision date to its review date (or supersession),
 * today's line, overdue reviews hatched red, and a dot for every work item that conflicts with it.
 */
export function Lifecycle({ decisions, checks, onSelect, now = Date.now() }) {
  const [bind, tip] = useTooltip();
  const rows = useMemo(
    () =>
      decisions
        .filter((d) => d.decidedAt)
        .map((d) => ({
          d,
          start: new Date(d.decidedAt).getTime(),
          end: new Date(d.health?.reviewBy || d.decidedAt).getTime(),
          conflicts: checks.filter((c) => c.conflicts.some((x) => x.decision.id === d.id && !x.acknowledged)),
        }))
        .sort((a, b) => a.start - b.start || Number(a.d.id.split('-')[1]) - Number(b.d.id.split('-')[1])),
    [decisions, checks],
  );
  if (!rows.length) return null;
  const W = 1000;
  const LEFT = 250;
  const ROW = 30;
  const TOP = 30;
  const H = TOP + rows.length * ROW + 30;
  const min = Math.min(...rows.map((r) => r.start)) - 20 * DAY;
  const max = Math.max(now + 45 * DAY, ...rows.map((r) => r.end)) + 10 * DAY;
  const x = (t) => LEFT + ((t - min) / (max - min)) * (W - LEFT - 16);
  const months = [];
  const m = new Date(min);
  m.setUTCDate(1);
  for (let t = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1); t < max; ) {
    months.push(t);
    const d = new Date(t);
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720 }} role="img" aria-label="Decision lifecycle timeline">
        <defs>
          <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="rgba(226,72,61,0.18)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#e2483d" strokeWidth="2.2" />
          </pattern>
        </defs>
        {months.map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 8} y2={H - 6} stroke="var(--border)" strokeDasharray={i % 3 ? '2 4' : undefined} />
            <text x={x(t) + 4} y={TOP - 14} fontSize="11" fill="var(--subtlest)" fontWeight="600">
              {new Date(t).getUTCMonth() === 0 ? `’${String(new Date(t).getUTCFullYear()).slice(2)}` : new Date(t).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = TOP + i * ROW + ROW / 2;
          const d = r.d;
          const inactive = d.status !== 'active';
          const grade = inactive ? 'inactive' : d.health?.grade || 'healthy';
          const color = d.status === 'superseded' ? '#8f7ee7' : GRADE_COLOR[grade];
          const x0 = x(r.start);
          const due = x(r.end);
          const xe = inactive ? due : Math.min(due, x(now));
          const overdue = !inactive && r.end < now;
          return (
            <g key={d.id} style={{ cursor: 'pointer' }} onClick={() => onSelect?.(d.id)} {...bind(
              <div>
                <b>{d.id}</b> {d.title}
                <div style={{ opacity: 0.85 }}>
                  Decided {formatDate(d.decidedAt)} · review {overdue ? 'overdue since' : 'by'} {formatDate(d.health?.reviewBy)}
                </div>
                {r.conflicts.length ? <div style={{ color: '#ffb3ad' }}>{plural(r.conflicts.length, 'open conflict')}</div> : null}
              </div>,
            )}>
              <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill={i % 2 ? 'transparent' : 'var(--sunken)'} opacity="0.6" />
              <text x={8} y={y + 4} fontSize="12" fontWeight="800" fill="var(--link)" fontFamily="var(--mono)">
                {d.id}
              </text>
              <text x={62} y={y + 4} fontSize="12" fill={inactive ? 'var(--subtlest)' : 'var(--text)'}>
                {d.title.length > 30 ? `${d.title.slice(0, 29)}…` : d.title}
              </text>
              <rect x={x0} y={y - 6} width={Math.max(4, xe - x0)} height={12} rx="6" fill={color} opacity={inactive ? 0.45 : 0.9} />
              {overdue ? <rect x={due} y={y - 6} width={Math.max(4, x(now) - due)} height={12} rx="3" fill="url(#hatch)" /> : null}
              {!inactive && !overdue ? <rect x={xe} y={y - 6} width={Math.max(0, due - xe)} height={12} rx="6" fill={color} opacity="0.18" /> : null}
              <circle cx={x0} cy={y} r="6.5" fill="var(--raised)" stroke={color} strokeWidth="3" />
              {r.conflicts.map((c, k) => (
                <circle key={c.issue.key} cx={Math.min(x(now) - 4, x(new Date(c.checkedAt || now).getTime())) - k * 9} cy={y} r="5" fill="#e2483d" stroke="var(--raised)" strokeWidth="2" />
              ))}
            </g>
          );
        })}
        <line x1={x(now)} x2={x(now)} y1={TOP - 10} y2={H - 20} stroke="var(--link)" strokeWidth="2" />
        <rect x={x(now) - 22} y={H - 20} width="44" height="16" rx="8" fill="var(--link)" />
        <text x={x(now)} y={H - 8.5} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#fff">
          TODAY
        </text>
      </svg>
      <div className="row wrap gap-16 small mt-8">
        <span className="legend"><i style={{ background: GRADE_COLOR.healthy }} />Active — until its review date</span>
        <span className="legend"><i style={{ background: 'repeating-linear-gradient(45deg, #e2483d 0 2px, rgba(226,72,61,0.18) 2px 5px)' }} />Review overdue</span>
        <span className="legend"><i style={{ background: '#e2483d', borderRadius: '50%' }} />Open conflict</span>
        <span className="legend"><i style={{ background: '#8f7ee7' }} />Superseded</span>
      </div>
      {tip}
    </div>
  );
}

// ---------- relationship map ----------

/**
 * Decisions on an inner ring, the work items that touch them on an outer ring, edges coloured by
 * relation (conflict / reviewed / aligned / related) and purple arcs for supersession.
 */
export function DecisionMap({ decisions, checks, teamScore, onSelect, onIssue }) {
  const [hover, setHover] = useState(null);
  const [bind, tip] = useTooltip();
  const W = 1000;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2;
  const R1 = 190;
  const R2 = 292;

  const layout = useMemo(() => {
    const ds = [...decisions].sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
    const angle = {};
    ds.forEach((d, i) => (angle[d.id] = -Math.PI / 2 + (i / Math.max(1, ds.length)) * Math.PI * 2));
    const dnodes = ds.map((d) => ({ d, x: cx + R1 * Math.cos(angle[d.id]), y: cy + R1 * Math.sin(angle[d.id]) }));
    const edges = [];
    const items = [];
    for (const c of checks) {
      const links = [
        ...c.conflicts.map((x) => [x.decision.id, x.acknowledged ? 'reviewed' : 'conflict']),
        ...c.aligned.map((x) => [x.decision.id, 'aligned']),
        ...c.related.map((x) => [x.decision.id, 'related']),
      ].filter(([id]) => angle[id] !== undefined);
      if (!links.length) continue;
      const a = Math.atan2(
        links.reduce((n, [id]) => n + Math.sin(angle[id]), 0),
        links.reduce((n, [id]) => n + Math.cos(angle[id]), 0),
      );
      items.push({ c, a, links });
    }
    // spread items that would overlap on the outer ring
    items.sort((p, q) => p.a - q.a);
    const minGap = (2 * Math.PI) / Math.max(items.length, 26);
    for (let pass = 0; pass < 40; pass++) {
      for (let i = 0; i < items.length; i++) {
        const next = items[(i + 1) % items.length];
        let gap = next.a - items[i].a;
        if (i === items.length - 1) gap += 2 * Math.PI;
        if (gap < minGap) {
          items[i].a -= (minGap - gap) / 2;
          next.a += (minGap - gap) / 2;
        }
      }
    }
    const inodes = items.map((it) => ({ ...it, x: cx + R2 * Math.cos(it.a), y: cy + R2 * Math.sin(it.a) }));
    const pos = Object.fromEntries(dnodes.map((n) => [n.d.id, n]));
    for (const n of inodes) for (const [id, rel] of n.links) edges.push({ from: n, to: pos[id], rel, key: `${n.c.issue.key}-${id}` });
    const supers = ds.filter((d) => d.supersededBy && pos[d.supersededBy]).map((d) => ({ from: pos[d.id], to: pos[d.supersededBy], key: `${d.id}>${d.supersededBy}` }));
    return { dnodes, inodes, edges, supers };
  }, [decisions, checks]);

  const lit = (key) => !hover || hover === key;
  const edgeLit = (e) => !hover || hover === e.to.d.id || hover === e.from.c.issue.key;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Decision relationship map">
        <defs>
          <radialGradient id="hub" cx="50%" cy="40%" r="65%">
            <stop offset="0" stopColor="#6c5ce7" />
            <stop offset="1" stopColor="#2c2a8a" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={R1} fill="none" stroke="var(--border)" strokeDasharray="3 6" />
        <circle cx={cx} cy={cy} r={R2} fill="none" stroke="var(--border)" strokeDasharray="3 6" />
        {layout.edges.map((e) => {
          const mx = (e.from.x + e.to.x) / 2 + (cx - (e.from.x + e.to.x) / 2) * 0.25;
          const my = (e.from.y + e.to.y) / 2 + (cy - (e.from.y + e.to.y) / 2) * 0.25;
          return (
            <path
              key={e.key}
              d={`M${e.from.x},${e.from.y} Q${mx},${my} ${e.to.x},${e.to.y}`}
              fill="none"
              stroke={RELATION_COLOR[e.rel]}
              strokeWidth={e.rel === 'conflict' ? 2.6 : 1.8}
              strokeDasharray={e.rel === 'related' ? '4 4' : undefined}
              opacity={edgeLit(e) ? (e.rel === 'conflict' ? 0.95 : 0.7) : 0.08}
              style={{ transition: 'opacity 0.15s' }}
            />
          );
        })}
        {layout.supers.map((s) => (
          <path key={s.key} d={`M${s.from.x},${s.from.y} Q${cx},${cy} ${s.to.x},${s.to.y}`} fill="none" stroke="#8f7ee7" strokeWidth="2.2" strokeDasharray="6 4" opacity={!hover ? 0.9 : 0.15} />
        ))}
        <g filter="url(#glow)">
          <circle cx={cx} cy={cy} r="62" fill="url(#hub)" />
        </g>
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="34" fontWeight="800" fill="#fff">
          {teamScore ?? '—'}
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="rgba(255,255,255,0.8)" letterSpacing="0.8">
          TEAM HEALTH
        </text>
        {layout.inodes.map((n) => {
          const worst = n.links.some(([, r]) => r === 'conflict') ? 'conflict' : n.links.some(([, r]) => r === 'reviewed') ? 'reviewed' : n.links.some(([, r]) => r === 'aligned') ? 'aligned' : 'related';
          const key = n.c.issue.key;
          const w = key.length * 7.6 + 18;
          return (
            <g
              key={key}
              transform={`translate(${n.x - w / 2}, ${n.y - 11})`}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
              opacity={lit(key) || n.links.some(([id]) => id === hover) ? 1 : 0.25}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onIssue?.(n.c.issue)}
              {...bind(
                <div>
                  <b>{key}</b> · {n.c.issue.summary}
                  <div style={{ opacity: 0.85 }}>{n.links.map(([id, r]) => `${r} ${id}`).join(' · ')}</div>
                </div>,
              )}
            >
              <rect width={w} height="22" rx="11" fill="var(--raised)" stroke={RELATION_COLOR[worst]} strokeWidth="2" />
              <text x={w / 2} y="15" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--text)" fontFamily="var(--mono)">
                {key}
              </text>
            </g>
          );
        })}
        {layout.dnodes.map(({ d, x, y }) => {
          const inactive = d.status !== 'active';
          const color = d.status === 'superseded' ? '#8f7ee7' : GRADE_COLOR[inactive ? 'inactive' : d.health?.grade || 'healthy'];
          const conflicts = checks.filter((c) => c.conflicts.some((k) => k.decision.id === d.id && !k.acknowledged)).length;
          return (
            <g
              key={d.id}
              transform={`translate(${x}, ${y})`}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
              opacity={lit(d.id) || layout.edges.some((e) => e.to.d.id === d.id && e.from.c.issue.key === hover) ? 1 : 0.3}
              onMouseEnter={() => setHover(d.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(d.id)}
              {...bind(
                <div>
                  <b>{d.id}</b> {d.title}
                  <div style={{ opacity: 0.85 }}>
                    {d.status !== 'active' ? d.status : `Health ${d.health?.score ?? '—'}`} · {d.owner?.name || 'no owner'}
                  </div>
                </div>,
              )}
            >
              {conflicts ? <circle r="31" fill="none" stroke="#e2483d" strokeWidth="2" opacity="0.5" strokeDasharray="2 3" /> : null}
              <circle r="25" fill="var(--raised)" stroke={color} strokeWidth="4" opacity={inactive ? 0.6 : 1} />
              <text y="-2" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="var(--subtlest)" letterSpacing="0.5">
                DEC
              </text>
              <text y="12" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">
                {d.id.split('-')[1]}
              </text>
              {conflicts ? (
                <g transform="translate(18,-19)">
                  <circle r="9" fill="#e2483d" stroke="var(--raised)" strokeWidth="2" />
                  <text y="3.6" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">
                    {conflicts}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="row wrap gap-16 small" style={{ justifyContent: 'center' }}>
        <span className="legend"><i style={{ background: RELATION_COLOR.conflict }} />Contradicts</span>
        <span className="legend"><i style={{ background: RELATION_COLOR.reviewed }} />Conflict reviewed</span>
        <span className="legend"><i style={{ background: RELATION_COLOR.aligned }} />Aligned with</span>
        <span className="legend"><i style={{ background: RELATION_COLOR.related }} />Related to</span>
        <span className="legend"><i style={{ background: '#8f7ee7' }} />Superseded by</span>
        <span className="legend"><i style={{ background: 'transparent', border: `3px solid ${GRADE_COLOR.healthy}`, borderRadius: '50%' }} />Decision (ring = health)</span>
      </div>
      {tip}
    </div>
  );
}
