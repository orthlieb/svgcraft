// The Shape Builder (Shift+M): selected shapes split into the regions their
// outlines make; drag across regions to merge them, click one to split it
// out, Alt to delete. What's left becomes separate shapes, all selected.
import { test, expect, load, toScreen, dragDoc } from './fixtures.js';

// Red A (0–100) and blue B (50–150) overlap in the middle: three regions.
const SCENE =
  '<rect id="a" x="0" y="0" width="100" height="100" fill="#dc2626"/>' +
  '<rect id="b" x="50" y="0" width="100" height="100" fill="#2563eb"/>';

async function start(page) {
  await load(page, SCENE, 200, 120);
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.state.sel = [document.getElementById('a'), document.getElementById('b')];
  });
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Shift+M');
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('shapebuilder');
  // The regions are ready once a hover shades one.
  const p = await toScreen(page, 75, 50);
  await expect
    .poll(async () => {
      await page.mouse.move(p.x, p.y);
      return page.locator('#sc-guides .sc-sb-region').count();
    })
    .toBe(1);
}

// Each shape in the drawing: its fill and its box (rounded).
const shapes = (page) =>
  page.$$eval('#sc-doc > *', (els) =>
    els.map((el) => {
      const b = el.getBBox();
      return [el.getAttribute('fill'), Math.round(b.x), Math.round(b.width)];
    }),
  );

const drag = (page, pts, mods = []) => dragDoc(page, pts, { mods, steps: 4 });

test('dragging across regions merges them, styled like the first; the rest stay apart', async ({
  page,
}) => {
  await start(page);
  // From A's own part across the overlap.
  await drag(page, [
    [25, 50],
    [75, 50],
  ]);
  await expect(page.locator('#sc-doc > *')).toHaveCount(2);
  expect(await shapes(page)).toEqual(
    expect.arrayContaining([
      ['#dc2626', 0, 100],
      ['#2563eb', 100, 50],
    ]),
  );
  // Everything made is selected, ready to go on building.
  expect(await page.evaluate(() => window.svgcraft.state.sel.length)).toBe(2);
  await expect(page.locator('#sc-msg')).toContainText('Merged 2 regions');
  // One undo brings the two rectangles back.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc > rect')).toHaveCount(2);
});

test('Alt-click deletes a region; a plain click splits one out', async ({ page }) => {
  await start(page);
  await drag(page, [[75, 50]], ['Alt']);
  await expect(page.locator('#sc-doc > *')).toHaveCount(2);
  expect(await shapes(page)).toEqual(
    expect.arrayContaining([
      ['#dc2626', 0, 50],
      ['#2563eb', 100, 50],
    ]),
  );
  await expect(page.locator('#sc-msg')).toContainText('Deleted 1 region');

  // The two halves left, split again: each click makes a shape of its own.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc > rect')).toHaveCount(2);
  // Undo leaves nothing selected; Select All gives the builder both again.
  await page.keyboard.press('Control+a');
  await expect
    .poll(async () => {
      const p = await toScreen(page, 75, 50);
      await page.mouse.move(p.x, p.y);
      return page.locator('#sc-guides .sc-sb-region').count();
    })
    .toBe(1);
  await drag(page, [[75, 50]]);
  await expect(page.locator('#sc-doc > *')).toHaveCount(3);
  // The overlap took the topmost shape's colour.
  expect(await shapes(page)).toEqual(
    expect.arrayContaining([
      ['#dc2626', 0, 50],
      ['#2563eb', 50, 50],
      ['#2563eb', 100, 50],
    ]),
  );
});

test('with fewer than two shapes selected it says what it needs', async ({ page }) => {
  await load(page, SCENE, 200, 120);
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Shift+M');
  await expect(page.locator('#sc-alert-text')).toContainText('Select two or more');
});
