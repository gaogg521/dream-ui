#!/usr/bin/env node
/**
 * DEV CDP acceptance: diagram pan/zoom in the real conversation UI (+ optional enterprise HTTP smoke).
 *
 * Seeds an assistant (left) markdown message — user bubbles render plain text and would not
 * exercise Mermaid/WaveDrom. Writes via local dream-ui-Dev SQLite when available.
 *
 * Prerequisites:
 *   $env:DREAM_DEVTOOLS_CDP_PORT = "9230"; bun run dev   (dream-ui, dev build)
 *
 * Usage:
 *   node scripts/dev-cdp-acceptance.mjs
 *   DREAM_CDP_CONVERSATION_ID=<id> node scripts/dev-cdp-acceptance.mjs
 *   DREAM_BACKEND_URL=http://127.0.0.1:25808 DREAM_ADMIN_TOKEN=... node scripts/dev-cdp-acceptance.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from '../node_modules/ws/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CDP_PORT = process.env.DREAM_DEVTOOLS_CDP_PORT || '9230';
const BACKEND = process.env.DREAM_BACKEND_URL;
const ADMIN_TOKEN = process.env.DREAM_ADMIN_TOKEN;
const CONV_ID_OVERRIDE = process.env.DREAM_CDP_CONVERSATION_ID;

const base = `http://127.0.0.1:${CDP_PORT}`;

/** Markdown blocks render inside ShadowView — pierce shadow roots for CDP queries. */
const SHADOW_PIERCE = `
function __deepQuery(sel) {
  function walk(root) {
    if (!root || !root.querySelectorAll) return null;
    var direct = root.querySelector(sel);
    if (direct) return direct;
    var nodes = root.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.shadowRoot) {
        var hit = walk(el.shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(document);
}
`;

function fail(msg) {
  console.error(`[dev-cdp-acceptance] FAIL: ${msg}`);
  process.exit(1);
}

function pass(label) {
  console.log(`[dev-cdp-acceptance] PASS: ${label}`);
}

function runDiagramSeed() {
  const seedScript = path.join(__dirname, 'seed-dev-diagram-conversation.mjs');
  return execSync(`bun "${seedScript}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
    cwd: path.join(__dirname, '..'),
    shell: true,
  }).trim();
}

function seedDiagramConversationId() {
  if (CONV_ID_OVERRIDE) {
    try {
      runDiagramSeed();
    } catch {
      // Best-effort refresh when overriding id; acceptance still navigates to the given id.
    }
    return CONV_ID_OVERRIDE;
  }
  try {
    return runDiagramSeed();
  } catch {
    return null;
  }
}

function buildNavigateExpression(conversationId) {
  const id = JSON.stringify(conversationId);
  return `
(function () {
  var conversationId = ${id};
  var hash = '#/conversation/' + conversationId;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  return { conversationId: conversationId, hash: hash, href: window.location.href };
})()
`;
}

function connectCdp(pageTarget) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: rj } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rj(new Error(JSON.stringify(msg.error))) : r(msg.result);
      }
    });
    ws.on('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((r, rj) => {
            const mid = ++id;
            pending.set(mid, { resolve: r, reject: rj });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        close() {
          ws.close();
        },
      })
    );
    ws.on('error', reject);
  });
}

async function cdpReload(pageTarget) {
  const sock = await connectCdp(pageTarget);
  try {
    await sock.send('Page.enable');
    await sock.send('Page.reload');
  } finally {
    sock.close();
  }
}

async function cdpEval(pageTarget, expression, attempt = 0) {
  try {
    const sock = await connectCdp(pageTarget);
    try {
      await sock.send('Runtime.enable');
      const payload = await sock.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (payload.exceptionDetails) {
        throw new Error(JSON.stringify(payload.exceptionDetails));
      }
      return payload.result?.value;
    } finally {
      sock.close();
    }
  } catch (err) {
    if (attempt < 5 && /Unexpected server response|ECONNRESET/i.test(String(err))) {
      await new Promise((r) => setTimeout(r, 700));
      const freshTarget = (await fetch(`${base}/json`).then((r) => r.json())).find(
        (t) => t.id === pageTarget.id && t.type === 'page'
      );
      return cdpEval(freshTarget || pageTarget, expression, attempt + 1);
    }
    throw err;
  }
}

async function pickMainPage() {
  const res = await fetch(`${base}/json`);
  if (!res.ok) fail(`CDP not listening on ${base} (${res.status})`);
  const list = await res.json();
  const pages = list.filter((t) => t.type === 'page');
  const hit =
    pages.find((t) => t.url.includes('localhost:5173')) ||
    pages.find((t) => t.url.includes('127.0.0.1:5173')) ||
    pages[0];
  if (!hit) fail('No CDP page target found — is dream-ui dev running with DREAM_DEVTOOLS_CDP_PORT?');
  return hit;
}

async function waitForEval(target, expression, { timeoutMs = 45000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await cdpEval(target, expression);
    if (ok) return ok;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function diagramPanZoomCheck(target, conversationId) {
  pass(`Conversation ready for CDP (${conversationId})`);

  const nav = await cdpEval(target, buildNavigateExpression(conversationId));
  if (
    nav?.href?.includes(`#/conversation/${conversationId}`) &&
    target.url.includes(`#/conversation/${conversationId}`)
  ) {
    await cdpReload(target);
  }
  await new Promise((r) => setTimeout(r, 3500));
  const pageTarget = await pickMainPage();

  const mermaidReady = await waitForEval(
    pageTarget,
    `${SHADOW_PIERCE}; __deepQuery('[data-testid="mermaid-diagram"]') !== null`
  );
  if (!mermaidReady) {
    fail(
      'Mermaid diagram not rendered in conversation message list (waited 45s). ' +
        'Ensure dream-ui dev is running and backend reachable via window.__backendPort.'
    );
  }

  const mermaidZoom = await cdpEval(
    pageTarget,
    `${SHADOW_PIERCE}; (function () {
      var btn = __deepQuery('[data-testid="mermaid-zoom-in"]');
      if (!btn) return { ok: false, reason: 'missing zoom-in control' };
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var diagram = __deepQuery('[data-testid="mermaid-diagram"]');
      var inner = diagram.querySelector('div[style*="transform"]') || diagram.firstElementChild;
      var transform = (inner && inner.style && inner.style.transform) || '';
      return { ok: transform.indexOf('scale') >= 0 || transform.indexOf('matrix') >= 0, transform: transform };
    })()`
  );
  if (!mermaidZoom?.ok) fail(`Mermaid zoom-in did not change transform: ${JSON.stringify(mermaidZoom)}`);
  pass('Mermaid pan/zoom in conversation UI');

  const wavedromReady = await waitForEval(
    pageTarget,
    `${SHADOW_PIERCE}; __deepQuery('[data-testid="wavedrom-diagram"]') !== null`
  );
  if (!wavedromReady) fail('WaveDrom diagram not rendered in conversation (waited 45s)');

  const wavedromZoom = await cdpEval(
    pageTarget,
    `${SHADOW_PIERCE}; (function () {
      var btn = __deepQuery('[data-testid="wavedrom-zoom-in"]');
      if (!btn) return { ok: false, reason: 'missing zoom-in control' };
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var diagram = __deepQuery('[data-testid="wavedrom-diagram"]');
      var inner = diagram.querySelector('div[style*="transform"]') || diagram.firstElementChild;
      var transform = (inner && inner.style && inner.style.transform) || '';
      return { ok: transform.indexOf('scale') >= 0 || transform.indexOf('matrix') >= 0, transform: transform };
    })()`
  );
  if (!wavedromZoom?.ok) fail(`WaveDrom zoom-in did not change transform: ${JSON.stringify(wavedromZoom)}`);
  pass('WaveDrom pan/zoom in conversation UI');
}

