import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const contexts = browser.contexts();
console.log(`contexts: ${contexts.length}`);
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    const url = page.url();
    const title = await page.title().catch(() => '(no title)');
    console.log(`page: ${url} | title=${title}`);
  }
}
await browser.close();
