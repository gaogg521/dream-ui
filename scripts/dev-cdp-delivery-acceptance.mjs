#!/usr/bin/env node
/**
 * DEV CDP acceptance: @@ cross-session delivery, end to end in the real app.
 *
 * Creates conversations A and B through the running local backend (reached
 * from the renderer page via window.__backendPort), sends `@@conv:<B>` from A
 * through the real send boundary, waits for the app's own 1s drainer, then
 * verifies B's history contains the inbound [[DREAM_SESSION_MESSAGE]] block
 * (no reply address when reply_requested=false) and that the real UI renders it.
 *
 * Prereq: dream-ui dev running with DREAM_DEVTOOLS_CDP_PORT.
 */
import { createRequire } from 'node:module';
const WebSocket = createRequire('D:/dream/dream-ui/package.json')('ws');

const CDP_PORT = process.env.DREAM_DEVTOOLS_CDP_PORT || '9230';
const fail = (m) => {
  console.error(`[cdp-delivery] FAIL: ${m}`);
  process.exit(1);
};
const pass = (m) => console.log(`[cdp-delivery] PASS: ${m}`);
const log = (m) => console.log(`[cdp-delivery] ${m}`);

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
  .then((r) => r.json())
  .catch(() => null);
if (!targets) fail(`CDP not reachable on ${CDP_PORT}`);
const page =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) || targets.find((t) => t.type === 'page');
if (!page) fail('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('ws open timeout')), 8000);
  ws.on('open', () => {
    clearTimeout(t);
    res();
  });
  ws.on('error', rej);
});
const send = (method, params = {}) =>
  new Promise((r, j) => {
    const mid = ++id;
    const t = setTimeout(() => j(new Error(method + ' timeout')), 15000);
    pending.set(mid, (m) => {
      clearTimeout(t);
      r(m);
    });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails)
    fail('page eval threw: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  return res.result?.result?.value;
};

pass('attached to page ' + page.url.slice(0, 60));

const boot = await evalJs(`(async () => {
  const port = window.__backendPort;
  if (!port) return { error: 'window.__backendPort missing' };
  const base = 'http://127.0.0.1:' + port;
  const j = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text: text.slice(0, 300) };
  };
  return { port, base, j };
})()`);
if (boot.error) fail(boot.error);
pass('backend reachable on port ' + boot.port);

// 1. Create conversations A and B.
const mk = (name) => evalJs(`boot.j('POST', '/api/conversations', { name: ${JSON.stringify(name)}, type: 'dream' })`);
boot.j = undefined; // not serializable across returnByValue — rebuild below
// (returnByValue dropped the function; re-create helpers in a fresh eval scope each time.)
const api = async (method, path, body) =>
  evalJs(`(async () => {
  const r = await fetch('http://127.0.0.1:' + window.__backendPort + '${path}', {
    method: '${method}',
    headers: ${body ? "'application/json'" : 'undefined'} ? { 'Content-Type': 'application/json' } : undefined,
    body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'},
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 300) };
})()`);

const created = {};
for (const name of ['CDP-Delivery-A (dev)', 'CDP-Delivery-B (dev)']) {
  const r = await api('POST', '/api/conversations', { name, type: 'dream', extra: {} });
  if (r.status !== 200 && r.status !== 201) fail(`create ${name}: HTTP ${r.status} ${r.text}`);
  const conv = r.json?.data ?? r.json;
  if (!conv?.id) fail(`create ${name}: no id in ${r.text}`);
  created[name.startsWith('CDP-Delivery-A') ? 'a' : 'b'] = conv.id;
}
pass(`conversations A=${created.a} B=${created.b}`);

// 2. Send from A with a @@ reference to B.
const body = `cdp e2e delivery ${Date.now()} @@conv:${created.b}`;
const sent = await api('POST', `/api/conversations/${created.a}/messages`, { content: body, reply_requested: false });
if (sent.status !== 200 && sent.status !== 201 && sent.status !== 202) fail(`send: HTTP ${sent.status} ${sent.text}`);
pass('sent from A (user message persisted, delivery enqueued at send boundary)');

// 3. Wait for the app's own drainer (1s tick) to deliver.
let inbound = null;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = await api('GET', `/api/conversations/${created.b}/messages?limit=20`);
  const items = r.json?.data?.items ?? r.json?.items ?? [];
  const hit = items.find((m) => (m.content?.content || '').includes('[[DREAM_SESSION_MESSAGE]]'));
  if (hit) {
    inbound = hit;
    break;
  }
}
if (!inbound) fail('drainer did not deliver within 15s');
pass('inbound [[DREAM_SESSION_MESSAGE]] block found in B history');

const blockText = inbound.content?.content || '';
if (!blockText.includes(body.split(' @@conv:')[0])) fail('inbound block missing original user body');
if (blockText.includes('reply_to_conversation_id')) fail('reply_requested=false but block contains a reply address');
pass('block carries user body; no reply address (reply_requested=false)');

// 4. Navigate the real UI to B and verify the block renders in the message list.
const nav = await evalJs(`(function(){ location.hash = '#/conversation/${created.b}'; return location.hash; })()`);
await new Promise((r) => setTimeout(r, 4000));
const rendered = await evalJs(`(function(){
  function deep(sel){ function walk(root){ if(!root||!root.querySelectorAll) return null; var d=root.querySelector(sel); if(d) return d; var n=root.querySelectorAll('*'); for(var i=0;i<n.length;i++){ if(n[i].shadowRoot){ var h=walk(n[i].shadowRoot); if(h) return h; } } return null; } return walk(document); }
  const text = document.body ? document.body.innerText : '';
  return { hash: location.hash, hasMarker: text.indexOf('[[DREAM_SESSION_MESSAGE]]') >= 0 || !!deep('[data-testid="session-message-block"]'), textLen: text.length };
})()`);
if (rendered.hash !== `#/conversation/${created.b}`) fail('navigation to B failed: ' + rendered.hash);
if (!rendered.hasMarker) fail(`UI did not render the inbound block (textLen=${rendered.textLen})`);
pass('inbound block rendered in the real conversation UI');

console.log('[cdp-delivery] All required checks passed.');
process.exit(0);
