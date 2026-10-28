// Calls the development-only selftest web trigger. URL and token are read from files outside the
// repo (paths in SELFTEST_URL_FILE / SELFTEST_TOKEN_FILE) and never printed.
import fs from 'node:fs';

const url = fs.readFileSync(process.env.SELFTEST_URL_FILE, 'utf8').trim();
const token = fs.readFileSync(process.env.SELFTEST_TOKEN_FILE, 'utf8').trim();

export async function op(name, payload = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-selftest-token': token },
    body: JSON.stringify({ op: name, payload }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} -> ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

if (process.argv[2]) {
  const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  console.log(JSON.stringify(await op(process.argv[2], payload), null, 2));
}
