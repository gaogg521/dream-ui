/**
 * Step 6: settings group CRUD — notifications, api keys (one-time secret),
 * billing cost cap roundtrip, invalid license code, file vault upload+delete,
 * backup export download, directory sync without IdP, SSO empty-save
 * validation, knowledge base doc, memory collection, users self-remove guard.
 */
import { connect, collect, visit, saveJson, shotDir } from './harness.mjs';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

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
const plainInputs = () => page.locator('.arco-modal:visible input.arco-input:not(.arco-select-view-input)');

// ============ 1. notifications: broadcast -> history ============
try {
  await visit(page, state, '/notifications', { settleMs: 1500 });
  await page.locator('button:has-text("发送消息")').first().click();
  await page.waitForTimeout(700);
  const modalTxt = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 260) : '(none)';
  });
  log('ntf-modal', { text: modalTxt });
  await shot('70-ntf-modal');
  await plainInputs().nth(0).fill('测评公告');
  const ta = page.locator('.arco-modal:visible textarea').first();
  if (await ta.count()) await ta.fill('功能测评自动发送的站内公告。');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1300);
  log('ntf-send', {
    toast: await toast(),
    inHistory: await page.evaluate(() => document.body.innerText.includes('测评公告')),
  });
  await shot('71-ntf-sent');
} catch (e) {
  log('ntf-fatal', { err: String(e).slice(0, 220) });
}

// ============ 2. api keys: create -> one-time secret -> delete ============
try {
  await visit(page, state, '/api-keys', { settleMs: 1500 });
  await page.locator('button:has-text("新建")').first().click();
  await page.waitForTimeout(700);
  await plainInputs().nth(0).fill('测评Key');
  await shot('72-key-modal');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('key-create', { toast: await toast() });
  await shot('73-key-created');
  const secret = await page.evaluate(
    () => document.body.innerText.match(/ow[a-zA-Z0-9_-]{10,}|sk-[a-zA-Z0-9_-]{10,}/)?.[0] ?? null
  );
  log('key-secret-shown-once', { secret: secret ? secret.slice(0, 8) + '…(已截图)' : '(未见明文)' });
  // close reveal dialog then delete
  await page
    .locator(
      '.arco-modal:visible .arco-btn:has-text("关闭"), .arco-modal:visible .arco-btn:has-text("我已保存"), .arco-modal:visible .arco-btn-primary:visible'
    )
    .last()
    .click();
  await page.waitForTimeout(700);
  const del = page.locator('button:has-text("删除"), button:has-text("吊销")').last();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('key-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评Key')),
    });
  }
} catch (e) {
  log('key-fatal', { err: String(e).slice(0, 220) });
}

// ============ 3. billing: cost cap roundtrip ============
try {
  await visit(page, state, '/billing', { settleMs: 1800 });
  const cap = page.locator('.arco-input-number input').first();
  if (await cap.count()) {
    await cap.fill('10');
    await page.locator('button:has-text("保存模型管控")').click();
    await page.waitForTimeout(1000);
    const v1 = await cap.inputValue();
    log('billing-cap-set', { value: v1, toast: await toast() });
    await cap.fill('0');
    await page.locator('button:has-text("保存模型管控")').click();
    await page.waitForTimeout(1000);
    log('billing-cap-reset', { value: await cap.inputValue(), toast: await toast() });
  } else log('billing-cap', { error: '未找到上限输入' });
} catch (e) {
  log('billing-fatal', { err: String(e).slice(0, 220) });
}

// ============ 4. license: invalid activation code ============
try {
  await visit(page, state, '/license', { settleMs: 1500 });
  const ta = page.locator('textarea').first();
  await ta.fill('EVAL-INVALID-LICENSE-CODE-12345');
  await page.locator('button:has-text("激活")').first().click();
  await page.waitForTimeout(1800);
  log('license-invalid', { toast: await toast() });
  await shot('74-license-invalid');
} catch (e) {
  log('license-fatal', { err: String(e).slice(0, 220) });
}

// ============ 5. file vault: upload + delete ============
try {
  await visit(page, state, '/file-vault', { settleMs: 1800 });
  writeFileSync('eval-upload.txt', 'one work admin eval file\n');
  const fi = page.locator('input[type=file]').first();
  await fi.setInputFiles('eval-upload.txt');
  await page.waitForTimeout(2500);
  log('fv-upload', {
    toast: await toast(),
    listed: await page.evaluate(() => document.body.innerText.includes('eval-upload.txt')),
  });
  await shot('75-fv-uploaded');
  const del = page.locator('button:has-text("删除")').first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('fv-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('eval-upload.txt')),
    });
  }
} catch (e) {
  log('fv-fatal', { err: String(e).slice(0, 220) });
}

