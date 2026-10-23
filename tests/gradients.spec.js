import { test, expect, toScreen } from './fixtures.js';

// Linear / radial gradient fills and strokes: the Color-panel editor, the
// Gradient tool, sharing between duplicates, imported gradients, pruning.

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 800 600">
  <defs><linearGradient id="base"><stop offset="0" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff" stop-opacity=".5"/></linearGradient>
  <linearGradient id="imp" xlink:href="#base" x1="0" y1="0" x2="0" y2="1"/></defs>
  <rect id="r" x="100" y="100" width="400" height="100" fill="#e8a33d" stroke="#1f2933" stroke-width="6"/>
  <circle id="c" cx="650" cy="150" r="60" fill="url(#imp)"/></svg>`;

// The gradient painting #id's fill or stroke, or null if it's not a gradient.
const grad = (page, id, attr = 'fill') =>
  page.evaluate(
    ([id, attr]) => {
      const el = document.getElementById(id);
      const gid = (el.getAttribute(attr) || '').match(/#([^)]+)/)?.[1];
      const g = gid && document.getElementById(gid);
      if (!g) return null;
      const a = (k) => g.getAttribute(k);
      const num = (k) => (a(k) == null ? null : Number(a(k)));
      return {
        tag: g.localName,
        id: gid,
        units: a('gradientUnits'),
        ...(g.localName === 'linearGradient'
          ? { x1: num('x1'), y1: num('y1'), x2: num('x2'), y2: num('y2') }
          : { cx: num('cx'), cy: num('cy'), r: num('r') }),
        stops: [...g.querySelectorAll('stop')].map(
          (s) =>
            `${s.getAttribute('offset')}:${s.getAttribute('stop-color')}` +
            (s.getAttribute('stop-opacity') ? '@' + s.getAttribute('stop-opacity') : ''),
        ),
      };
    },
    [id, attr],
  );

// Numeric gradient geometry compared with toBeCloseTo.
function expectGeom(g, want) {
  for (const [k, v] of Object.entries(want)) expect(g[k], k).toBeCloseTo(v, 1);
}

const tab = (page, name) => page.click(`[data-tab="${name}"]`);
const pick = (page, id) =>
  page
    .locator('#sc-layers li')
    .filter({
      has: page.locator('.sc-layer-name', { hasText: id === 'r' ? /^rect/ : /^circle/ }),
    })
    .first()
    .click();
const stops = (page) => page.locator('.sc-gstop');
const ourGrads = (page) => page.locator('#sc-defs [data-sc-grad]');

async function setField(page, sel, v) {
  const f = page.locator(sel);
  await f.fill(String(v));
  await f.press('Enter');
  await f.blur();
}

async function dragPx(page, from, to, steps = 5) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

async function dragDoc(page, a, z, steps = 5) {
  await dragPx(page, await toScreen(page, ...a), await toScreen(page, ...z), steps);
}

const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'g.svg'), DOC);
  await tab(page, 'color');
  await pick(page, 'r');
});

// Fill → Linear on the rect.
const makeLinear = (page) => page.click('[data-kind-for="fill"] [data-kind="linear"]');

// Linear, angle 90, sunset preset.
async function sunset(page) {
  await makeLinear(page);
  await setField(page, '#sc-grad-angle', 90);
  await page.selectOption('#sc-grad-preset', 'sunset');
}

// Click the bar at 50% and recolour the new stop green from Swatches.
async function addGreenStop(page) {
  const bar = await page.locator('#sc-grad-bar').boundingBox();
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await tab(page, 'swatches');
  await page.click('#sc-palette button[aria-label="#16a34a"]');
  await tab(page, 'color');
}

test.describe('gradient editor', () => {
  test('Fill → Linear makes a left-to-right gradient fading out the fill colour', async ({
    page,
  }) => {
    await makeLinear(page);
    const g = await grad(page, 'r');
    expect(g).toMatchObject({
      tag: 'linearGradient',
      id: expect.stringMatching(/^sc-grad-\d+$/),
      units: 'userSpaceOnUse',
      stops: ['0:#e8a33d', '1:#e8a33d@0'],
    });
    expectGeom(g, { x1: 100, y1: 150, x2: 500, y2: 150 });
    await expect(page.locator('#sc-grad')).toBeVisible();
    const chip = await page.evaluate(() =>
      getComputedStyle(document.getElementById('sc-fill-chip')).getPropertyValue('--chip'),
    );
    expect(chip).toMatch(/^\s*linear-gradient\(90deg, rgba\(232, ?163, ?61, ?1/);
  });

  test('angle 90 runs bottom to top through the centre', async ({ page }) => {
    await makeLinear(page);
    await setField(page, '#sc-grad-angle', 90);
    expectGeom(await grad(page, 'r'), { x1: 300, y1: 200, x2: 300, y2: 100 });
  });

  test('a preset replaces the stops and keeps the direction', async ({ page }) => {
    await sunset(page);
    const g = await grad(page, 'r');
    expect(g.stops).toEqual(['0:#facc15', '0.33:#f97316', '0.67:#db2777', '1:#7c3aed']);
    expectGeom(g, { x1: 300, y1: 200, x2: 300, y2: 100 });
  });

  test('clicking the bar adds a stop that a swatch recolours', async ({ page }) => {
    await sunset(page);
    const bar = await page.locator('#sc-grad-bar').boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await expect(stops(page)).toHaveCount(5);
    await expect(page.locator('#sc-gstop-o')).toHaveValue('50');
    await tab(page, 'swatches');
    await page.click('#sc-palette button[aria-label="#16a34a"]');
    await tab(page, 'color');
    expect((await grad(page, 'r')).stops).toEqual([
      '0:#facc15',
      '0.33:#f97316',
      '0.5:#16a34a',
      '0.67:#db2777',
      '1:#7c3aed',
    ]);
  });

  test('stops can be dragged along the bar, and off it to delete', async ({ page }) => {
    await sunset(page);
    await addGreenStop(page);
    const bar = await page.locator('#sc-grad-bar').boundingBox();
    const m = await centre(page.locator('.sc-gstop.sel'));
    await dragPx(page, m, { x: bar.x + bar.width * 0.8, y: m.y });
    await expect(page.locator('#sc-gstop-o')).toHaveValue('80');
    const m2 = await centre(stops(page).nth(1));
    await dragPx(page, m2, { x: m2.x, y: m2.y + 90 });
    await expect(stops(page)).toHaveCount(4);
    expect((await grad(page, 'r')).stops).toEqual([
      '0:#facc15',
      '0.67:#db2777',
      '0.8:#16a34a',
      '1:#7c3aed',
    ]);
  });

  test('stop opacity and Reverse', async ({ page }) => {
    await sunset(page);
    await addGreenStop(page);
    const bar = await page.locator('#sc-grad-bar').boundingBox();
    const m = await centre(page.locator('.sc-gstop.sel'));
    await dragPx(page, m, { x: bar.x + bar.width * 0.8, y: m.y });
    const m2 = await centre(stops(page).nth(1));
    await dragPx(page, m2, { x: m2.x, y: m2.y + 90 });
    await setField(page, '#sc-gstop-a', 40);
    await page.click('#sc-grad-reverse');
    expect((await grad(page, 'r')).stops).toEqual([
      '0:#7c3aed',
      '0.2:#16a34a',
      '0.33:#db2777',
      '1:#facc15@0.4',
    ]);
  });

  test('Radial centres on the shape and hides the angle field', async ({ page }) => {
    await sunset(page);
    await page.click('[data-kind-for="fill"] [data-kind="radial"]');
    const g = await grad(page, 'r');
    expect(g).toMatchObject({
      tag: 'radialGradient',
      units: 'userSpaceOnUse',
      stops: ['0:#facc15', '0.33:#f97316', '0.67:#db2777', '1:#7c3aed'],
    });
    expectGeom(g, { cx: 300, cy: 150, r: 200 });
    await expect(page.locator('#sc-grad-angle-wrap')).toBeHidden();
  });
});

test.describe('Gradient tool', () => {
  test.beforeEach(async ({ page }) => {
    await makeLinear(page);
    await page.keyboard.press('g');
    await dragDoc(page, [150, 120], [450, 180], 6);
  });

  test('dragging across a shape sets the gradient line and angle', async ({ page }) => {
    const g = await grad(page, 'r');
    expect(g).toMatchObject({ tag: 'linearGradient', units: 'userSpaceOnUse' });
    expectGeom(g, { x1: 150, y1: 120, x2: 450, y2: 180 });
    // atan2(60, 300) ≈ 11.3° downward; angles count anticlockwise.
    await expect(page.locator('#sc-grad-angle')).toHaveValue('-11');
    await expect(page.locator('[data-grad-h]')).toHaveCount(2);
  });

  test('the end handle can be dragged', async ({ page }) => {
    await dragPx(
      page,
      await centre(page.locator('[data-grad-h="b"]')),
      await toScreen(page, 300, 200),
      4,
    );
    expectGeom(await grad(page, 'r'), { x1: 150, y1: 120, x2: 300, y2: 200 });
  });

  test('on a rotated shape the drag start maps back to the same document point', async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.getElementById('r').setAttribute('transform', 'rotate(30 300 150)');
      window.svgcraft.commit();
    });
    await dragDoc(page, [200, 150], [400, 160], 4);
    const p = await page.evaluate(() => {
      const el = document.getElementById('r');
      const g = document.getElementById(el.getAttribute('fill').match(/#([^)]+)/)[1]);
      const v = document.getElementById('sc-view').getCTM().inverse();
      const p = new DOMPoint(+g.getAttribute('x1'), +g.getAttribute('y1')).matrixTransform(
        v.multiply(el.getCTM()),
      );
      return [p.x, p.y];
    });
    expect(p[0]).toBeCloseTo(200, 0);
    expect(p[1]).toBeCloseTo(150, 0);
  });
});

test('a duplicate shares the gradient until one of them is edited', async ({ page }) => {
  await makeLinear(page);
  await page.keyboard.press('Control+j');
  const fills = () =>
    page.locator('#sc-doc rect').evaluateAll((els) => els.map((r) => r.getAttribute('fill')));
  const [a, b] = await fills();
  expect(a).toMatch(/^url\(#sc-grad-\d+\)$/);
  expect(b).toBe(a);
  await expect(ourGrads(page)).toHaveCount(1);

  await tab(page, 'color');
  await page.selectOption('#sc-grad-preset', 'ocean');
  const [a2, b2] = await fills();
  expect(a2).toMatch(/^url\(#sc-grad-\d+\)$/);
  expect(b2).toMatch(/^url\(#sc-grad-\d+\)$/);
  expect(a2).not.toBe(b2);
  await expect(ourGrads(page)).toHaveCount(2);
});

test('an imported gradient (href chain, bounding-box units) is read into the editor', async ({
  page,
}) => {
  await pick(page, 'c');
  const on = page.locator('[data-kind-for="fill"] [aria-checked="true"]');
  await expect(on).toHaveCount(1);
  await expect(on).toHaveAttribute('data-kind', 'linear');
  await expect(stops(page)).toHaveCount(2);
  // Top to bottom.
  await expect(page.locator('#sc-grad-angle')).toHaveValue('-90');
  expect(await page.evaluate(() => window.svgcraft.state.fillGrad.stops[1].a)).toBeCloseTo(0.5);
});

test.describe('stroke gradient', () => {
  test.beforeEach(async ({ page }) => {
    await makeLinear(page);
    await pick(page, 'c');
    await page.click('#sc-stroke-chip');
    await page.click('[data-kind-for="stroke"] [data-kind="linear"]');
  });

  test('Stroke → Linear spans the shape', async ({ page }) => {
    const g = await grad(page, 'c', 'stroke');
    expect(g).toMatchObject({ tag: 'linearGradient', units: 'userSpaceOnUse' });
    expectGeom(g, { x1: 590, y1: 150, x2: 710, y2: 150 });
  });

  test('going back to Solid prunes our gradient but keeps imported ones', async ({ page }) => {
    await expect(ourGrads(page)).toHaveCount(2);
    await page.click('[data-kind-for="stroke"] [data-kind="solid"]');
    expect(await grad(page, 'c', 'stroke')).toBeNull();
    await expect(ourGrads(page)).toHaveCount(1);
    await expect(page.locator('#sc-defs #imp')).toHaveCount(1);
    await expect(page.locator('#sc-defs #base')).toHaveCount(1);

    // The export carries every gradient still in use: base, imp, the rect's.
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    expect(svg.match(/<(linear|radial)Gradient/g)).toHaveLength(3);

    await page.keyboard.press('Control+z');
    expect(await grad(page, 'c', 'stroke')).toMatchObject({ tag: 'linearGradient' });
  });
});
