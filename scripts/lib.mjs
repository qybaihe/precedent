// Shared helpers for seed/test scripts. Credentials come from ~/hackathons/.secrets/atlassian.env
// (FORGE_EMAIL, FORGE_API_TOKEN, ATLASSIAN_SITE) and are never printed.
export const SITE = `https://${process.env.ATLASSIAN_SITE}`;
const AUTH = 'Basic ' + Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64');

export async function call(method, path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
