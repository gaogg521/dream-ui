/**
 * Round 2, step 2: on-page user interactions, mouse-driven:
 * tabs, modal cancel paths (X/取消/ESC/mask), selects, theme & language
 * switch, batch invite, targeted notification validation, company danger
 * zone dialog, file quota modal, SMTP onboarding validation, audit filters.
 */
import { connect, collect, visit, saveJson, shotDir } from './harness.mjs';
import { resolve } from 'node:path';

const { browser, page } = await connect();
const state = collect(page);
const results = [];
const log = (step, data) => {
  results.push({ step, ...data });
  console.log(`· ${step}: ${JSON.stringify(data)}`);
};
const shot = (n) => page.screenshot({ path: resolve(shotDir(), n + '.png') });
const popOk = async () => {
  const p = page.locator('.arco-trigger.arco-popconfirm button:has-text("确定")').last();
  if (await p.count()) {
    await p.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
};
const toast = async () =>
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim());
    return t.length ? t[t.length - 1] : '';
  });
const modalOpen = () =>
  page.evaluate(() => [...document.querySelectorAll('.arco-modal')].some((x) => x.offsetParent !== null));

// ============ 1. tabs across pages ============
for (const [name, url, tabs] of [
  ['资源注册表', '/resource-registry', ['工具 (MCP)', '知识库', '数字员工', '员工目录', '技能']],
  ['内容检查', '/content-inspection', ['命中记录 (0)']],
  ['站内消息', '/notifications', ['发送历史', '收件箱']],
]) {
  try {
    await visit(page, state, url, { settleMs: 1600 });
    const found = [];
    for (const t of tabs) {
      const tab = page.locator(`.arco-tabs-tab:has-text("${t}"), [role=tab]:has-text("${t}")`).first();
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(900);
        found.push({ tab: t, ok: true });
      } else found.push({ tab: t, ok: false });
    }
    // back to first tab
    const first = page.locator('.arco-tabs-tab, [role=tab]').first();
    if (await first.count()) await first.click();
    log(`tabs-${name}`, found);
  } catch (e) {
    log(`tabs-${name}`, { err: String(e).slice(0, 120) });
  }
}

// ============ 2. modal cancel paths (scenes) ============
try {
  await visit(page, state, '/scenes', { settleMs: 1600 });
  const open = async () => {
    await page.locator('button:has-text("新建场景")').first().click();
    await page.waitForTimeout(700);
  };
  // a) X button
  await open();
  await page
    .locator('.arco-modal:visible .arco-modal-close-btn, .arco-modal:visible [class*=close]')
    .first()
    .click()
    .catch(async () => {
      await page.locator('.arco-modal:visible .arco-btn:has-text("取消")').click();
    });
  await page.waitForTimeout(600);
  log('modal-close-x', { closed: !(await modalOpen()) });
  // b) ESC
  await open();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  log('modal-close-esc', { closed: !(await modalOpen()) });
  // c) mask click
  await open();
  await page.mouse.click(30, 500);
  await page.waitForTimeout(600);
  log('modal-close-mask', { closed: !(await modalOpen()) });
  // d) 取消
  await open();
  await page.locator('.arco-modal:visible .arco-btn:has-text("取消")').first().click();
  await page.waitForTimeout(600);
  log('modal-close-cancel', { closed: !(await modalOpen()) });
  await shot('91-modal-paths');
} catch (e) {
  log('modal-paths', { err: String(e).slice(0, 150) });
}

// ============ 3. reports: time range select ============
try {
  await visit(page, state, '/reports/overview', { settleMs: 1800 });
  const sel = page.locator('.arco-select').first();
  await sel.click();
  await page.waitForTimeout(500);
  const opt = page
    .locator('.arco-select-option:has-text("近 7 天"), .arco-select-popup li:has-text("近 7 天")')
    .first();
  await opt.click();
  await page.waitForTimeout(1500);
  log('report-range-change', { toast: await toast() });
  await shot('92-report-7d');
} catch (e) {
  log('report-range', { err: String(e).slice(0, 150) });
}

