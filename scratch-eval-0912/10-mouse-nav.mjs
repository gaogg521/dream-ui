/**
 * Round 2, step 1: PURE MOUSE navigation — no page.goto for page switching.
 * Click every sidebar menu item, every home quick-start card, and the
 * onboarding checklist; verify landing URL + render + errors each time.
 */
import { connect, collect, saveJson, shotDir, ADMIN } from './harness.mjs';
import { resolve } from 'node:path';

const { browser, page } = await connect();
const state = collect(page);
const results = [];
const log = (step, data) => {
  results.push({ step, ...data });
  console.log(`· ${step}: ${JSON.stringify(data)}`);
};
const shot = (n) => page.screenshot({ path: resolve(shotDir(), n + '.png') });

// land on home first (single goto allowed as the entry point)
await page.goto(`${ADMIN}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// ---------- 1. enumerate sidebar menu ----------
const menuDump = await page.evaluate(() => {
  const menu = document.querySelector('.arco-menu, aside nav, aside');
  if (!menu) return null;
  return [...menu.querySelectorAll('li, .arco-menu-item, .arco-menu-group-title')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ tag: el.tagName, cls: el.className.slice(0, 60), text: el.innerText.trim().slice(0, 20) }));
});
log('menu-dump-count', { items: menuDump?.length ?? 0 });
const itemTexts = [
  ...new Set((menuDump ?? []).map((m) => m.text).filter((t) => t && t.length <= 12 && !['首页'].includes(t))),
];
log('menu-items', { texts: itemTexts });

// ---------- 2. click every menu item ----------
const navResults = [];
for (const text of itemTexts) {
  const before = page.url();
  state.reset();
  const item = page.locator(`div.arco-menu-item:has-text("${text}")`).first();
  try {
    await item.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    try {
      await page.waitForLoadState('networkidle', { timeout: 4000 });
    } catch {
      /* polling */
    }
    const url = page.url();
    const info = await page.evaluate(() => ({
      textLen: (document.querySelector('main') ?? document.body).innerText.length,
      spinning: [...document.querySelectorAll('.arco-spin-icon')].some(
        (n) => n.closest('.arco-spin-loading') && n.offsetParent !== null
      ),
    }));
    const issues = [];
    if (url === before) issues.push('URL未变化');
    if (info.textLen < 80) issues.push(`内容过少(${info.textLen})`);
    if (info.spinning) issues.push('加载中');
    if (state.bad.length) issues.push(`HTTP:${state.bad.join(';')}`);
    if (state.pageErrors.length) issues.push(`pageerror:${state.pageErrors.length}`);
    if (state.console.filter((c) => !c.includes('element.ref')).length) issues.push(`console:${state.console.length}`);
    navResults.push({ text, from: before.replace(ADMIN, ''), to: url.replace(ADMIN, ''), issues });
    console.log(`${issues.length ? '⚠' : '✓'} ${text} → ${url.replace(ADMIN, '')} ${issues.join(' | ')}`);
  } catch (e) {
    navResults.push({ text, error: String(e).slice(0, 120) });
    console.log(`✗ ${text} 点击失败: ${String(e).slice(0, 100)}`);
  }
}
log('nav-summary', {
  count: navResults.length,
  problems: navResults.filter((r) => r.issues?.length || r.error).length,
});

// ---------- 3. home quick-start cards ----------
await page.locator('div.arco-menu-item:has-text("首页")').first().click();
await page.waitForTimeout(1500);
const cards = await page.evaluate(() =>
  [...document.querySelectorAll('main a, main [role=button], main .cursor-pointer')]
    .map((c) => c.innerText.trim().slice(0, 15))
    .filter((t) => t && t.length > 1)
);
log('home-clickables', { cards: [...new Set(cards)].slice(0, 25) });
for (const label of ['邀请成员', '配置模型渠道', '设置安全策略', '激活 License', '资源授权', '审计日志']) {
  state.reset();
  const before = page.url();
  const card = page.locator(`main :has-text("${label}")`).last();
  try {
    await card.click({ timeout: 4000 });
    await page.waitForTimeout(1200);
    const to = page.url();
    navResults.push({
      quickCard: label,
      from: before.replace(ADMIN, ''),
      to: to.replace(ADMIN, ''),
      moved: to !== before,
    });
    console.log(
      `${to !== before ? '✓' : '⚠'} 快捷卡「${label}」 ${before.replace(ADMIN, '')} → ${to.replace(ADMIN, '')}`
    );
    await page.locator('div.arco-menu-item:has-text("首页")').first().click();
    await page.waitForTimeout(1000);
  } catch (e) {
    navResults.push({ quickCard: label, error: String(e).slice(0, 100) });
    console.log(`✗ 快捷卡「${label}」 ${String(e).slice(0, 80)}`);
  }
}

// ---------- 4. onboarding checklist items ----------
const checklist = await page.evaluate(() =>
  [...document.querySelectorAll('main [class*=step], main li, main [role=listitem]')]
    .map((n) => n.innerText.trim().slice(0, 20))
    .filter(
      (t) =>
        t &&
        (t.includes('邀请') ||
          t.includes('模型') ||
          t.includes('License') ||
          t.includes('市场') ||
          t.includes('SSO') ||
          t.includes('企业'))
    )
);
log('onboarding-items', { items: [...new Set(checklist)].slice(0, 10) });
await shot('90-round2-home');

await saveJson('10-nav-results.json', navResults);
console.log('DONE');
process.exit(0);
