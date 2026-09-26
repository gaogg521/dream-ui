import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const page = browser.contexts()[0].pages()[0];

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

// Read-only: does not click/type. Just confirm the page is alive and enterprise-connected.
const isEnterprise = await page.evaluate(() => {
  try {
    return (
      localStorage.getItem('one_enterprise_resources_materialized') ||
      localStorage.getItem('__one_enterprise_mode') ||
      'unknown-keys'
    );
  } catch {
    return 'error';
  }
});
console.log('enterprise marker probe:', isEnterprise);

await new Promise((r) => setTimeout(r, 1500));
console.log('--- console/page errors captured in last 1.5s ---');
for (const l of logs) console.log(l);
console.log('--- end ---');

await browser.close();
