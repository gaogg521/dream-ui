import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const page = browser.contexts()[0].pages()[0];

const plusBtn = page.locator('[data-testid="file-upload-btn"]').first();
console.log('plus button found:', await plusBtn.count());
await plusBtn.hover();
await page.waitForTimeout(400);

const skillsSubmenuTitle = page.getByText(/技能 \(|Skills \(/).first();
const hasSubmenu = await skillsSubmenuTitle.count();
console.log('skills submenu title found:', hasSubmenu);
if (hasSubmenu) {
  await skillsSubmenuTitle.hover();
  await page.waitForTimeout(500);

  const list = page.locator('[data-testid="guid-skills-list"]');
  const grid = page.locator('[data-testid="guid-skills-grid"]');
  console.log('new list container present:', await list.count());
  console.log('old grid container present (should be 0):', await grid.count());

  const rows = page.locator('[data-testid^="guid-skill-row-"]');
  const rowCount = await rows.count();
  console.log('skill rows rendered:', rowCount);

  if (rowCount > 0) {
    const first = rows.first();
    console.log('first row text:', await first.innerText());
  }

  const teamBadgeCount = await page.locator('[data-testid^="guid-skill-row-"]').filter({ hasText: '团队' }).count();
  console.log('rows with 团队 badge:', teamBadgeCount);
} else {
  const bodyText = await page.locator('body').innerText();
  console.log('body snippet:', bodyText.slice(0, 500));
}

await browser.close();
