import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const out = path.join('D:/dream/scratchpad/ent-eval-0912', 'client-e2e');
fs.mkdirSync(out, { recursive: true });

const INVITE = '3602CDDAAE645BE5';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230', { timeout: 10000 });
const page =
  browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('5173')) ?? browser.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);

const report = { steps: [] };
const step = (name, data) => {
  report.steps.push({ name, ...data });
  console.log(`STEP ${name}: ${JSON.stringify(data).slice(0, 500)}`);
};

const probe = async (base, token) => {
  const paths = [
    '/api/one/org/context',
    '/api/one/platform/my-security-policy',
    '/api/one/billing/plan',
    '/api/one/devops/skills',
  ];
  const outp = {};
  for (const p of paths) {
    try {
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const t = await r.text();
      outp[p] = { status: r.status, body: t.slice(0, 400) };
    } catch (e) {
      outp[p] = { error: String(e) };
    }
  }
  return outp;
};

const session = await page.evaluate(() => JSON.parse(localStorage.getItem('one-enterprise:session') || 'null'));
const serverUrl = await page.evaluate(() => localStorage.getItem('one-enterprise:server-url'));
step('session', { serverUrl, user: session?.username, userId: session?.userId });

const [viaAdminUi, viaApi] = await Promise.all([
  probe('http://127.0.0.1:25810', session.token),
  probe('http://127.0.0.1:25808', session.token),
]);
step('probe-25810', viaAdminUi);
step('probe-25808', viaApi);

await page.evaluate(() => {
  location.hash = '#/settings/enterprise-identity';
});
await page.waitForTimeout(800);

const addr = page.getByPlaceholder(/完整地址|含端口/).first();
if (await addr.count()) {
  await addr.fill('http://127.0.0.1:25808');
  const save = page.getByRole('button', { name: '保存地址' });
  if (await save.count()) await save.click();
  await page.waitForTimeout(500);
}

step('after-url', {
  url: await page.evaluate(() => localStorage.getItem('one-enterprise:server-url')),
  text: (await page.locator('body').innerText()).slice(0, 900),
});

await page.evaluate(() => {
  location.hash = '#/settings/enterprise';
});
await page.waitForTimeout(1000);
const joinText = (await page.locator('body').innerText()).slice(0, 1200);
step('enterprise-page', { text: joinText, href: page.url() });

const input = page.getByPlaceholder('邀请码');
if (await input.count()) {
  await input.fill(INVITE);
  const btn = page.getByRole('button', { name: /加入/ });
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(1500);
  }
}
step('after-join', { text: (await page.locator('body').innerText()).slice(0, 900) });

const localProbe = await page.evaluate(async () => {
  const paths = ['/api/tool-security/policy', '/api/one/org/context'];
  const r = {};
  for (const p of paths) {
    try {
      const res = await fetch(p);
      r[p] = { status: res.status, body: (await res.text()).slice(0, 500) };
    } catch (e) {
      r[p] = { error: String(e) };
    }
  }
  return r;
});
step('local-backend-via-renderer', localProbe);

fs.writeFileSync(path.join(out, 'join-report.json'), JSON.stringify(report, null, 2));
console.log('WROTE', path.join(out, 'join-report.json'));
