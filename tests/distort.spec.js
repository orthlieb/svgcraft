// Object → Transform → Distort and Perspective: four corner handles that
// reshape the selection's paths and shapes through a projective map.
import { test, expect, load, select, menu } from './fixtures.js';

const BODY =
  '<rect id="r" x="100" y="100" width="200" height="100" fill="#2563eb"/>' +
  '<text id="t" x="400" y="150">Hi</text>';
// Drag a corner handle by (dx, dy) screen pixels.
async function pull(page, i, dx, dy) {
  const b = await page.locator(`[data-handle="q${i}"]`).boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}
// The path's corner points, in document space, rounded.
const corners = (page, sel = '#sc-doc > path') =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const M = el.getCTM();
    const D = document.getElementById('sc-doc').getCTM().inverse();
    return window.svgcraft
      .shapeNodes(el)[0]
      .nodes.map((n) => new DOMPoint(n.x, n.y).matrixTransform(M).matrixTransform(D))
      .map((p) => [Math.round(p.x), Math.round(p.y)]);
  }, sel);

test('Perspective moves a corner and its partner on the same edge the other way', async ({
  page,
}) => {
  await load(page, BODY, 600, 300);
  await select(page, 'r');
  await menu(page, 'Object', 'tfPerspective');
  await expect(page.locator('[data-handle^="q"]')).toHaveCount(4);
  // The number fields don't apply while distorting.
  await expect(page.locator('[data-tf="w"]')).toBeDisabled();
  const z = await page.evaluate(() => window.svgcraft.state.zoom);
  // Top-left in by 40 drawing units: top-right comes in by 40 too.
  await pull(page, 0, 40 * z, 1);
  const c = await corners(page);
  expect(c).toEqual([
    [140, 100],
    [260, 100],
    [300, 200],
    [100, 200],
  ]);
  // Mostly downwards on the bottom-right: the top-right goes up as much.
  await pull(page, 2, 1, 20 * z);
  expect((await corners(page))[1]).toEqual([260, 80]);
  expect((await corners(page))[2]).toEqual([300, 220]);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-handle^="q"]')).toHaveCount(0);
  await expect(page.locator('[data-tf="w"]')).toBeEnabled();
  await expect(page.locator('#sc-doc > rect')).toHaveCount(0);
});

test('Distort moves one corner; Esc puts it all back; text is left alone', async ({ page }) => {
  await load(page, BODY, 600, 300);
  await select(page, 'r', 't');
  await menu(page, 'Object', 'tfDistort');
  const z = await page.evaluate(() => window.svgcraft.state.zoom);
  // The bottom-left corner out and down: the rectangle's bottom-left goes
  // with it, its top-left stays.
  await pull(page, 3, -30 * z, 30 * z);
  const c = await corners(page);
  expect(c[0]).toEqual([100, 100]);
  expect(c[3][0]).toBeLessThan(100);
  expect(c[3][1]).toBeGreaterThan(200);
  await expect(page.locator('#t')).toHaveAttribute('x', '400');
  await page.keyboard.press('Escape');
  await expect(page.locator('#r')).toHaveAttribute('width', '200');
  await expect(page.locator('#sc-doc > path')).toHaveCount(0);
});

test('a selection of only text says it can’t be distorted', async ({ page }) => {
  await load(page, BODY, 600, 300);
  await select(page, 't');
  await menu(page, 'Object', 'tfDistort');
  await expect(page.locator('#sc-alert-text')).toContainText('can’t be');
  await expect(page.locator('[data-handle^="q"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.svgcraft.state.tf)).toBeNull();
});
