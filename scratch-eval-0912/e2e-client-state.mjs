import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const out = path.join('D:/dream/scratchpad/ent-eval-0912', 'client-e2e');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().includes('5173')) ?? context.pages()[0];
page.setDefaultTimeout(15000);

const log = [];
const rec = async (name, extra = {}) => {
  const text = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).slice(0, 1500);
  const row = { name, url: page.url(), text, ...extra };
  log.push(row);
  console.log(`\n=== ${name} ===\n${page.url()}\n${text.slice(0, 500)}\n`);
  return row;
};

await rec('start');

const state = await page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const pick = {};
  for (const k of keys) {
    if (/enterprise|org|server|deployment|remote/i.test(k)) {
      pick[k] = localStorage.getItem(k)?.slice(0, 400);
    }
  }
  return { href: location.href, keys, pick };
});
log.push({ name: 'storage', state });
console.log(JSON.stringify(state, null, 2));

await page.evaluate(() => {
  location.hash = '#/settings/enterprise-identity';
});
await page.waitForTimeout(1200);
await rec('enterprise-identity');

fs.writeFileSync(path.join(out, 'client-state.json'), JSON.stringify({ log, state }, null, 2));
