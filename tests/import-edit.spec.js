// Editing inside an imported (placed) SVG: nested transformed groups, point
// editing a nested path / rect, styling and undo while point editing, layer
// renaming and Inkscape labels.
import { test, expect } from './fixtures.js';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(10 10)"><g transform="rotate(15 40 40)">
    <rect id="r" x="10" y="10" width="40" height="30" fill="#2563eb"/>
    <path id="p" d="M10 70 L60 70 L35 90 Z" fill="#dc2626"/>
  </g></g></svg>`;

async function placeIcon(page) {
  await page.evaluate((svg) => window.svgcraft.placeSvg(svg), ICON);
}

// Page position of a point given in the local coordinates of the shape with
// that fill colour (inside all its nested transforms).
async function screenOf(page, fill, lx, ly) {
  return page.evaluate(
    ([fill, lx, ly]) => {
      const e = [...document.querySelectorAll('#sc-doc rect, #sc-doc path')].find(
        (x) => x.getAttribute('fill') === fill,
      );
      const p = new DOMPoint(lx, ly).matrixTransform(e.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [fill, lx, ly],
  );
}

// Centre of a point marker in page pixels.
async function markerCentre(page, id) {
  const b = await page.locator(`#sc-nodes [data-node="${id}"]`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function dragBy(page, from, dx, dy, steps = 5) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

const nodes = (page) => page.locator('#sc-nodes [data-node]');
const tool = (page) => page.evaluate(() => window.svgcraft.state.tool);
const target = (page) =>
  page.evaluate(() => {
    const el = window.svgcraft.tools.node.el;
    return (
      el && { tag: el.localName, parent: el.parentNode.localName, fill: el.getAttribute('fill') }
    );
  });

// Place the icon and double-click the red triangle to point-edit it.
async function editTriangle(page) {
  await placeIcon(page);
  await page.keyboard.press('v');
  const p = await screenOf(page, '#dc2626', 35, 75);
  await page.mouse.dblclick(p.x, p.y);
  await expect(nodes(page)).toHaveCount(3);
}

test('placing an SVG wraps it in one group and keeps its nested groups', async ({ page }) => {
  await placeIcon(page);
  // wrapper group, translate group, rotate group, rect, path
  await expect(page.locator('#sc-layers li')).toHaveCount(5);
  expect(
    await page.evaluate(() => document.querySelector('#sc-doc').firstElementChild.localName),
  ).toBe('g');
});

test('double-clicking a path inside nested groups point-edits that path, markers on its corners', async ({
  page,
}) => {
  await editTriangle(page);
  expect(await tool(page)).toBe('node');
  expect((await target(page)).fill).toBe('#dc2626');
  // The marker for (10,70) sits on the real corner, nested transforms composed.
  const want = await screenOf(page, '#dc2626', 10, 70);
  const got = await markerCentre(page, '0:0');
  expect(got.x).toBeCloseTo(want.x, 0);
  expect(got.y).toBeCloseTo(want.y, 0);
});

test('a nested point can be moved, a point added on an edge and deleted again', async ({
  page,
}) => {
  await editTriangle(page);
  const d = () => page.evaluate(() => window.svgcraft.tools.node.el.getAttribute('d'));

  const n1 = await markerCentre(page, '0:1');
  const n1Box = await page.locator('#sc-nodes [data-node="0:1"]').boundingBox();
  const drop = { x: n1Box.x + 40, y: n1Box.y + 30 };
  await dragBy(page, n1, drop.x - n1.x, drop.y - n1.y);
  // Only the dragged point (was 60,70) changes, and it lands under the cursor.
  expect(await d()).toMatch(/^M10 70L(?!60 70L)[-\d.]+ [-\d.]+L35 90Z$/);
  const moved = await markerCentre(page, '0:1');
  expect(moved.x).toBeCloseTo(drop.x, 0);
  expect(moved.y).toBeCloseTo(drop.y, 0);

  // Wait out the "this click picked the shape" window, then add a point on
  // the edge from node 0 (10,70) toward node 2 (35,90).
  await page.waitForFunction(
    () => performance.now() - (window.svgcraft.tools.node.targetedAt ?? -1e9) > 500,
  );
  const mid = await screenOf(page, '#dc2626', 25, 79);
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(nodes(page)).toHaveCount(4);

  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(3);
});

test('a nested rect becomes a path in place when edited; fill and undo/redo hit only it', async ({
  page,
}) => {
  await editTriangle(page);

  // Clicking the rect in the node tool targets it without converting it yet.
  const rc = await screenOf(page, '#2563eb', 30, 25);
  await page.mouse.click(rc.x, rc.y);
  expect(await target(page)).toEqual({ tag: 'rect', parent: 'g', fill: '#2563eb' });

  await dragBy(page, await markerCentre(page, '0:0'), -20, -20, 4);
  expect(await target(page)).toEqual({ tag: 'path', parent: 'g', fill: '#2563eb' });

  // A colour change while point editing applies only to the edited shape.
  await page.fill('#sc-fill-hex', '#16a34a');
  await page.press('#sc-fill-hex', 'Enter');
  const fills = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc path, #sc-doc rect')].map(
        (p) => `${p.localName} ${p.getAttribute('fill')}`,
      ),
    );
  expect(await fills()).toEqual(['path #16a34a', 'path #dc2626']);

  // Shortcuts are ignored while typing, so leave the hex field first.
  await page.locator('#sc-fill-hex').blur();
  await page.keyboard.press('Control+z');
  expect(await fills(), 'undo the fill change').toEqual(['path #2563eb', 'path #dc2626']);
  expect(await target(page)).toEqual({ tag: 'path', parent: 'g', fill: '#2563eb' });

  await page.keyboard.press('Control+z');
  expect(await fills(), 'undo the point drag').toEqual(['rect #2563eb', 'path #dc2626']);
  expect(await target(page), 'still point-editing the restored rect').toEqual({
    tag: 'rect',
    parent: 'g',
    fill: '#2563eb',
  });
  await expect(nodes(page)).toHaveCount(4);

  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  expect(await fills(), 'redo both').toEqual(['path #16a34a', 'path #dc2626']);
});

test('a layer can be renamed; Esc cancels and an empty name restores the automatic one', async ({
  page,
}) => {
  await placeIcon(page);
  const name = page.locator('#sc-layers .sc-layer-name').first();
  await expect(name).toHaveText('Pasted SVG');
  // On the name's text: the empty row after it opens Layer Style.

  await name.dblclick({ position: { x: 8, y: 6 } });
  await page.keyboard.type('Logo');
  await page.keyboard.press('Enter');
  await expect(name).toHaveText('Logo');
  expect(
    await page.evaluate(() => document.querySelector('#sc-doc > g').getAttribute('data-name')),
  ).toBe('Logo');
  expect(await page.evaluate(() => window.svgcraft.serialize())).toContain('data-name="Logo"');

  await name.dblclick({ position: { x: 8, y: 6 } });
  await page.keyboard.type('nope');
  await page.keyboard.press('Escape');
  await expect(name).toHaveText('Logo');

  await name.dblclick({ position: { x: 8, y: 6 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  // The automatic name: a group with one child.
  await expect(name).toHaveText('group (1)');
  await expect(page.locator('#sc-layers li')).toHaveCount(5);
});

test('an Inkscape layer label is read as the layer name on open', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><g inkscape:label="Background"><rect width="5" height="5"/></g></svg>',
      'i.svg',
    ),
  );
  await expect(page.locator('#sc-layers .sc-layer-name').first()).toHaveText('Background');
});
