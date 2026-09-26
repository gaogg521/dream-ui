/**
 * Step 3b: resume interrupted org CRUD — verify invite state, rename+delete
 * department, then scene create/delete. Visible-scoped selectors this time.
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
const clickButton = async (text, scope = 'page') => {
  const loc =
    scope === 'modal'
      ? page.locator('.arco-modal:visible button:has-text("' + text + '")')
      : page.locator(`button:has-text("${text}")`).first();
  await loc.first().click();
  await page.waitForTimeout(700);
};
const popConfirm = async () => {
  const pop = page
    .locator('.arco-popconfirm-popup:visible button:has-text("确定"), .arco-modal:visible button:has-text("确定")')
    .last();
  await pop.click({ timeout: 4000 }).catch((e) => log('popconfirm', { error: String(e).slice(0, 80) }));
  await page.waitForTimeout(700);
};
const lastToast = async () => {
  const t = await page.evaluate(() => [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim()));
  return t[t.length - 1] ?? '';
};
const tableText = () =>
  page.evaluate(
    () =>
      document.querySelector('.arco-table-body')?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ??
      document.body.innerText.slice(0, 300)
  );

// ---------- 1. invites state check + revoke if still active ----------
await visit(page, state, '/invites', { settleMs: 1500 });
let inv = await tableText();
log('invites-state', { table: inv.slice(0, 200) });
if (inv.includes('待使用') || (inv.includes('ED4E') && !inv.includes('已作废'))) {
  await clickButton('作废');
  await popConfirm();
  log('invite-revoke', { toast: await lastToast(), table: (await tableText()).slice(0, 200) });
}
await page.screenshot({ path: resolve(shotDir(), '12-invite-after-revoke.png') });

// ---------- 2. org-tree: rename -> delete 测评-部门A ----------
await visit(page, state, '/org-tree', { settleMs: 1500 });
const nodeBtns = page.locator('.arco-tree-node:has-text("测评-部门A") button');
const hasNode = await page.locator('.arco-tree-node:has-text("测评-部门A")').count();
log('org-node-found', { hasNode });
if (hasNode) {
  // hover may be needed for inline actions; arco renders them regardless in DOM
  await page.locator('.arco-tree-node:has-text("测评-部门A") button:has-text("重命名")').first().click({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(shotDir(), '14b-rename-modal.png') });
  const inp = page.locator('.arco-modal:visible input').first();
  await inp.fill('测评-部门A改');
  await clickButton('确定', 'modal');
  await page.waitForTimeout(800);
  log('org-rename', {
    toast: await lastToast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评-部门A改')),
  });
  await page.locator('.arco-tree-node:has-text("测评-部门A改") button:has-text("删除")').first().click({ force: true });
  await page.waitForTimeout(500);
  await popConfirm();
  await page.waitForTimeout(600);
  log('org-delete', {
    toast: await lastToast(),
    gone: await page.evaluate(() => !document.body.innerText.includes('测评-部门A改')),
  });
} else {
  log('org-node-found', { note: '部门已不存在，跳过' });
}

// ---------- 3. scenes: create -> delete ----------
await visit(page, state, '/scenes', { settleMs: 1500 });
await clickButton('新建场景');
await page.waitForTimeout(600);
await page.locator('.arco-modal:visible input').first().fill('测评场景X');
const desc = page.locator('.arco-modal:visible textarea').first();
if (await desc.count()) await desc.fill('功能测评自动创建');
await clickButton('确定', 'modal');
await page.waitForTimeout(1000);
log('scene-create', {
  toast: await lastToast(),
  visible: await page.evaluate(() => document.body.innerText.includes('测评场景X')),
});
await page.screenshot({ path: resolve(shotDir(), '18-scene-created.png') });
const sceneDel = page.locator('.arco-table-tbody:visible button:has-text("删除")').first();
if (await sceneDel.count()) {
  await sceneDel.click();
  await page.waitForTimeout(500);
  await popConfirm();
  await page.waitForTimeout(700);
  log('scene-delete', {
    toast: await lastToast(),
    gone: await page.evaluate(() => !document.body.innerText.includes('测评场景X')),
  });
} else {
  log('scene-delete', { error: '自定义场景行没有删除按钮', table: (await tableText()).slice(0, 260) });
}

await saveJson('03b-crud-org-results.json', results);
console.log('DONE');
process.exit(0);
