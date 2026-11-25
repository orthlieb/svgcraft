// Adding points on open paths in Direct Selection: a double-click near a
// thin line counts, and one on a filled path's gap closes it with a point
// there. The gap shows dashed; Close / open says what it did.
import { test, expect } from './fixtures.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <path id="line" d="M40 40 L200 40 L200 140" fill="none" stroke="#000" stroke-width="1"/>
  <path id="wedge" d="M240 260 L360 160 L380 260" fill="#000"/></svg>`;

async function edit(page, id) {
  await page.evaluate((s) => window.openSvg(s, 'open.svg'), SVG);
  await page.keyboard.press('a');
  await page.evaluate((id) => window.svgcraft.tools.node.target(document.getElementById(id)), id);
  // Wait out the "this click picked the shape" window.
  await page.waitForFunction(
    () => performance.now() - (window.svgcraft.tools.node.targetedAt ?? -1e9) > 500,
  );
}
const screen = (page, id, x, y) =>
  page.evaluate(
    ([id, x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(document.getElementById(id).getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [id, x, y],
  );
const nodes = (page) => page.locator('#sc-nodes [data-node]');
const d = (page, id) => page.evaluate((id) => document.getElementById(id).getAttribute('d'), id);

test('a double-click just off a thin open line adds a point; far off, nothing', async ({
  page,
}) => {
  await edit(page, 'line');
  await expect(nodes(page)).toHaveCount(3);
  // The gap shows dashed while the path is open.
  await expect(page.locator('#sc-nodes line.sc-ov-dash')).toHaveCount(1);
  const p = await screen(page, 'line', 120, 40);
  await page.mouse.dblclick(p.x, p.y + 30);
  await expect(nodes(page)).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.mouse.dblclick(p.x, p.y + 5);
  await expect(nodes(page)).toHaveCount(4);
  expect(await d(page, 'line')).not.toMatch(/Z/i);
});

test('a double-click on a filled open path’s gap closes it with a point there', async ({
  page,
}) => {
  await edit(page, 'wedge');
  const p = await screen(page, 'wedge', 310, 260);
  await page.mouse.dblclick(p.x, p.y);
  await expect(nodes(page)).toHaveCount(4);
  expect(await d(page, 'wedge')).toMatch(/Z$/);
  await expect(page.locator('#sc-nodes line.sc-ov-dash')).toHaveCount(0);
  // The new point is on the old gap, between the last point and the first.
  const nd = await page.evaluate(() => window.svgcraft.tools.node.targets[0].subs[0].nodes[3]);
  expect(nd.y).toBeCloseTo(260, 0);
  expect(nd.x).toBeCloseTo(310, -1);
});

test('Close / open says which way it went', async ({ page }) => {
  await edit(page, 'wedge');
  await page.click('button:has-text("Close / open")');
  expect(await d(page, 'wedge')).toMatch(/Z$/);
  await expect(page.locator('body')).toContainText('Path closed');
  await page.click('button:has-text("Close / open")');
  expect(await d(page, 'wedge')).not.toMatch(/Z/i);
  await expect(page.locator('body')).toContainText('Path opened');
  await expect(page.locator('#sc-nodes line.sc-ov-dash')).toHaveCount(1);
});
