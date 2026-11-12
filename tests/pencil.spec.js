// The Pencil: freehand lines simplified as they're drawn (Smoothing), with
// sharp turns kept as corners (Corners).
import { test, expect, load, toScreen } from './fixtures.js';

// A zigzag of two legs, drawn point by point; `hold` keeps the button down.
async function draw(page, pts, hold = false) {
  const at = [];
  for (const p of pts) at.push(await toScreen(page, ...p));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  if (!hold) await page.mouse.up();
}
const VEE = [
  ...Array.from({ length: 21 }, (_, i) => [100 + i * 5, 100 + i * 10 + (i % 2)]),
  ...Array.from({ length: 20 }, (_, i) => [205 + i * 5, 290 - i * 10 + (i % 2)]),
];
const nodesOf = (page) =>
  page.evaluate(
    () => window.svgcraft.shapeNodes(document.querySelector('#sc-doc > path:last-child'))[0].nodes,
  );

test('the Pencil simplifies as it draws, keeping sharp turns as corners', async ({ page }) => {
  await load(page, '', 600, 400);
  await page.keyboard.press('b');
  // While the button is still down, the line is already simplified: a few
  // points, not the 41 drawn through.
  await draw(page, VEE, true);
  await page.waitForTimeout(50);
  const live = await page.locator('#sc-doc > path').last().getAttribute('d');
  expect((live.match(/[LC]/g) || []).length).toBeLessThan(12);
  await page.mouse.up();
  const nodes = await nodesOf(page);
  expect(nodes.length).toBeLessThan(12);
  // The bottom of the V is a corner (no handles); 180° makes it a curve.
  const tip = nodes.reduce((a, n) => (n.y > a.y ? n : a));
  expect(tip.hin || tip.hout).toBeFalsy();
  await page.fill('#sc-pencil-corners', '180');
  await page.dispatchEvent('#sc-pencil-corners', 'input');
  await draw(
    page,
    VEE.map(([x, y]) => [x + 250, y]),
  );
  const smooth = await nodesOf(page);
  expect(smooth.every((n, i) => i === 0 || i === smooth.length - 1 || (n.hin && n.hout))).toBe(
    true,
  );
  // Smoothing 0 keeps every point drawn through.
  await page.fill('#sc-smooth', '0');
  await page.dispatchEvent('#sc-smooth', 'input');
  await draw(
    page,
    VEE.map(([x, y]) => [x, y + 0.5]),
  );
  expect((await nodesOf(page)).length).toBeGreaterThan(30);
});
