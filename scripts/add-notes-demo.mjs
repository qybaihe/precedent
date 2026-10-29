// Adds the prose meeting notes ("Payments Sync — 2026-10-27") and the work item that only conflicts
// once a decision from those notes is tracked, to an already seeded demo site (no reset).
// Usage: source ~/hackathons/.secrets/atlassian.env && ATLASSIAN_SITE=… node scripts/add-notes-demo.mjs
import { call } from './lib.mjs';
import { PAGES, ISSUES } from './demo-data.mjs';

const page = PAGES.find((pg) => pg.title.startsWith('Payments Sync'));
const issue = ISSUES.find((i) => i.summary.includes('direct HTTP callbacks'));
const doc = (t) => ({ type: 'doc', version: 1, content: t.split('\n\n').map((x) => ({ type: 'paragraph', content: [{ type: 'text', text: x }] })) });

const space = await call('GET', '/wiki/rest/api/space/ENG');
const existing = await call('GET', `/wiki/rest/api/content?spaceKey=ENG&title=${encodeURIComponent(page.title)}`);
if (existing.results.length) console.log(`page exists: ${existing.results[0].id}`);
else {
  const created = await call('POST', '/wiki/api/v2/pages', { spaceId: String(space.id), status: 'current', title: page.title, body: { representation: 'atlas_doc_format', value: JSON.stringify(page.adf) } });
  await call('POST', `/wiki/rest/api/content/${created.id}/label`, page.labels.map((name) => ({ prefix: 'global', name })));
  console.log(`page ${created.id} ${page.title}`);
}
const found = await call('POST', '/rest/api/3/search/jql', { jql: `project = ${issue.project} AND summary ~ "\\"direct HTTP callbacks\\""`, fields: ['summary'], maxResults: 5 });
if (found.issues.length) console.log(`issue exists: ${found.issues[0].key}`);
else {
  const meta = await call('GET', `/rest/api/3/issue/createmeta/${issue.project}/issuetypes`);
  const type = (meta.issueTypes.find((t) => t.name === 'Task') || meta.issueTypes[0]).id;
  const created = await call('POST', '/rest/api/3/issue', { fields: { project: { key: issue.project }, issuetype: { id: type }, summary: issue.summary, labels: issue.labels, description: doc(issue.description) } });
  console.log(`issue ${created.key} ${issue.summary}`);
}
