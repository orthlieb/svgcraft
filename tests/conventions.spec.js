// Familiar conventions: the toolbar's order, the Layers panel's footer,
// Alt-click to show one layer, double-click a row for Layer Style, and
// Edit → Cut / Copy / Paste.
import { test, expect, menuOff } from './fixtures.js';

const open = (page) =>
  page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
        '<rect id="a" data-name="A" x="10" y="10" width="50" height="50" fill="#dc2626"/>' +
        '<g id="g" data-name="G"><rect id="b" data-name="B" x="100" y="10" width="50" height="50"/>' +
        '<rect id="c" data-name="C" x="200" y="10" width="50" height="50" display="none"/></g>' +
        '<rect id="d" data-name="D" x="300" y="10" width="50" height="50"/></svg>',
      'parity.svg',
    ),
  );
const row = (page, name) =>
  page.locator('#sc-layers li', {
    has: page.locator('.sc-layer-name', { hasText: new RegExp(`^${name}$`) }),
  });
const shown = (page) =>
  page.$$eval('#sc-doc [data-name]', (els) =>
    els.filter((e) => e.getAttribute('display') !== 'none').map((e) => e.dataset.name),
  );

test('the toolbar runs in the familiar order', async ({ page }) => {
  const order = await page.$$eval('.sc-tools > button', (bs) =>
    bs.map((b) => b.dataset.tool || b.id),
  );
  expect(order).toEqual([
    'select',
    'eyedropper',
    'pencil',
    'eraser',
    'pen',
    'text',
    'node',
    'sc-shape-btn',
    'artboard',
    'shapebuilder',
    'hand',
    'zoom',
  ]);
});

test('the Layers footer: fx, clipping mask, group, new, delete', async ({ page }) => {
  const order = await page.$$eval('.sc-layers-foot button', (bs) =>
    bs.map((b) => b.dataset.action),
  );
  expect(order).toEqual(['layerStyle', 'clipMake', 'group', 'duplicate', 'delete']);
});

test('Alt-click an eye shows only that layer; again, the rest come back', async ({ page }) => {
  await open(page);
  await row(page, 'B')
    .locator('.sc-eye')
    .click({ modifiers: ['Alt'] });
  // B and its group show; A, C (beside B) and D hide.
  expect(await shown(page)).toEqual(['G', 'B']);
  await row(page, 'B')
    .locator('.sc-eye')
    .click({ modifiers: ['Alt'] });
  // Back as they were: C stays hidden.
  expect(await shown(page)).toEqual(['A', 'G', 'B', 'D']);
  // One undo step each way.
  await page.keyboard.press('Control+z');
  expect(await shown(page)).toEqual(['G', 'B']);
});

test('double-clicking a row (not its name) opens Layer Style', async ({ page }) => {
  await open(page);
  const r = row(page, 'D');
  // Selecting it first: a rectangle's corner settings open in Properties
  // and move the list down.
  await r.click();
  const box = await r.boundingBox();
  await r.dblclick({ position: { x: box.width - 12, y: box.height / 2 } });
  await expect(page.locator('#sc-fx')).toBeVisible();
  expect(await page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id))).toEqual(['d']);
});

test('Edit → Cut, Copy and Paste go through the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await menuOff(page, 'Edit', 'copy');
  await row(page, 'A').click();
  await page.click('.sc-menu-btn:text-is("Edit")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="copy"]');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('data-name="A"');
  await page.click('.sc-menu-btn:text-is("Edit")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="cut"]');
  await expect(page.locator('#a')).toHaveCount(0);
  await page.click('.sc-menu-btn:text-is("Edit")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="paste"]');
  await expect.poll(() => page.locator('#sc-doc rect[fill="#dc2626"]').count()).toBe(1);
});