// ============ 4. theme toggle ============
try {
  await visit(page, state, '/', { settleMs: 1500 });
  const before = await page.evaluate(() => document.body.getAttribute('arco-theme') ?? 'light');
  await page.locator('header button, [class*=header] button').first().click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.body.getAttribute('arco-theme') ?? 'light');
  log('theme-toggle', { before, after });
  await shot('93-theme-dark');
  await page.locator('header button, [class*=header] button').first().click();
  await page.waitForTimeout(700);
  log('theme-restore', { now: await page.evaluate(() => document.body.getAttribute('arco-theme') ?? 'light') });
} catch (e) {
  log('theme', { err: String(e).slice(0, 150) });
}

// ============ 5. language switch + raw key scan ============
try {
  await visit(page, state, '/users', { settleMs: 1600 });
  await page.locator('button:has-text("简体中文")').first().click();
  await page.waitForTimeout(700);
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('.arco-dropdown-option, .arco-select-popup li, [class*=lang] li')]
      .map((n) => n.innerText.trim())
      .filter(Boolean)
  );
  log('lang-options', { opts: opts.slice(0, 15) });
  const en = page.locator('.arco-dropdown-option:has-text("English"), li:has-text("English")').first();
  if (await en.count()) {
    await en.click();
    await page.waitForTimeout(1800);
    const rawKeys = await page.evaluate(() =>
      (document.body.innerText.match(/\bcommon\.[a-zA-Z0-9.]+/g) ?? []).slice(0, 10)
    );
    const sample = await page.evaluate(() => ({
      nav: document.querySelector('div.arco-menu-item')?.innerText?.trim(),
      btn: [...document.querySelectorAll('main button')]
        .map((b) => b.innerText.trim())
        .filter(Boolean)
        .slice(0, 6),
    }));
    log('lang-en', { rawKeys, sample });
    await shot('94-lang-en');
    // switch back
    const zhBtn = page.locator('button:has-text("English"), button:has-text("中文")').first();
    await zhBtn.click();
    await page.waitForTimeout(600);
    const zh = page.locator('.arco-dropdown-option:has-text("简体中文"), li:has-text("简体中文")').first();
    if (await zh.count()) await zh.click();
    await page.waitForTimeout(1200);
    log('lang-restore', {
      nav: await page.evaluate(() => document.querySelector('div.arco-menu-item')?.innerText?.trim()),
    });
  } else log('lang-options', { note: 'English 选项未找到' });
} catch (e) {
  log('lang', { err: String(e).slice(0, 150) });
}

// ============ 6. model channel edit → pull models (invalid upstream) ============
try {
  await visit(page, state, '/model-channels', { settleMs: 1600 });
  await page.locator('button:has-text("新增渠道")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.arco-modal:visible input').nth(0).fill('拉取测试渠道');
  await page.locator('.arco-modal:visible input').nth(2).fill('https://eval.invalid.test/v1');
  await page.locator('.arco-modal:visible input[type=password]').first().fill('sk-dummy');
  await page.locator('.arco-modal:visible button:has-text("从上游拉取模型")').first().click();
  await page.waitForTimeout(2500);
  log('pull-models-invalid', { toast: await toast() });
  await shot('95-pull-models');
  // cancel the modal without saving
  await page.locator('.arco-modal:visible .arco-btn:has-text("取消")').first().click();
  await page.waitForTimeout(600);
  log('pull-cancel', { modalClosed: !(await modalOpen()) });
} catch (e) {
  log('pull-models', { err: String(e).slice(0, 150) });
}

// ============ 7. invite bulk generate + revoke all ============
try {
  await visit(page, state, '/invites', { settleMs: 1600 });
  await page.locator('button:has-text("批量生成")').first().click();
  await page.waitForTimeout(700);
  const num = page.locator('.arco-modal:visible .arco-input-number input, .arco-modal:visible input').first();
  await num.fill('3');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1300);
  log('invite-bulk', { toast: await toast() });
  await shot('96-invite-bulk');
  // revoke every 作废 button until none left
  let revoked = 0;
  for (let i = 0; i < 8; i++) {
    const btns = page.locator('button:has-text("作废")');
    if (!(await btns.count())) break;
    await btns.first().click();
    await page.waitForTimeout(500);
    await popOk();
    revoked++;
  }
  log('invite-bulk-cleanup', { revoked });
} catch (e) {
  log('invite-bulk', { err: String(e).slice(0, 150) });
}

