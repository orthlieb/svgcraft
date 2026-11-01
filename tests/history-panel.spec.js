// Window → History: every step named by what it did, click one to
// go back, and a new change drops the steps after it.
import { test, expect, load, select, menu } from './fixtures.js';

const steps = (page) => page.$$eval('#sc-history button', (bs) => bs.map((b) => b.textContent));
const current = (page) => page.$eval('#sc-history .on', (b) => b.textContent);

test('steps are named by what made them; clicking one goes back to it', async ({ page }) => {
  await load(page, '<rect id="r" x="10" y="10" width="40" height="40" fill="#dc2626"/>');
  await page.click('[data-tab="history"]');
  await expect(page.locator('[data-pane="history"]')).toBeVisible();
  // (The test opens it straight over the blank drawing: two Opens.)
  expect(await steps(page)).toEqual(['Open', 'Open']);

  // A menu command, a shortcut, a panel control and a drag with the Move tool.
  await select(page, 'r');
  await menu(page, 'Object', 'flipH');
  await page.keyboard.press('Control+g');
  const w = page.locator('#sc-appearance [data-bind="strokeWidth"]');
  await page.click('[data-tab="props"]');
  await w.fill('7');
  await w.press('Enter');
  await page.click('[data-tab="history"]');
  const r = await page.locator('#r').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 60, r.y + 40, { steps: 4 });
  await page.mouse.up();
  expect((await steps(page)).slice(2)).toEqual([
    'Flip Horizontal',
    'Group',
    'Stroke width',
    'Move',
  ]);
  expect(await current(page)).toBe('Move');

  // Back to before the group: the later steps dim, and the drawing is as it was.
  await page.click('#sc-history button:text-is("Flip Horizontal")');
  expect(await current(page)).toBe('Flip Horizontal');
  await expect(page.locator('#sc-history .after')).toHaveCount(3);
  await expect(page.locator('#sc-doc > g')).toHaveCount(0);
  // Redo walks forward again.
  await page.keyboard.press('Control+Shift+z');
  expect(await current(page)).toBe('Group');
  // A new change replaces what came after.
  await select(page, 'r');
  await page.keyboard.press('ArrowRight');
  expect((await steps(page)).slice(2)).toEqual(['Flip Horizontal', 'Group', 'Nudge']);
  await expect(page.locator('#sc-history .after')).toHaveCount(0);
});

test('Window → History shows the panel', async ({ page }) => {
  await page.click('.sc-menu-btn:text-is("Window")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="panelHistory"]');
  await expect(page.locator('[data-pane="history"]')).toBeVisible();
});
