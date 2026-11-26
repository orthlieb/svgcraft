// The Crop tool (C): a box over the canvas; Enter crops the canvas to it.
// Nothing is deleted: Crop to Drawing brings back what was cropped away.
import { test, expect, load } from './fixtures.js';

const SCENE =
  '<rect id="a" x="100" y="100" width="200" height="100" fill="#dc2626"/>' +
  '<rect id="b" x="500" y="300" width="100" height="100" fill="#2563eb"/>';

// A point on the canvas (document coordinates) on the page.
const at = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(
        document.getElementById('sc-doc').getScreenCTM(),
      );
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
const size = (page) => page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h]);
const corner = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const m = document.getElementById('sc-doc').getCTM().inverse().multiply(el.getCTM());
    const b = el.getBBox();
    const p = new DOMPoint(b.x, b.y).matrixTransform(m);
    return [Math.round(p.x), Math.round(p.y)];
  }, id);
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

test('C picks the Crop tool; its box starts as the canvas and shades what’s cut', async ({
  page,
}) => {
  await load(page, SCENE);
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('c');
  await expect(page.locator('button[data-tool="crop"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sc-crop-w')).toHaveValue('800');
  await expect(page.locator('#sc-crop-h')).toHaveValue('600');
  await expect(page.locator('#sc-guides .sc-crop-box')).toHaveCount(1);
  await expect(page.locator('#sc-guides [data-crop]')).toHaveCount(8);
});

test('a new box dragged out, then Enter crops the canvas to it; the art comes along', async ({
  page,
}) => {
  await load(page, SCENE);
  await page.keyboard.press('c');
  await drag(page, await at(page, 50, 50), await at(page, 350, 250));
  await expect(page.locator('#sc-crop-w')).toHaveValue('300');
  await page.keyboard.press('Enter');
  expect(await size(page)).toEqual([300, 200]);
  // The art keeps its place on screen: a's corner is 50 in from the new one.
  expect(await corner(page, 'a')).toEqual([50, 50]);
  // b, outside, is kept.
  await expect(page.locator('#b')).toBeAttached();
  // Crop to Drawing brings it all back.
  await page.click('[data-for="crop"] [data-action="cropToDrawing"]');
  expect(await size(page)).toEqual([500, 300]);
});

test('dragging an edge resizes the box; Esc puts it back; ✓ crops; undo restores', async ({
  page,
}) => {
  await load(page, SCENE);
  await page.keyboard.press('c');
  await drag(page, await at(page, 800, 300), await at(page, 400, 300));
  await expect(page.locator('#sc-crop-w')).toHaveValue('400');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-crop-w')).toHaveValue('800');
  await drag(page, await at(page, 400, 600), await at(page, 400, 450));
  await page.locator('#sc-crop-w').fill('500');
  await page.locator('#sc-crop-w').press('Tab');
  await page.click('#sc-crop-apply');
  expect(await size(page)).toEqual([500, 450]);
  await page.keyboard.press('Control+z');
  expect(await size(page)).toEqual([800, 600]);
});

test('a file saved with artboards opens with its first as the canvas', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 0 400 100" ' +
        'data-sc-artboards=\'[{"name":"A","x":0,"y":0,"w":200,"h":100},{"name":"B","x":-50,"y":0,"w":40,"h":40}]\'>' +
        '<rect id="r" x="10" y="10" width="20" height="20"/><rect id="s" x="-40" y="5" width="10" height="10"/></svg>',
      'old.svg',
    ),
  );
  expect(await size(page)).toEqual([200, 100]);
  expect(await corner(page, 'r')).toEqual([10, 10]);
  // The art from the other artboard is kept, outside the canvas.
  expect(await corner(page, 's')).toEqual([-40, 5]);
  const saved = await page.evaluate(() => window.svgcraft.serialize());
  expect(saved).not.toContain('data-sc-artboards');
});
