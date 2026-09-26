import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const out = path.join('D:/dream/scratchpad/ent-eval-0912', 'client-e2e');
fs.mkdirSync(out, { recursive: true });
const INVITE = '3602CDDAAE645BE5';
const pass = process.env.ADMIN_PASS;
if (!pass) throw new Error('ADMIN_PASS missing');

const report = { steps: [] };
const step = (name, data) => {
  report.steps.push({ name, ...data });
  console.log(`STEP ${name}: ${JSON.stringify(data).slice(0, 700)}`);
};

const loginRes = await fetch('http://127.0.0.1:25808/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: pass }),
});
const loginJson = await loginRes.json();
step('login', {
  status: loginRes.status,
  keys: Object.keys(loginJson),
  mfa: loginJson.mfa_required,
  dataKeys: loginJson.data ? Object.keys(loginJson.data) : null,
});
if (!loginRes.ok || loginJson.mfa_required) {
  fs.writeFileSync(path.join(out, 'login-join.json'), JSON.stringify(report, null, 2));
  process.exit(1);
}
const token = loginJson.data?.token || loginJson.token;
const user = loginJson.data?.user || loginJson.user || {};
const userId = user.id || user.userId;
const username = user.username || 'admin';

const ctx = await fetch('http://127.0.0.1:25808/api/one/org/context', {
  headers: { Authorization: `Bearer ${token}` },
});
step('org-context', { status: ctx.status, body: (await ctx.text()).slice(0, 500) });

const pol = await fetch('http://127.0.0.1:25808/api/one/platform/my-security-policy', {
  headers: { Authorization: `Bearer ${token}` },
});
step('security-policy', { status: pol.status, body: (await pol.text()).slice(0, 700) });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230', { timeout: 10000 });
const page =
  browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('5173')) ?? browser.contexts()[0].pages()[0];
page.setDefaultTimeout(10000);

await page.evaluate(
  ({ token, userId, username }) => {
    localStorage.setItem('one-enterprise:server-url', 'http://127.0.0.1:25808');
    localStorage.setItem('one-enterprise:enabled', 'true');
    localStorage.setItem('one-enterprise:session', JSON.stringify({ token, userId, username, name: username }));
    location.hash = '#/settings/enterprise';
    location.reload();
  },
  { token, userId, username }
);

await page.waitForTimeout(2500);
step('after-inject', { href: page.url(), text: (await page.locator('body').innerText()).slice(0, 1000) });

const joinInput = page.getByPlaceholder('邀请码');
if ((await joinInput.count()) && (await joinInput.isEnabled())) {
  await joinInput.fill(INVITE);
  await page.getByRole('button', { name: '加入' }).click();
  await page.waitForTimeout(1500);
  step('after-join-click', { text: (await page.locator('body').innerText()).slice(0, 800) });
} else {
  step('join-skipped', {
    enabled: (await joinInput.count()) ? await joinInput.isEnabled() : false,
    text: (await page.locator('body').innerText()).slice(0, 800),
  });
}

const local = await page.evaluate(async () => {
  const out = {};
  for (const p of ['/api/tool-security/policy', '/api/one/org/context']) {
    try {
      const r = await fetch(p);
      out[p] = { status: r.status, body: (await r.text()).slice(0, 500) };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return out;
});
step('local-via-renderer', local);

fs.writeFileSync(path.join(out, 'login-join.json'), JSON.stringify(report, null, 2));
console.log('DONE');
