// Object → Path → Simplify…: fewer points and smoother outlines, with a
// live preview and the point count; Cancel puts it back, OK is one undo.
import { test, expect, load, select, menu } from './fixtures.js';

// A wobbly ring of 200 points (a too-detailed trace) and a speck beside it.
const blob = () => {
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const t = (i / 200) * Math.PI * 2;
    const r = 100 + ((i * 7919) % 5) - 2;
    pts.push(`${(200 + r * Math.cos(t)).toFixed(2)} ${(200 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}ZM350 50l3 0l0 3Z`;
};
const BODY =
  `<path id="b" d="${blob()}" fill="#2563eb"/>` +
  '<polygon id="g" points="400,300 420,301 440,299 460,300 480,302 500,300 500,380 400,380" fill="#16a34a"/>' +
  '<rect id="r" x="10" y="10" width="40" height="40"/>';
const amount = async (page, v) => {
  await page.fill('[data-simp="amount"] input[type=number]', String(v));
  await page.dispatchEvent('[data-simp="amount"] input[type=number]', 'input');
  await page.waitForTimeout(100);
};
const nodes = (page, id) =>
  page.evaluate(
    (id) =>
      window.svgcraft
        .shapeNodes(document.getElementById(id))
        .reduce((a, s) => a + s.nodes.length, 0),
    id,
  );

test('Simplify thins a jagged path, removes specks, previews and undoes', async ({ page }) => {
  await load(page, BODY, 600, 420);
  const d0 = await page.getAttribute('#b', 'd');
  await select(page, 'b');
  await menu(page, 'Object', 'simplifyPath');
  await expect(page.locator('#sc-simplify')).toBeVisible();
  await amount(page, 60);
  // The count, and the drawing previewing it.
  await expect(page.locator('[data-simp-count]')).toHaveText(/^203 points → \d+$/);
  const after = +(await page.textContent('[data-simp-count]')).split('→ ')[1];
  expect(after).toBeLessThan(40);
  expect(await page.getAttribute('#b', 'd')).not.toBe(d0);
  // Preview off shows it as it was.
  await page.uncheck('[data-simp-preview]');
  expect(await page.getAttribute('#b', 'd')).toBe(d0);
  await page.check('[data-simp-preview]');
  await page.click('[data-simp-btn="ok"]');
  await expect(page.locator('#sc-simplify')).toBeHidden();
  expect(await nodes(page, 'b')).toBe(after);
  // Curves now, the speck gone, the outline where it was.
  const d1 = await page.getAttribute('#b', 'd');
  expect(d1).toMatch(/C/);
  expect((d1.match(/M/g) || []).length).toBe(1);
  const box1 = await page.evaluate(() => {
    const b = document.getElementById('b').getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  // (The ring alone: about 98–302 each way; the speck stretched the box before.)
  for (const k of ['x', 'y']) expect(Math.abs(box1[k] - 100)).toBeLessThan(6);
  for (const k of ['width', 'height']) expect(Math.abs(box1[k] - 200)).toBeLessThan(8);
  // One undo puts it back.
  await page.keyboard.press('Control+z');
  expect(await page.getAttribute('#b', 'd')).toBe(d0);
});

test('Simplify: Cancel puts it back; straight lines; polygons become paths', async ({ page }) => {
  await load(page, BODY, 600, 420);
  const d0 = await page.getAttribute('#b', 'd');
  await select(page, 'b');
  await menu(page, 'Object', 'simplifyPath');
  await amount(page, 80);
  await page.click('[data-simp-btn="cancel"]');
  expect(await page.getAttribute('#b', 'd')).toBe(d0);

  await select(page, 'g');
  await menu(page, 'Object', 'simplifyPath');
  await page.check('[data-simp-opt="straight"]');
  await amount(page, 50);
  await page.click('[data-simp-btn="ok"]');
  // The wobbly top is one straight edge now: four corners.
  const el = page.locator('#sc-doc path[fill="#16a34a"]');
  await expect(el).toHaveCount(1);
  const d = await el.getAttribute('d');
  expect(d).not.toMatch(/C/);
  expect((d.match(/L/g) || []).length).toBe(3);
});

test('Simplify needs a path, polygon or polyline', async ({ page }) => {
  await load(page, BODY, 600, 420);
  await select(page, 'r');
  await page.click('.sc-menu-btn:text-is("Object")');
  await page.hover('.sc-sub-btn:has-text("Path")');
  await expect(
    page.locator('.sc-sub-list:not([hidden]) [data-action="simplifyPath"]'),
  ).toBeDisabled();
});
