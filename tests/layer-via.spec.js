import { test, expect, load, select, menuOff } from './fixtures.js';

// Layer → New → Layer via Copy (Ctrl+J) and Layer via Cut (Alt+Shift+J):
// whole layers, shapes picked inside a group, or points picked with Edit
// Points, onto a new layer above.

const SQUARE = '<path id="p" d="M0 0L100 0L100 100L0 100Z" fill="#2563eb" stroke="#000000"/>';
const GROUP =
  '<g id="g" transform="translate(50 40)"><rect id="r" x="10" y="10" width="40" height="30" fill="#dc2626"/>' +
  '<circle id="c" cx="120" cy="60" r="20" fill="#16a34a"/></g><rect id="top" x="300" y="300" width="20" height="20"/>';

const order = (page) => page.$$eval('#sc-doc > *', (els) => els.map((e) => e.id || e.localName));
const selIds = (page) =>
  page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id || e.getAttribute('d')));
const box = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
  }, sel);
// Edit Points on #id with these points picked.
const pickPoints = (page, id, picked) =>
  page.evaluate(
    ([id, picked]) => {
      const s = window.svgcraft;
      s.setTool('node');
      s.tools.node.target(document.getElementById(id));
      s.tools.node.picked = picked;
    },
    [id, picked],
  );

test('the menus in the familiar order: Layer between Image and Object, Window before Help', async ({
  page,
}) => {
  await expect(page.locator('.sc-menu-btn')).toHaveText([
    'File',
    'Edit',
    'Image',
    'Layer',
    'Object',
    'Type',
    'Select',
    'View',
    'Window',
    'Help',
  ]);
});

test('Layer via Copy copies whole layers in place; Duplicate Layer offsets', async ({ page }) => {
  await load(page, SQUARE);
  await select(page, 'p');
  const before = await box(page, '#p');
  await page.keyboard.press('Control+j');
  await expect(page.locator('#sc-doc > path')).toHaveCount(2);
  expect(await box(page, '#sc-doc > path:nth-child(2)')).toEqual(before);
  // The copy is the new layer above, and selected.
  expect(
    await page.evaluate(
      () => window.svgcraft.state.sel[0] === document.querySelector('#sc-doc > path:nth-child(2)'),
    ),
  ).toBe(true);
  await page.evaluate(() => window.svgcraft.actions.duplicate());
  const dup = await box(page, '#sc-doc > path:nth-child(3)');
  expect(dup[0]).toBeGreaterThan(before[0]);
});

test('Layer via Copy with points: the picked segments become a new path', async ({ page }) => {
  await load(page, SQUARE);
  await pickPoints(page, 'p', [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
  await page.keyboard.press('Control+j');
  await expect(page.locator('#sc-doc > path')).toHaveCount(2);
  // The original is untouched; the copy runs along its top and right sides.
  await expect(page.locator('#p')).toHaveAttribute('d', 'M0 0L100 0L100 100L0 100Z');
  const copy = page.locator('#sc-doc > path:nth-child(2)');
  await expect(copy).toHaveAttribute('d', 'M0 0L100 0L100 100');
  await expect(copy).toHaveAttribute('stroke', '#000000');
  await expect(copy).not.toHaveAttribute('id', /./);
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
  expect(await page.evaluate(() => window.svgcraft.state.sel[0].getAttribute('d'))).toBe(
    'M0 0L100 0L100 100',
  );
});

test('Layer via Cut with points splits the path where they were taken', async ({ page }) => {
  await load(page, SQUARE);
  await pickPoints(page, 'p', [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
  await page.keyboard.press('Alt+Shift+KeyJ');
  // What's left runs from where the cut ended round to where it began.
  await expect(page.locator('#p')).toHaveAttribute('d', 'M100 100L0 100L0 0');
  await expect(page.locator('#sc-doc > path:nth-child(2)')).toHaveAttribute(
    'd',
    'M0 0L100 0L100 100',
  );
  // One step to undo.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc > path')).toHaveCount(1);
  await expect(page.locator('#p')).toHaveAttribute('d', 'M0 0L100 0L100 100L0 100Z');

  // A run that wraps round the start of a closed path stays one piece.
  await pickPoints(page, 'p', [
    [0, 3],
    [0, 0],
    [0, 1],
  ]);
  await page.evaluate(() => window.svgcraft.actions.layerViaCut());
  await expect(page.locator('#p')).toHaveAttribute('d', 'M100 0L100 100L0 100');
  await expect(page.locator('#sc-doc > path:nth-child(2)')).toHaveAttribute(
    'd',
    'M0 100L0 0L100 0',
  );
  await page.keyboard.press('Control+z');

  // Cutting every segment takes the whole path.
  await pickPoints(page, 'p', [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ]);
  await page.evaluate(() => window.svgcraft.actions.layerViaCut());
  await expect(page.locator('#sc-doc > path')).toHaveCount(1);
  await expect(page.locator('#sc-doc > path')).toHaveAttribute('d', 'M0 0L100 0L100 100L0 100Z');
  await expect(page.locator('#p')).toHaveCount(0);
});

test('Layer via Cut lifts a shape out of its group, looking the same', async ({ page }) => {
  await load(page, GROUP);
  const before = await box(page, '#r');
  await select(page, 'r');
  await page.keyboard.press('Alt+Shift+KeyJ');
  // Just above the group, still where it was on screen.
  expect(await order(page)).toEqual(['g', 'r', 'top']);
  expect(await box(page, '#r')).toEqual(before);
  await expect(page.locator('#g > *')).toHaveCount(1);
  expect(await selIds(page)).toEqual(['r']);
  await expect(page.locator('#sc-msg')).toContainText('Layer via Cut: 1 layer out of the group.');
});

test('Layer via Copy and Cut grey out until there is something to take', async ({ page }) => {
  await load(page, GROUP);
  await menuOff(page, 'Layer', 'layerViaCopy');
  await menuOff(page, 'Layer', 'layerViaCut');
  // A top-level layer can be copied, but there's nothing to cut it out of.
  await select(page, 'top');
  await menuOff(page, 'Layer', 'layerViaCut');
  await page.keyboard.press('Alt+Shift+KeyJ');
  expect(await order(page)).toEqual(['g', 'top']);
  // A single picked point has no segment to take.
  await pickPoints(page, 'top', [[0, 0]]);
  await menuOff(page, 'Layer', 'layerViaCut');
});
