// Image Trace on images kept in <defs>: drawn by a <use> (straight, or
// through a symbol) or shown by a shape's pattern fill. The traced shapes
// must land where the image was drawn, so each case renders the drawing
// before and after, and compares the colours.
import { test, expect, load, select } from './fixtures.js';

// A 200 × 100 bitmap in four flat quarters, as a data: URL.
const quarters = (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const x = c.getContext('2d');
    for (const [col, qx, qy] of [
      ['#dc2626', 0, 0],
      ['#2563eb', 100, 0],
      ['#16a34a', 0, 50],
      ['#facc15', 100, 50],
    ]) {
      x.fillStyle = col;
      x.fillRect(qx, qy, 100, 50);
    }
    return c.toDataURL();
  });

// The saved drawing rendered at 1 px a unit: the colour every 8 units where
// the 9 × 9 pixels round it are one opaque colour, as "x,y" → [r, g, b].
const render = (page) =>
  page.evaluate(async () => {
    const text = window.svgcraft.serialize();
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    await img.decode();
    const { w, h } = window.svgcraft.state;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const out = {};
    for (let y = 8; y < h - 8; y += 8)
      for (let px = 8; px < w - 8; px += 8) {
        const at = (i, j) => ((y + j) * w + px + i) * 4;
        const o = at(0, 0);
        let flat = d[o + 3] === 255;
        for (let j = -4; flat && j <= 4; j++)
          for (let i = -4; flat && i <= 4; i++) {
            const q = at(i, j);
            flat = [0, 1, 2, 3].every((k) => Math.abs(d[q + k] - d[o + k]) < 8);
          }
        if (flat) out[`${px},${y}`] = [d[o], d[o + 1], d[o + 2]];
      }
    return out;
  });

async function traceIt(page) {
  await page.click('.sc-menu-btn:text-is("Object")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="imageTrace"]');
  await expect(page.locator('#sc-trace')).toBeVisible();
  await page.evaluate(() => {
    const b = document.querySelector('[data-tr="ignoreBg"]');
    b.checked = false;
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const ok = page.locator('[data-tr-btn="ok"]');
  await expect(ok).toBeEnabled();
  await expect(page.locator('[data-tr="status"]')).toHaveText(/^4 colours/);
  await ok.click();
  await expect(page.locator('#sc-trace')).toBeHidden();
  await expect(page.locator('#sc-doc g[data-name="Image Trace"]')).toHaveCount(1);
}

const CASES = {
  'a <use> of an image in <defs>': (u) =>
    `<defs><image id="im" width="200" height="100" href="${u}"/></defs>` +
    '<use id="L" href="#im" x="20" y="30" transform="translate(100 50) scale(1.5)"/>',
  'a <use> of a symbol with a viewBox': (u) =>
    `<defs><symbol id="sy" viewBox="0 0 200 100"><image width="200" height="100" href="${u}"/></symbol></defs>` +
    '<use id="L" href="#sy" x="100" y="80" width="300" height="150"/>',
  'a <use> of a symbol drawing the image through a group': (u) =>
    `<defs><symbol id="sy"><g transform="translate(10 20) rotate(15)"><image x="5" width="200" height="100" href="${u}"/></g></symbol></defs>` +
    '<use id="L" href="#sy" transform="translate(150 100)"/>',
  'a pattern fill, as Figma exports one': (u) =>
    `<defs><pattern id="pa" patternContentUnits="objectBoundingBox" width="1" height="1"><use href="#im" transform="scale(0.005 0.01)"/></pattern>` +
    `<image id="im" width="200" height="100" href="${u}"/></defs>` +
    '<rect id="L" x="120" y="60" width="300" height="150" fill="url(#pa)"/>',
  'an offset bounding-box tile with bounding-box content': (u) =>
    `<defs><pattern id="pd" patternContentUnits="objectBoundingBox" x="0.25" y="0.2" width="0.5" height="0.6">` +
    `<image width="0.5" height="0.6" preserveAspectRatio="none" href="${u}"/></pattern></defs>` +
    '<rect id="L" x="60" y="40" width="400" height="300" fill="url(#pd)"/>',
  'a user-space pattern with an offset tile and a patternTransform': (u) =>
    `<defs><pattern id="pb" patternUnits="userSpaceOnUse" x="100" y="50" width="200" height="100" patternTransform="rotate(10 200 100)">` +
    `<image width="200" height="100" href="${u}"/></pattern></defs>` +
    '<rect id="L" x="100" y="50" width="200" height="100" fill="url(#pb)"/>',
  'a pattern with a viewBox, inherited through href': (u) =>
    `<defs><pattern id="base" viewBox="0 0 200 100"><image width="200" height="100" href="${u}"/></pattern>` +
    '<pattern id="pc" href="#base" x="0.1" y="0" width="0.8" height="1"/></defs>' +
    '<ellipse id="L" cx="300" cy="200" rx="200" ry="80" fill="url(#pc)"/>',
};

for (const [name, scene] of Object.entries(CASES))
  test(`traces ${name} where it’s drawn`, async ({ page }) => {
    await load(page, '', 600, 400);
    await load(page, scene(await quarters(page)), 600, 400);
    await select(page, 'L');
    const before = await render(page);
    await traceIt(page);
    const after = await render(page);
    let same = 0;
    const wrong = [];
    const seen = new Set();
    for (const [k, a] of Object.entries(before)) {
      const b = after[k];
      if (!b) continue;
      if (a.every((v, i) => Math.abs(v - b[i]) < 24)) {
        same++;
        seen.add(a.join());
      } else wrong.push(`${k}: ${a} → ${b}`);
    }
    expect(wrong, 'points whose colour changed').toEqual([]);
    expect(seen.size, 'all four quarters compared').toBe(4);
    expect(same).toBeGreaterThan(40);
  });

test('a <use> of a symbol with two images says to pick one', async ({ page }) => {
  await load(page, '', 600, 400);
  const u = await quarters(page);
  await load(
    page,
    `<defs><symbol id="sy" data-name="Pair"><image width="200" height="100" href="${u}"/><image y="120" width="200" height="100" href="${u}"/></symbol></defs>` +
      '<use id="L" href="#sy" data-name="Pair"/>',
    600,
    400,
  );
  await select(page, 'L');
  await page.evaluate(() => window.svgcraft.actions.imageTrace());
  await expect(page.locator('#sc-alert-text')).toContainText('“Pair” draws 2 images');
});

test('a shape with a plain fill isn’t an image layer', async ({ page }) => {
  await load(page, '<rect id="L" width="100" height="100" fill="url(#none)"/>', 600, 400);
  await select(page, 'L');
  await page.click('.sc-menu-btn:text-is("Object")');
  await expect(
    page.locator('.sc-menu-list:not([hidden]) [data-action="imageTrace"]'),
  ).toBeDisabled();
});
