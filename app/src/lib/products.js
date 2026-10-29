// Thin wrappers around the Jira and Confluence REST APIs used by Precedent.
// All calls run as the app (asApp) because they happen in triggers, queues and Rovo actions
// where there is no interactive user; user-facing resolvers check permissions first.

import api, { route, getAppContext } from '@forge/api';
import { kvs } from '@forge/kvs';
import { adfToText } from './adf.js';
import { stripBrief } from './brief.js';

async function json(res, what) {
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${what} failed: ${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- site ----------

/** Base URL of the site, e.g. https://acme.atlassian.net (cached). */
export async function siteUrl() {
  const cached = await kvs.get('meta:siteUrl');
  if (cached) return cached;
  const info = await json(await api.asApp().requestJira(route`/rest/api/3/serverInfo`), 'serverInfo');
  await kvs.set('meta:siteUrl', info.baseUrl);
  return info.baseUrl;
}

// ---------- Jira ----------

const ISSUE_FIELDS = 'summary,description,labels,components,project,issuetype,status,assignee,reporter,created,updated';

/** The Jira Decision Log page of this installation. */
export function decisionLogUrl(base) {
  try {
    const app = getAppContext();
    return `${base}/jira/apps/${app.appAri.appId}/${app.environmentAri.environmentId}`;
  } catch {
    return `${base}/jira/apps`;
  }
}

export async function getIssue(key) {
  return json(await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`), `get issue ${key}`);
}

/** Text that represents the work item for matching: summary + description. */
export function issueText(issue) {
  const f = issue.fields || {};
  // Precedent's own brief block mentions what decisions rule out: never check it as the work itself
  return [f.summary || '', adfToText(stripBrief(f.description).adf).trim()].join('\n');
}

export function issueMeta(issue, base) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary,
    projectKey: f.project?.key,
    projectName: f.project?.name,
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    issueType: f.issuetype?.name,
    assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : null,
    url: base ? `${base}/browse/${issue.key}` : null,
  };
}

export async function setIssueProperty(key, value) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/properties/precedent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok && res.status !== 201) await json(res, `set property on ${key}`);
}

export async function getComment(issueKey, commentId) {
  return json(await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`), 'get comment');
}

export async function addComment(issueKey, adfBody) {
  return json(
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    }),
    'add comment',
  );
}

export async function updateComment(issueKey, commentId, adfBody) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}?notifyUsers=false`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfBody }),
  });
  if (res.status === 404) return null; // someone deleted it
  return json(res, 'update comment');
}

export async function deleteComment(issueKey, commentId) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.warn(`delete comment ${issueKey}/${commentId}: ${res.status}`);
}

/** Number of work items matching a JQL query (Jira's approximate count, fine for thresholds). */
export async function countIssues(jql) {
  const data = await json(
    await api.asApp().requestJira(route`/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql }),
    }),
    'count issues',
  );
  return Number(data.count) || 0;
}

/** Keys of the work items matching a JQL query. */
export async function issueKeysMatching(jql, max = 200) {
  const issues = await searchIssues(jql, { max, fields: ['summary'] });
  return issues.map((i) => i.key);
}

export async function updateIssue(key, fields) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) await json(res, `update ${key}`);
}

/** Enhanced JQL search (POST /search/jql). Returns up to `max` issues. */
export async function searchIssues(jql, { max = 50, fields = ISSUE_FIELDS.split(',') } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const body = { jql, fields, maxResults: Math.min(100, max - issues.length) };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    // eslint-disable-next-line no-await-in-loop
    const page = await json(
      await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      'search',
    );
    issues.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return issues;
}

export async function listProjects() {
  const page = await json(await api.asApp().requestJira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`), 'projects');
  return (page.values || []).map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey }));
}

export async function createIssue({ projectKey, summary, description, labels = [] }) {
  const meta = await json(
    await api.asApp().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=50`),
    'createmeta',
  );
  const types = meta.issueTypes || meta.values || [];
  const type = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask && !/epic/i.test(t.name)) || types[0];
  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { id: type.id },
      summary,
      labels,
      description: { type: 'doc', version: 1, content: description.split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) },
    },
  };
  return json(
    await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'create issue',
  );
}

/** Permission check used before showing data to a user through a resolver. */
export async function userCanBrowse(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=BROWSE_PROJECTS`);
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.permissions?.BROWSE_PROJECTS?.havePermission);
}

export async function userCanEdit(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=EDIT_ISSUES`);
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.permissions?.EDIT_ISSUES?.havePermission);
}

// ---------- Confluence ----------

export async function getPage(id) {
  return json(
    await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`),
    `get page ${id}`,
  );
}

export async function getPageLabels(id) {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${id}/labels?limit=50`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((l) => l.name);
}

export async function getSpace(spaceId) {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function listSpaces() {
  const data = await json(await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?limit=50&type=global`), 'spaces');
  return (data.results || []).map((s) => ({ id: s.id, key: s.key, name: s.name }));
}

/** Most recently modified pages, used for the "Scan Confluence" backfill. */
export async function recentPageIds(limit = 50) {
  const cql = 'type = page order by lastmodified desc';
  const data = await json(
    await api.asApp().requestConfluence(route`/wiki/rest/api/content/search?cql=${cql}&limit=${limit}`),
    'cql search',
  );
  return (data.results || []).map((r) => r.id);
}

export async function createPage({ spaceId, title, adf }) {
  return json(
    await api.asApp().requestConfluence(route`/wiki/api/v2/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId,
        status: 'current',
        title,
        body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
      }),
    }),
    'create page',
  );
}

/** Footer comment on a page (v2; the v1 content endpoint for comments is gone). */
export async function addPageComment(pageId, storageHtml) {
  return json(
    await api.asApp().requestConfluence(route`/wiki/api/v2/footer-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: String(pageId), body: { representation: 'storage', value: storageHtml } }),
    }),
    'add page comment',
  );
}
