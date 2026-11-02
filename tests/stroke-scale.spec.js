// Scaling keeps stroke widths: a rectangle, ellipse or line takes its new
// size into its geometry (no transform), so its stroke stays as set; a path
// or group keeps its transform with its stroke widths divided by the scale.
import { test, expect, load, select as pick } from './fixtures.js';

async function select(page, id) {
  await pick(page, id);
  // eslint-disable-next-line no-undef -- the editor's own global
  await page.evaluate(() => drawSelection());
}

const SCENE =
  '<rect id="r" x="20" y="20" width="100" height="50" fill="#e8a33d" stroke="#1f2933" stroke-width="10"/>' +
  '<ellipse id="e" cx="300" cy="60" rx="40" ry="30" fill="none" stroke="#1f2933" stroke-width="4"/>' +
  '<path id="p" d="M20 200h100v50h-100z" fill="none" stroke="#1f2933" stroke-width="6"/>';

const attrs = (page, id, names) =>
  page.$eval(
    `#${id}`,
    (el, names) => Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])),
    names,
  );

// Drag a selection handle by (dx, dy) screen pixels.
async function dragHandle(page, k, dx, dy) {
  const b = await page.locator(`[data-handle="${k}"]`).boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}
const zoom = (page) => page.evaluate(() => window.svgcraft.state.zoom);

test('a rectangle scaled with its handles takes the new size; its stroke stays as set', async ({
  page,
}) => {
  await load(page, SCENE, 400, 300);
  await select(page, 'r');
  const z = await zoom(page);
  // Twice as wide, three times as tall (the box includes the stroke).
  await dragHandle(page, 'se', 110 * z, 120 * z);
  const a = await attrs(page, 'r', ['transform', 'stroke-width', 'x', 'y', 'width', 'height']);
  expect(a.transform).toBeNull();
  expect(a['stroke-width']).toBe('10');
  expect(+a.x).toBeCloseTo(20, 0);
  expect(+a.width).toBeGreaterThan(190);
  expect(+a.height).toBeGreaterThan(140);
  // The Width field still shows it.
  await expect(page.locator('#sc-appearance input[data-bind="strokeWidth"]')).toHaveValue('10');
  // One undo puts it back.
  await page.keyboard.press('Control+z');
  expect(await attrs(page, 'r', ['width', 'transform'])).toEqual({
    width: '100',
    transform: null,
  });
});

// Free Transform's W field, then Enter to finish.
async function stretchTo(page, w) {
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Alt+t');
  await page.fill('.sc-opt.on [data-tf="w"]', String(w));
  await page.press('.sc-opt.on [data-tf="w"]', 'Enter');
  await page.keyboard.press('Enter');
}

test('Free Transform scales an ellipse the same way; a path keeps its transform, stroke divided', async ({
  page,
}) => {
  await load(page, SCENE, 400, 300);
  await select(page, 'e');
  // Twice as wide (W isn't linked to H).
  await stretchTo(page, 160);
  const e = await attrs(page, 'e', ['transform', 'rx', 'ry', 'stroke-width']);
  expect(e).toEqual({ transform: null, rx: '80', ry: '30', 'stroke-width': '4' });
  // A path: the transform stays, its stroke drawn as wide as before.
  await select(page, 'p');
  await stretchTo(page, 200);
  const p = await attrs(page, 'p', ['transform', 'stroke-width']);
  expect(p.transform).toMatch(/^matrix\(2 0 0 1 /);
  // Divided by the overall scale, √2.
  expect(+p['stroke-width']).toBeCloseTo(6 / Math.SQRT2, 3);
});

test('the stroke alignment buttons don’t mark shapes in the drawing', async ({ page }) => {
  await load(
    page,
    '<rect id="r" x="20" y="20" width="100" height="50" fill="#e8a33d" stroke="#000" stroke-width="20" data-stroke-align="inside"/>',
    400,
    300,
  );
  await select(page, 'r');
  await page.locator('button[data-stroke-align="outside"]:visible').first().click();
  expect(await page.locator('#r').getAttribute('aria-checked')).toBeNull();
});
