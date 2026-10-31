import { test, expect, load, toScreen, tab } from './fixtures.js';

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

const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'g.svg'), DOC);
  await tab(page, 'props');
  await pick(page, 'r');
});

// Fill → Linear on the rect.
const makeLinear = (page) => page.click('[data-kind-for="fill"] [data-kind="linear"]');

// Lay a gradient by its handles, as the Move tool drags them: the start
// handle to doc point a, then the end handle to b.
async function lay(page, a, b, steps = 4) {
  await page.evaluate(() => window.svgcraft.setTool('select'));
  await dragPx(
    page,
    await centre(page.locator('[data-grad-h="a"]')),
    await toScreen(page, ...a),
    steps,
  );
  await dragPx(
    page,
    await centre(page.locator('[data-grad-h="b"]')),
    await toScreen(page, ...b),
    steps,
  );
}

// Linear, angle 90, sunset preset.
async function sunset(page) {
  await makeLinear(page);
  await setField(page, '#sc-grad-angle', 90);
  await page.click('#sc-grad-preset');
  await page.click('#sc-libpick-pop .sc-libpick-tile[data-id="sunset"]');
}

// Click the bar at 50% and recolour the new stop green from Swatches.
async function addGreenStop(page) {
  const bar = await page.locator('#sc-grad-bar').boundingBox();
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await tab(page, 'swatches');
  await page.click('#sc-palette button[aria-label="#16a34a"]');
  await tab(page, 'props');
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
    await tab(page, 'props');
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

test.describe('gradient handles (Move tool)', () => {
  test.beforeEach(async ({ page }) => {
    await makeLinear(page);
    await lay(page, [150, 120], [450, 180]);
  });

  test('dragging its handles sets the gradient line and angle', async ({ page }) => {
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
    await lay(page, [200, 150], [400, 160]);
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

  await tab(page, 'props');
  await page.click('#sc-grad-preset');
  await page.click('#sc-libpick-pop .sc-libpick-tile[data-id="ocean"]');
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

// A symbol instance's shapes paint a gradient in their own coordinates
// (the library's are drawn at 512 and scaled to 64): it's mapped back, so
// the colours sit under their stop handles, as on any shape.
test('a gradient on a symbol instance lines up with its handles', async ({ page }) => {
  await load(page, '', 600, 500);
  const at = await page.evaluate(() => {
    /* eslint-disable no-undef -- the editor's own globals */
    const item = lib.symbols.find((x) => x.name === 'Square');
    const u = placeLibSymbol(item, { x: 300, y: 250 });
    setM(u, new DOMMatrix([4, 0, 0, 4, 172, 122]));
    setGradPaint(u, 'fill', { type: 'linear', stops: GRAD_PRESETS.sunset[1](), angle: 0 });
    window.svgcraft.commit();
    const g = document.getElementById(paintRef(u, 'fill'));
    const geo = geoOf(g);
    // Its handles, as the Gradient tool draws them (in its own space).
    const M = fullM(u).multiply(gradSpace(u, false).toLocal);
    /* eslint-enable no-undef */
    // Where each stop's handle is, in the drawing.
    return [...g.children].map((s) => {
      const o = +s.getAttribute('offset');
      const p = new DOMPoint(
        geo.x1 + (geo.x2 - geo.x1) * o,
        geo.y1 + (geo.y2 - geo.y1) * o,
      ).matrixTransform(M);
      return { x: Math.round(p.x), y: Math.round(p.y), c: s.getAttribute('stop-color') };
    });
  });
  // The colours drawn there (just inside the ends).
  const drawn = await page.evaluate(async (pts) => {
    const im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await im.decode();
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 500;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    return pts.map((p, i) => {
      const dx = i === 0 ? 3 : i === pts.length - 1 ? -3 : 0;
      const [r, g, b] = x.getImageData(p.x + dx, p.y, 1, 1).data;
      return [r, g, b];
    });
  }, at);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  at.forEach((s, i) => {
    const want = rgb(s.c);
    for (let k = 0; k < 3; k++)
      expect(Math.abs(drawn[i][k] - want[k]), `${s.c} channel ${k}`).toBeLessThan(24);
  });
});

// Where the gradient lies on the page: its ends (or centre and radius
// handle), through the shape's transform and its own.
const onPage = (page, id = 'r') =>
  page.evaluate((id) => {
    /* eslint-disable no-undef -- the editor's own globals */
    const el = document.getElementById(id);
    const g = document.getElementById(paintRef(el, 'fill'));
    const t = g.gradientTransform.baseVal.consolidate()?.matrix;
    const M = fullM(el).multiply(
      t ? new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f]) : new DOMMatrix(),
    );
    const geo = geoOf(g);
    /* eslint-enable no-undef */
    const P = (x, y) => new DOMPoint(x, y).matrixTransform(M);
    const r2 = (v) => Math.round(v * 100) / 100;
    const [a, b] =
      g.localName === 'radialGradient'
        ? [P(geo.cx, geo.cy), P(geo.cx + geo.r, geo.cy)]
        : [P(geo.x1, geo.y1), P(geo.x2, geo.y2)];
    // Round (or square on), with no skew: equal column lengths, at right angles.
    const round =
      Math.abs(Math.hypot(M.a, M.b) - Math.hypot(M.c, M.d)) < 1e-3 &&
      Math.abs(M.a * M.c + M.b * M.d) < 1e-3;
    return {
      a: [r2(a.x), r2(a.y)],
      b: [r2(b.x), r2(b.y)],
      deg: Math.round((Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI),
      len: r2(Math.hypot(b.x - a.x, b.y - a.y)),
      round,
    };
  }, id);

// Free Transform's W field: the selection stretched to w wide.
async function stretchTo(page, w) {
  await page.evaluate(() => window.svgcraft.setTool('select'));
  await page.keyboard.press('Alt+t');
  await page.fill('[data-tf="w"]', String(w));
  await page.press('[data-tf="w"]', 'Enter');
  await page.keyboard.press('Enter');
}

test.describe('stretching the shape', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, '<rect id="sq" x="100" y="100" width="100" height="100" fill="#e8a33d"/>');
    await page.evaluate(() => {
      window.svgcraft.state.sel = [document.getElementById('sq')];
      window.svgcraft.setTool('select');
    });
    await tab(page, 'props');
  });

  test('a linear gradient keeps its angle and still spans the shape', async ({ page }) => {
    await page.click('[data-kind-for="fill"] [data-kind="linear"]');
    await setField(page, '#sc-grad-angle', 45);
    expect(await onPage(page, 'sq')).toMatchObject({ deg: 45, len: 141.42 });
    await expect(page.locator('#sc-grad-stretch')).not.toBeChecked();
    await stretchTo(page, 200);
    // 200 × 100 from (100, 100): through its centre, edge to edge at 45°.
    const g = await onPage(page, 'sq');
    expect(g.deg).toBe(45);
    expect(g.len).toBeCloseTo(300 * Math.SQRT1_2, 1);
    expect((g.a[0] + g.b[0]) / 2).toBeCloseTo(200, 1);
    expect((g.a[1] + g.b[1]) / 2).toBeCloseTo(150, 1);
    // Undo: the square, as it was.
    await page.keyboard.press('Control+z');
    expect(await onPage(page, 'sq')).toMatchObject({ deg: 45, len: 141.42 });
    await page.keyboard.press('Control+Shift+z');
    expect((await onPage(page, 'sq')).deg).toBe(45);
    // Off: it stretches with the shape, its angle with it.
    await page.evaluate(() => (window.svgcraft.state.sel = [document.getElementById('sq')]));
    await page.evaluate(() => window.svgcraft.setTool('select'));
    await tab(page, 'props');
    await page.locator('[data-kind-for="fill"]').scrollIntoViewIfNeeded();
    await page.check('#sc-grad-stretch');
    await stretchTo(page, 400);
    expect((await onPage(page, 'sq')).deg).not.toBe(45);
    // The setting travels in the file.
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'g2.svg'), svg);
    await page.evaluate(() => (window.svgcraft.state.sel = [document.getElementById('sq')]));
    await page.evaluate(() => window.svgcraft.setTool('select'));
    await expect(page.locator('#sc-grad-stretch')).toBeChecked();
  });

  test('a radial gradient stays round, from the middle out to the far side', async ({ page }) => {
    await page.click('[data-kind-for="fill"] [data-kind="radial"]');
    await stretchTo(page, 300);
    const g = await onPage(page, 'sq');
    expect(g.round).toBe(true);
    expect(g.a).toEqual([250, 150]);
    expect(g.len).toBeCloseTo(150, 1);
  });

  test('its handles lay it where you drag them, on a stretched shape too', async ({ page }) => {
    await stretchTo(page, 300);
    await tab(page, 'props');
    await makeLinear(page);
    await lay(page, [120, 120], [360, 180]);
    const g = await onPage(page, 'sq');
    expect(g.a[0]).toBeCloseTo(120, 0);
    expect(g.a[1]).toBeCloseTo(120, 0);
    expect(g.b[0]).toBeCloseTo(360, 0);
    expect(g.b[1]).toBeCloseTo(180, 0);
    // Its end handle sits where it ends.
    const h = await centre(page.locator('[data-grad-h="b"]'));
    const want = await toScreen(page, 360, 180);
    expect(Math.abs(h.x - want.x) + Math.abs(h.y - want.y)).toBeLessThan(2);
  });
});
