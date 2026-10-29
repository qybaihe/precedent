// Guards: the optional, structured part of a decision that makes enforcement deterministic.
//
//   guard: {
//     paths:    ['services/payments/**']       code the decision governs (globs)
//     packages: { deny: ['mongodb', 'mongoose'], allow: ['pg'] }
//     keywords: ['DocumentDB']                  extra phrases that contradict it in Jira text / plans
//     jql:      'project = PAY'                 the work items it governs
//   }
//
// Everything here is pure (no Forge APIs), so agents, the issue panel, the workflow validator and
// the create-time warning all get the same answer for the same input.

const MAX = { paths: 20, packages: 30, keywords: 20, jql: 500 };

function list(value, max) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  const out = [];
  for (const raw of items) {
    const s = String(raw).trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
}

/** Package names are case-insensitive and lose any version spec: "Lodash@^4" -> "lodash". */
export function packageName(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/^["'`]+|["'`,]+$/g, '');
  const at = s.indexOf('@', s.startsWith('@') ? 1 : 0);
  if (at > 0) s = s.slice(0, at);
  return s.replace(/[=<>~^].*$/, '').trim();
}

/** Clean a guard typed in a form or sent by an agent. Returns null when nothing is set. */
export function normalizeGuard(input) {
  if (!input) return null;
  const pkgs = input.packages || {};
  const guard = {
    paths: list(input.paths, MAX.paths).map((p) => p.replace(/^\.\//, '')),
    packages: {
      deny: list(pkgs.deny ?? input.denyPackages, MAX.packages).map(packageName).filter(Boolean),
      allow: list(pkgs.allow ?? input.allowPackages, MAX.packages).map(packageName).filter(Boolean),
    },
    keywords: list(input.keywords, MAX.keywords),
    jql: String(input.jql || '').trim().slice(0, MAX.jql),
  };
  const empty = !guard.paths.length && !guard.packages.deny.length && !guard.packages.allow.length && !guard.keywords.length && !guard.jql;
  return empty ? null : guard;
}

export function hasGuard(decision) {
  return Boolean(normalizeGuard(decision?.guard));
}

/** Glob -> RegExp: `**` any depth, `*` within a segment, `?` one char, `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let re = '';
  const g = String(glob).replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end < 0) re += '\\{';
      else {
        re += `(?:${g.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  // a bare directory ("services/payments") governs everything below it
  const dirLike = !/[*?{]/.test(g) && !/\.[a-z0-9]+$/i.test(g);
  return new RegExp(`^${re}${dirLike ? '(?:/.*)?' : ''}$`, 'i');
}

export function matchPath(glob, path) {
  return globToRegExp(glob).test(String(path || '').trim().replace(/^\.\//, ''));
}

/** Exact name or a glob over names ("@aws-sdk/*", "moment*"). */
export function matchPackage(pattern, name) {
  const p = packageName(pattern);
  const n = packageName(name);
  if (!p || !n) return false;
  if (!p.includes('*')) return p === n;
  return new RegExp(`^${p.replace(/[.+^$()|[\]\\?{}]/g, '\\$&').replace(/\*/g, '.*')}$`).test(n);
}

const INSTALL = /\b(?:npm\s+(?:i|install|add)|yarn\s+add|pnpm\s+(?:add|install|i)|bun\s+add|pip3?\s+install|poetry\s+add|uv\s+add|go\s+get|cargo\s+add|gem\s+install|composer\s+require|dotnet\s+add\s+package)((?:[^\S\n]+[^\s,;&|]+)+)/gi;
const PROSE = new Set(['and', 'then', 'to', 'for', 'in', 'into', 'with', 'so', 'as', 'the', 'a', 'an', 'or', 'from', 'on']);

/**
 * Packages a plan or diff summary adds: install commands ("npm install mongoose") and added
 * dependency lines in a package.json / requirements diff ('+ "mongoose": "^8.0.0"', '+redis==5.0').
 */
export function packagesFromText(text) {
  const out = new Set();
  const t = String(text || '');
  for (const m of t.matchAll(INSTALL)) {
    for (const arg of m[1].trim().split(/\s+/)) {
      if (PROSE.has(arg.toLowerCase())) break;
      const end = /[,.;:)]$/.test(arg);
      const name = packageName(arg.replace(/[.;:)]+$/, ''));
      if (!arg.startsWith('-') && /^[@a-z0-9][\w./-]*$/.test(name)) out.add(name);
      if (end) break; // "npm install zod, then …"
    }
  }
  for (const m of t.matchAll(/^\+\s*"(@?[\w./-]+)"\s*:\s*"[^"]*"/gm)) out.add(packageName(m[1]));
  for (const m of t.matchAll(/^\+\s*([a-z0-9][\w.-]*)\s*(?:==|>=|~=)/gim)) out.add(packageName(m[1]));
  return [...out];
}

/** File paths mentioned in a plan or diff summary ("services/payments/ledger.ts", "+++ b/db/x.sql"). */
export function pathsFromText(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?:^|[\s(`'"])(?:[ab]\/)?((?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,8})\b/gim)) out.add(m[1]);
  return [...out];
}

/**
 * Evaluate the structured part of one decision's guard against a piece of work.
 *   work: { paths?: string[], packages?: string[], jqlScope?: {[decisionId]: boolean} }
 * Returns { applies, governed: [paths], violations: [{ rule, item, pattern }], byJql }.
 *  - applies=false when the work's files are all outside guard.paths, or the work item is
 *    outside guard.jql: the decision doesn't govern this work.
 */
export function evaluateGuard(decision, work = {}) {
  const g = normalizeGuard(decision?.guard);
  const result = { applies: true, governed: [], violations: [], byJql: false };
  if (!g) return result;
  if (g.jql && work.jqlScope && work.jqlScope[decision.id] === false) return { ...result, applies: false };
  result.byJql = Boolean(g.jql && work.jqlScope?.[decision.id] === true);
  const paths = work.paths || [];
  if (g.paths.length && paths.length) {
    result.governed = paths.filter((p) => g.paths.some((glob) => matchPath(glob, p)));
    if (!result.governed.length) return { ...result, applies: false };
  }
  for (const pkg of work.packages || []) {
    const hit = g.packages.deny.find((pattern) => matchPackage(pattern, pkg));
    if (hit) result.violations.push({ rule: 'package', item: packageName(pkg), pattern: hit });
  }
  return result;
}

/** Extra avoid-phrases for the text matcher: guard keywords plus plain denied package names. */
export function guardAvoidPhrases(decision) {
  const g = normalizeGuard(decision?.guard);
  if (!g) return [];
  const pkgs = g.packages.deny.filter((p) => /^[a-z][a-z0-9-]{2,}$/.test(p));
  return [...g.keywords, ...pkgs];
}

/** One-line human summary of a guard ("services/payments/** · deny mongodb, mongoose · project = PAY"). */
export function describeGuard(guard) {
  const g = normalizeGuard(guard);
  if (!g) return '';
  return [
    g.paths.length ? `files ${g.paths.join(', ')}` : null,
    g.packages.deny.length ? `no ${g.packages.deny.join(', ')}` : null,
    g.packages.allow.length ? `use ${g.packages.allow.join(', ')}` : null,
    g.keywords.length ? `flags “${g.keywords.join('”, “')}”` : null,
    g.jql ? `work items: ${g.jql}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
