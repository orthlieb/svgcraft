// Combine Shapes (Unite / Subtract Front / Intersect / Exclude). Paper.js is
// loaded lazily on first use, so every run waits for the result message
// instead of a fixed delay.
import { test, expect, load } from './fixtures.js';

const TWO = `<rect id="a" x="100" y="100" width="100" height="100" fill="#2563eb"/>
  <rect id="b" x="150" y="150" width="100" height="100" fill="#dc2626"/>`;

const selectAll = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = [...document.querySelectorAll('#sc-doc > *')];
    s.syncActions();
  });

const msg = (page) => page.locator('#sc-msg');
const layerCount = (page) => page.locator('#sc-doc > *').count();

// Click an options-bar combine button and wait until the operation reports
// (in the status bar, or as an error above it).
async function combine(page, act) {
  await page.evaluate((a) => {
    document.getElementById('sc-msg').textContent = '';
    document.getElementById('sc-alert-text').textContent = '';
    document.querySelector(`.sc-options [data-action="${a}"]`).click();
  }, act);
  await page.waitForFunction(
    () =>
      document.getElementById('sc-msg').textContent ||
      document.getElementById('sc-alert-text').textContent,
  );
}

// The selected result: its doc-space area (sampled with isPointInFill on a
// 2 px grid, as Exclude's signed paper.js area would cancel out), fill, doc
// bbox (via paper.js, which is loaded by now) and whether it kept curves.
const result = (page) =>
  page.evaluate(() => {
    const el = window.svgcraft.state.sel[0];
    if (!el || el.localName !== 'path') return null;
    const v = document.getElementById('sc-view').getCTM().inverse();
    const m = v.multiply(el.getCTM());
    const p = new window.paper.CompoundPath({ pathData: el.getAttribute('d'), insert: false });
    p.transform(new window.paper.Matrix(m.a, m.b, m.c, m.d, m.e, m.f));
    let area;
    if (el.transform.baseVal.length) area = Math.abs(p.area);
    else {
      const b = el.getBBox();
      let n = 0;
      const q = el.ownerSVGElement.createSVGPoint();
      for (let x = b.x + 1; x < b.x + b.width; x += 2)
        for (let y = b.y + 1; y < b.y + b.height; y += 2) {
          q.x = x;
          q.y = y;
          if (el.isPointInFill(q)) n++;
        }
      area = n * 4;
    }
    const bb = p.bounds;
    return {
      area,
      fill: el.getAttribute('fill'),
      curves: /[cCsSqQaA]/.test(el.getAttribute('d')),
      bbox: [bb.x, bb.y, bb.width, bb.height],
      parent: el.parentNode.id || el.parentNode.localName,
    };
  });

// Sampled areas are good to ~0.2%.
function expectArea(area, want) {
  expect(Math.abs(area - want) / want, `area ${area} ≈ ${want}`).toBeLessThan(0.002);
}

function expectBox(got, want, digits = 0) {
  for (let i = 0; i < 4; i++) expect(got[i]).toBeCloseTo(want[i], digits);
}

test('paper.js is not loaded until a combine runs, then only once', async ({ page }) => {
  expect(await page.evaluate(() => !!window.paper)).toBe(false);
  for (const act of ['combineUnite', 'combineIntersect']) {
    await load(page, TWO);
    await selectAll(page);
    await combine(page, act);
  }
  expect(await page.evaluate(() => !!window.paper?.CompoundPath)).toBe(true);
  await expect(page.locator('script[src*="paper-core"]')).toHaveCount(1);
});

// Two overlapping 100 × 100 squares sharing a 50 × 50 corner.
for (const [act, label, area, fill] of [
  ['combineUnite', 'Unite', 10000 + 10000 - 2500, '#dc2626'],
  ['combineSubtract', 'Subtract Front', 10000 - 2500, '#2563eb'],
  ['combineIntersect', 'Intersect', 2500, '#dc2626'],
  ['combineExclude', 'Exclude', 10000 + 10000 - 2 * 2500, '#dc2626'],
]) {
  test(`${label} of two squares: area ${area}, ${fill} style, one layer`, async ({ page }) => {
    await load(page, TWO, 800, 600, 'b.svg');
    await selectAll(page);
    await combine(page, act);
    await expect(msg(page)).toHaveText(`${label}: 2 shapes → 1.`);
    const r = await result(page);
    expectArea(r.area, area);
    expect(r.fill).toBe(fill);
    expect(await layerCount(page)).toBe(1);
  });
}

