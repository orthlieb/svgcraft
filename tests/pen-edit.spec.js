// The Pen on a selected path: an open path's end carries it on (and its
// other end closes it), a point is deleted, a line gets a new point; Shift
// starts a new path anyway. Works through the path's transform.
import { test, expect } from './fixtures.js';

// An open zigzag, drawn at half size and moved: its local coordinates
// aren't the document's.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <path id="z" d="M40 40 L200 40 L200 200 L360 200" transform="translate(20 20) scale(0.5)"
    fill="none" stroke="#000" stroke-width="2"/></svg>`;

async function penOn(page) {
  await page.evaluate((s) => window.openSvg(s, 'pen.svg'), SVG);
  await page.evaluate(() => (window.svgcraft.state.sel = [document.getElementById('z')]));
  await page.keyboard.press('p');
}
// Page position of a point in the zigzag's own coordinates.
const at = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(document.getElementById('z').getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
const d = (page) => page.evaluate(() => document.getElementById('z').getAttribute('d'));
const paths = (page) => page.locator('#sc-doc path').count();
const cursor = (page) => page.evaluate(() => window.svgcraft.tools.pen.hover?.kind ?? null);

test('the Pen carries an open path on from its end and closes it on the other', async ({
  page,
}) => {
  await penOn(page);
  const end = await at(page, 360, 200);
  await page.mouse.move(end.x, end.y);
  expect(await cursor(page)).toBe('cont');
  await page.mouse.click(end.x, end.y);
  const p = await at(page, 360, 40);
  await page.mouse.click(p.x, p.y);
  const start = await at(page, 40, 40);
  await page.mouse.click(start.x, start.y);
  // One path still, now closed, with the new point, in its own coordinates.
  expect(await paths(page)).toBe(1);
  expect(await d(page)).toMatch(/^M40 40L200 40L200 200L360 200L360 40Z$/);
});

test('carrying on from the first point keeps the path’s direction; Enter leaves it open', async ({
  page,
}) => {
  await penOn(page);
  const s = await at(page, 40, 40);
  await page.mouse.click(s.x, s.y);
  const p = await at(page, 40, 200);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Enter');
  expect(await d(page)).toMatch(/^M40 200L40 40L200 40L200 200L360 200$/);
  await page.keyboard.press('Control+z');
  expect(await d(page)).toBe('M40 40 L200 40 L200 200 L360 200');
});

test('the Pen deletes a point, and adds one on a line', async ({ page }) => {
  await penOn(page);
  const mid = await at(page, 200, 40);
  await page.mouse.move(mid.x, mid.y);
  expect(await cursor(page)).toBe('del');
  await page.mouse.click(mid.x, mid.y);
  expect(await d(page)).toMatch(/^M40 40L200 200L360 200$/);

  const on = await at(page, 280, 200);
  await page.mouse.move(on.x, on.y + 2);
  expect(await cursor(page)).toBe('add');
  await page.mouse.click(on.x, on.y + 2);
  expect(await d(page)).toMatch(/^M40 40L200 200L28\d(\.\d+)? 200L360 200$/);
  expect(await paths(page)).toBe(1);
});

test('Shift starts a new path even over the selected one; away from it, a new path', async ({
  page,
}) => {
  await penOn(page);
  const mid = await at(page, 200, 40);
  await page.keyboard.down('Shift');
  await page.mouse.move(mid.x, mid.y);
  expect(await cursor(page)).toBe(null);
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.up('Shift');
  await page.mouse.click(mid.x + 80, mid.y + 120);
  await page.keyboard.press('Enter');
  expect(await paths(page)).toBe(2);
  expect(await d(page)).toBe('M40 40 L200 40 L200 200 L360 200');
});
