import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const out = path.join('D:/dream/scratchpad/ent-eval-0912', 'client-e2e');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().includes('5173')) ?? context.pages()[0];

const result = { url: page.url(), title: await page.title(), steps: [] };
const shot = async (name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const text = (await page.locator('body').innerText()).slice(0, 2000);
  result.steps.push({ name, url: page.url(), file, text });
  return text;
};

const text = await shot('01-start');
console.log(JSON.stringify({ url: page.url(), title: await page.title(), preview: text.slice(0, 800) }, null, 2));
fs.writeFileSync(path.join(out, 'inspect.json'), JSON.stringify(result, null, 2));