// ============ 6. backup: export download ============
let downloadInfo = null;
try {
  await visit(page, state, '/backup', { settleMs: 1500 });
  const dlPromise = page
    .waitForEvent('download', { timeout: 8000 })
    .then((d) => ({ file: d.suggestedFilename() }))
    .catch(() => null);
  const respPromise = page
    .waitForResponse((r) => r.url().includes('backup') || r.url().includes('export'), { timeout: 8000 })
    .then((r) => ({ url: r.url(), status: r.status(), ct: r.headers()['content-type'] }))
    .catch(() => null);
  await page.locator('button:has-text("导出备份")').first().click();
  downloadInfo = await dlPromise;
  const respInfo = await respPromise;
  log('backup-export', { download: downloadInfo, response: respInfo });
  await shot('76-backup-export');
} catch (e) {
  log('backup-fatal', { err: String(e).slice(0, 220) });
}

// ============ 7. directory: sync without IdP ============
try {
  await visit(page, state, '/directory', { settleMs: 1500 });
  await page.locator('button:has-text("立即同步")').first().click();
  await page.waitForTimeout(1800);
  log('directory-sync', { toast: await toast() });
  await shot('77-directory-sync');
} catch (e) {
  log('directory-fatal', { err: String(e).slice(0, 220) });
}

// ============ 8. sso: empty save validation ============
try {
  await visit(page, state, '/sso', { settleMs: 1800 });
  // feishu card save button (first 保存)
  await page.locator('button:has-text("保存")').first().click();
  await page.waitForTimeout(1000);
  log('sso-empty-save', { toast: await toast() });
  await shot('78-sso-validation');
} catch (e) {
  log('sso-fatal', { err: String(e).slice(0, 220) });
}

// ============ 9. knowledge bases: doc create + delete ============
try {
  await visit(page, state, '/knowledge-bases', { settleMs: 1800 });
  await page.locator('button:has-text("新建文档")').first().click();
  await page.waitForTimeout(800);
  const modalTxt = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(none)';
  });
  log('kb-modal', { text: modalTxt });
  await plainInputs().nth(0).fill('测评文档');
  const ta = page.locator('.arco-modal:visible textarea').first();
  if (await ta.count()) await ta.fill('One Work 企业管理后台功能测评自动创建的测试文档内容。');
  await shot('79-kb-modal');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('kb-save', {
    toast: await toast(),
    listed: await page.evaluate(() => document.body.innerText.includes('测评文档')),
  });
  const del = page.locator('button:has-text("删除")').first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('kb-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评文档')),
    });
  }
} catch (e) {
  log('kb-fatal', { err: String(e).slice(0, 220) });
}

// ============ 10. memory: collection create + delete ============
try {
  await visit(page, state, '/memory', { settleMs: 1800 });
  await page.locator('button:has-text("新建集合")').first().click();
  await page.waitForTimeout(800);
  await plainInputs().nth(0).fill('测评记忆集合');
  const ta = page.locator('.arco-modal:visible textarea').first();
  if (await ta.count()) await ta.fill('功能测评自动创建');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1300);
  log('mem-create', {
    toast: await toast(),
    listed: await page.evaluate(() => document.body.innerText.includes('测评记忆集合')),
  });
  await shot('80-memory-created');
  const del = page.locator('button:has-text("删除")').last();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('mem-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评记忆集合')),
    });
  }
} catch (e) {
  log('mem-fatal', { err: String(e).slice(0, 220) });
}

// ============ 11. users: self-remove guard (button disabled) ============
try {
  await visit(page, state, '/users', { settleMs: 1800 });
  const rm = page.locator('.arco-table-tr:has-text("admin") button:has-text("移除")').first();
  const dis = rm.count() ? await rm.isDisabled() : null;
  log('users-self-remove-guard', { found: await rm.count(), disabled: dis });
} catch (e) {
  log('users-fatal', { err: String(e).slice(0, 220) });
}

await saveJson('06-results.json', results);
console.log('DONE');
process.exit(0);
