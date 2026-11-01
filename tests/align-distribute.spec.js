// Align / distribute (by command and from the options bar) and the
// eyedropper's style and pixel modes.
import { test, expect, toScreen, clickDoc } from './fixtures.js';

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <rect id="a" x="50" y="60" width="100" height="80" fill="#dc2626"/>
  <rect id="b" x="300" y="200" width="60" height="140" fill="#16a34a" stroke="#000" stroke-width="6" stroke-opacity="0.5" opacity="0.8"/>
  <circle id="c" cx="600" cy="400" r="50" fill="#2563eb" fill-opacity="0.5"/>
  <rect id="d" x="200" y="450" width="40" height="40" fill="#facc15" transform="rotate(20 220 470)"/>
</svg>`;

// d is a 40 × 40 square rotated 20° about its centre (220,470): its box
// reaches 20·(cos 20° + sin 20°) from the centre on every side.
const D_HALF = 20 * (Math.cos(Math.PI / 9) + Math.sin(Math.PI / 9)); // ≈ 25.63

const open = (page) => page.evaluate((svg) => window.svgcraft.openSvg(svg, 't.svg'), DOC);

// Doc-space boxes of the top-level layers, transforms included.
const boxes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc > *')].map((el) => {
      const r = el.getBBox();
      const M = document.getElementById('sc-view').getCTM().inverse().multiply(el.getCTM());
      const pts = [
        [r.x, r.y],
        [r.x + r.width, r.y],
        [r.x, r.y + r.height],
        [r.x + r.width, r.y + r.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(M));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return {
        id: el.id,
        x: Math.min(...xs),
        y: Math.min(...ys),
        r: Math.max(...xs),
        b: Math.max(...ys),
      };
    }),
  );

const selectIds = (page, ids) =>
  page.evaluate((ids) => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = ids.map((i) => document.getElementById(i));
    s.syncActions();
  }, ids);

const run = (page, cmd) => page.evaluate((cmd) => window.svgcraft.cmds[cmd](), cmd);

function expectAll(values, want, digits = 1) {
  for (const v of values) expect(v).toBeCloseTo(want, digits);
}

async function openAndSelectAll(page) {
  await open(page);
  await selectIds(page, ['a', 'b', 'c', 'd']);
}

test('Align Left lines up left edges with the leftmost', async ({ page }) => {
  await openAndSelectAll(page);
  await run(page, 'alignLeft');
  expectAll(
    (await boxes(page)).map((q) => q.x),
    50,
  );
});

test('Align Bottom lines up bottoms with the lowest, rotated box included', async ({ page }) => {
  await openAndSelectAll(page);
  await run(page, 'alignBottom');
  expectAll(
    (await boxes(page)).map((q) => q.b),
    470 + D_HALF,
  ); // ≈ 495.63
});

test('Align Vertical Centers uses the middle of the selection’s box', async ({ page }) => {
  await openAndSelectAll(page);
  await run(page, 'alignVCenter');
  const mid = (60 + 470 + D_HALF) / 2; // ≈ 277.82
  expectAll(
    (await boxes(page)).map((q) => (q.y + q.b) / 2),
    mid,
  );
});

test('Distribute Horizontally evens the gaps between fixed outer edges', async ({ page }) => {
  await openAndSelectAll(page);
  await run(page, 'distributeH');
  const s = (await boxes(page)).sort((p, q) => p.x - q.x);
  // Span 50 → 650 minus widths 100 + 60 + 100 + 2·D_HALF, over three gaps.
  const gap = (600 - 260 - 2 * D_HALF) / 3; // ≈ 96.25
  expectAll(
    s.slice(1).map((q, i) => q.x - s[i].r),
    gap,
  );
  expect(s[0].x).toBeCloseTo(50, 2);
  expect(s.at(-1).r).toBeCloseTo(650, 2);
});

test('Distribute Vertically evens the gaps between fixed outer edges', async ({ page }) => {
  await openAndSelectAll(page);
  await run(page, 'distributeV');
  const t = (await boxes(page)).sort((p, q) => p.y - q.y);
  // Span 60 → 470 + D_HALF minus heights 80 + 140 + 100 + 2·D_HALF.
  const gap = (470 + D_HALF - 60 - 320 - 2 * D_HALF) / 3; // ≈ 21.46
  expectAll(
    t.slice(1).map((q, i) => q.y - t[i].b),
    gap,
  );
  expect(t[0].y).toBeCloseTo(60, 2);
  expect(t.at(-1).b).toBeCloseTo(470 + D_HALF, 2);
});

test('undo after an align restores every layer', async ({ page }) => {
  await openAndSelectAll(page);
  const before = await boxes(page);
  await run(page, 'distributeV');
  await page.keyboard.press('Control+z');
  const after = await boxes(page);
  expect(after).toHaveLength(4);
  for (const [i, q] of after.entries())
    for (const k of ['x', 'y', 'r', 'b']) expect(q[k]).toBeCloseTo(before[i][k], 2);
});

test('a single object aligns to the artboard', async ({ page }) => {
  await open(page);
  await selectIds(page, ['c']);
  await run(page, 'alignHCenter');
  await run(page, 'alignVCenter');
  const c = (await boxes(page)).find((q) => q.id === 'c');
  expect((c.x + c.r) / 2).toBeCloseTo(400, 2);
  expect((c.y + c.b) / 2).toBeCloseTo(300, 2);
});

test('distributing fewer than three objects explains why nothing happened', async ({ page }) => {
  await open(page);
  await selectIds(page, ['a', 'b']);
  await run(page, 'distributeH');
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'Select three or more objects to distribute.',
  );
});

test('the options-bar Align Top button works and its rotated icons render rotated', async ({
  page,
}) => {
  await open(page);
  await selectIds(page, ['a', 'b', 'c']);
  await page.click('.sc-opt.on [data-action="alignTop"]');
  const abc = (await boxes(page)).filter((q) => 'abc'.includes(q.id));
  expectAll(
    abc.map((q) => q.y),
    60,
    2,
  );
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.sc-opt.on .sc-rot90 svg')).transform,
    ),
  ).toBe('matrix(0, 1, -1, 0, 0, 0)');
});

// ---- Eyedropper -----------------------------------------------------------

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Rasterising a 50%-alpha colour can round a channel by a step or two.
function expectHexNear(hex, want, tol = 2) {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  const [g, w] = [rgb(hex), rgb(want)];
  for (let i = 0; i < 3; i++)
    expect(Math.abs(g[i] - w[i]), `${hex} ≈ ${want}`).toBeLessThanOrEqual(tol);
}

const paint = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    return { active: s.active, fill: s.fill, fillA: s.fillA, stroke: s.stroke, strokeA: s.strokeA };
  });

test('the eyedropper copies a clicked object’s style onto the selection; undo reverts it', async ({
  page,
}) => {
  await open(page);
  await selectIds(page, ['a']);
  await page.keyboard.press('i');
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('eyedropper');
  expect(await page.evaluate(() => window.svgcraft.state.sel.length), 'selection kept').toBe(1);

  await clickDoc(page, 330, 270); // centre of b
  const a = page.locator('#sc-doc #a');
  await expect(a).toHaveAttribute('fill', '#16a34a');
  await expect(a).toHaveAttribute('stroke', '#000000');
  await expect(a).toHaveAttribute('stroke-opacity', '0.5');
  await expect(a).toHaveAttribute('stroke-width', '6');
  await expect(a).toHaveAttribute('opacity', '0.8');
  // Geometry is untouched.
  await expect(a).toHaveAttribute('x', '50');
  await expect(a).toHaveAttribute('width', '100');
  await expect(page.locator('#sc-msg')).toHaveText('Style applied to 1 object.');

  await page.keyboard.press('Control+z');
  await expect(a).toHaveAttribute('fill', '#dc2626');
});

test.describe('eyedropper pixel mode', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.keyboard.press('i');
    await page.click('[data-eyedrop="pixel"]');
    await page.evaluate(() => {
      window.svgcraft.state.sel = [];
    });
  });

  test('hovering previews the colour; clicking sets the fill with its alpha', async ({ page }) => {
    // The 50%-blue circle over a transparent artboard.
    const [cx, cy] = [600, 400];
    const p0 = await toScreen(page, cx - 5, cy - 5);
    const p1 = await toScreen(page, cx, cy);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.move(p1.x, p1.y, { steps: 2 });

    const ring = page.locator('#sc-guides .sc-eyedrop-ring').first();
    await expect(ring).toHaveAttribute('stroke', /^#[0-9a-f]{6}$/i);
    const hover = await ring.getAttribute('stroke');
    expectHexNear(hover, '#2563eb');
    await expect(page.locator('#sc-eyedrop-note')).toHaveText(`${hover} · 50%`);

    await page.mouse.click(p1.x, p1.y);
    await expect(page.locator('#sc-msg')).toHaveText(/^Fill set to #[0-9a-f]{6} at 50%\.$/i);
    expect(
      await page.evaluate(
        () => `${window.svgcraft.state.tool} ${window.svgcraft.state.eyedropMode}`,
      ),
    ).toBe('eyedropper pixel');
    const s = await paint(page);
    expect(s.active).toBe('fill');
    expectHexNear(s.fill, '#2563eb');
    expect(s.fillA).toBeCloseTo(0.5, 1);
  });

  test('Alt-click samples into the stroke', async ({ page }) => {
    const p = await toScreen(page, 80, 80); // inside the opaque red rect a
    await page.keyboard.down('Alt');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await paint(page)).stroke).toBe('#dc2626');
    expect((await paint(page)).strokeA).toBe(1);
  });

  test('clicking a transparent spot says there is nothing to sample', async ({ page }) => {
    await clickDoc(page, 780, 20);
    await expect(page.locator('#sc-alert-text')).toHaveText(
      'Nothing there to sample (transparent).',
    );
  });
});
