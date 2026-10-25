import { test, expect, load, select, menu } from './fixtures.js';

// Layer Style (effects), blend modes and layer locks.

const SCENE =
  '<rect id="bg" width="400" height="300" fill="#ffffff"/>' +
  '<rect id="a" x="60" y="60" width="140" height="100" fill="#2563eb"/>' +
  '<rect id="b" x="240" y="60" width="100" height="100" fill="#ffff00"/>';

const attr = (page, id, a) =>
  page.evaluate(([id, a]) => document.getElementById(id).getAttribute(a), [id, a]);
const fxOf = (page, id) => attr(page, id, 'data-sc-fx').then((v) => (v ? JSON.parse(v) : null));
const msg = (page) => page.locator('#sc-msg');

async function openStyle(page) {
  await page.click('.sc-layers-foot [data-action="layerStyle"]');
  await expect(page.locator('#sc-fx')).toBeVisible();
}
async function setField(page, key, value) {
  await page.fill(`#sc-fx [data-fx="${key}"]`, String(value));
  await page.dispatchEvent(`#sc-fx [data-fx="${key}"]`, 'input');
}
const effect = (page, k) => page.click(`#sc-fx [data-fx-page="${k}"] button`);

// Rasterise the export and read pixels at doc points.
const pixels = (page, pts) =>
  page.evaluate(async (pts) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, pts);
const lum = ([r, g, b]) => (r + g + b) / 3;
// Effects sync in a microtask after each change.
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 400, 300);
  await select(page, 'a');
});

