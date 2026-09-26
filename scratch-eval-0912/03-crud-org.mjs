/**
 * Step 3: CRUD spot checks — invites, org-tree departments, scenes.
 * Every created object is deleted again; final state must equal initial.
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

const clickButton = async (text) => {
  await page.locator(`button:has-text("${text}")`).first().click();
  await page.waitForTimeout(600);
};
const modalVisible = async () =>
  page
    .locator('.arco-modal:visible')
    .count()
    .then((n) => n > 0);
const confirmPopup = async (which = '确定') => {
  // arco popconfirm or modal confirm — whichever is on top
  const pop = page
    .locator(`.arco-popconfirm-popup button:has-text("${which}"), .arco-modal button:has-text("${which}")`)
    .last();
  await pop.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
};
const fillLabeled = async (labelRe, value) => {
  const input = page.locator(`.arco-form-item:has(label:text-matches("${labelRe}","i")) input`).first();
  await input.fill(value, { timeout: 4000 });
};
const lastToast = async () => {
  const t = await page.evaluate(() => [...document.querySelectorAll('.arco-message')].map((n) => n.innerText.trim()));
  return t[t.length - 1] ?? '';
};

// ---------- 1. invites: generate -> appears -> revoke ----------
await visit(page, state, '/invites', { shot: '10-invites-before.png' });
await clickButton('生成邀请码');
await page.waitForTimeout(900);
let shot = resolve(shotDir(), '11-invite-created.png');
await page.screenshot({ path: shot });
const inviteRow = await page.evaluate(
  () => document.querySelector('.arco-table-tbody')?.innerText?.slice(0, 300) ?? ''
);
log('invite-generate', { toast: await lastToast(), row: inviteRow.slice(0, 150) });
// copy link button may reveal full URL — capture it
const linkInfo = await page.evaluate(() => {
  const el = [...document.querySelectorAll('input, .arco-typography, code, span')]
    .map((n) => n.value ?? n.textContent)
    .find((t) => t && t.includes('/invite') && t.length > 10);
  return el ?? null;
});
log('invite-link', { link: linkInfo ? String(linkInfo).slice(0, 200) : '(未发现链接文本)' });
// revoke / invalidate
const revokeBtn = page
  .locator('button:has-text("作废"), button:has-text("撤销"), button:has-text("删除"), button:has-text("停用")')
  .first();
if (await revokeBtn.count()) {
  await revokeBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(shotDir(), '12-invite-revoke-confirm.png') });
  await confirmPopup('确定');
  log('invite-revoke', {
    toast: await lastToast(),
    after: (
      await page.evaluate(() => document.querySelector('.arco-table-tbody')?.innerText?.slice(0, 200) ?? '')
    ).slice(0, 120),
  });
} else {
  log('invite-revoke', { error: '未找到作废按钮' });
}

// ---------- 2. org-tree: create -> rename -> delete ----------
await visit(page, state, '/org-tree', { shot: '13-org-before.png' });
await clickButton('新增部门');
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(shotDir(), '14-org-modal.png') });
const modalInputs = page.locator('.arco-modal input');
const nInputs = await modalInputs.count();
if (nInputs >= 1) {
  await modalInputs.first().fill('测评-部门A');
  await clickButton('确定');
  await page.waitForTimeout(900);
  log('org-create', {
    toast: await lastToast(),
    tree: await page.evaluate(() => document.body.innerText.match(/测评-部门A/)?.[0] ?? 'MISSING'),
  });
} else {
  log('org-create', { error: `modal inputs=${nInputs}` });
}
await page.screenshot({ path: resolve(shotDir(), '15-org-created.png') });
// rename via row action if present
const renameBtn = page
  .locator('button:has-text("重命名"), button:has-text("编辑"), .arco-table-tbody button:has-text("改名")')
  .first();
if (await renameBtn.count()) {
  await renameBtn.click();
  await page.waitForTimeout(500);
  const inp = page.locator('.arco-modal input, .arco-popconfirm-popup input').first();
  if (await inp.count()) {
    await inp.fill('测评-部门A改');
    await clickButton('确定');
    await page.waitForTimeout(800);
    log('org-rename', { toast: await lastToast() });
  }
}
// delete
const delBtn = page.locator('.arco-table-tbody button:has-text("删除"), button:has-text("删除部门")').first();
if (await delBtn.count()) {
  await delBtn.click();
  await page.waitForTimeout(500);
  await confirmPopup('确定');
  await page.waitForTimeout(600);
  const gone = await page.evaluate(() => !document.body.innerText.includes('测评-部门A'));
  log('org-delete', { toast: await lastToast(), gone });
} else {
  log('org-delete', { error: '未找到删除按钮' });
}

// ---------- 3. scenes: create custom scene -> delete ----------
await visit(page, state, '/scenes', { shot: '16-scenes-before.png' });
await clickButton('新建场景');
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(shotDir(), '17-scene-modal.png') });
const sceneName = page.locator('.arco-modal input').first();
await sceneName.fill('测评场景X');
// description second input/textarea
const desc = page.locator('.arco-modal textarea').first();
if (await desc.count()) await desc.fill('功能测评自动创建');
await clickButton('确定');
await page.waitForTimeout(1000);
log('scene-create', {
  toast: await lastToast(),
  visible: await page.evaluate(() => document.body.innerText.includes('测评场景X')),
});
await page.screenshot({ path: resolve(shotDir(), '18-scene-created.png') });
const sceneDel = page.locator('.arco-table-tbody button:has-text("删除")').first();
if (await sceneDel.count()) {
  await sceneDel.click();
  await page.waitForTimeout(500);
  await confirmPopup('确定');
  await page.waitForTimeout(700);
  log('scene-delete', {
    toast: await lastToast(),
    gone: await page.evaluate(() => !document.body.innerText.includes('测评场景X')),
  });
} else {
  log('scene-delete', { error: '未找到删除按钮' });
}

const w = await visit(page, state, '/invites', { shot: '19-final-state.png' });
results.push(report('final-state', '/invites', w, state));
await saveJson('03-crud-org-results.json', results);
console.log('DONE');
process.exit(0);
