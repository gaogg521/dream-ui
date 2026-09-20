#!/usr/bin/env node
/**
 * Screenshot variant of the delivery acceptance: runs the same E2E flow, then
 * captures PNGs of the sender (A, outbound block) and recipient (B, inbound
 * block) conversation UIs via CDP Page.captureScreenshot.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const WebSocket = createRequire('D:/dream/dream-ui/package.json')('ws');

const CDP_PORT = process.env.DREAM_DEVTOOLS_CDP_PORT || '9230';
const OUT_DIR = 'D:/dream/outputs';
const fail = (m) => { console.error(`[cdp-shot] FAIL: ${m}`); process.exit(1); };
const pass = (m) => console.log(`[cdp-shot] PASS: ${m}`);

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then(r => r.json());
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173')) || targets.find(t => t.type === 'page');
if (!page) fail('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ws open timeout')), 8000); ws.on('open', () => { clearTimeout(t); res(); }); ws.on('error', rej); });
const send = (method, params = {}) => new Promise((r, j) => {
  const mid = ++id;
  const t = setTimeout(() => j(new Error(method + ' timeout')), 20000);
  pending.set(mid, (m) => { clearTimeout(t); r(m); });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) fail('page eval threw: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  return res.result?.result?.value;
};
const api = (method, path, body) => evalJs(`(async () => {
  const r = await fetch('http://127.0.0.1:' + window.__backendPort + '${path}', {
    method: '${method}',
    headers: ${body ? `{ 'Content-Type': 'application/json' }` : 'undefined'},
    body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'},
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 300) };
})()`);
const navigate = async (convId) => {
  await evalJs(`(function(){ location.hash = '#/conversation/${convId}'; return location.hash; })()`);
  await new Promise((r) => setTimeout(r, 4000));
};
const shot = async (file) => {
  await send('Page.enable');
  await evalJs(`(function(){ function deep(sel){ function walk(root){ if(!root||!root.querySelectorAll) return null; var d=root.querySelector(sel); if(d) return d; var n=root.querySelectorAll('*'); for(var i=0;i<n.length;i++){ if(n[i].shadowRoot){ var h=walk(n[i].shadowRoot); if(h) return h; } } return null; } return walk(document); }
    const el = deep('[data-testid="session-message-block"]') || document.body; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); return true; })()`);
  await new Promise((r) => setTimeout(r, 800));
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const data = res.result?.data;
  if (!data) fail('captureScreenshot returned no data: ' + JSON.stringify(res).slice(0, 300));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/${file}`, Buffer.from(data, 'base64'));
  pass(`screenshot saved: ${OUT_DIR}/${file} (${Math.round(data.length * 3 / 4 / 1024)} KB)`);
};

pass('attached to page ' + page.url.slice(0, 60));

const created = {};
for (const [key, name] of [['a', 'CDP-Delivery-A (dev)'], ['b', 'CDP-Delivery-B (dev)']]) {
  const r = await api('POST', '/api/conversations', { name, type: 'dream', extra: {} });
  if (r.status !== 200 && r.status !== 201) fail(`create ${name}: HTTP ${r.status} ${r.text}`);
  const conv = r.json?.data ?? r.json;
  created[key] = conv.id;
}
pass(`conversations A=${created.a} B=${created.b}`);

const body = `跨会话投递效果截图 ${Date.now()} @@conv:${created.b}`;
const sent = await api('POST', `/api/conversations/${created.a}/messages`, { content: body, reply_requested: false });
if (![200, 201, 202].includes(sent.status)) fail(`send: HTTP ${sent.status} ${sent.text}`);
pass('sent from A');

let inbound = null;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = await api('GET', `/api/conversations/${created.b}/messages?limit=20`);
  const items = r.json?.data?.items ?? r.json?.items ?? [];
  const hit = items.find((m) => (m.content?.content || '').includes('[[DREAM_SESSION_MESSAGE]]'));
  if (hit) { inbound = hit; break; }
}
if (!inbound) fail('drainer did not deliver within 15s');
pass('delivered to B');

// Recipient side first (the headline effect), then sender side.
await navigate(created.b);
const bCheck = await evalJs(`(function(){ return { marker: document.body.innerText.indexOf('[[DREAM_SESSION_MESSAGE]]') >= 0, text: document.body.innerText.slice(0, 0) || null }; })()`);
if (!bCheck.marker) fail('inbound block not rendered in B UI');
await shot('cdp-delivery-B-recipient.png');

await navigate(created.a);
const aCheck = await evalJs(`(function(){ return { sessions: document.body.innerText.indexOf('[[DREAM_SESSIONS]]') >= 0 }; })()`);
if (!aCheck.sessions) console.log('[cdp-shot] NOTE: outbound [[DREAM_SESSIONS]] marker not visible in A body text (may render as styled widget)');
await shot('cdp-delivery-A-sender.png');

console.log('[cdp-shot] DONE. A=' + created.a + ' B=' + created.b);
process.exit(0);
