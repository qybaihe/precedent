// Inline stroke icons (24px grid). No icon fonts or external assets, so the app stays self-contained.
import React from 'react';

const PATHS = {
  alert: 'M12 3 2.5 20h19L12 3Zm0 6v5m0 3.2v.3',
  check: 'm5 12.5 4.2 4.2L19 7',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.8 2.8L16.5 9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.2v.3',
  x: 'M6 6l12 12M18 6 6 18',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.3-2.2L21 21',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4m-4 5a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  chat: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z',
  wand: 'm4 20 10-10m2-6v3m0 6v3m-6-9h3m6 0h3M14.5 5.5l2 2',
  sparkles: 'M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.4 2.4m6.6 6.6 2.4 2.4m0-11.4-2.4 2.4m-6.6 6.6-2.4 2.4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  calendar: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm0 4h16M8 3v4m8-4v4',
  doc: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 13h6m-6 4h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1',
  external: 'M14 4h6v6m0-6-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  shield: 'M12 3 4.5 6v6c0 4.4 3.2 7.9 7.5 9 4.3-1.1 7.5-4.6 7.5-9V6L12 3Z',
  shieldCheck: 'M12 3 4.5 6v6c0 4.4 3.2 7.9 7.5 9 4.3-1.1 7.5-4.6 7.5-9V6L12 3Zm-3.5 9 2.5 2.5 4.5-4.5',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  thumb: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2.6 2.4L12.8 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  graph: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-.2-15 8.4 2.6M7.2 7l.6 10m.2.4 8.6-7.2',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-1.6.9 1.6-2 3.4-1.8-.3a7.6 7.6 0 0 1-2.2 1.3L14 21h-4l-.6-1.6a7.6 7.6 0 0 1-2.2-1.3l-1.8.3-2-3.4.9-1.6a7.8 7.8 0 0 1 0-2.8L3.6 9 5.6 5.6l1.8.3a7.6 7.6 0 0 1 2.2-1.3L10 3h4l.6 1.6a7.6 7.6 0 0 1 2.2 1.3l1.8-.3 2 3.4-.9 1.6a7.8 7.8 0 0 1 0 2.8Z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  arrowRight: 'M5 12h14m-5-5 5 5-5 5',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  jira: 'M12 3 21 12l-9 9-9-9 9-9Zm0 5-4 4 4 4 4-4-4-4Z',
  timeline: 'M3 12h18M7 12V8m5 4v6m5-6V6',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2.5-8h11L20 13v6H4v-6Z',
};

export function Icon({ name, size = 16, stroke = 2, className, style, title }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

/** The Precedent mark: a stacked "decision record" glyph. */
export function Logo({ size = 40 }) {
  return (
    <div className="logo" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 4h12M6 8.5h12" opacity="0.75" />
        <path d="M6 13h12v6.5l-3.2-2.2L12 19.5l-2.8-2.2L6 19.5V13Z" />
      </svg>
    </div>
  );
}
