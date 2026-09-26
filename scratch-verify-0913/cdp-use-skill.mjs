import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const page = browser.contexts()[0].pages()[0];

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

const originalUrl = page.url();
console.log('starting url:', originalUrl);

// Navigate in-app via hash routing so React Router picks it up.
await page.evaluate(() => {
  window.location.hash = '#/settings/skills';
});
await page.waitForTimeout(1200);
console.log('now at:', page.url());

await page.waitForTimeout(800);
const useBtn = page.getByText('使用此技能', { exact: true }).first();
const count = await useBtn.count();
console.log('use-skill buttons found:', count);
if (count > 0) {
  console.log('clicking first 使用此技能');
  await useBtn.click();
  await page.waitForTimeout(600);

  const toast = page.locator('.arco-message-success, [class*="message-success"]');
  const toastCount = await toast.count();
  console.log('success toast visible:', toastCount > 0);
  if (toastCount > 0) {
    console.log('toast text:', await toast.first().innerText());
  }

  await page.waitForTimeout(800);
  console.log('final url:', page.url());
}

console.log('--- console/page errors ---');
for (const l of logs) console.log(l);
console.log('--- end ---');

await browser.close();
