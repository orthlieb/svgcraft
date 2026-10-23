import { test, expect, load, menu } from './fixtures.js';

// Image → Image Trace…: a placed bitmap traced into one layer per colour,
// stacked (each layer also covers the colours above it, so there are no
// gaps) or abutting.

// A 300 × 200 test image: white ground, red disc, blue box with a green
// ring in it, and a thick dark line.
async function placeTestImage(page) {
  await load(page, '', 600, 400);
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 300, 200);
    x.fillStyle = '#dc2626';
    x.beginPath();
    x.arc(80, 100, 60, 0, 7);
    x.fill();
    x.fillStyle = '#2563eb';
    x.fillRect(150, 40, 110, 80);
    x.strokeStyle = '#111111';
    x.lineWidth = 10;
    x.beginPath();
    x.moveTo(140, 180);
    x.lineTo(290, 140);
    x.stroke();
    x.strokeStyle = '#16a34a';
    x.lineWidth = 12;
    x.beginPath();
    x.arc(200, 80, 25, 0, 7);
    x.stroke();
    // eslint-disable-next-line no-undef -- the editor's own global
    placeImage(c.toDataURL());
  });
  await expect(page.locator('#sc-doc image')).toHaveCount(1);
  await expect(page.locator('#sc-msg')).toContainText('Image Trace');
}
async function openTrace(page) {
  await menu(page, 'Image', 'imageTrace');
  await expect(page.locator('#sc-trace')).toBeVisible();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/colour/);
}
const status = (page) => page.locator('[data-tr="status"]').textContent();
// Distance between two hex colours, per channel.
const near = (a, b) =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)),
    ),
  );
// Is a point of the image (in its own 300 × 200 pixels) inside each layer?
const hits = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const img = document.querySelector('#sc-doc image');
      const pt = new DOMPoint(
        +img.getAttribute('x') + (x * +img.getAttribute('width')) / 300,
        +img.getAttribute('y') + (y * +img.getAttribute('height')) / 200,
      );
      return [...document.querySelectorAll('#sc-doc g[data-name="Image Trace"] path')].map((p) =>
        p.isPointInFill(
          pt.matrixTransform(
            p.getCTM().inverse().multiply(document.getElementById('sc-doc').getCTM()),
          ),
        ),
      );
    },
    [x, y],
  );

test('traces into one layer per colour, over the image, stacked', async ({ page }) => {
  await placeTestImage(page);
  await openTrace(page);
  // Logo: six colours at most, the white background left out.
  await expect(page.locator('[data-tr="preset"]')).toHaveValue('logo');
  expect(await status(page)).toMatch(/^4 colours · \d+ shapes( \([^)]+\))? · [\d.]+ K?B$/);
  await expect(page.locator('[data-tr="preview"] path')).toHaveCount(4);
  await page.click('[data-tr-btn="ok"]');
  await expect(page.locator('#sc-msg')).toHaveText('Traced into 4 colour layers.');
  const g = page.locator('#sc-doc g[data-name="Image Trace"]');
  await expect(g).toHaveCount(1);
  const fills = await g.locator('path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')));
  // Largest colour at the bottom: the red disc, then the blue box, in their
  // exact colours (from their insides, not their blended edges).
  expect(fills.slice(0, 2)).toEqual(['#dc2626', '#2563eb']);
  expect(fills.some((f) => near(f, '#16a34a') < 12)).toBe(true);
  expect(fills.some((f) => near(f, '#111111') < 20)).toBe(true);
  // Layer names say the colour and its share.
  await expect(g.locator('path').first()).toHaveAttribute(
    'data-name',
    /^Colour #[0-9a-f]{6} · \d+%$/,
  );
  // The original stays, hidden, under the trace; the trace sits where it was.
  const img = page.locator('#sc-doc image');
  await expect(img).toHaveAttribute('display', 'none');
  const [ib, gb] = await page.evaluate(() => {
    // eslint-disable-next-line no-undef -- the editor's own global
    const b = (el) => bboxDoc(el);
    const im = document.querySelector('#sc-doc image');
    return [
      { x: +im.getAttribute('x'), y: +im.getAttribute('y') },
      b(document.querySelector('#sc-doc g[data-name="Image Trace"]')),
    ];
  });
  // The disc's left edge is 20 px into the image (of 300).
  expect(Math.abs(gb.x - (ib.x + 20 * (+(await img.getAttribute('width')) / 300)))).toBeLessThan(2);
  // Stacked: the bottom (red) layer also covers the blue box, so no gaps.
  expect((await hits(page, 165, 110))[0]).toBe(true);
  // Undo brings the image back as it was.
  await page.evaluate(() => window.svgcraft.undo());
  await expect(page.locator('#sc-doc g')).toHaveCount(0);
  await expect(page.locator('#sc-doc image')).not.toHaveAttribute('display', 'none');
});

