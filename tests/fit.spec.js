// A drawing fitted to the window stays fitted while the canvas changes size,
// until you zoom or pan it; and comes back fitted.
import { test, expect, load } from './fixtures.js';

const zoom = (page) => page.evaluate(() => window.svgcraft.state.zoom);
// What Fit would give now, leaving the view as it was.
const fitZoom = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    const was = [s.zoom, s.panX, s.panY];
    window.svgcraft.actions.fit();
    const z = s.zoom;
    [s.zoom, s.panX, s.panY] = was;
    return z;
  });
const BIG = '<rect width="2000" height="1200" fill="#2563eb"/>';

test('a fitted drawing refits as the canvas changes size; a zoomed one stays put', async ({
  page,
}) => {
  await load(page, BIG, 2000, 1200);
  const z0 = await zoom(page);
  expect(z0).toBeCloseTo(await fitZoom(page), 6);
  // SVG Source docks beside the canvas: narrower, still fitted.
  await page.keyboard.press('Control+u');
  await expect(page.locator('#sc-source')).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(z0);
  expect(await zoom(page)).toBeCloseTo(await fitZoom(page), 6);
  await page.keyboard.press('Control+u');
  await expect.poll(() => zoom(page)).toBeCloseTo(z0, 6);
  // Zoomed by hand: the canvas changing size leaves the view alone.
  await page.click('#sc-stage', { position: { x: 5, y: 5 } });
  await page.keyboard.press('=');
  const z1 = await zoom(page);
  await page.keyboard.press('Control+u');
  await expect(page.locator('#sc-source')).toBeVisible();
  await page.waitForTimeout(200);
  expect(await zoom(page)).toBe(z1);
});

test('a fitted drawing comes back fitted to the window it reopens in', async ({ page }) => {
  await page.evaluate((b) => {
    window.svgcraft.openSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1200">${b}</svg>`,
      'big.svg',
    );
  }, BIG);
  await page.waitForTimeout(600); // saved
  await page.setViewportSize({ width: 900, height: 700 });
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  await expect.poll(() => page.evaluate(() => window.svgcraft.state.fileName)).toBe('big');
  expect(await zoom(page)).toBeCloseTo(await fitZoom(page), 6);
});
