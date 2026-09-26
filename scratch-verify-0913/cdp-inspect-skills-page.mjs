import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const page = browser.contexts()[0].pages()[0];
await page.waitForTimeout(500);

const grid = await page.locator('[data-testid="skill-card-grid"]').count();
console.log('skill-card-grid present:', grid);

const cardsAny = await page.locator('[data-testid^="skill-card-"]').count();
console.log('skill-card-* elements:', cardsAny);

const body = await page.locator('body').innerText();
console.log('--- body text (first 1500 chars) ---');
console.log(body.slice(0, 1500));

await browser.close();