// ============ 8. targeted notification validation ============
try {
  await visit(page, state, '/notifications', { settleMs: 1600 });
  await page.locator('button:has-text("发送消息")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.arco-radio:has-text("定向通知")').first().click();
  await page.waitForTimeout(500);
  const modalTxt = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 200) : '';
  });
  await page
    .locator('.arco-modal:visible button:has-text("发送"), .arco-modal:visible .arco-btn-primary:visible')
    .last()
    .click();
  await page.waitForTimeout(1000);
  log('ntf-targeted-empty', { modalTxt, toast: await toast() });
  await page.keyboard.press('Escape');
  await page
    .locator('.arco-modal:visible .arco-btn:has-text("取消")')
    .last()
    .click()
    .catch(() => {});
} catch (e) {
  log('ntf-targeted', { err: String(e).slice(0, 150) });
}

// ============ 9. company: edit cancel + danger zone dialog ============
try {
  await visit(page, state, '/company', { settleMs: 1600 });
  await page.locator('button:has-text("编辑")').first().click();
  await page.waitForTimeout(700);
  log('company-edit-modal', { open: await modalOpen() });
  await page.locator('.arco-modal:visible .arco-btn:has-text("取消")').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("解散企业")').first().click();
  await page.waitForTimeout(800);
  const dangerTxt = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(no modal)';
  });
  log('company-danger-dialog', { text: dangerTxt });
  await shot('97-company-danger');
  // cancel — never confirm
  await page
    .locator('.arco-modal:visible .arco-btn:has-text("取消")')
    .last()
    .click()
    .catch(async () => {
      await page.keyboard.press('Escape');
    });
  await page.waitForTimeout(500);
  log('company-danger-cancel', { closed: !(await modalOpen()) });
} catch (e) {
  log('company', { err: String(e).slice(0, 150) });
}

// ============ 10. file vault: quota modal ============
try {
  await visit(page, state, '/file-vault', { settleMs: 1600 });
  await page.locator('button:has-text("设置配额")').first().click();
  await page.waitForTimeout(700);
  const inp = page.locator('.arco-modal:visible input').first();
  await inp.fill('100');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1200);
  log('fv-quota-set', {
    toast: await toast(),
    shown: await page.evaluate(() => /100 (MB|KB|B)/.test(document.body.innerText)),
  });
  await shot('98-fv-quota');
  // restore unlimited
  await page.locator('button:has-text("设置配额")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.arco-modal:visible input').first().fill('');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1200);
  log('fv-quota-reset', {
    toast: await toast(),
    unlimited: await page.evaluate(() => document.body.innerText.includes('不限')),
  });
} catch (e) {
  log('fv-quota', { err: String(e).slice(0, 150) });
}

// ============ 11. onboarding SMTP: enable with empty fields ============
try {
  await visit(page, state, '/invites/onboarding', { settleMs: 1600 });
  const card = page.locator('.arco-card:has-text("邀请邮件"), div:has-text("SMTP")').first();
  const enableSwitch = page
    .locator('.arco-card:has-text("邀请邮件") .arco-switch, [class*=card]:has-text("SMTP") .arco-switch')
    .last();
  const sw = enableSwitch.count() ? enableSwitch : page.locator('.arco-switch').nth(1);
  await sw.click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("保存")').last().click();
  await page.waitForTimeout(1000);
  log('smtp-empty-save', { toast: await toast() });
  await shot('99-smtp-validation');
  // restore
  await sw.click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("保存")').last().click();
  await page.waitForTimeout(900);
  log('smtp-restore', { toast: await toast() });
} catch (e) {
  log('smtp', { err: String(e).slice(0, 150) });
}

// ============ 12. audit filters ============
try {
  await visit(page, state, '/audit', { settleMs: 1600 });
  await page.locator('button:has-text("查询"), button:has-text("刷新")').first().click();
  await page.waitForTimeout(1500);
  const rows = await page.evaluate(() => document.querySelectorAll('.arco-table-tr').length);
  log('audit-query', { rows });
  await shot('100-audit-data');
} catch (e) {
  log('audit', { err: String(e).slice(0, 150) });
}

await saveJson('11-interactions-results.json', results);
console.log('DONE');
process.exit(0);
