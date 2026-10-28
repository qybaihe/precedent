// Seeds the demo site with a realistic engineering org ("Lumen Pay"):
// Confluence pages that contain decisions, and Jira work items — some of which contradict them.
// Usage: source ~/hackathons/.secrets/atlassian.env && node scripts/seed-demo.mjs [--reset]
import { call, sleep } from './lib.mjs';

const ME = '712020:1a2d93dd-7154-45be-8fcc-bf5262dd2dce';
const SPACE_KEY = 'ENG';
const PROJECTS = [
  { key: 'PAY', name: 'Payments' },
  { key: 'CHK', name: 'Checkout' },
  { key: 'PLAT', name: 'Platform' },
];

import { PAGES, ISSUES } from './demo-data.mjs';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const adfFromText = (t) => doc(...t.split('\n\n').map((para) => p(para)));

async function ensureProject({ key, name }, reset) {
  const existing = await call('GET', `/rest/api/3/project/${key}`).catch(() => null);
  if (existing && reset) {
    await call('DELETE', `/rest/api/3/project/${key}?enableUndo=false`);
    console.log(`deleted project ${key}`);
    await sleep(4000);
  } else if (existing) return existing;
  const created = await call('POST', '/rest/api/3/project', {
    key,
    name,
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    leadAccountId: ME,
    assigneeType: 'UNASSIGNED',
  });
  console.log(`created project ${key}`);
  return created;
}

async function transition(key, target) {
  const { transitions } = await call('GET', `/rest/api/3/issue/${key}/transitions`);
  const t = transitions.find((x) => x.to.name.toLowerCase() === target.toLowerCase() || x.name.toLowerCase() === target.toLowerCase());
  if (t) await call('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
}

async function main() {
  const reset = process.argv.includes('--reset');
  const space = await call('GET', `/wiki/rest/api/space/${SPACE_KEY}?expand=homepage`);
  const spaceId = String(space.id);

  if (reset) {
    // delete every page in the space except the homepage
    const pages = await call('GET', `/wiki/api/v2/spaces/${spaceId}/pages?limit=100`);
    for (const pg of pages.results) {
      if (String(pg.id) === String(space.homepage?.id || '')) continue;
      if (/overview|home/i.test(pg.title) && !pg.parentId) continue;
      await call('DELETE', `/wiki/api/v2/pages/${pg.id}`).catch((e) => console.warn(e.message));
      await call('DELETE', `/wiki/api/v2/pages/${pg.id}?purge=true`).catch(() => {});
      console.log(`deleted page ${pg.title}`);
    }
  }
  for (const proj of PROJECTS) await ensureProject(proj, reset);

  for (const page of PAGES) {
    const created = await call('POST', '/wiki/api/v2/pages', {
      spaceId,
      status: 'current',
      title: page.title,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(page.adf) },
    });
    await call('POST', `/wiki/rest/api/content/${created.id}/label`, page.labels.map((name) => ({ prefix: 'global', name })));
    console.log(`page ${created.id} ${page.title}`);
    await sleep(1500);
  }

  // Give the page triggers time to harvest before work items arrive.
  await sleep(20000);

  const typeIds = {};
  for (const proj of PROJECTS) {
    const meta = await call('GET', `/rest/api/3/issue/createmeta/${proj.key}/issuetypes`);
    typeIds[proj.key] = (meta.issueTypes.find((t) => t.name === 'Task') || meta.issueTypes[0]).id;
  }
  for (const issue of ISSUES) {
    const created = await call('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: issue.project },
        issuetype: { id: typeIds[issue.project] },
        summary: issue.summary,
        labels: issue.labels,
        assignee: { accountId: ME },
        description: adfFromText(issue.description),
      },
    });
    if (issue.status) await transition(created.key, issue.status).catch((e) => console.warn(e.message));
    if (issue.comment) {
      await sleep(3000);
      await call('POST', `/rest/api/3/issue/${created.key}/comment`, { body: adfFromText(issue.comment) });
    }
    console.log(`issue ${created.key} ${issue.summary}`);
    await sleep(800);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
