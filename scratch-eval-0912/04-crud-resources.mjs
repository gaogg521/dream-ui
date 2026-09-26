/**
 * Step 4: resources CRUD — model channel, config vault, categories/tags,
 * API assets, market sources. Modal forms are dumped first (labels+inputs),
 * then filled adaptively; every created row is deleted again.
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
  const p = page
    .locator(
      '.arco-trigger.arco-popconfirm button:has-text("确定"), .arco-modal:visible .arco-btn-primary:has-text("删除")'
    )
    .last();
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
const modalFooter = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.arco-modal:visible .arco-btn')].map((b) => b.innerText.trim()).filter(Boolean)
  );

/** Dump the visible modal's form structure: labels, placeholders, input types. */
const dumpModal = async () =>
  page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    if (!m) return null;
    const items = [...m.querySelectorAll('.arco-form-item')].map((fi) => ({
      label: fi.querySelector('.arco-form-item-label')?.innerText.trim() ?? '',
      inputs: [...fi.querySelectorAll('input, textarea')].map((i) => ({
        type: i.type ?? 'textarea',
        ph: i.placeholder ?? '',
      })),
    }));
    return {
      title: m.querySelector('.arco-modal-title')?.innerText ?? '',
      footer: [...m.querySelectorAll('.arco-btn')].map((b) => b.innerText.trim()),
      items,
    };
  });

const fillByKeywords = async (keywords, value) => {
  for (const kw of keywords) {
    const inp = page.locator(`.arco-modal:visible .arco-form-item:has-text("${kw}") input:visible`).first();
    if (await inp.count()) {
      await inp.fill(value);
      return kw;
    }
  }
  return null;
};

// ============ 1. model channels ============
try {
  await visit(page, state, '/model-channels', { settleMs: 1500 });
  await page.locator('button:has-text("新增渠道")').first().click();
  await page.waitForTimeout(800);
  log('mc-modal', await dumpModal());
  await shot('30-mc-modal');
  log('mc-fill-name', { kw: await fillByKeywords(['名称', '渠道'], '测评渠道A') });
  log('mc-fill-url', { kw: await fillByKeywords(['地址', 'URL', 'Base'], 'https://api.invalid-eval.test/v1') });
  log('mc-fill-key', { kw: await fillByKeywords(['Key', '密钥', 'Token'], 'sk-eval-dummy') });
  // model id fields
  for (const kw of ['模型 ID', '模型ID', '模型列表', '模型']) {
    const inp = page.locator(`.arco-modal:visible .arco-form-item:has-text("${kw}") input:visible`).last();
    if (await inp.count()) {
      await inp.fill('gpt-4o-mini');
      log('mc-fill-model', { kw });
      break;
    }
  }
  await shot('31-mc-filled');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1200);
  log('mc-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评渠道A')),
  });
  await shot('32-mc-saved');
  // row-level 测试/连通性 button if any
  const testBtn = page
    .locator(
      '.arco-table-tr:has-text("测评渠道A") button:has-text("测试"), .arco-table-tr:has-text("测评渠道A") button:has-text("连通")'
    )
    .first();
  if (await testBtn.count()) {
    await testBtn.click();
    await page.waitForTimeout(2500);
    log('mc-test-conn', { toast: await toast() });
    await shot('33-mc-testconn');
  }
  const del = page.locator('.arco-table-tr:has-text("测评渠道A") button:has-text("删除")').first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('mc-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评渠道A')),
    });
  } else {
    // maybe an icon button / dropdown "更多"
    log('mc-delete', { error: '行上无删除按钮' });
    await shot('34-mc-row-no-delete');
  }
} catch (e) {
  log('mc-fatal', { err: String(e).slice(0, 200) });
}

// ============ 2. config vault ============
try {
  await visit(page, state, '/config-vault', { settleMs: 1500 });
  await page.locator('button:has-text("新建配置集")').first().click();
  await page.waitForTimeout(700);
  log('cv-modal', await dumpModal());
  await shot('35-cv-modal');
  await fillByKeywords(['名称', '配置'], '测评配置集');
  // entry key/value if present
  await fillByKeywords(['键', 'key'], 'eval_key');
  const val = page
    .locator(
      '.arco-modal:visible .arco-form-item:has-text("值") input:visible, .arco-modal:visible .arco-form-item:has-text("值") textarea:visible'
    )
    .first();
  if (await val.count()) await val.fill('eval_value_1');
  await shot('36-cv-filled');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1000);
  log('cv-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评配置集')),
  });
  const cvDel = page.locator('.arco-table-tr:has-text("测评配置集") button:has-text("删除")').first();
  if (await cvDel.count()) {
    await cvDel.click();
    await page.waitForTimeout(500);
    log('cv-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评配置集')),
    });
  } else log('cv-delete', { error: '无删除按钮' });
} catch (e) {
  log('cv-fatal', { err: String(e).slice(0, 200) });
}

