/**
 * Shared CDP harness for the 2026-09-12 admin console functional evaluation.
 * Connects over CDP to a Chrome instance already listening on :9232 and
 * exposes one collected Page object: console errors, page errors, >=400
 * responses, arco toasts, and screenshots land in ./shots/.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const CDP = process.env.EVAL_CDP ?? 'http://127.0.0.1:9232';
export const ADMIN = process.env.EVAL_ADMIN ?? 'http://localhost:25810/admin';

export function shotDir() {
  const d = resolve(ROOT, 'shots');
  mkdirSync(d, { recursive: true });
  return d;
}

export async function connect() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { browser, ctx, page };
}

/** Attach listeners; returns a resettable collector. */
export function collect(page) {
  const state = { console: [], pageErrors: [], bad: [], toasts: new Set() };
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  page.on('console', (m) => {
    if (m.type() === 'error') state.console.push(m.text().slice(0, 500));
  });
  page.on('pageerror', (e) => state.pageErrors.push(String(e).slice(0, 500)));
  page.on('response', (r) => {
    if (r.status() >= 400) state.bad.push(`${r.request().method()} ${r.url()} -> ${r.status()}`);
  });
  state.reset = () => {
    state.console.length = 0;
    state.pageErrors.length = 0;
    state.bad.length = 0;
    state.toasts.clear();
  };
  return state;
}

/** Drain arco toast/notification text into the collector, then clear. */
export async function drainToasts(page, state) {
  const texts = await page.evaluate(() => {
    const sel = '.arco-message, .arco-notification, .arco-message-list .arco-message';
    return [...document.querySelectorAll(sel)].map((n) => n.innerText.trim()).filter(Boolean);
  });
  for (const t of texts) state.toasts.add(t);
}

/** Visit one route, wait for it to settle, capture everything. */
export async function visit(page, state, path, { shot, settleMs = 1800 } = {}) {
  state.reset();
  await page.goto(`${ADMIN}${path}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 6000 });
  } catch {
    /* long-polling pages never go idle; the settle wait below still applies */
  }
  await page.waitForTimeout(settleMs);
  await drainToasts(page, state);
  const info = await page.evaluate(() => {
    const spins = [...document.querySelectorAll('.arco-spin-icon')].filter(
      (n) => n.offsetParent !== null && n.closest('.arco-spin-loading')
    );
    const main = document.querySelector('main') ?? document.body;
    return {
      title: document.title,
      textLen: main.innerText.length,
      textHead: main.innerText.replace(/\s+/g, ' ').slice(0, 600),
      spinning: spins.length > 0,
      tables: document.querySelectorAll('.arco-table-tr').length,
    };
  });
  if (shot) {
    await page.screenshot({ path: resolve(shotDir(), shot), fullPage: false });
  }
  return info;
}

export function report(label, path, info, state) {
  const row = {
    label,
    path,
    ...info,
    toasts: [...state.toasts],
    bad: [...state.bad],
    console: [...state.console],
    pageErrors: [...state.pageErrors],
  };
  return row;
}

export async function saveJson(name, data) {
  const p = resolve(ROOT, name);
  writeFileSync(p, JSON.stringify(data, null, 1));
  return p;
}
