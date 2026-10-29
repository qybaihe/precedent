// Decision health: is a decision still doing its job? A decision that work keeps contradicting,
// that keeps getting exceptions, that nobody has reviewed in months or that has no owner is
// drifting, and the team should look at it before it silently stops being true.
//
// Every point lost is explained by a signal, so the UI can say *why* a decision is at risk.

export const REVIEW_DAYS = 180;

const DAY = 86400000;
const EXCEPTION_WINDOW_DAYS = 90;
const SOON_DAYS = 14;

const PENALTY = {
  conflict: 12,
  conflictMax: 36,
  exception: 8,
  exceptionMax: 24,
  overdue: 20,
  soon: 5,
  owner: 10,
  guardrails: 10,
};

/** 'Mar 12, 2026'; date-only values (UTC midnight) keep their calendar day, like the UI's formatDate. */
function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

const count = (x) => (Array.isArray(x) ? x.length : Math.max(0, Number(x) || 0));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** When the decision is due for review (ISO): explicit reviewBy, else last review/decision + REVIEW_DAYS. */
export function reviewDate(decision) {
  const explicit = toTime(decision?.reviewBy);
  if (explicit !== null) return new Date(explicit).toISOString();
  const base = toTime(decision?.reviewedAt) ?? toTime(decision?.decidedAt) ?? toTime(decision?.createdAt);
  return base === null ? null : new Date(base + REVIEW_DAYS * DAY).toISOString();
}

export function gradeFor(score) {
  if (score === null || score === undefined) return 'inactive';
  if (score >= 80) return 'healthy';
  if (score >= 55) return 'watch';
  return 'at-risk';
}

/**
 * decisionHealth(decision, impact, now) -> { score, grade, reviewBy, reviewState, signals }
 * `impact` counts the work items currently conflicting with / aligned with / related to it.
 * Inactive decisions (superseded, archived, proposed) are not scored.
 */
export function decisionHealth(decision, impact = { conflicts: 0, aligned: 0, related: 0 }, now = new Date()) {
  const reviewBy = reviewDate(decision);
  if (decision?.status && decision.status !== 'active') {
    return { score: null, grade: 'inactive', reviewBy, reviewState: 'ok', signals: [] };
  }

  const nowMs = new Date(now).getTime();
  const signals = [];
  const add = (kind, tone, label, points) => signals.push({ kind, tone, label, impact: points });

  const conflicts = count(impact?.conflicts);
  if (conflicts) {
    add('conflicts', 'danger', `${plural(conflicts, 'work item contradicts', 'work items contradict')} it`, -Math.min(PENALTY.conflictMax, conflicts * PENALTY.conflict));
  }

  const since = nowMs - EXCEPTION_WINDOW_DAYS * DAY;
  const exceptions = (decision?.exceptions || []).filter((e) => {
    const at = toTime(e?.at);
    return at !== null && at >= since && at <= nowMs;
  }).length;
  if (exceptions) {
    const label = `${plural(exceptions, 'exception', 'exceptions')} in ${EXCEPTION_WINDOW_DAYS} days${exceptions > 1 ? ' — the rule may be bending' : ''}`;
    add('exceptions', 'warning', label, -Math.min(PENALTY.exceptionMax, exceptions * PENALTY.exception));
  }

  let reviewState = 'ok';
  const reviewMs = toTime(reviewBy);
  if (reviewMs !== null) {
    if (reviewMs < nowMs) {
      reviewState = 'overdue';
      add('review', 'danger', `Review overdue since ${formatDate(reviewBy)}`, -PENALTY.overdue);
    } else {
      const days = Math.ceil((reviewMs - nowMs) / DAY);
      if (days <= SOON_DAYS) {
        reviewState = 'soon';
        add('review', 'warning', days === 0 ? 'Review due today' : `Review due in ${plural(days, 'day', 'days')}`, -PENALTY.soon);
      }
    }
  }

  const owner = decision?.owner;
  if (!(typeof owner === 'string' ? owner.trim() : owner?.name || owner?.accountId)) add('owner', 'warning', 'No owner to ask', -PENALTY.owner);

  if (!(decision?.guardrails?.avoid || []).length) add('guardrails', 'warning', 'No guardrails — shown as context only', -PENALTY.guardrails);

  const aligned = count(impact?.aligned);
  if (aligned) add('aligned', 'success', `${plural(aligned, 'work item follows', 'work items follow')} it`, 0);

  const score = Math.round(Math.max(0, Math.min(100, 100 + signals.reduce((n, s) => n + s.impact, 0))));
  // most negative first; the sort is stable so equal penalties keep the order above
  signals.sort((a, b) => a.impact - b.impact);
  return { score, grade: gradeFor(score), reviewBy, reviewState, signals };
}

/**
 * teamHealth(decisions, refs, now) -> { score, grade, active, healthy, watch, atRisk, overdue, dueSoon, byId }
 * `refs` maps a DEC id to its impact counts. The team score is the mean of active decisions (100 when none).
 */
export function teamHealth(decisions, refs = {}, now = new Date()) {
  const byId = {};
  const scored = [];
  const totals = { healthy: 0, watch: 0, atRisk: 0, overdue: 0, dueSoon: 0 };
  for (const d of decisions || []) {
    if (!d?.id) continue;
    const health = decisionHealth(d, refs?.[d.id] || undefined, now);
    byId[d.id] = health;
    if (health.score === null) continue;
    scored.push(health.score);
    if (health.grade === 'healthy') totals.healthy++;
    else if (health.grade === 'watch') totals.watch++;
    else totals.atRisk++;
    if (health.reviewState === 'overdue') totals.overdue++;
    if (health.reviewState === 'soon') totals.dueSoon++;
  }
  const score = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 100;
  return { score, grade: gradeFor(score), active: scored.length, ...totals, byId };
}
