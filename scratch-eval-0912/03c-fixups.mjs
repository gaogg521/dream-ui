/**
 * Step 3c: finish org-area CRUD with corrected popconfirm selectors
 * (arco renders popconfirm content inside .arco-trigger-popup).
 */
import { connect, collect, visit, report, saveJson, shotDir } from './harness.mjs';
import { resolve } from 'node:path';

const { browser, page } = await connect();
const state = collect(page);
const results = [];
const log = (step, data) => {
  results.push({ step, ...data });
  console.log(`· ${step}: ${JSON.stringify(data)}`);
};
const popConfirmOk = async (label = '确定') => {
  const pop = page.locator(`.arco-trigger-popup:visible button:has-text("${label}")`).last();
  const n = await pop.count();
  if (!n) {
    log('popconfirm', { error: '未出现确认弹层' });
    return false;
  }
  await pop.click({ timeout: 4000 });
  await page.waitForTimeout(700);
  return true;
};
const lastToast = async () => {
  const t = await page.evaluate(() => [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim()));
  return t[t.length - 1] ?? '';
};
const tbody = () =>
  page.evaluate(() => {
    const t = document.querySelector('.arco-table-body, .arco-table-tr-empty');
    return t ? t.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(no table)';
  });

// ---------- 1. invites ----------
await visit(page, state, '/invites', { settleMs: 1500 });
let inv = await tbody();
log('invites-table', { table: inv });
await page.screenshot({ path: resolve(shotDir(), '12-invites-state.png') });
if (inv.includes('生效中') || inv.includes('待使用') || /ED4E/.test(inv)) {
  await page.locator('button:has-text("作废")').first().click();
  await page.waitForTimeout(500);
  await popConfirmOk();
  log('invite-revoke', { toast: await lastToast(), table: await tbody() });
}

// ---------- 2. org-tree delete leftover ----------
await visit(page, state, '/org-tree', { settleMs: 1500 });
if (await page.locator('.arco-tree-node:has-text("测评-部门A")').count()) {
  await page.locator('.arco-tree-node:has-text("测评-部门A") button:has-text("删除")').first().click({ force: true });
  await page.waitForTimeout(500);
  await popConfirmOk();
  await page.waitForTimeout(500);
  log('org-delete', {
    toast: await lastToast(),
    gone: await page.evaluate(() => !document.body.innerText.includes('测评-部门A')),
  });
} else {
  log('org-delete', { note: '无残留部门' });
}

// ---------- 3. scenes create + delete ----------
await visit(page, state, '/scenes', { settleMs: 1500 });
await page.locator('button:has-text("新建场景")').first().click();
await page.waitForTimeout(700);
await page.locator('.arco-modal:visible input').first().fill('测评场景X');
const desc = page.locator('.arco-modal:visible textarea').first();
if (await desc.count()) await desc.fill('功能测评自动创建');
await page.locator('.arco-modal:visible button:has-text("保存")').first().click();
await page.waitForTimeout(1000);
log('scene-create', {
  toast: await lastToast(),
  visible: await page.evaluate(() => document.body.innerText.includes('测评场景X')),
});
await page.screenshot({ path: resolve(shotDir(), '18-scene-created.png') });
// delete the custom row (last row) via its Popconfirm
const rowDel = page.locator('.arco-table-tr:has-text("测评场景X") button:has-text("删除")').first();
if (await rowDel.count()) {
  await rowDel.click();
  await page.waitForTimeout(500);
  await popConfirmOk();
  await page.waitForTimeout(700);
  log('scene-delete', {
    toast: await lastToast(),
    gone: await page.evaluate(() => !document.body.innerText.includes('测评场景X')),
  });
} else {
  log('scene-delete', { error: '找不到该行删除按钮' });
}

await saveJson('03c-results.json', results);
console.log('DONE');
process.exit(0);
