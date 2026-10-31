// Fixes from the UI review: Enter on a focused button presses that button,
// arrow keys in panel controls stay there, a symbol instance's paint, and
// dialogs that say what's wrong without closing.
import { test, expect, load, select, menu, action } from './fixtures.js';

test('Enter on a focused button presses that button, not OK', async ({ page }) => {
  await load(page, '<rect id="r" width="50" height="50"/>');
  // New Guide: Enter on Cancel adds no guide.
  await action(page, 'newGuide');
  await page.fill('#sc-newguide input[type=number]', '50');
  await page.focus('#sc-newguide [data-ng="cancel"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-newguide')).toBeHidden();
  expect(await page.evaluate(() => window.svgcraft.state.guides.length)).toBe(0);
  // Clean SVG: Enter on its ? opens help, it doesn't export.
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await action(page, 'exportCleanSvg');
  await page.focus('#sc-cleansvg .sc-help-btn');
  const [help] = await Promise.all([
    page.context().waitForEvent('page'),
    page.keyboard.press('Enter'),
  ]);
  expect(help.url()).toContain('help.html');
  await page.waitForTimeout(300);
  expect(downloaded).toBe(false);
});

test('arrow keys in a radio group or tab list step through it, and never nudge', async ({
  page,
}) => {
  await load(page, '<rect id="r" x="10" y="10" width="50" height="50" fill="#2563eb"/>');
  await select(page, 'r');
  await page.click('[data-kind-for="fill"] [data-kind="solid"]');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-kind-for="fill"] [data-kind="linear"]')).toBeFocused();
  await expect(page.locator('[data-kind-for="fill"] [data-kind="linear"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-kind-for="fill"] [data-kind="solid"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Panel tabs too.
  await page.click('[data-tab="props"]');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-tab="character"]')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.getElementById('r').getAttribute('transform'))).toBe(
    null,
  );
  await expect(page.locator('#sc-history')).not.toContainText('Nudge');
});

test('a symbol instance shows the paint its symbol sets, and says how to change it', async ({
  page,
}) => {
  await load(page, '<path id="s" d="M10 10h50v50H10z" fill="#f97316"/>');
  await select(page, 's');
  await menu(page, 'Object', 'makeSymbol');
  await page.click('#sc-ask [data-ask="ok"]');
  const fill = page.locator('.sc-paint[data-target="fill"]');
  await expect(page.locator('#sc-fill-hex')).toHaveValue('#f97316');
  await expect(fill).toHaveClass(/sc-paint-locked/);
  await expect(page.locator('.sc-paint-note').first()).toContainText('sets this fill itself');
  // A swatch can't change it either, and says so; nothing goes in the history.
  const steps = await page.locator('#sc-history button').count();
  await page.evaluate(() => {
    window.svgcraft.state.active = 'fill';
    window.applySwatch('#16a34a', 1);
  });
  await expect(page.locator('#sc-alert-text')).toContainText('sets its own fill');
  await expect(page.locator('#sc-history button')).toHaveCount(steps);
  expect(
    await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('fill')),
  ).toBe(null);
  // Its stroke isn't set in the symbol: that one still works.
  await expect(page.locator('.sc-paint[data-target="stroke"]')).not.toHaveClass(/sc-paint-locked/);
  // Edit Symbol from the note.
  await page.click('.sc-paint-note .sc-linkbtn');
  await expect(page.locator('#sc-iso')).toBeVisible();
});

test('dialogs keep themselves open and say what’s wrong next to the field', async ({ page }) => {
  await load(page, '<rect id="r" width="50" height="50"/>');
  // Canvas Size out of range.
  await action(page, 'canvasSize');
  await page.fill('#sc-canvassize [data-cv="w"]', '0');
  await page.keyboard.press('Enter');
  const cv = page.locator('#sc-canvassize');
  await expect(cv).toBeVisible();
  await expect(cv.locator('.sc-dlg-err')).toHaveText('The canvas must be 1 to 20,000 px each way.');
  await expect(cv.locator('[data-cv="w"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(cv.locator('[data-cv="w"]')).toBeFocused();
  // Typing clears it; a good value goes through.
  await page.keyboard.type('300');
  await expect(cv.locator('.sc-dlg-err')).toBeHidden();
  await page.keyboard.press('Escape');
  // Opened again: no old error.
  await action(page, 'canvasSize');
  await expect(cv.locator('.sc-dlg-err')).toBeHidden();
  await page.keyboard.press('Escape');
  // Create Shape with no width stays open.
  await page.keyboard.press('r');
  await page.evaluate(() => window.openCreateShape('rect', { x: 20, y: 20 }));
  await page.fill('[data-cs-shape="w"]', '0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-createshape')).toBeVisible();
  await expect(page.locator('#sc-createshape .sc-dlg-err')).toHaveText(
    'Enter a width and height above zero.',
  );
  await page.keyboard.press('Escape');
  // App Icons: Export waits for a platform.
  await action(page, 'exportAppIcons');
  for (const k of ['web', 'ios', 'android', 'macos']) await page.uncheck(`[data-ai="${k}"]`);
  await expect(page.locator('[data-ai-btn="ok"]')).toBeDisabled();
  await page.check('[data-ai="web"]');
  await expect(page.locator('[data-ai-btn="ok"]')).toBeEnabled();
  await page.keyboard.press('Escape');
});

test('Esc closes the phone’s Layers sheet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, '<rect id="r" width="50" height="50"/>');
  await action(page, 'peekLayers');
  await expect(page.locator('#sc-peek')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-peek')).toBeHidden();
  expect(errors).toEqual([]);
});
