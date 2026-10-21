import { test, expect, load } from './fixtures.js';

// Phones only preview (open, tabs, pan / pinch-zoom, fit); tablets and up
// get the editor.

const DRAWING =
  '<rect id="r" x="20" y="20" width="160" height="120" fill="#2563eb"/>' +
  '<circle id="c" cx="230" cy="100" r="40" fill="#dc2626"/>';
const preview = (page) =>
  page.evaluate(() => document.documentElement.classList.contains('sc-preview'));

test.describe('phone, portrait', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('is a viewer that fits the screen', async ({ page }) => {
    expect(await preview(page)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    for (const sel of [
      '.sc-menus',
      '.sc-options',
      '.sc-tools',
      '.sc-panel',
      '#sc-undo',
      '.sc-export',
    ])
      await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator('.sc-menubar-end [data-action="open"]')).toBeVisible();
    await expect(page.locator('.sc-menubar-end [data-action="fit"]')).toBeVisible();
    await expect(page.locator('.sc-preview-note')).toBeVisible();
    // The canvas takes the height between the tabs and the status bar.
    const stage = await page.locator('#sc-stage').boundingBox();
    expect(stage.height).toBeGreaterThan(600);
    expect(stage.x + stage.width).toBeLessThanOrEqual(390);
  });

  test('only the Hand tool: tool keys, shortcuts and drags do not edit', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    const before = await page.evaluate(() => window.svgcraft.serialize());
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    await page.keyboard.press('r');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    await page.evaluate(() => window.svgcraft.setTool('rect'));
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    const pan0 = await page.evaluate(() => window.svgcraft.state.panX);
    const b = await page.locator('#sc-stage').boundingBox();
    await page.mouse.move(b.x + 200, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 300, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.svgcraft.state.panX)).toBeCloseTo(pan0 - 80, 0);
    expect(await page.evaluate(() => window.svgcraft.serialize())).toBe(before);
    await expect(page.locator('#sc-doc-title')).not.toContainText('*');
  });

  test('zoom keys and Fit still work', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    const z0 = await page.evaluate(() => window.svgcraft.state.zoom);
    await page.keyboard.press('+');
    expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBeCloseTo(z0 * 1.25);
    await page.click('.sc-menubar-end [data-action="fit"]');
    expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBeCloseTo(z0);
  });

  test('Open loads a file into a tab of its own', async ({ page }) => {
    await page.setInputFiles('#sc-file', {
      name: 'poster.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${DRAWING}</svg>`,
      ),
    });
    await expect(page.locator('#sc-doc-title')).toHaveText(/^poster\.svg @/);
    await expect(page.locator('#sc-doc circle')).toHaveCount(1);
  });
});

test.describe('phone, landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('is a viewer too', async ({ page }) => {
    expect(await preview(page)).toBe(true);
    await expect(page.locator('.sc-tools')).toBeHidden();
  });
});

test.describe('tablet, portrait', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('gets the editor, with nothing off-screen', async ({ page }) => {
    expect(await preview(page)).toBe(false);
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
    await expect(page.locator('.sc-tools')).toBeVisible();
    await expect(page.locator('.sc-preview-note')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      820,
    );
    const toggle = await page.locator('.sc-panel-toggle').boundingBox();
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(820);
  });
});

test('growing a window past phone size switches back to the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => preview(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => preview(page)).toBe(false);
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
  await expect(page.locator('.sc-tools')).toBeVisible();
});
