import { test, expect, load, toScreen } from './fixtures.js';

// Stroke caps, joins, dash presets and rounded rectangle corners.

const props = '[data-pane="props"]';
const opt = '.sc-opt.on';

// Drag between two document points.
async function drag(page, a, z, steps = 4) {
  const s = await toScreen(page, ...a);
  const t = await toScreen(page, ...z);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps });
  await page.mouse.up();
}

// Drag the centre of a locator by (dx, dy) page pixels.
async function dragBy(page, loc, dx, dy, steps = 5) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}

async function setField(loc, v) {
  await loc.fill(String(v));
  await loc.press('Enter');
}

const attrsOf = (loc, names) =>
  loc.evaluate((el, names) => Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])), names);

const zoom = (page) => page.evaluate(() => window.svgcraft.state.zoom);

test.describe('line caps and dashes from the options bar', () => {
  const line = (page) => page.locator('#sc-doc line');
  const width = (page) => page.locator(`${opt} input[data-bind="strokeWidth"]`);

  // Line tool, square caps, dashed, width 6, drawn 100,100 → 400,100.
  test.beforeEach(async ({ page }) => {
    await page.keyboard.press('l');
    await page.click(`${opt} [data-stroke-cap="square"]`);
    await page.selectOption(`${opt} select[data-stroke-dash]`, 'dash');
    await setField(width(page), 6);
    await drag(page, [100, 100], [400, 100]);
    await expect(line(page)).toHaveCount(1);
  });

  test('a dashed line with square caps shortens dashes by the cap', async ({ page }) => {
    // Dash = 4w 2w; square caps add w/2 at each end, so 3w 3w is drawn.
    expect(
      await attrsOf(line(page), [
        'stroke-width',
        'stroke-linecap',
        'data-dash',
        'stroke-dasharray',
        'x1',
        'y1',
        'x2',
        'y2',
      ]),
    ).toEqual({
      'stroke-width': '6',
      'stroke-linecap': 'square',
      'data-dash': 'dash',
      'stroke-dasharray': '18 18',
      x1: '100',
      y1: '100',
      x2: '400',
      y2: '100',
    });
  });

  test('butt caps use the plain 4w 2w pattern and drop the cap attribute', async ({ page }) => {
    await page.click(`${opt} [data-stroke-cap="butt"]`);
    await expect(line(page)).not.toHaveAttribute('stroke-linecap', /./);
    await expect(line(page)).toHaveAttribute('stroke-dasharray', '24 12');
  });

  test('changing the width rescales the dashes', async ({ page }) => {
    await page.click(`${opt} [data-stroke-cap="butt"]`);
    await setField(width(page), 10);
    await expect(line(page)).toHaveAttribute('stroke-width', '10');
    await expect(line(page)).toHaveAttribute('stroke-dasharray', '40 20');
  });

  test('dotted with round caps uses zero-length dashes', async ({ page }) => {
    await page.click(`${opt} [data-stroke-cap="butt"]`);
    await setField(width(page), 10);
    await page.selectOption(`${opt} select[data-stroke-dash]`, 'dot');
    await page.click(`${opt} [data-stroke-cap="round"]`);
    await expect(line(page)).toHaveAttribute('stroke-linecap', 'round');
    await expect(line(page)).toHaveAttribute('stroke-dasharray', '0 20');
  });
});

