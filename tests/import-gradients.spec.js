// Gradients from other programs (in the shape's box, with a
// gradientTransform, borrowed down an href chain) become SVGCraft's own on
// import, drawing the same, so they have handles straight away.
import { test, expect, select } from './fixtures.js';

const SRC =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300">' +
  '<defs>' +
  '<linearGradient id="stops"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#2563eb"/></linearGradient>' +
  '<linearGradient id="box" xlink:href="#stops" x1="0" y1="0" x2="1" y2="1"/>' +
  '<linearGradient id="turned" xlink:href="#stops" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0" gradientTransform="translate(200 20) rotate(30) scale(1 0.5)"/>' +
  '<radialGradient id="round" xlink:href="#stops" cx="0.5" cy="0.5" r="0.5"/>' +
  '<radialGradient id="oval" xlink:href="#stops"/>' +
  '<linearGradient id="repeat" xlink:href="#stops" x2="0.2" spreadMethod="repeat"/>' +
  '</defs>' +
  '<rect id="a" x="20" y="20" width="160" height="80" fill="url(#box)"/>' +
  '<rect id="b" x="200" y="20" width="180" height="120" style="fill:url(#turned)"/>' +
  '<rect id="c" x="20" y="160" width="100" height="100" fill="url(#round)"/>' +
  '<rect id="d" x="140" y="160" width="160" height="60" fill="url(#oval)"/>' +
  '<rect id="e" x="140" y="230" width="160" height="60" fill="url(#repeat)"/>' +
  '</svg>';

// The share of pixels that differ visibly between two SVGs, drawn the same size.
const diff = (page, a, b) =>
  page.evaluate(
    async ([a, b]) => {
      const draw = async (svg) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const c = document.createElement('canvas');
        [c.width, c.height] = [400, 300];
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 400, 300);
        return g.getImageData(0, 0, 400, 300).data;
      };
      const [p, q] = [await draw(a), await draw(b)];
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if (Math.max(...[0, 1, 2, 3].map((k) => Math.abs(p[i + k] - q[i + k]))) > 8) n++;
      return n / (p.length / 4);
    },
    [a, b],
  );

test('imported gradients become SVGCraft’s own and draw the same', async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'import.svg'), SRC);
  const paint = (id) =>
    page.evaluate((id) => {
      const el = document.getElementById(id);
      const g = document.getElementById(
        (el.getAttribute('fill') || '').match(/#([^)]+)/)?.[1] || '',
      );
      return { own: !!g?.hasAttribute('data-sc-grad'), inline: el.style.fill };
    }, id);
  // In the box, turned and squashed, round radial: adopted.
  for (const id of ['a', 'b', 'c']) expect((await paint(id)).own).toBe(true);
  expect((await paint('b')).inline).toBe('');
  // An oval radial and a repeating one can't be matched: left alone.
  for (const id of ['d', 'e']) expect((await paint(id)).own).toBe(false);
  // Each painted one shape, so its replacement takes its id; those still
  // used or borrowed from stay as they were.
  const ids = await page.$$eval('#sc-defs > *', (gs) =>
    gs.map((g) => g.id + (g.hasAttribute('data-sc-grad') ? '*' : '')),
  );
  expect(ids.sort()).toEqual(['box*', 'oval', 'repeat', 'round*', 'stops', 'turned*']);
  for (const [el, id] of [
    ['a', 'box'],
    ['c', 'round'],
  ])
    expect(await page.locator(`#${el}`).getAttribute('fill')).toBe(`url(#${id})`);

  const out = await page.evaluate(() => window.svgcraft.serialize());
  expect(await diff(page, SRC, out)).toBeLessThan(0.002);

  // Selected, the adopted one shows its handles.
  await select(page, 'b');
  await page.evaluate(() => window.drawSelection());
  await expect(page.locator('[data-grad-h="a"]')).toHaveCount(1);
});

test('a placed SVG’s gradients are adopted too, inside its scaled group', async ({ page }) => {
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'placed.svg'), SRC);
  const own = await page.$eval('#sc-doc #a', (el) =>
    document
      .getElementById(el.getAttribute('fill').match(/#([^)]+)/)[1])
      .hasAttribute('data-sc-grad'),
  );
  expect(own).toBe(true);
});

test('a gradient shared by two shapes gives each its own; its name goes with them', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs>' +
        '<linearGradient id="g" data-name="Sky"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>' +
        '<rect id="a" width="80" height="80" fill="url(#g)"/><rect id="b" x="100" width="80" height="80" fill="url(#g)"/></svg>',
      'shared.svg',
    ),
  );
  const fills = await page.$$eval('#sc-doc rect', (rs) => rs.map((r) => r.getAttribute('fill')));
  expect(new Set(fills).size).toBe(2);
  expect(fills).not.toContain('url(#g)');
  await expect(page.locator('#sc-defs #g')).toHaveCount(0);
  await expect(page.locator('#sc-defs [data-sc-grad][data-name="Sky"]')).toHaveCount(2);
});
