// Fill and Stroke in the options bar: the drawing tools' paint pickers.
// Each button shows its paint; its dropdown chooses None, a colour (this
// drawing's colours, the swatches, or any colour with its alpha), a gradient
// or a pattern, for the next shape and the selection.
import { test, expect, load, select, tab } from './fixtures.js';

const SCENE =
  '<rect id="a" x="20" y="20" width="100" height="80" fill="#2563eb" fill-opacity="0.5"/>' +
  '<circle id="b" cx="250" cy="150" r="40" fill="#dc2626"/>';
const pop = (page) => page.locator('#sc-paintpop');
const fillBtn = (page) => page.locator('.sc-paintbtn[data-paint="fill"]');
const st = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    return { fill: s.fill, fillA: s.fillA, on: s.fillOn, grad: !!s.fillGrad, pat: s.fillPat?.id };
  });

test.beforeEach(async ({ page }) => {
  await load(page, SCENE);
  await page.keyboard.press('r');
});

test('the shape tools show Fill and Stroke; the dropdown offers this drawing’s colours', async ({
  page,
}) => {
  await expect(fillBtn(page)).toBeVisible();
  await expect(page.locator('.sc-paintbtn[data-paint="stroke"]')).toBeVisible();
  await fillBtn(page).click();
  await expect(pop(page)).toBeVisible();
  await expect(pop(page).locator('[data-mode="solid"]')).toHaveAttribute('aria-checked', 'true');
  // The drawing's own colours, with their alpha, first.
  const mine = pop(page).locator('.sc-paintpop-grid').first();
  await expect(mine.locator('.sc-paintpop-tile[aria-label="#2563eb 50%"]')).toHaveCount(1);
  await expect(mine.locator('.sc-paintpop-tile[aria-label="#dc2626"]')).toHaveCount(1);
  await pop(page).locator('.sc-paintpop-tile[aria-label="#2563eb 50%"]').click();
  expect(await st(page)).toMatchObject({ fill: '#2563eb', fillA: 0.5, on: true });
  await expect(fillBtn(page)).toHaveAttribute('aria-label', 'Fill: #2563eb at 50%');
});

test('any colour by hex and alpha; None; and the next shape gets it', async ({ page }) => {
  await fillBtn(page).click();
  const hex = pop(page).locator('.sc-hex');
  await hex.fill('#16a34a');
  await hex.press('Enter');
  const alpha = pop(page).locator('input[aria-label="Alpha"]');
  await alpha.fill('75');
  await alpha.press('Enter');
  expect(await st(page)).toMatchObject({ fill: '#16a34a', fillA: 0.75 });
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();
  await expect(fillBtn(page)).toBeFocused();
  // Draw: the new rectangle has it.
  await page.evaluate(() => window.svgcraft.setTool('rect'));
  const s = await page.locator('#sc-stage').boundingBox();
  await page.mouse.move(s.x + 500, s.y + 500);
  await page.mouse.down();
  await page.mouse.move(s.x + 600, s.y + 580, { steps: 3 });
  await page.mouse.up();
  const made = page.locator('#sc-doc > rect').last();
  await expect(made).toHaveAttribute('fill', '#16a34a');
  await expect(made).toHaveAttribute('fill-opacity', '0.75');
  // None.
  await fillBtn(page).click();
  await pop(page).locator('[data-mode="none"]').click();
  expect((await st(page)).on).toBe(false);
});

test('a gradient or a pattern from the dropdown goes on the shape just drawn', async ({ page }) => {
  const s = await page.locator('#sc-stage').boundingBox();
  await page.mouse.move(s.x + 500, s.y + 500);
  await page.mouse.down();
  await page.mouse.move(s.x + 600, s.y + 580, { steps: 3 });
  await page.mouse.up();
  const made = page.locator('#sc-doc > rect').last();
  await fillBtn(page).click();
  await pop(page).locator('[data-mode="gradient"]').click();
  await pop(page).locator('.sc-paintpop-tile[aria-label="Sunset"]').click();
  expect((await st(page)).grad).toBe(true);
  await expect(made).toHaveAttribute('fill', /^url\(#sc-grad-\d+\)$/);
  await pop(page).locator('[data-mode="pattern"]').click();
  await pop(page).locator('.sc-paintpop-tile[aria-label="Dots"]').click();
  expect((await st(page)).pat).toBe('dots');
  await expect(made).toHaveAttribute('fill', /^url\(#sc-pat-\d+\)$/);
  // Custom… opens the Libraries window on Patterns.
  await pop(page).locator('.sc-libpick-manage').click();
  await expect(page.locator('#sc-libraries [data-tab="patterns"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Appearance’s hex is empty for a gradient or no paint, and typing one makes it solid', async ({
  page,
}) => {
  await load(
    page,
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
      '<rect id="a" x="20" y="20" width="100" height="80" fill="url(#g)" stroke="none"/>' +
      '<rect id="b" x="150" y="20" width="100" height="80" fill="#2563eb"/>',
  );
  await tab(page, 'props');
  const hexOf = (k) => page.locator(`#sc-${k}-hex`);
  await select(page, 'a');
  await page.evaluate(() => window.syncStyleUI());
  await expect(hexOf('fill')).toHaveValue('');
  await expect(hexOf('fill')).toHaveAttribute('placeholder', 'Gradient');
  await expect(hexOf('stroke')).toHaveValue('');
  await expect(hexOf('stroke')).toHaveAttribute('placeholder', 'None');
  // A solid one shows its colour.
  await select(page, 'b');
  await page.evaluate(() => window.syncStyleUI());
  await expect(hexOf('fill')).toHaveValue('#2563eb');
  await expect(hexOf('fill')).toHaveAttribute('placeholder', '');
  // Typed into the gradient's: solid.
  await select(page, 'a');
  await page.evaluate(() => window.syncStyleUI());
  await hexOf('fill').fill('00ff00');
  await hexOf('fill').press('Enter');
  await expect(page.locator('#a')).toHaveAttribute('fill', '#00ff00');
  await expect(hexOf('fill')).toHaveAttribute('placeholder', '');
});
