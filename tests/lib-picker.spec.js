// The library pickers: Custom Shape's Shape (the Symbols library) and the
// pattern editor's pattern (the Patterns library), each a button that opens
// the library's tiles, and kept in step with the panel's own.
import { test, expect, load, select, toScreen } from './fixtures.js';

const pop = (page) => page.locator('#sc-libpick-pop');
const tiles = (page) => pop(page).locator('.sc-libpick-tile');
const shapeBtn = (page) => page.locator('#sc-custom-shape');
const patBtn = (page) => page.locator('#sc-pat-pick');

async function drag(page, [x0, y0], [x1, y1]) {
  const a = await toScreen(page, x0, y0);
  const b = await toScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
}

test.describe('Custom Shape', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => window.svgcraft.setTool('custom'));
  });

  test('the button shows the shape; its popup searches, filters and picks', async ({ page }) => {
    await expect(shapeBtn(page)).toHaveText('Arrow right');
    await shapeBtn(page).click();
    await expect(pop(page)).toBeVisible();
    await expect(shapeBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(pop(page).locator('input')).toBeFocused();
    await expect(tiles(page).first()).toHaveClass(/sel/);
    const all = await tiles(page).count();
    expect(all).toBeGreaterThan(40);
    // A category, then a search within it.
    await pop(page).locator('select').selectOption('Shapes');
    const shapes = await tiles(page).count();
    expect(shapes).toBeLessThan(all);
    await pop(page).locator('input').fill('hea');
    await expect(tiles(page)).toHaveText(['Heart']);
    await tiles(page).first().click();
    await expect(pop(page)).toBeHidden();
    await expect(shapeBtn(page)).toHaveText('Heart');
    await drag(page, [100, 100], [200, 200]);
    await expect(page.locator('#sc-doc > use').last()).toHaveAttribute('data-name', 'Heart');
  });

  test('the keyboard: arrows into and around the tiles, Enter picks, Esc closes', async ({
    page,
  }) => {
    await shapeBtn(page).click();
    await page.keyboard.press('ArrowDown');
    await expect(tiles(page).first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tiles(page).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pop(page)).toBeHidden();
    await expect(shapeBtn(page)).toHaveText('Arrow left');
    await expect(shapeBtn(page)).toBeFocused();
    // Esc leaves it as it was; so does a click outside, or the button again.
    await shapeBtn(page).click();
    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await expect(shapeBtn(page)).toBeFocused();
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('custom');
    await shapeBtn(page).click();
    await page.mouse.click(900, 48); // the options bar
    await expect(pop(page)).toBeHidden();
    await shapeBtn(page).click();
    await expect(pop(page)).toBeVisible();
    await shapeBtn(page).click();
    await expect(pop(page)).toBeHidden();
    await expect(shapeBtn(page)).toHaveText('Arrow left');
  });

  test('one current shape: the Symbols panel’s Library marks it and can change it', async ({
    page,
  }) => {
    await shapeBtn(page).click();
    await pop(page).locator('input').fill('star');
    await tiles(page).first().click();
    // Manage in the Symbols panel: its Library, with Star marked.
    await shapeBtn(page).click();
    await pop(page).locator('.sc-libpick-manage').click();
    await expect(pop(page)).toBeHidden();
    await expect(page.locator('#sc-libsyms')).toBeVisible();
    await expect(page.locator('#sc-libsyms .sc-sym-tile.sel')).toHaveAttribute(
      'aria-label',
      'Star',
    );
    // A click on a tile there is the tool's shape too.
    await page.locator('#sc-libsyms .sc-sym-tile[aria-label="Heart"]').click();
    await expect(shapeBtn(page)).toHaveText('Heart');
    await drag(page, [100, 100], [200, 200]);
    await expect(page.locator('#sc-doc > use').last()).toHaveAttribute('data-name', 'Heart');
  });
});

test.describe('the pattern editor', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, '<rect id="a" x="20" y="20" width="100" height="80" fill="#2563eb"/>');
    await select(page, 'a');
    await page.click('[data-tab="patterns"]');
    await page.locator('#sc-patlib .sc-tile').nth(2).click(); // Dots
    await page.click('[data-tab="color"]');
  });

  test('the button shows the pattern; a tile in its popup swaps it', async ({ page }) => {
    await expect(patBtn(page)).toHaveText('Dots');
    await patBtn(page).click();
    await expect(pop(page).locator('select')).toBeHidden();
    await expect(pop(page).locator('.sc-libpick-tile.sel')).toHaveText('Dots');
    await pop(page).locator('.sc-libpick-tile[data-id="waves"]').click();
    await expect(patBtn(page)).toHaveText('Waves');
    expect(await page.evaluate(() => window.svgcraft.state.fillPat.name)).toBe('Waves');
    expect(
      await page.evaluate(() => {
        const id = /#([^)]+)/.exec(document.getElementById('a').getAttribute('fill'))[1];
        return document.getElementById(id).innerHTML;
      }),
    ).toContain('q5-5');
  });

  test('the Patterns panel marks the same one, and Manage opens it', async ({ page }) => {
    await patBtn(page).click();
    await pop(page).locator('.sc-libpick-tile[data-id="bricks"]').click();
    await patBtn(page).click();
    await pop(page).locator('.sc-libpick-manage').click();
    await expect(page.locator('#sc-patlib')).toBeVisible();
    await expect(page.locator('#sc-patlib .sc-tile.sel')).toHaveAttribute('data-id', 'bricks');
  });
});