async function enterpriseHttpSmoke() {
  if (!BACKEND) {
    console.log('[dev-cdp-acceptance] SKIP: enterprise HTTP (set DREAM_BACKEND_URL to enable)');
    return;
  }
  const headers = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
  const providers = await fetch(`${BACKEND}/api/one/sso/providers`, { headers });
  if (providers.status === 404) {
    const body = await providers.json().catch(() => ({}));
    if (body?.code === 'NOT_FOUND') {
      fail('Enterprise routes missing — rebuild dreamcore with --features enterprise');
    }
  }
  if (providers.ok) pass('Enterprise backend reachable (/api/one/sso/providers)');

  if (!ADMIN_TOKEN) {
    console.log('[dev-cdp-acceptance] SKIP: integration sync probe (set DREAM_ADMIN_TOKEN)');
    return;
  }
  const sync = await fetch(`${BACKEND}/api/one/admin/integrations/github/sync`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!sync.ok) {
    console.log(`[dev-cdp-acceptance] WARN: github sync HTTP ${sync.status} (connector may be unset)`);
  } else {
    const payload = await sync.json();
    pass(`Integration sync endpoint (${payload?.data?.status ?? 'ok'})`);
  }

  const relay = await fetch(`${BACKEND}/api/one/admin/platform/collaboration/relay`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: 'mention' }),
  });
  if (relay.ok) {
    const payload = await relay.json();
    pass(`Collaboration relay endpoint (${payload?.data?.status ?? 'ok'})`);
  } else {
    console.log(`[dev-cdp-acceptance] WARN: collaboration relay HTTP ${relay.status}`);
  }
}

async function main() {
  const version = await fetch(`${base}/json/version`).catch(() => null);
  if (!version?.ok) fail(`CDP port ${CDP_PORT} not reachable — start dream-ui with DREAM_DEVTOOLS_CDP_PORT`);
  pass(`CDP listening on ${CDP_PORT}`);

  const conversationId = seedDiagramConversationId();
  if (!conversationId) {
    fail(
      '无法准备助理侧 diagram 消息：本机缺少 dream-ui-Dev 的 one-backend.db，或请设置 DREAM_CDP_CONVERSATION_ID 指向已含左侧 Mermaid/WaveDrom 的会话'
    );
  }

  const target = await pickMainPage();
  pass(`Using page target ${target.url.slice(0, 80)}`);

  await diagramPanZoomCheck(target, conversationId);
  await enterpriseHttpSmoke();

  console.log('[dev-cdp-acceptance] All required checks passed.');
}

main().catch((err) => fail(err.message || String(err)));
