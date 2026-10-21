// The Zoom tool: click / Alt-click steps, Zoom Out mode, scrubby drag, box
// zoom, Fill Screen, double-click for 100%, the max clamp and its tooltip.
import { test, expect, load, action, stageBox } from './fixtures.js';

const zoom = (page) => page.evaluate(() => window.svgcraft.state.zoom);
const cursor = (page) => page.evaluate(() => document.getElementById('sc-stage').style.cursor);

// Doc point under a page-pixel point.
const docAt = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const s = window.svgcraft.state;
      const r = document.getElementById('sc-stage').getBoundingClientRect();
      return { x: (x - r.left - s.panX) / s.zoom, y: (y - r.top - s.panY) / s.zoom };
    },
    [x, y],
  );

function expectSamePoint(a, b) {
  expect(a.x).toBeCloseTo(b.x, 2);
  expect(a.y).toBeCloseTo(b.y, 2);
}

let sr, cx, cy;

test.beforeEach(async ({ page }) => {
  await load(page, '<rect x="100" y="100" width="50" height="50"/>', 800, 600, 'z.svg');
  sr = await stageBox(page);
  cx = sr.x + 500;
  cy = sr.y + 300;
});

// Pick the Zoom tool with Z and reset to 100%.
async function zoomTool(page) {
  await page.keyboard.press('z');
  await action(page, 'zoom100');
  expect(await zoom(page)).toBe(1);
}

test('Z selects the Zoom tool with its cursor and options', async ({ page }) => {
  await page.keyboard.press('z');
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('zoom');
  expect(await cursor(page)).toBe('zoom-in');
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-opt.on')].map((o) => o.dataset.for).join('/'),
  );
  expect(opts).toBe('zoom/hand zoom');
  await expect(page.locator('#sc-opt-name')).toHaveText('Zoom');
});

test('click zooms in a step about the click point', async ({ page }) => {
  await zoomTool(page);
  const before = await docAt(page, cx, cy);
  await page.mouse.click(cx, cy);
  expect(await zoom(page)).toBeCloseTo(2, 4);
  expectSamePoint(await docAt(page, cx, cy), before);
  await page.mouse.click(cx, cy);
  expect(await zoom(page)).toBeCloseTo(3, 4);
});

test('holding Alt shows zoom-out and Alt-click zooms out', async ({ page }) => {
  await zoomTool(page);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await page.keyboard.down('Alt');
  expect(await cursor(page)).toBe('zoom-out');
  await page.mouse.click(cx, cy);
  await page.keyboard.up('Alt');
  expect(await zoom(page)).toBeCloseTo(2, 4);
  expect(await cursor(page)).toBe('zoom-in');
});

test('Zoom Out mode makes a plain click zoom out', async ({ page }) => {
  await zoomTool(page);
  await page.mouse.click(cx, cy);
  await page.click('[data-zoomdir="out"]');
  await page.mouse.click(cx, cy);
  expect(await zoom(page)).toBeCloseTo(1, 4);
  expect(await cursor(page)).toBe('zoom-out');
});

test('scrubby drag zooms exponentially about the press point', async ({ page }) => {
  await zoomTool(page);
  const p0 = await docAt(page, cx, cy);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy, { steps: 5 });
  await page.mouse.move(cx + 100, cy, { steps: 5 });
  await page.mouse.up();
  expect(await zoom(page)).toBeCloseTo(Math.E, 4);
  expectSamePoint(await docAt(page, cx, cy), p0);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 100, cy, { steps: 8 });
  await page.mouse.up();
  expect(await zoom(page)).toBeCloseTo(1, 4);
});

test('with Scrubby Zoom off, a drag draws a marquee and zooms to it', async ({ page }) => {
  await page.keyboard.press('z');
  await page.uncheck('#sc-scrubby');
  await page.click('.sc-opt.on [data-action="zoom100"]');
  const tl = await page.evaluate(() => {
    const s = window.svgcraft.state;
    const r = document.getElementById('sc-stage').getBoundingClientRect();
    return [r.left + s.panX + 100 * s.zoom, r.top + s.panY + 100 * s.zoom];
  });
  await page.mouse.move(tl[0], tl[1]);
  await page.mouse.down();
  await page.mouse.move(tl[0] + 25, tl[1] + 25, { steps: 4 });
  await expect(page.locator('#sc-guides rect')).toHaveCount(1);
  await page.mouse.move(tl[0] + 50, tl[1] + 50, { steps: 4 });
  await page.mouse.up();

  // 50 × 50 doc px box at 100% → fits the box into the stage.
  expect(await zoom(page)).toBeCloseTo(Math.min(sr.width / 50, sr.height / 50), 2);
  const c = await docAt(page, sr.x + sr.width / 2, sr.y + sr.height / 2);
  expectSamePoint(c, { x: 125, y: 125 });
  await expect(page.locator('#sc-guides rect')).toHaveCount(0);
});

test('Fill Screen covers the stage; double-clicking the tool returns to 100%', async ({ page }) => {
  await page.keyboard.press('z');
  await page.click('.sc-opt.on [data-action="fillScreen"]');
  expect(await zoom(page)).toBeCloseTo(Math.max(sr.width / 800, sr.height / 600), 4);
  await page.dblclick('[data-tool="zoom"]');
  expect(await zoom(page)).toBe(1);
});

test('zooming in is clamped at the maximum', async ({ page }) => {
  await page.keyboard.press('z');
  await page.evaluate(() => {
    window.svgcraft.state.zoom = 60;
  });
  await page.mouse.click(cx, cy);
  expect(await zoom(page)).toBe(64);
});

test('the Zoom tool tooltip carries a description', async ({ page }) => {
  await page.mouse.move(700, 450);
  await page.hover('[data-tool="zoom"]');
  await expect(page.locator('.sc-tip')).toHaveText(
    'ZoomZClick to zoom in, Alt-click to zoom out. Drag left or right to zoom smoothly. Double-click for 100%.',
  );
});
