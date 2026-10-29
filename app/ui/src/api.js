// Thin wrapper over @forge/bridge. Opened outside Atlassian (vite preview, `?surface=…`), the UI
// runs on built-in demo data instead, which is how the screens are iterated on locally.
// The bridge throws when it can't reach an Atlassian host, so it is only loaded inside Forge.
let bridgeP = null;
const bridge = () => (bridgeP ||= import('@forge/bridge'));

export const IN_FORGE = window.self !== window.top;
export const AGENT = { type: 'forge', agentKey: 'precedent-agent', agentName: 'Precedent' };
export const APP_ID = '92a37583-d5ab-4554-97dd-8e6d41617e28';

let mock = null;
const getMock = async () => (mock ||= await import('./mock.js'));

export async function invoke(name, payload = {}) {
  if (IN_FORGE) return (await bridge()).invoke(name, payload);
  const m = await getMock();
  await new Promise((r) => setTimeout(r, 250));
  return m.invoke(name, payload);
}

export async function getContext() {
  if (IN_FORGE) return (await bridge()).view.getContext();
  return (await getMock()).context();
}

export async function enableTheme() {
  if (IN_FORGE) await (await bridge()).view.theme.enable().catch(() => {});
}

export function open(url) {
  if (!url) return;
  if (IN_FORGE) bridge().then((b) => b.router.open(url)).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

export function navigate(url) {
  if (IN_FORGE) bridge().then((b) => b.router.navigate(url)).catch(() => {});
}

export async function rovoEnabled() {
  if (!IN_FORGE) return true;
  try {
    return await (await bridge()).rovo.isEnabled();
  } catch {
    return false;
  }
}

export function askRovo(prompt) {
  if (IN_FORGE) bridge().then((b) => b.rovo.open({ ...AGENT, prompt })).catch(() => {});
  else console.log('[rovo]', prompt);
}

let flagId = 0;
export function flag(title, description, appearance = 'success') {
  if (IN_FORGE) bridge().then((b) => b.showFlag({ id: `precedent-${++flagId}`, title, description, type: appearance, isAutoDismiss: true })).catch(() => {});
  else console.log('[flag]', title, description);
}