test('joins on a pen path are set from Properties; miter is the default', async ({ page }) => {
  await load(page, '');
  await page.keyboard.press('b');
  for (const [x, y] of [
    [100, 250],
    [200, 180],
    [300, 250],
  ]) {
    const p = await toScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  const path = page.locator('#sc-doc path');
  await expect(path).toHaveCount(1);
  await page.keyboard.press('v');
  await page.locator('#sc-layers li').first().click();

  await page.click(`${props} [data-stroke-join="bevel"]`);
  await expect(path).toHaveAttribute('stroke-linejoin', 'bevel');
  await page.click(`${props} [data-stroke-join="round"]`);
  await expect(path).toHaveAttribute('stroke-linejoin', 'round');
  await expect(page.locator(`${props} [data-stroke-join="round"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.click(`${props} [data-stroke-join="miter"]`);
  await expect(path).not.toHaveAttribute('stroke-linejoin', /./);
});

test('selecting a shape reads its cap, join and dash into Properties', async ({ page }) => {
  await load(
    page,
    '<path id="p" d="M100 250L200 180L300 250" fill="none" stroke="#000" stroke-width="4"/>' +
      '<line id="l" x1="100" y1="100" x2="400" y2="100" fill="none" stroke="#1f2933" stroke-width="10"' +
      ' stroke-linecap="round" stroke-linejoin="round" data-dash="dot" stroke-dasharray="0 20"/>',
  );
  await page.locator('#sc-layers li', { hasText: 'line' }).click();
  for (const [k, v] of [
    ['cap', 'round'],
    ['join', 'round'],
  ]) {
    const on = page.locator(`${props} [data-stroke-${k}][aria-checked="true"]`);
    await expect(on).toHaveCount(1);
    await expect(on).toHaveAttribute(`data-stroke-${k}`, v);
  }
  await expect(page.locator(`${props} select[data-stroke-dash]`)).toHaveValue('dot');
});

test('the rect tool draws with the corner radius from the options bar', async ({ page }) => {
  await load(page, '');
  await page.keyboard.press('r');
  await setField(page.locator(`${opt} [data-corner-all]`), 20);
  await drag(page, [100, 350], [300, 470]);
  const r = page.locator('#sc-doc rect');
  await expect(r).toHaveCount(1);
  expect(await attrsOf(r, ['x', 'y', 'width', 'height', 'rx', 'ry'])).toEqual({
    x: '100',
    y: '350',
    width: '200',
    height: '120',
    rx: '20',
    ry: '20',
  });
  await expect(page.locator('#sc-corner-props')).toBeVisible();
  expect(
    await page.$$eval('[data-corner]', (i) =>
      Object.fromEntries(i.map((x) => [x.dataset.corner, x.value])),
    ),
  ).toEqual({ tl: '20', tr: '20', br: '20', bl: '20' });
});

test.describe('rect corner radii', () => {
  const sel = (page) => page.evaluate(() => window.svgcraft.state.sel[0]);
  const selAttrs = (page, names) =>
    page.evaluate((names) => {
      const el = window.svgcraft.state.sel[0];
      return {
        tag: el.localName,
        ...Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])),
      };
    }, names);
  const corner = (page, k) => page.locator(`[data-corner="${k}"]`);

  test.beforeEach(async ({ page }) => {
    await load(
      page,
      '<rect id="r" x="100" y="350" width="200" height="120" rx="20" ry="20" fill="none" stroke="#1f2933" stroke-width="10"/>',
    );
    await page.keyboard.press('v');
    await page.locator('#sc-layers li').first().click();
    await expect(page.locator('#sc-corner-props')).toBeVisible();
    expect(await sel(page)).not.toBeNull();
  });

  test('unlinked mixed radii turn the rect into a path that remembers them', async ({ page }) => {
    await page.click('#sc-corner-link');
    await expect(page.locator('#sc-corner-link')).toHaveAttribute('aria-pressed', 'false');
    await setField(corner(page, 'tl'), 0);
    await setField(corner(page, 'br'), 50);
    // data-radii is tl tr br bl.
    expect(await selAttrs(page, ['data-rect', 'data-radii', 'fill'])).toEqual({
      tag: 'path',
      'data-rect': '100 350 200 120',
      'data-radii': '0 20 50 20',
      fill: 'none',
    });
    const b = await page.evaluate(() => {
      const b = window.svgcraft.state.sel[0].getBBox();
      return [b.x, b.y, b.width, b.height];
    });
    [100, 350, 200, 120].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 2));
  });

  test('relinking and setting one radius goes back to a plain rect', async ({ page }) => {
    await page.click('#sc-corner-link');
    await setField(corner(page, 'tl'), 0);
    await setField(corner(page, 'br'), 50);
    await page.click('#sc-corner-link');
    await expect(page.locator('#sc-corner-link')).toHaveAttribute('aria-pressed', 'true');
    await setField(corner(page, 'tl'), 10);
    expect(
      await selAttrs(page, ['x', 'y', 'width', 'height', 'rx', 'ry', 'data-rect', 'data-radii']),
    ).toEqual({
      tag: 'rect',
      x: '100',
      y: '350',
      width: '200',
      height: '120',
      rx: '10',
      ry: '10',
      'data-rect': null,
      'data-radii': null,
    });
  });

  test('a radius is clamped to half the shorter side', async ({ page }) => {
    await setField(corner(page, 'tl'), 999);
    expect((await selAttrs(page, ['rx'])).rx).toBe('60');
  });

  test('dragging a corner handle sets all radii while linked', async ({ page }) => {
    await setField(corner(page, 'tl'), 0);
    const z = await zoom(page);
    // With radius 0 the handle sits 12 screen px inside the corner; drag it
    // 30 doc units further along the diagonal.
    await dragBy(page, page.locator('[data-corner-h="tl"]'), 30 * z, 30 * z);
    const rx = Number((await selAttrs(page, ['rx'])).rx);
    expect(Math.abs(rx - Math.round(12 / z + 30))).toBeLessThanOrEqual(1);
    expect(await selAttrs(page, ['ry'])).toMatchObject({ tag: 'rect', ry: String(rx) });
  });

  test('Alt-dragging a corner handle changes that corner alone', async ({ page }) => {
    await setField(corner(page, 'tl'), 40);
    const z = await zoom(page);
    // BR handle sits 40 in; 20 more would be 60, the clamp limit (120 / 2).
    await page.keyboard.down('Alt');
    await dragBy(page, page.locator('[data-corner-h="br"]'), -25 * z, -25 * z);
    await page.keyboard.up('Alt');
    expect(await selAttrs(page, ['data-radii'])).toEqual({
      tag: 'path',
      'data-radii': '40 40 60 40',
    });
  });

  test('corner handles sit on a rotated, nested rounded path', async ({ page }) => {
    await page.click('#sc-corner-link');
    await setField(corner(page, 'br'), 50);
    await page.evaluate(() => {
      const s = window.svgcraft;
      const el = s.state.sel[0];
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'rotate(30 200 400)');
      el.before(g);
      g.append(el);
      s.state.sel = [el];
      s.commit();
    });
    const off = await page.evaluate(() => {
      const el = window.svgcraft.state.sel[0];
      const h = document.querySelector('[data-corner-h="tr"]').getBoundingClientRect();
      const [x, y, w] = el.getAttribute('data-rect').split(' ').map(Number);
      const r = +el.getAttribute('data-radii').split(' ')[1];
      const d = Math.max(r, 12 / window.svgcraft.state.zoom);
      const p = new DOMPoint(x + w - d, y + d).matrixTransform(el.getScreenCTM());
      return [p.x - (h.x + h.width / 2), p.y - (h.y + h.height / 2)];
    });
    expect(off[0]).toBeCloseTo(0, 0);
    expect(off[1]).toBeCloseTo(0, 0);
  });

  test('point-editing a rounded path forgets its radii; undo brings them back', async ({
    page,
  }) => {
    await page.click('#sc-corner-link');
    await setField(corner(page, 'br'), 50);
    await expect.poll(() => selAttrs(page, ['data-rect'])).toMatchObject({ tag: 'path' });
    // Leave the field so the tool shortcut and Ctrl+Z reach the app.
    await corner(page, 'br').blur();
    await page.keyboard.press('a');
    const n0 = await page.locator('#sc-nodes [data-node]').first().boundingBox();
    await page.mouse.move(n0.x + 4, n0.y + 4);
    await page.mouse.down();
    await page.mouse.move(n0.x + 30, n0.y + 4, { steps: 3 });
    await page.mouse.up();
    expect(
      await page.evaluate(() => {
        const el = window.svgcraft.tools.node.el;
        return [el.hasAttribute('data-rect'), el.hasAttribute('data-radii')];
      }),
    ).toEqual([false, false]);

    await page.keyboard.press('Control+z');
    const p = page.locator('#sc-doc path');
    await expect(p).toHaveAttribute('data-rect', '100 350 200 120');
    await expect(p).toHaveAttribute('data-radii', '20 20 50 20');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#sc-doc path')).toHaveCount(0);
    await expect(page.locator('#sc-doc rect')).toHaveAttribute('rx', '20');
  });
});
