/**
 * Step 1: first-boot login with the generated admin password, forced password
 * change, re-login, and a sanity check that the console home renders.
 * Credentials persist to creds.json for later steps.
 */
import { connect, collect, visit, report, saveJson, shotDir, ADMIN } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = 'D:/dream/scratchpad/ent-eval-0912/ent-data';
const txt = readFileSync(resolve(DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt'), 'utf8');
const password = txt.match(/Password: (.+)/)[1].trim();
const NEW_PASSWORD = 'Eval#2026-OneWork';

const { browser, page } = await connect();
const state = collect(page);
const results = [];

// --- login with initial password
await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(shotDir(), '00-login.png') });
await page.fill('input[type="text"], input:not([type="password"])', 'admin');
await page.fill('input[type="password"]', password);
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);
const urlAfterLogin = page.url();
results.push({ step: 'login-initial', url: urlAfterLogin });

// --- forced password change (if redirected there)
if (urlAfterLogin.includes('change-password')) {
  await page.fill('input[type="password"]', NEW_PASSWORD, { timeout: 5000 }).catch(() => {});
  // three fields: current, new, confirm — fill by order
  const pwInputs = page.locator('input[type="password"]');
  const n = await pwInputs.count();
  for (let i = 0; i < n; i++) await pwInputs.nth(i).fill(i === 0 ? password : NEW_PASSWORD);
  await page.screenshot({ path: resolve(shotDir(), '01-change-password.png') });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  results.push({ step: 'change-password', url: page.url(), pwFields: n });
  // after change we may be logged out — re-login with new password
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.fill('input[type="text"], input:not([type="password"])', 'admin');
  await page.fill('input[type="password"]', NEW_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  results.push({ step: 'relogin-new', url: page.url() });
}

const home = await visit(page, state, '/', { shot: '02-home.png' });
results.push(report('home', '/', home, state));
await saveJson('01-login-results.json', results);
console.log(JSON.stringify(results, null, 1));
writeFileSync(
  resolve(import.meta.dirname, 'creds.json'),
  JSON.stringify({ username: 'admin', password: NEW_PASSWORD })
);
// keep the browser alive for later scripts — just drop the CDP connection