test('it looks like the image', async ({ page }) => {
  await placeTestImage(page);
  await openTrace(page);
  await page.locator('[data-tr="ignoreBg"]').uncheck();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/^5 colours/);
  await page.click('[data-tr-btn="ok"]');
  // Draw the drawing with only the image, then with only the trace.
  const differ = await page.evaluate(async () => {
    const draw = async (showTrace) => {
      const img = document.querySelector('#sc-doc image');
      const g = document.querySelector('#sc-doc g');
      img.setAttribute('display', showTrace ? 'none' : 'inline');
      g.setAttribute('display', showTrace ? 'inline' : 'none');
      const im = new Image();
      im.src =
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
      await im.decode();
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 400;
      c.getContext('2d').drawImage(im, 0, 0);
      return c.getContext('2d').getImageData(0, 0, 600, 400).data;
    };
    const a = await draw(false);
    const b = await draw(true);
    let n = 0;
    let all = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (!a[i + 3]) continue;
      all++;
      if (Math.max(...[0, 1, 2].map((k) => Math.abs(a[i + k] - b[i + k]))) > 60) n++;
    }
    return n / all;
  });
  // Only edges differ: by a pixel here and there, and stacked layers
  // reach a pixel over the ones below so there's never a gap.
  expect(differ).toBeLessThan(0.035);
});

test('abutting, black and white, presets and Cancel', async ({ page }) => {
  await placeTestImage(page);
  await openTrace(page);
  // Abutting: each colour only covers itself.
  await page.locator('[data-tr="stacked"]').uncheck();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/colour/);
  await page.click('[data-tr-btn="ok"]');
  expect((await hits(page, 165, 110))[0]).toBe(false);
  expect((await hits(page, 80, 100))[0]).toBe(true);
  await page.evaluate(() => window.svgcraft.undo());
  // Sketch: black and white, background left out. The colours darker than
  // the threshold go black; the light green ring is a white island in them.
  await page.evaluate(
    () => (window.svgcraft.state.sel = [document.querySelector('#sc-doc image')]),
  );
  await openTrace(page);
  await page.selectOption('[data-tr="preset"]', 'sketch');
  await expect(page.locator('[data-tr-mode="bw"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-tr="threshold"]')).toBeVisible();
  await expect(page.locator('[data-tr="colours"]')).toBeHidden();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/^2 colours ·/);
  expect(
    await page
      .locator('[data-tr="preview"] path')
      .evaluateAll((ps) => ps.map((p) => p.getAttribute('fill'))),
  ).toEqual(['#000000', '#ffffff']);
  // Changing a setting makes it Custom.
  await page.fill('[data-tr="speck"]', '3');
  await expect(page.locator('[data-tr="preset"]')).toHaveValue('');
  // Cancel leaves the drawing alone; Keep off replaces the image.
  await page.click('[data-tr-btn="cancel"]');
  await expect(page.locator('#sc-doc g')).toHaveCount(0);
  await openTrace(page);
  await page.locator('[data-tr="keep"]').uncheck();
  await page.click('[data-tr-btn="ok"]');
  await expect(page.locator('#sc-doc image')).toHaveCount(0);
  await expect(page.locator('#sc-doc g[data-name="Image Trace"]')).toHaveCount(1);
});

test('needs an image selected', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  await menu(page, 'Image', 'imageTrace');
  await expect(page.locator('#sc-trace')).toBeHidden();
  await expect(page.locator('#sc-msg')).toContainText('Select a placed image');
});

test.describe('without workers', () => {
  test.beforeEach(({ page }) => page.addInitScript(() => (window.Worker = undefined)));
  test('it traces on the page instead', async ({ page }) => {
    await placeTestImage(page);
    await openTrace(page);
    expect(await status(page)).toMatch(/^4 colours/);
  });
});

