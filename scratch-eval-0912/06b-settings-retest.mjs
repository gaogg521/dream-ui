/**
 * Step 6b: retest with correct field mapping — notifications(title/body),
 * api key full flow incl. one-time secret modal, billing cap plain input,
 * license activate modal, file-vault row-scoped delete, users self-remove
 * offboarding dialog (inspect + cancel only).
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
    await page.waitForTimeout(900);
    return true;
  }
  return false;
};
const toast = async () =>
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim());
    return t.length ? t[t.length - 1] : '';
  });
const modalText = async () =>
  page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 400) : '(none)';
  });

// ============ 1. notifications ============
try {
  await visit(page, state, '/notifications', { settleMs: 1500 });
  await page.locator('button:has-text("发送消息")').first().click();
  await page.waitForTimeout(700);
  const inputs = page.locator('.arco-modal:visible input.arco-input:not(.arco-select-view-input)');
  await inputs.nth(1).fill('测评公告'); // 分类, 标题
  await page.locator('.arco-modal:visible textarea').first().fill('功能测评自动发送的站内公告。');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1400);
  log('ntf-send', {
    toast: await toast(),
    inHistory: await page.evaluate(() => document.body.innerText.includes('测评公告')),
  });
  await shot('71b-ntf-sent');
} catch (e) {
  log('ntf-fatal', { err: String(e).slice(0, 200) });
}

// ============ 2. api key ============
try {
  await visit(page, state, '/api-keys', { settleMs: 1500 });
  await page.locator('button:has-text("新建")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.arco-modal:visible input.arco-input:not(.arco-select-view-input)').first().fill('测评Key');
  const ta = page.locator('.arco-modal:visible textarea').first();
  if (await ta.count()) await ta.fill('/api/one/billing/*');
  await shot('72b-key-filled');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('key-create', { toast: await toast(), modal: await modalText() });
  await shot('73b-key-secret');
  const secret = await page.evaluate(
    () => document.body.innerText.match(/owek_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|[A-Fa-f0-9-]{20,}/)?.[0] ?? null
  );
  log('key-secret', { found: !!secret, head: secret ? secret.slice(0, 10) : '' });
  // close reveal modal (any primary/OK button)
  const closeBtn = page.locator('.arco-modal:visible .arco-btn').last();
  await closeBtn.click();
  await page.waitForTimeout(800);
  const rowDel = page
    .locator(
      '.arco-table-tr:has-text("测评Key") button:has-text("删除"), .arco-table-tr:has-text("测评Key") button:has-text("吊销")'
    )
    .first();
  if (await rowDel.count()) {
    await rowDel.click();
    await page.waitForTimeout(500);
    log('key-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评Key')),
    });
  } else
    log('key-delete', {
      rowButtons: await page.evaluate(() =>
        [...document.querySelectorAll('.arco-table-tr')]
          .filter((t) => t.innerText.includes('测评Key'))
          .flatMap((t) => [...t.querySelectorAll('button')].map((b) => b.innerText.trim()))
      ),
    });
} catch (e) {
  log('key-fatal', { err: String(e).slice(0, 200) });
}

// ============ 3. billing cap ============
try {
  await visit(page, state, '/billing', { settleMs: 1800 });
  const capArea = page.locator('.arco-card:has-text("模型管控"), div:has(> .text-14px:has-text("模型管控"))').first();
  const capInput = page.locator('input[type="text"], input:not([type])').filter({ hasNot: page.locator('nothing') });
  // simpler: the input next to $ sign — find by aria/placeholder or take first input on page after 成本上限 text
  const inp = page.locator('input').filter({ visible: true }).first();
  await inp.fill('10', { timeout: 4000 }).catch(async () => {
    log('billing-cap', { fallback: 'first-input fill failed; dumping inputs' });
  });
  const saveBtn = page.locator('button:has-text("保存模型管控")');
  if (await saveBtn.count()) {
    await saveBtn.click();
    await page.waitForTimeout(1100);
    log('billing-cap-set', { toast: await toast() });
    await inp.fill('0');
    await saveBtn.click();
    await page.waitForTimeout(1100);
    log('billing-cap-reset', { toast: await toast() });
  } else log('billing-cap', { error: 'no save button' });
  await shot('75b-billing');
} catch (e) {
  log('billing-fatal', { err: String(e).slice(0, 200) });
}

// ============ 4. license activation (invalid code) ============
try {
  await visit(page, state, '/license', { settleMs: 1500 });
  await page.locator('button:has-text("激活")').first().click();
  await page.waitForTimeout(800);
  log('license-modal', { text: await modalText() });
  const ta = page.locator('.arco-modal:visible textarea').first();
  const inp = page.locator('.arco-modal:visible input.arco-input:not(.arco-select-view-input)').first();
  if (await ta.count()) await ta.fill('EVAL-INVALID-LICENSE-CODE');
  else if (await inp.count()) await inp.fill('EVAL-INVALID-LICENSE-CODE');
  await shot('76b-license-modal');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1800);
  log('license-invalid', { toast: await toast() });
  await shot('76c-license-error');
  await page
    .locator('.arco-modal:visible .arco-btn:has-text("取消")')
    .last()
    .click()
    .catch(() => {});
} catch (e) {
  log('license-fatal', { err: String(e).slice(0, 200) });
}

// ============ 5. file vault row delete ============
try {
  await visit(page, state, '/file-vault', { settleMs: 1800 });
  const rowDel = page.locator('.arco-table-tr:has-text("eval-upload.txt") button:has-text("删除")').first();
  if (await rowDel.count()) {
    await rowDel.click();
    await page.waitForTimeout(500);
    log('fv-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('eval-upload.txt')),
    });
  } else
    log('fv-delete', {
      error: 'row not found or no delete btn',
      page: await page.evaluate(() =>
        (document.querySelector('main') ?? document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)
      ),
    });
} catch (e) {
  log('fv-fatal', { err: String(e).slice(0, 200) });
}

// ============ 6. users self-remove dialog (inspect + cancel) ============
try {
  await visit(page, state, '/users', { settleMs: 1800 });
  await page.locator('.arco-table-tr:has-text("system_admin") button:has-text("移除")').first().click();
  await page.waitForTimeout(900);
  log('offboard-modal', { text: await modalText() });
  await shot('77b-offboard-modal');
  await page
    .locator('.arco-modal:visible .arco-btn:has-text("取消")')
    .last()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  log('offboard-cancelled', {
    modalGone: await page.evaluate(
      () => ![...document.querySelectorAll('.arco-modal')].some((x) => x.offsetParent !== null)
    ),
  });
} catch (e) {
  log('offboard-fatal', { err: String(e).slice(0, 200) });
}

await saveJson('06b-results.json', results);
console.log('DONE');
process.exit(0);
