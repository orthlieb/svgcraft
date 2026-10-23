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
  expect(await status(page)).toMatch(/^4 colours · \d+ shapes · [\d.]+ KB$/);
  await expect(page.locator('[data-tr="preview"] path')).toHaveCount(4);
  await page.click('[data-tr-btn="ok"]');
  await expect(page.locator('#sc-msg')).toHaveText('Traced into 4 colour layers.');
  const g = page.locator('#sc-doc g[data-name="Image Trace"]');
  await expect(g).toHaveCount(1);
  const fills = await g.locator('path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')));
  // Largest colour at the bottom: the red disc, then the blue box.
  for (const [i, want] of ['#dc2626', '#2563eb'].entries())
    expect(near(fills[i], want)).toBeLessThan(12);
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
  // Edges move by a pixel here and there; nothing more.
  expect(differ).toBeLessThan(0.02);
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