test.describe('Layer Style', () => {
  test('opens from the fx button and Object menu, with OK focused', async ({ page }) => {
    await openStyle(page);
    await expect(page.locator('#sc-fx [data-fxd="ok"]')).toBeFocused();
    await page.click('#sc-fx [data-fxd="cancel"]');
    await menu(page, 'Layer', 'layerStyle');
    await expect(page.locator('#sc-fx')).toBeVisible();
  });

  test('a drop shadow previews live, Cancel restores, OK keeps, undo removes', async ({ page }) => {
    await openStyle(page);
    await effect(page, 'ds');
    await expect(page.locator('#sc-fx [data-fx-on="ds"]')).toBeChecked();
    await setField(page, 'ds.o', 80);
    await setField(page, 'ds.d', 10);
    await tick(page);
    expect(await attr(page, 'a', 'filter')).toMatch(/^url\(#sc-fx-\d+\)$/);
    await page.click('#sc-fx [data-fxd="cancel"]');
    await tick(page);
    expect(await attr(page, 'a', 'data-sc-fx')).toBeNull();
    expect(await attr(page, 'a', 'filter')).toBeNull();
    await expect(page.locator('#sc-defs filter')).toHaveCount(0);

    await openStyle(page);
    await effect(page, 'ds');
    await setField(page, 'ds.o', 80);
    await setField(page, 'ds.d', 10);
    await page.click('#sc-fx [data-fxd="ok"]');
    expect(await fxOf(page, 'a')).toMatchObject({ ds: { o: 80, d: 10, a: 120 } });
    await expect(page.locator('#sc-layers .sc-fx-badge')).toHaveCount(1);

    // The shadow falls down and to the right (light from 120°): just past
    // the bottom-right corner is darkened, the top-left outside isn't.
    const [below, above] = await pixels(page, [
      [203, 165],
      [54, 52],
    ]);
    expect(lum(below)).toBeLessThan(200);
    expect(lum(above)).toBeGreaterThan(250);

    await page.keyboard.press('Control+z');
    await tick(page);
    expect(await attr(page, 'a', 'filter')).toBeNull();
  });

  test('a rotated layer still casts its shadow down and to the right', async ({ page }) => {
    await load(
      page,
      '<rect width="400" height="300" fill="#fff"/><rect id="a" x="150" y="100" width="100" height="100" fill="#2563eb" transform="rotate(180 200 150)"/>',
      400,
      300,
    );
    await select(page, 'a');
    await openStyle(page);
    await effect(page, 'ds');
    await setField(page, 'ds.o', 100);
    await setField(page, 'ds.d', 12);
    await setField(page, 'ds.s', 0);
    await page.click('#sc-fx [data-fxd="ok"]');
    const [br, tl] = await pixels(page, [
      [254, 208],
      [146, 92],
    ]);
    expect(lum(br)).toBeLessThan(60);
    expect(lum(tl)).toBeGreaterThan(250);
  });

  test('each effect draws what it should', async ({ page }) => {
    // Colour Overlay paints the layer.
    await openStyle(page);
    await effect(page, 'co');
    await page.fill('#sc-fx [data-fx="co.c"]', '#ff0000');
    await page.dispatchEvent('#sc-fx [data-fx="co.c"]', 'input');
    await page.click('#sc-fx [data-fxd="ok"]');
    let [mid] = await pixels(page, [[130, 110]]);
    expect(mid.slice(0, 3)).toEqual([255, 0, 0]);

    // Outer Glow lights up just outside the edge (on a dark background).
    await load(
      page,
      '<rect width="400" height="300" fill="#000"/><rect id="a" x="100" y="100" width="100" height="100" fill="#2563eb"/>',
      400,
      300,
    );
    await select(page, 'a');
    await openStyle(page);
    await effect(page, 'og');
    await setField(page, 'og.o', 100);
    await setField(page, 'og.s', 20);
    await page.click('#sc-fx [data-fxd="ok"]');
    const [glow, far] = await pixels(page, [
      [96, 150],
      [20, 20],
    ]);
    expect(lum(glow)).toBeGreaterThan(40);
    expect(lum(far)).toBeLessThan(5);

    // Inner Glow brightens the inside edge, not the centre.
    await openStyle(page);
    await page.click('#sc-fx [data-fx-on="og"]');
    await effect(page, 'ig');
    await setField(page, 'ig.o', 100);
    await setField(page, 'ig.s', 20);
    await page.click('#sc-fx [data-fxd="ok"]');
    const [edge, centre] = await pixels(page, [
      [102, 150],
      [150, 150],
    ]);
    expect(lum(edge)).toBeGreaterThan(lum(centre) + 30);

    // Inner Shadow darkens the inside top-left edge (light from 120°).
    await openStyle(page);
    await page.click('#sc-fx [data-fx-on="ig"]');
    await effect(page, 'is');
    await setField(page, 'is.o', 100);
    await setField(page, 'is.d', 8);
    await setField(page, 'is.s', 0);
    await page.click('#sc-fx [data-fxd="ok"]');
    const [tlIn, brIn] = await pixels(page, [
      [102, 102],
      [197, 197],
    ]);
    expect(lum(tlIn)).toBeLessThan(10);
    expect(lum(brIn)).toBeGreaterThan(60);

    // Gaussian Blur softens the edge.
    await openStyle(page);
    await page.click('#sc-fx [data-fx-on="is"]');
    await effect(page, 'bl');
    await setField(page, 'bl.r', 6);
    await page.click('#sc-fx [data-fxd="ok"]');
    [mid] = await pixels(page, [[97, 150]]);
    expect(lum(mid)).toBeGreaterThan(5);
    expect(await page.locator('#sc-defs filter feGaussianBlur').count()).toBeGreaterThan(0);
  });

  test('the fx badge reopens the dialog with the layer’s settings', async ({ page }) => {
    await openStyle(page);
    await effect(page, 'og');
    await setField(page, 'og.s', 33);
    await page.click('#sc-fx [data-fxd="ok"]');
    await page.dblclick('#sc-layers .sc-fx-badge');
    await expect(page.locator('#sc-fx')).toBeVisible();
    await expect(page.locator('#sc-fx [data-fx-pane="og"]')).toBeVisible();
    await expect(page.locator('#sc-fx [data-fx="og.s"]')).toHaveValue('33');
    await page.keyboard.press('Escape');
    await expect(page.locator('#sc-fx')).toBeHidden();
  });

  test('Clear Layer Style removes it; duplicates get their own filter', async ({ page }) => {
    await openStyle(page);
    await effect(page, 'ds');
    await page.click('#sc-fx [data-fxd="ok"]');
    await page.keyboard.press('Control+j');
    await tick(page);
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc [data-sc-fx]')].map((e) => e.getAttribute('filter')),
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    await menu(page, 'Layer', 'clearLayerStyle');
    await tick(page);
    await expect(page.locator('#sc-doc [data-sc-fx]')).toHaveCount(1);
    await expect(page.locator('#sc-defs filter')).toHaveCount(1);
  });

  test('effects survive export and reopening', async ({ page }) => {
    await openStyle(page);
    await effect(page, 'ds');
    await setField(page, 'ds.d', 9);
    await page.click('#sc-fx [data-fxd="ok"]');
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    expect(svg).toContain('<filter');
    await page.evaluate((t) => window.svgcraft.openSvg(t, 're.svg'), svg);
    await tick(page);
    expect(await fxOf(page, 'a')).toMatchObject({ ds: { d: 9 } });
    expect(await attr(page, 'a', 'filter')).toMatch(/^url\(#sc-fx-\d+\)$/);
  });
});

test.describe('blend modes', () => {
  test('the Layers panel menu sets mix-blend-mode, and it blends', async ({ page }) => {
    await load(
      page,
      '<rect width="400" height="300" fill="#fff"/><rect id="b" x="100" y="100" width="100" height="100" fill="#ffff00"/><rect id="a" x="150" y="100" width="100" height="100" fill="#00ffff"/>',
      400,
      300,
    );
    await select(page, 'a');
    await page.selectOption('#sc-blend', 'multiply');
    expect(await attr(page, 'a', 'style')).toContain('mix-blend-mode: multiply');
    // Yellow × cyan = green where they overlap.
    const [[r, g, b]] = await pixels(page, [[175, 150]]);
    expect(r).toBeLessThan(10);
    expect(g).toBeGreaterThan(245);
    expect(b).toBeLessThan(10);
    await select(page, 'b');
    await expect(page.locator('#sc-blend')).toHaveValue('normal');
    await select(page, 'a');
    await expect(page.locator('#sc-blend')).toHaveValue('multiply');
    await page.keyboard.press('Control+z');
    expect(await attr(page, 'a', 'style')).toBeNull();
  });

  test('Blending Options in the dialog set blend mode and opacity', async ({ page }) => {
    await openStyle(page);
    await page.click('#sc-fx [data-fx-page="blend"]');
    await page.selectOption('#sc-fx [data-fx="blend"]', 'screen');
    await page.dispatchEvent('#sc-fx [data-fx="blend"]', 'input');
    await setField(page, 'opacity', 40);
    await page.click('#sc-fx [data-fxd="ok"]');
    expect(await attr(page, 'a', 'style')).toContain('mix-blend-mode: screen');
    expect(await attr(page, 'a', 'opacity')).toBe('0.4');
    await expect(page.locator('#sc-blend')).toHaveValue('screen');
  });
});

test.describe('Pass Through (groups)', () => {
  // A cyan layer set to Multiply inside a group, over a yellow background.
  const GROUPED =
    '<rect width="400" height="300" fill="#ffff00"/>' +
    '<g id="g"><rect id="a" x="100" y="100" width="100" height="100" fill="#00ffff" style="mix-blend-mode: multiply;"/></g>';

  test('is offered for groups only, and is their default', async ({ page }) => {
    await load(page, GROUPED, 400, 300);
    await select(page, 'g');
    await expect(page.locator('#sc-blend')).toHaveValue('pass-through');
    await expect(page.locator('#sc-blend option[value="pass-through"]')).not.toHaveAttribute(
      'hidden',
      '',
    );
    await select(page, 'a');
    await expect(page.locator('#sc-blend option[value="pass-through"]')).toHaveAttribute(
      'hidden',
      '',
    );
    await expect(page.locator('#sc-blend')).toHaveValue('multiply');
  });

  test('Pass Through lets layers blend below the group; Normal isolates it', async ({ page }) => {
    await load(page, GROUPED, 400, 300);
    // Pass Through: cyan × yellow = green.
    let [[r, g, b]] = await pixels(page, [[150, 150]]);
    expect([r, g, b]).toEqual([0, 255, 0]);
    await select(page, 'g');
    await page.selectOption('#sc-blend', 'normal');
    expect(await attr(page, 'g', 'style')).toContain('isolation: isolate');
    // Isolated: the multiply only meets the group's own (empty) backdrop.
    [[r, g, b]] = await pixels(page, [[150, 150]]);
    expect([r, g, b]).toEqual([0, 255, 255]);
    await page.selectOption('#sc-blend', 'pass-through');
    expect(await attr(page, 'g', 'style')).toBeNull();
  });
});

test.describe('layer locks', () => {
  const box = (page, id) =>
    page.evaluate((id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.x, y: b.y };
    }, id);

  test('Lock Position: no moving, nudging or aligning, but styling is fine', async ({ page }) => {
    await page.click('[data-lock="position"]');
    await expect(page.locator('[data-lock="position"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await attr(page, 'a', 'data-sc-lock')).toBe('position');
    await expect(page.locator('#sc-layers .sc-row-lock')).toHaveCount(1);

    const b0 = await box(page, 'a');
    await page.mouse.move(b0.x + 30, b0.y + 30);
    await page.mouse.down();
    await page.mouse.move(b0.x + 130, b0.y + 90, { steps: 5 });
    await page.mouse.up();
    expect(await box(page, 'a')).toEqual(b0);
    await expect(msg(page)).toContainText('is locked');
    await page.keyboard.press('ArrowRight');
    await menu(page, 'Object', 'flipH');
    expect(await attr(page, 'a', 'transform')).toBeNull();

    await page.evaluate(() => {
      window.svgcraft.state.fill = '#ff0000';
      document.querySelector('#sc-fill-hex').value = '#ff0000';
      document.querySelector('#sc-fill-hex').dispatchEvent(new Event('change'));
    });
    expect(await attr(page, 'a', 'fill')).toBe('#ff0000');
  });

  test('Lock All: no style, delete, point or text edits', async ({ page }) => {
    await menu(page, 'Layer', 'lockAll');
    expect(await attr(page, 'a', 'data-sc-lock')).toBe('all');
    await page.evaluate(() => {
      document.querySelector('#sc-fill-hex').value = '#ff0000';
      document.querySelector('#sc-fill-hex').dispatchEvent(new Event('change'));
    });
    expect(await attr(page, 'a', 'fill')).toBe('#2563eb');
    await page.keyboard.press('Delete');
    await expect(page.locator('#a')).toHaveCount(1);
    await page.click('.sc-layers-foot [data-action="layerStyle"]');
    await expect(page.locator('#sc-fx')).toBeHidden();
    await page.selectOption('#sc-blend', 'multiply');
    expect(await attr(page, 'a', 'style')).toBeNull();
    await page.evaluate(() => window.svgcraft.setTool('node'));
    await page.evaluate(() => window.svgcraft.tools.node.target(document.getElementById('a')));
    expect(await page.evaluate(() => window.svgcraft.tools.node.el)).toBeNull();
    await expect(msg(page)).toContainText('is locked');
  });

  test('a lock on a group covers its layers; the row padlock unlocks', async ({ page }) => {
    await load(
      page,
      '<g id="g"><rect id="a" x="60" y="60" width="100" height="100" fill="#2563eb"/></g>',
      400,
      300,
    );
    await select(page, 'g');
    await page.click('[data-lock="all"]');
    await page.evaluate(() => {
      window.svgcraft.state.autoSelect = 'layer';
    });
    await select(page, 'a');
    await page.keyboard.press('Delete');
    await expect(page.locator('#a')).toHaveCount(1);
    await page.click('#sc-layers .sc-row-lock');
    expect(await attr(page, 'g', 'data-sc-lock')).toBeNull();
    await select(page, 'a');
    await page.keyboard.press('Delete');
    await expect(page.locator('#a')).toHaveCount(0);
  });

  test('locks survive export and reopening, and Unlock clears them', async ({ page }) => {
    await menu(page, 'Layer', 'lockPosition');
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    await page.evaluate((t) => window.svgcraft.openSvg(t, 're.svg'), svg);
    expect(await attr(page, 'a', 'data-sc-lock')).toBe('position');
    await select(page, 'a');
    await menu(page, 'Layer', 'unlockLayers');
    expect(await attr(page, 'a', 'data-sc-lock')).toBeNull();
  });
});
