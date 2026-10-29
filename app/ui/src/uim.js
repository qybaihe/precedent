// UI modification for Jira's Create dialog: when the summary is filled in, say right under it if
// the team already decided against it ("Already decided: DEC-1 rules out MongoDB…"). Runs in an
// invisible iframe; all matching happens in the `createHint` resolver.
import { uiModificationsApi } from '@forge/jira-bridge';
import { invoke } from '@forge/bridge';

const FIELDS = () => ['summary'];
let last = null;
let label = null; // the summary field's own name, restored when there is nothing to say

async function hint(api, projectKey) {
  const summary = api.getFieldById('summary');
  if (!summary) return;
  const text = String(summary.getValue() || '').trim();
  if (text === last) return;
  last = text;
  label ||= summary.getName?.() || 'Summary';
  const show = (r) => {
    summary.setDescription(r?.hint || '');
    // the new Create dialog tucks descriptions behind an info icon: flag it in the label too
    summary.setName(r?.flag ? `${label} · ${r.flag}` : label);
  };
  if (text.length < 8) return show(null);
  try {
    show(await invoke('createHint', { summary: text, projectKey }));
  } catch (e) {
    console.warn('Precedent create hint failed', e);
  }
}

export function startCreateHints(context) {
  const projectKey = context?.extension?.project?.key;
  uiModificationsApi.onInit(({ api }) => hint(api, projectKey), FIELDS);
  uiModificationsApi.onChange(({ api, change }) => (change?.current?.getId?.() === 'summary' ? hint(api, projectKey) : undefined), FIELDS);
  uiModificationsApi.onError(({ errors }) => console.warn('Precedent UI modification errors', errors));
}