// ============ 3. categories & tags ============
try {
  await visit(page, state, '/content-governance', { settleMs: 1500 });
  await page.locator('button:has-text("新建根分类")').first().click();
  await page.waitForTimeout(700);
  log('cg-modal', await dumpModal());
  await shot('37-cg-modal');
  await fillByKeywords(['名称', '分类'], '测评分类');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(900);
  log('cg-cat-create', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评分类')),
  });
  // tag
  const tagBtn = page.locator('.arco-card:has-text("标签") button:has-text("添加")').first();
  if (await tagBtn.count()) {
    await tagBtn.click();
    await page.waitForTimeout(600);
    const tInp = page.locator('.arco-input:visible, .arco-modal:visible input:visible').last();
    await tInp.fill('测评标签');
    await page.keyboard.press('Enter').catch(() => {});
    const okBtn = page
      .locator('.arco-modal:visible .arco-btn-primary:visible, .arco-trigger.arco-popconfirm button:has-text("确定")')
      .last();
    if (await okBtn.count()) await okBtn.click();
    await page.waitForTimeout(800);
    log('cg-tag-create', {
      toast: await toast(),
      visible: await page.evaluate(() => document.body.innerText.includes('测评标签')),
    });
    await shot('38-cg-created');
  } else log('cg-tag-create', { error: '未找到添加标签入口' });
  // cleanup category + tag
  for (const name of ['测评分类', '测评标签']) {
    const del = page.locator(`:has-text("${name}") >> button:has-text("删除")`).last();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(500);
      log(`cg-delete-${name}`, {
        confirmed: await popOk(),
        toast: await toast(),
        gone: await page.evaluate((n) => !document.body.innerText.includes(n), name),
      });
    } else log(`cg-delete-${name}`, { error: '未找到删除按钮' });
  }
  await shot('39-cg-after');
} catch (e) {
  log('cg-fatal', { err: String(e).slice(0, 200) });
}

// ============ 4. api assets ============
try {
  await visit(page, state, '/api-assets', { settleMs: 1500 });
  await page.locator('button:has-text("导入")').first().click();
  await page.waitForTimeout(700);
  log('aa-modal', await dumpModal());
  await shot('40-aa-modal');
  const fileInput = page.locator('.arco-modal:visible input[type=file]');
  if (await fileInput.count()) {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Eval API', version: '1.0' },
      paths: { '/ping': { get: { summary: 'ping', responses: { 200: { description: 'ok' } } } } },
    };
    writeFileSync('eval-openapi.json', JSON.stringify(spec));
    await fileInput.setInputFiles('eval-openapi.json');
    await page.waitForTimeout(800);
  }
  await fillByKeywords(['名称'], '测评API');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('aa-import', {
    toast: await toast(),
    visible: await page.evaluate(
      () => document.body.innerText.includes('测评API') || document.body.innerText.includes('Eval API')
    ),
  });
  await shot('41-aa-imported');
  const aaDel = page.locator('button:has-text("删除")').first();
  if (await aaDel.count()) {
    await aaDel.click();
    await page.waitForTimeout(500);
    log('aa-delete', { confirmed: await popOk(), toast: await toast() });
  }
} catch (e) {
  log('aa-fatal', { err: String(e).slice(0, 200) });
}

// ============ 5. market sources ============
try {
  await visit(page, state, '/market-sources', { settleMs: 1500 });
  await page.locator('button:has-text("添加来源")').first().click();
  await page.waitForTimeout(700);
  log('ms-modal', await dumpModal());
  await shot('42-ms-modal');
  await fillByKeywords(['名称'], '测评来源');
  await fillByKeywords(['URL', '地址'], 'https://eval.invalid/market.json');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('ms-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评来源')),
  });
  const msDel = page
    .locator('.arco-table-tr:has-text("测评来源") button:has-text("删除"), button:has-text("移除")')
    .first();
  if (await msDel.count()) {
    await msDel.click();
    await page.waitForTimeout(500);
    log('ms-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评来源')),
    });
  } else log('ms-delete', { error: '无删除按钮' });
} catch (e) {
  log('ms-fatal', { err: String(e).slice(0, 200) });
}

await saveJson('04-crud-resources-results.json', results);
console.log('DONE');
process.exit(0);