test('circles and ellipses come out as true arcs', async ({ page }) => {
  await placeTestImage(page);
  await openTrace(page);
  await expect(page.locator('[data-tr="status"]')).toHaveText(/\(\d+ ellipses?[,)]/);
  await page.click('[data-tr-btn="ok"]');
  // The red disc (radius 60 of the image's 300 px) is two elliptical arcs
  // of equal radii, centred where it was.
  const red = page.locator('#sc-doc g[data-name="Image Trace"] path').first();
  const d = await red.getAttribute('d');
  const m = /^M([\d.]+) ([\d.]+)A([\d.]+) ([\d.]+) [-\d.]+ 1 1 ([\d.]+) ([\d.]+)A/.exec(d);
  expect(m).not.toBeNull();
  const [x0, y0, rx, ry, x1, y1] = m.slice(1).map(Number);
  const k = 400 / 300; // traced at 400 px on the long side
  expect(rx / k).toBeCloseTo(60, 0);
  expect(ry / k).toBeCloseTo(60, 0);
  expect((x0 + x1) / 2 / k).toBeCloseTo(80, 0);
  expect((y0 + y1) / 2 / k).toBeCloseTo(100, 0);
  // The box isn't an ellipse; turned off, nothing is.
  const blue = page.locator('#sc-doc g[data-name="Image Trace"] path').nth(1);
  expect(await blue.getAttribute('d')).toMatch(/^M[^A]*?L/);
  await page.evaluate(() => window.svgcraft.undo());
  await page.evaluate(
    () => (window.svgcraft.state.sel = [document.querySelector('#sc-doc image')]),
  );
  await openTrace(page);
  await page.locator('[data-tr="shapes"]').uncheck();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/shapes · /);
  expect(
    await page
      .locator('[data-tr="preview"] path')
      .evaluateAll((ps) => ps.some((p) => /A/.test(p.getAttribute('d')))),
  ).toBe(false);
});

test('rectangles, square or rounded, at any angle, come out exact', async ({ page }) => {
  await load(page, '', 600, 400);
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 400, 300);
    // Square corners, turned 20°, 120 × 70.
    x.save();
    x.translate(110, 150);
    x.rotate((20 * Math.PI) / 180);
    x.fillStyle = '#2563eb';
    x.fillRect(-60, -35, 120, 70);
    x.restore();
    // Rounded (radius 18), turned −30°, 130 × 80.
    x.save();
    x.translate(290, 150);
    x.rotate((-30 * Math.PI) / 180);
    x.fillStyle = '#dc2626';
    x.beginPath();
    x.roundRect(-65, -40, 130, 80, 18);
    x.fill();
    x.restore();
    // eslint-disable-next-line no-undef -- the editor's own global
    placeImage(c.toDataURL());
  });
  await expect(page.locator('#sc-doc image')).toHaveCount(1);
  await openTrace(page);
  // Stacked: the bottom (red, larger) layer has the blue square in it too.
  await expect(page.locator('[data-tr="status"]')).toHaveText(/\(3 rectangles\)/);
  // Traced at 400 px: the image's own pixels. Each layer's path, by colour.
  const d = async (fill) =>
    page.locator(`[data-tr="preview"] path[fill="${fill}"]`).getAttribute('d');
  const nums = (s) => s.match(/-?[\d.]+/g).map(Number);
  // Square: four corners, the sides 120 and 70 long.
  const sq = await d('#2563eb');
  expect(sq).toMatch(/^M[-\d. ]+L[-\d. ]+L[-\d. ]+L[-\d. ]+Z$/);
  const p = nums(sq);
  const side = (i, j) => Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1]);
  // (The top layer reaches a pixel further each side, over the one below.)
  expect(Math.abs(side(0, 2) - 120)).toBeLessThan(2.5);
  expect(Math.abs(side(2, 4) - 70)).toBeLessThan(2.5);
  // Its centre where it was drawn.
  expect((p[0] + p[4]) / 2).toBeCloseTo(110, 0);
  expect((p[1] + p[5]) / 2).toBeCloseTo(150, 0);
  // Rounded: four arcs of the same radius, about 18.
  const rr = await d('#dc2626');
  const radii = [...rr.matchAll(/A([\d.]+) ([\d.]+) 0 0 1/g)].map((m) => +m[1]);
  expect(radii).toHaveLength(4);
  for (const r of radii) expect(Math.abs(r - 18)).toBeLessThan(2);
});
