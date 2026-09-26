/**
 * Step 5: security & approval CRUD — policy preset apply+restore, runtime
 * approval switch toggle, DLP rule lifecycle, full approval request cycle,
 * media ledger retention toggle. Everything restored to initial state.
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
  (await page.evaluate(() => [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim()))).pop() ??
  '';

// ============ 1. security policy: 标准 preset -> save -> restore 宽松 ============
try {
  await visit(page, state, '/security-policy', { settleMs: 1800 });
  const before = await page.evaluate(() => document.body.innerText.match(/当前: ([^·]+)/)?.[1]?.trim() ?? '?');
  log('sp-before', { tier: before });
  await page.locator('button:has-text("标准"), .arco-radio:has-text("标准")').first().click();
  await page.waitForTimeout(600);
  await shot('60-sp-standard-selected');
  const saveBtn = page.locator('button:has-text("保存")').first();
  await saveBtn.click();
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => document.body.innerText.match(/当前: ([^·]+)/)?.[1]?.trim() ?? '?');
  log('sp-save', { tierAfter: after, toast: await toast() });
  await shot('61-sp-standard-saved');
  // restore
  await page.locator('button:has-text("宽松"), .arco-radio:has-text("宽松")').first().click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("保存")').first().click();
  await page.waitForTimeout(1000);
  const restored = await page.evaluate(() => document.body.innerText.match(/当前: ([^·]+)/)?.[1]?.trim() ?? '?');
  log('sp-restore', { tierRestored: restored, toast: await toast() });
} catch (e) {
  log('sp-fatal', { err: String(e).slice(0, 220) });
}

// ============ 2. runtime: 接入审批 switch on -> off ============
try {
  await visit(page, state, '/runtime', { settleMs: 1500 });
  const sw = page.locator('.arco-switch').first();
  const s0 = await sw.getAttribute('aria-checked');
  await sw.click();
  await page.waitForTimeout(900);
  const s1 = await sw.getAttribute('aria-checked');
  log('runtime-switch-on', { before: s0, after: s1, toast: await toast() });
  await shot('62-runtime-switch');
  if (s1 === 'true' && s0 === 'false') {
    // a confirm may pop for enabling
    const p = page
      .locator('.arco-trigger.arco-popconfirm button:has-text("确定"), .arco-modal:visible .arco-btn-primary')
      .last();
    if (await p.count()) await p.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await sw.click();
  await page.waitForTimeout(900);
  const s2 = await sw.getAttribute('aria-checked');
  const p2 = page
    .locator('.arco-trigger.arco-popconfirm button:has-text("确定"), .arco-modal:visible .arco-btn-primary')
    .last();
  if (await p2.count()) await p2.click().catch(() => {});
  await page.waitForTimeout(600);
  log('runtime-switch-off', {
    after: await page.locator('.arco-switch').first().getAttribute('aria-checked'),
    toast: await toast(),
  });
} catch (e) {
  log('runtime-fatal', { err: String(e).slice(0, 220) });
}

// ============ 3. content inspection: DLP rule lifecycle ============
try {
  await visit(page, state, '/content-inspection', { settleMs: 1500 });
  await page.locator('button:has-text("新增规则")').first().click();
  await page.waitForTimeout(800);
  const modalTxt = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(none)';
  });
  log('dlp-modal', { text: modalTxt });
  await shot('63-dlp-modal');
  const inp = page.locator('.arco-modal:visible input:visible').first();
  await inp.fill('测评DLP规则');
  const ta = page.locator('.arco-modal:visible textarea:visible').first();
  if (await ta.count()) await ta.fill('内部机密示例词');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1200);
  log('dlp-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评DLP规则')),
  });
  await shot('64-dlp-saved');
  const del = page.locator('button:has-text("删除")').first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('dlp-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评DLP规则')),
    });
  } else {
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .map((b) => b.innerText.trim())
        .filter(Boolean)
        .slice(0, 20)
    );
    log('dlp-delete', { noDelete: true, buttons: btns });
  }
} catch (e) {
  log('dlp-fatal', { err: String(e).slice(0, 220) });
}

// ============ 4. approvals: submit -> approve (admin approves own request) ============
try {
  await visit(page, state, '/approvals', { settleMs: 1800 });
  await page.locator('button:has-text("发起审批")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.arco-modal:visible input:visible').first().fill('测评审批申请');
  await page
    .locator('.arco-modal:visible textarea:visible')
    .first()
    .fill('功能测评自动提交的申请，请批准后由脚本清理。');
  await shot('65-approval-compose');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1300);
  log('appr-submit', {
    toast: await toast(),
    pending: await page.evaluate(() => document.body.innerText.includes('测评审批申请')),
  });
  await shot('66-approval-pending');
  // approve it in 待办审批 (first table). find 同意 in the row
  const appr = page
    .locator(
      '.arco-table-tr:has-text("测评审批申请") button:has-text("同意"), .arco-table-tr:has-text("测评审批申请") button:has-text("通过")'
    )
    .first();
  if (await appr.count()) {
    await appr.click();
    await page.waitForTimeout(500);
    await popOk();
    await page.waitForTimeout(900);
    log('appr-approve', { toast: await toast() });
  } else {
    const rowBtns = await page.evaluate(() =>
      [...document.querySelectorAll('.arco-table-tr')]
        .filter((t) => t.innerText.includes('测评审批申请'))
        .flatMap((t) => [...t.querySelectorAll('button')].map((b) => b.innerText.trim()))
    );
    log('appr-approve', { rowButtons: rowBtns });
  }
  await shot('67-approval-approved');
  // cleanup: delete from 我的申请 if possible
  const mineDel = page
    .locator(
      '.arco-table-tr:has-text("测评审批申请") button:has-text("删除"), .arco-table-tr:has-text("测评审批申请") button:has-text("撤回")'
    )
    .first();
  if (await mineDel.count()) {
    await mineDel.click();
    await page.waitForTimeout(500);
    log('appr-cleanup', { confirmed: await popOk(), toast: await toast() });
  } else log('appr-cleanup', { note: '已办记录无删除入口（审计留痕属预期）' });
} catch (e) {
  log('appr-fatal', { err: String(e).slice(0, 220) });
}

// ============ 5. media ledger: retention toggle restore ============
try {
  await visit(page, state, '/media-ledger', { settleMs: 1500 });
  const sw = page.locator('.arco-switch').first();
  const s0 = await sw.getAttribute('aria-checked');
  await sw.click();
  await page.waitForTimeout(800);
  const saveBtn = page.locator('button:has-text("保存")').first();
  if (await saveBtn.count()) await saveBtn.click();
  await page.waitForTimeout(900);
  log('media-toggle-on', { before: s0, after: await sw.getAttribute('aria-checked'), toast: await toast() });
  // restore
  await sw.click();
  await page.waitForTimeout(800);
  if (await saveBtn.count()) await saveBtn.click();
  await page.waitForTimeout(900);
  log('media-toggle-off', { after: await sw.getAttribute('aria-checked'), toast: await toast() });
} catch (e) {
  log('media-fatal', { err: String(e).slice(0, 220) });
}

await saveJson('05-results.json', results);
console.log('DONE');
process.exit(0);
