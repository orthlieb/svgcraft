import { test, expect, load, select, menu } from './fixtures.js';

// The painted bounds (used by Crop, Define Pattern and Copy as SVG) cover
// exactly what's drawn: stroke width and position, mitres, caps, joins and
// effects — checked against the pixels the browser renders.

// Render one layer alone, 4× supersampled, and find its non-transparent
// pixels' bounds in document units.
const rasterBounds = (page, id) =>
  page.evaluate(async (id) => {
    const el = document.getElementById(id);
    // The layer alone, but where it sits: its whole document transform.
    const docM = document.getElementById('sc-doc').getCTM().inverse().multiply(el.getCTM());
    const placed = el.cloneNode(true);
    placed.setAttribute(
      'transform',
      `matrix(${[docM.a, docM.b, docM.c, docM.d, docM.e, docM.f].join(' ')})`,
    );
    const S = 4;
    const W = 400;
    const H = 300;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W} ${H}">` +
      `<defs>${document.getElementById('sc-defs').innerHTML}</defs>${placed.outerHTML}</svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W * S;
    c.height = H * S;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          x1 = Math.min(x1, x);
          y1 = Math.min(y1, y);
          x2 = Math.max(x2, x + 1);
          y2 = Math.max(y2, y + 1);
        }
    return { x1: x1 / S, y1: y1 / S, x2: x2 / S, y2: y2 / S };
  }, id);

const computed = (page, id) =>
  page.evaluate((id) => {
    const b = window.svgcraft.paintBox([document.getElementById(id)]);
    return { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
  }, id);

// Covers every painted pixel, and doesn't overshoot by more than `slack`.
async function expectTight(page, id, slack = 1) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  const r = await rasterBounds(page, id);
  const c = await computed(page, id);
  const tol = 0.5;
  expect(c.x1, 'left covers').toBeLessThanOrEqual(r.x1 + tol);
  expect(c.y1, 'top covers').toBeLessThanOrEqual(r.y1 + tol);
  expect(c.x2, 'right covers').toBeGreaterThanOrEqual(r.x2 - tol);
  expect(c.y2, 'bottom covers').toBeGreaterThanOrEqual(r.y2 - tol);
  expect(r.x1 - c.x1, 'left tight').toBeLessThanOrEqual(slack);
  expect(r.y1 - c.y1, 'top tight').toBeLessThanOrEqual(slack);
  expect(c.x2 - r.x2, 'right tight').toBeLessThanOrEqual(slack);
  expect(c.y2 - r.y2, 'bottom tight').toBeLessThanOrEqual(slack);
}

const CASES = {
  'mitre tips at a sharp corner':
    '<path id="s" d="M100 200 L150 100 L200 200" fill="none" stroke="#000" stroke-width="14"/>',
  'beyond the mitre limit the corner is bevelled':
    '<path id="s" d="M100 200 L130 60 L160 200" fill="none" stroke="#000" stroke-width="14" stroke-miterlimit="2"/>',
  'square caps on a diagonal line':
    '<line id="s" x1="100" y1="100" x2="250" y2="200" stroke="#000" stroke-width="20" stroke-linecap="square"/>',
  'round caps and joins':
    '<polyline id="s" points="80,200 140,80 200,200 260,90" fill="none" stroke="#000" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>',
  'outside stroke': '',
  'inside stroke': '',
  'a rotated ellipse under a non-uniform scale':
    '<g transform="scale(1.6 0.8)"><ellipse id="s" cx="120" cy="180" rx="60" ry="30" fill="#0af" stroke="#000" stroke-width="10" transform="rotate(30 120 180)"/></g>',
  'a thick curve':
    '<path id="s" d="M60 220 C 100 20, 260 20, 320 220" fill="none" stroke="#000" stroke-width="16"/>',
};

for (const [name, markup] of Object.entries(CASES)) {
  if (!markup) continue;
  test(`painted bounds: ${name}`, async ({ page }) => {
    await load(page, markup, 400, 300);
    await expectTight(page, 's');
  });
}

test('painted bounds: outside and inside stroke positions', async ({ page }) => {
  await load(
    page,
    '<rect id="s" x="100" y="80" width="120" height="90" fill="#0af" stroke="#000" stroke-width="12"/>',
    400,
    300,
  );
  await select(page, 's');
  for (const align of ['outside', 'inside', 'center']) {
    await page.click(`#sc-appearance button[data-stroke-align="${align}"]`);
    await expectTight(page, 's');
  }
  const outside = async () => {
    await page.click(`#sc-appearance button[data-stroke-align="outside"]`);
    return computed(page, 's');
  };
  expect(await outside()).toEqual({ x1: 88, y1: 68, x2: 232, y2: 182 });
});

test('painted bounds: a drop shadow and outer glow are included', async ({ page }) => {
  await load(
    page,
    '<rect id="s" x="100" y="80" width="100" height="80" fill="#0af" data-sc-fx=\'{"ds":{"c":"#000000","o":100,"a":120,"d":20,"sp":0,"s":0}}\'/>',
    400,
    300,
  );
  await expectTight(page, 's');
});

test('Crop to Selection keeps a mitred stroke whole', async ({ page }) => {
  await load(
    page,
    '<path id="s" d="M100 200 L150 100 L200 200" fill="none" stroke="#000" stroke-width="14"/>',
    400,
    300,
  );
  await select(page, 's');
  await menu(page, 'Image', 'cropToSelection');
  const { w, h } = await page.evaluate(() => window.svgcraft.state);
  const r = await rasterBounds(page, 's');
  // Everything painted is inside the new artboard.
  expect(r.x1).toBeGreaterThanOrEqual(0);
  expect(r.y1).toBeGreaterThanOrEqual(0);
  expect(r.x2).toBeLessThanOrEqual(w);
  expect(r.y2).toBeLessThanOrEqual(h);
  // Bottom: the butt ends reach 200 + 7·sin(63.4°) ≈ 203.1 → 204. Top: the
  // mitre tip pokes up 7 / sin(26.6°) ≈ 15.65 above the corner → 84.
  expect(h).toBe(204 - 84);
});

test('Copy as SVG frames the selection as painted', async ({ page }) => {
  await load(
    page,
    '<rect id="s" x="100" y="80" width="100" height="80" fill="#0af" stroke="#000" stroke-width="20"/>',
    400,
    300,
  );
  await select(page, 's');
  const svg = await page.evaluate(() => window.svgcraft.serialize({ selection: true }));
  expect(svg).toContain('viewBox="90 70 120 100"');
});
