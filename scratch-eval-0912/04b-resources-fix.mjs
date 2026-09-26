/**
 * Step 4b: resources CRUD retry — fill via raw <label> elements (these modals
 * don't use arco Form.Item), dump label→input mapping for evidence.
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

/** Map every raw <label> in the visible modal to its label text + input type. */
const dumpRawLabels = async () =>
  page.evaluate(() => {
    const m = [...document.querySelectorAll('.arco-modal')].find((x) => x.offsetParent !== null);
    if (!m) return null;
    return [...m.querySelectorAll('label')].map((l) => ({
      text: l.innerText.replace(/\s+/g, ' ').trim().slice(0, 40),
      hasInput: !!l.querySelector('input'),
      hasTextarea: !!l.querySelector('textarea'),
      inputType: l.querySelector('input')?.type ?? '',
      ph: l.querySelector('input,textarea')?.placeholder?.slice(0, 40) ?? '',
    }));
  });
const fillRaw = async (kw, value) => {
  const inp = page
    .locator(
      `.arco-modal:visible label:has-text("${kw}") input:visible, .arco-modal:visible label:has-text("${kw}") textarea:visible`
    )
    .first();
  if (await inp.count()) {
    await inp.fill(value);
    return true;
  }
  return false;
};

// ============ 1. model channel ============
try {
  await visit(page, state, '/model-channels', { settleMs: 1500 });
  await page.locator('button:has-text("新增渠道")').first().click();
  await page.waitForTimeout(800);
  log('mc-labels', await dumpRawLabels());
  log('mc-fill-name', { ok: await fillRaw('名称', '测评渠道A') });
  log('mc-fill-url', {
    ok:
      (await fillRaw('地址', 'https://eval.invalid.test/v1')) ||
      (await page
        .locator('.arco-modal:visible input[placeholder*="api.openai.com"]')
        .fill('https://eval.invalid.test/v1')
        .then(() => true)
        .catch(() => false)),
  });
  log('mc-fill-key', {
    ok:
      (await fillRaw('密钥', 'sk-eval-dummy')) ||
      (await fillRaw('Key', 'sk-eval-dummy')) ||
      (await page
        .locator('.arco-modal:visible input[type=password]')
        .first()
        .fill('sk-eval-dummy')
        .then(() => true)
        .catch(() => false)),
  });
  await shot('30b-mc-filled');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1500);
  log('mc-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评渠道A')),
  });
  await shot('32b-mc-saved');
  if (!(await page.evaluate(() => document.body.innerText.includes('测评渠道A')))) {
    log('mc-save-retry', { note: 'modal 仍开着，dump 当前报错' });
    await shot('32c-mc-error');
  }
  // clean up
  const del = page
    .locator(
      '.arco-table-tr:has-text("测评渠道A") button:has-text("删除"), .arco-table-tr:has-text("测评渠道A") .arco-btn-status-danger'
    )
    .first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(500);
    log('mc-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评渠道A')),
    });
  } else {
    const rowBtns = await page.evaluate(() =>
      [...document.querySelectorAll('.arco-table-tr')]
        .filter((t) => t.innerText.includes('测评渠道A'))
        .flatMap((t) =>
          [...t.querySelectorAll('button')].map((b) => b.innerText.trim() || b.getAttribute('aria-label') || '(icon)')
        )
    );
    log('mc-delete', { rowButtons: rowBtns });
  }
} catch (e) {
  log('mc-fatal', { err: String(e).slice(0, 250) });
}

// ============ 2. config vault ============
try {
  await visit(page, state, '/config-vault', { settleMs: 1500 });
  await page.locator('button:has-text("新建配置集")').first().click();
  await page.waitForTimeout(700);
  log('cv-labels', await dumpRawLabels());
  log('cv-fill-name', { ok: await fillRaw('名称', '测评配置集') });
  log('cv-fill-key', { ok: await fillRaw('键', 'eval_key') });
  log('cv-fill-value', { ok: await fillRaw('值', 'eval_value_1') });
  await shot('36b-cv-filled');
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1200);
  log('cv-save', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评配置集')),
  });
  await shot('36c-cv-saved');
  const cvDel = page.locator('button:has-text("删除")').first();
  if (await cvDel.count()) {
    await cvDel.click();
    await page.waitForTimeout(500);
    log('cv-delete', {
      confirmed: await popOk(),
      toast: await toast(),
      gone: await page.evaluate(() => !document.body.innerText.includes('测评配置集')),
    });
  } else
    log('cv-delete', {
      rowButtons: await page.evaluate(() =>
        [...document.querySelectorAll('.arco-btn')]
          .map((b) => b.innerText.trim())
          .filter(Boolean)
          .slice(0, 20)
      ),
    });
} catch (e) {
  log('cv-fatal', { err: String(e).slice(0, 250) });
}

// ============ 3. category + tag ============
try {
  await visit(page, state, '/content-governance', { settleMs: 1500 });
  await page.locator('button:has-text("新建根分类")').first().click();
  await page.waitForTimeout(700);
  log('cg-labels', await dumpRawLabels());
  log('cg-fill-name', { ok: await fillRaw('名称', '测评分类') });
  await page.locator('.arco-modal:visible .arco-btn-primary:visible').last().click();
  await page.waitForTimeout(1000);
  log('cg-cat-create', {
    toast: await toast(),
    visible: await page.evaluate(() => document.body.innerText.includes('测评分类')),
  });
  await shot('38b-cg-cat');
  // tag: find 添加 button in the tag card
  const addTag = page.locator('button:has-text("添加")').last();
  if (await addTag.count()) {
    await addTag.click();
    await page.waitForTimeout(600);
    // dump what appeared: modal or inline input
    const vis = await page.evaluate(() => ({
      modal: [...document.querySelectorAll('.arco-modal')].some((x) => x.offsetParent !== null),
      popupInput: [...document.querySelectorAll('.arco-trigger input, .arco-input-tag input')].some(
        (x) => x.offsetParent !== null
      ),
    }));
    log('cg-tag-entry', vis);
    const inp = page.locator('.arco-modal:visible input:visible, .arco-trigger input:visible').last();
    if (await inp.count()) {
      await inp.fill('测评标签');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const ok = page.locator('.arco-modal:visible .arco-btn-primary:visible').last();
      if (await ok.count()) await ok.click();
      await page.waitForTimeout(900);
      log('cg-tag-create', {
        toast: await toast(),
        visible: await page.evaluate(() => document.body.innerText.includes('测评标签')),
      });
    }
  }
  await shot('38c-cg-tag');
  // cleanup both
  for (const name of ['测评标签', '测评分类']) {
    const near = page
      .locator(
        `.arco-table-tr:has-text("${name}") button:has-text("删除"), .arco-tree-node:has-text("${name}") button:has-text("删除"), .arco-tag:has-text("${name}") ~ * button`
      )
      .last();
    if (await near.count()) {
      await near.click({ force: true });
      await page.waitForTimeout(500);
      log(`cg-delete-${name}`, {
        confirmed: await popOk(),
        toast: await toast(),
        gone: await page.evaluate((n) => !document.body.innerText.includes(n), name),
      });
    } else {
      const anyDel = await page.evaluate(() =>
        [...document.querySelectorAll('button')].filter((b) => b.innerText.includes('删除')).map((b) => b.innerText)
      );
      log(`cg-delete-${name}`, { anyDeleteButtons: anyDel });
    }
  }
} catch (e) {
  log('cg-fatal', { err: String(e).slice(0, 250) });
}

await saveJson('04b-results.json', results);
console.log('DONE');
process.exit(0);
