// Layout and feedback, from the UI review: room for Layers, the options
// bar's overflow, Properties' Transform, the Character tab, the view kept
// on a resize, shape tools' options, alerts that go, success messages,
// greyed-out submenus and library buttons, and Undo for a library delete.
import { test, expect, load, select, menu, action, tab } from './fixtures.js';

// Select as a click on its Layers row does.
const pick = (page, name) => page.locator('#sc-layers li', { hasText: name }).click();

const SCENE =
  '<rect id="a" data-name="Box" x="20" y="20" width="100" height="80" fill="#2563eb"/>' +
  '<text id="t" x="200" y="60" font-size="24">Hi</text>';

test('Layers keeps room for four rows', async ({ page }) => {
  await load(page, SCENE);
  expect(
    await page.locator('#sc-layers').evaluate((l) => l.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(4 * 38);
});

test('an options bar too long for the window shows › and ‹ to scroll it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await load(page, SCENE);
  await page.evaluate(() => window.svgcraft.setTool('select'));
  const right = page.locator('.sc-opt-more-r');
  const left = page.locator('.sc-opt-more-l');
  await expect(right).toBeVisible();
  await expect(left).toBeHidden();
  await right.click();
  await expect(left).toBeVisible();
  await expect
    .poll(() => page.locator('#sc-options').evaluate((o) => o.scrollLeft))
    .toBeGreaterThan(0);
});

test('Properties shows the selection’s X, Y, W and H, and typing moves or sizes it', async ({
  page,
}) => {
  await load(page, SCENE);
  await pick(page, 'Box');
  const f = (k) => page.locator(`[data-box="${k}"]`);
  await expect(page.locator('#sc-box-props')).toBeVisible();
  await expect(f('x')).toHaveValue('20');
  await expect(f('w')).toHaveValue('100');
  await f('w').fill('200');
  await f('w').press('Enter');
  expect(
    await page.evaluate(() => window.svgcraft.paintBox([document.getElementById('a')]).w),
  ).toBeCloseTo(200, 0);
  await f('x').fill('50');
  await f('x').press('Enter');
  expect(
    await page.evaluate(() => window.svgcraft.paintBox([document.getElementById('a')]).x),
  ).toBeCloseTo(50, 0);
  // One undo step each.
  await page.keyboard.press('Control+z');
  expect(
    await page.evaluate(() => window.svgcraft.paintBox([document.getElementById('a')]).x),
  ).toBeCloseTo(20, 0);
  // Nothing selected: no Transform.
  await page.evaluate(() => window.setSel([]));
  await expect(page.locator('#sc-box-props')).toBeHidden();
});

test('text shows Character; something else afterwards goes back to the tab before', async ({
  page,
}) => {
  await load(page, SCENE);
  await tab(page, 'props');
  await pick(page, 'Hi');
  await expect(page.locator('[data-tab="character"]')).toHaveAttribute('aria-selected', 'true');
  await pick(page, 'Box');
  await expect(page.locator('[data-tab="props"]')).toHaveAttribute('aria-selected', 'true');
  // Choosing a tab yourself in between: it stays.
  await pick(page, 'Hi');
  await tab(page, 'paragraph');
  await pick(page, 'Box');
  await expect(page.locator('[data-tab="paragraph"]')).toHaveAttribute('aria-selected', 'true');
});

test('a zoomed view keeps its zoom and middle when a window docks beside it', async ({ page }) => {
  await load(page, SCENE);
  await page.evaluate(() => window.zoomAt(2));
  const mid = () =>
    page.evaluate(() => {
      const r = document.getElementById('sc-stage').getBoundingClientRect();
      const p = new DOMPoint(r.left + r.width / 2, r.top + r.height / 2).matrixTransform(
        document.getElementById('sc-view').getScreenCTM().inverse(),
      );
      return [Math.round(p.x), Math.round(p.y), window.svgcraft.state.zoom];
    });
  const before = await mid();
  await page.keyboard.press('Control+u');
  await expect(page.locator('#sc-source')).toBeVisible();
  await expect.poll(mid).toEqual(before);
});

test('every shape tool has the stroke options', async ({ page }) => {
  await load(page, SCENE);
  for (const t of ['rect', 'triangle', 'polygon', 'custom']) {
    await page.evaluate((t) => window.svgcraft.setTool(t), t);
    await expect(page.locator('.sc-opt.on [data-stroke-dash]'), t).toBeVisible();
  }
});

test('a locked layer: no handles, how to unlock it, and the alert goes on Esc', async ({
  page,
}) => {
  await load(page, SCENE);
  await select(page, 'a');
  await menu(page, 'Layer', 'lockAll');
  await expect(page.locator('#sc-selection .sc-handle')).toHaveCount(0);
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sc-alert-text')).toContainText('Layer → Unlock');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-alert')).toBeHidden();
  // A new selection puts a stale one away too (Esc deselected it).
  await select(page, 'a');
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sc-alert')).toBeVisible();
  await page.waitForTimeout(450);
  await pick(page, 'Hi');
  await expect(page.locator('#sc-alert')).toBeHidden();
});

test('commands say what they did', async ({ page }) => {
  await load(page, SCENE);
  await select(page, 'a');
  await action(page, 'duplicate');
  await expect(page.locator('#sc-msg')).toHaveText('Duplicated 1 layer.');
  await action(page, 'group');
  await expect(page.locator('#sc-msg')).toContainText('Grouped 1 layer into');
  await select(page);
  await action(page, 'group');
  await expect(page.locator('#sc-msg')).toContainText('Made an empty group');
});

test('a submenu with nothing to do is greyed out; library buttons wait for a pick', async ({
  page,
}) => {
  await load(page, SCENE);
  await select(page);
  await page.click('.sc-menu-btn:text-is("Layer")');
  const arrange = page
    .locator('.sc-menu-list:not([hidden]) .sc-sub-btn')
    .filter({ hasText: 'Arrange' });
  await expect(arrange).toBeDisabled();
  await page.keyboard.press('Escape');
  await tab(page, 'patterns');
  await expect(page.locator('[data-lib="patterns"] [data-lib-act="rename"]')).toBeDisabled();
  await expect(page.locator('[data-lib="patterns"] [data-lib-act="add"]')).toBeDisabled();
  await page.locator('#sc-patlib .sc-tile').first().click();
  await expect(page.locator('[data-lib="patterns"] [data-lib-act="rename"]')).toBeEnabled();
});

test('a deleted library item comes back with Undo', async ({ page }) => {
  await load(page, SCENE);
  await tab(page, 'swatches');
  const tiles = page.locator('#sc-palette .sc-tile:not(.none)');
  const n = await tiles.count();
  await tiles.nth(2).click({ modifiers: ['Alt'] });
  await expect(tiles).toHaveCount(n - 1);
  await page.click('#sc-msg .sc-msg-undo');
  await expect(tiles).toHaveCount(n);
});

test('Fill shows one swatch, which opens the colour picker', async ({ page }) => {
  await load(page, SCENE);
  await expect(page.locator('#sc-fill-color')).toHaveCSS('opacity', '0');
  await expect(page.locator('#sc-fill-chip')).toHaveAttribute('aria-label', 'Fill colour');
  // Both paint editors say "Stretch with shape", off by default.
  await expect(page.locator('label:has(#sc-grad-stretch)')).toContainText('Stretch with shape');
  await expect(page.locator('label:has(#sc-pat-with)')).toContainText('Stretch with shape');
});