test('circle ∪ square keeps curves, has the right area and bbox, and is point-editable', async ({
  page,
}) => {
  await load(
    page,
    '<circle cx="200" cy="200" r="80" fill="#16a34a"/><rect x="200" y="200" width="120" height="120" fill="#facc15"/>',
  );
  await selectAll(page);
  await combine(page, 'combineUnite');
  const r = await result(page);
  expect(r.curves).toBe(true);
  // Three quarters of the circle plus the whole square.
  expectArea(r.area, Math.PI * 80 * 80 * 0.75 + 120 * 120); // ≈ 29480
  expectBox(r.bbox, [120, 120, 200, 200]);

  await page.keyboard.press('a');
  // The circle's top and left quadrant points, the two points where it meets
  // the square's edges, and the square's three outer corners.
  await expect(page.locator('#sc-nodes [data-node]')).toHaveCount(7);
  await page.keyboard.press('Escape');
});

test('rotated and nested operands combine where they appear on screen', async ({ page }) => {
  await load(
    page,
    '<g transform="translate(300 100)"><rect x="0" y="0" width="200" height="100" fill="#7c3aed" transform="rotate(30 100 50)"/></g><rect x="350" y="120" width="100" height="100" fill="#0ea5e9"/>',
  );
  const operands = await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    const els = [
      document.querySelector('#sc-doc g rect'),
      document.querySelector('#sc-doc > rect'),
    ];
    s.state.sel = els;
    s.syncActions();
    const v = document.getElementById('sc-view').getCTM().inverse();
    let [x0, y0, x1, y1] = [1e9, 1e9, -1e9, -1e9];
    for (const el of els) {
      const bb = el.getBBox();
      const m = v.multiply(el.getCTM());
      for (const [x, y] of [
        [bb.x, bb.y],
        [bb.x + bb.width, bb.y],
        [bb.x, bb.y + bb.height],
        [bb.x + bb.width, bb.y + bb.height],
      ]) {
        const p = new DOMPoint(x, y).matrixTransform(m);
        [x0, y0, x1, y1] = [
          Math.min(x0, p.x),
          Math.min(y0, p.y),
          Math.max(x1, p.x),
          Math.max(y1, p.y),
        ];
      }
    }
    return [x0, y0, x1 - x0, y1 - y0];
  });
  await combine(page, 'combineUnite');
  const r = await result(page);
  expectBox(r.bbox, operands);
  expect(r.parent).toBe('sc-doc');
});

test('a group counts as one shape and text layers are skipped', async ({ page }) => {
  await load(
    page,
    '<g data-name="pair"><rect x="100" y="100" width="100" height="100" fill="#f97316"/><rect x="250" y="100" width="100" height="100" fill="#f97316"/></g><rect x="150" y="120" width="150" height="60" fill="#14b8a6"/><text x="50" y="400" font-size="40">Hi</text>',
  );
  await selectAll(page);
  await combine(page, 'combineIntersect');
  await expect(msg(page)).toHaveText('Intersect: 2 shapes → 1 (1 text / image layer skipped).');
  // The strip crosses each square of the pair over 50 × 60.
  expectArea((await result(page)).area, 2 * 50 * 60);
  expect(await layerCount(page), 'result + the untouched text').toBe(2);
});

test('a gradient fill on the style source survives; undo restores the operands', async ({
  page,
}) => {
  await load(
    page,
    '<defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="100" y="100" width="100" height="100" fill="#2563eb"/><circle cx="200" cy="200" r="60" fill="url(#gg)"/>',
  );
  await selectAll(page);
  await combine(page, 'combineUnite');
  expect((await result(page)).fill).toBe('url(#gg)');
  await expect(page.locator('#gg'), 'gradient not pruned').toHaveCount(1);

  await page.keyboard.press('Control+z');
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc > *')].map((e) => e.localName),
    ),
  ).toEqual(['rect', 'circle']);
});

test('intersecting disjoint shapes leaves everything alone', async ({ page }) => {
  await load(
    page,
    '<rect x="0" y="0" width="50" height="50"/><rect x="300" y="300" width="50" height="50"/>',
  );
  await selectAll(page);
  await combine(page, 'combineIntersect');
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'The shapes don’t overlap, so there’s nothing to keep.',
  );
  expect(await layerCount(page)).toBe(2);
});

test('Object › Combine Shapes › Exclude works from the menu', async ({ page }) => {
  await load(page, TWO);
  await selectAll(page);
  await page.evaluate(() => (document.getElementById('sc-msg').textContent = ''));
  await page.click('.sc-menu-btn:has-text("Object")');
  await page.hover('.sc-sub-btn:has-text("Combine Shapes")');
  await page.click('.sc-sub-list button:has-text("Exclude")');
  await expect(msg(page)).toHaveText('Exclude: 2 shapes → 1.');
  expectArea((await result(page)).area, 15000);

  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc > rect')).toHaveCount(2);
});
