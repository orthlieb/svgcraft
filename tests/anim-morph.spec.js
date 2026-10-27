// Morph: a layer's outline turns into another layer's.
import { test, expect, load, select as pickIds } from './fixtures.js';

const select = async (page, ...ids) => {
  await pickIds(page, ...ids);
  await page.evaluate(() => window.svgcraft.commit());
};
const anims = (page, id) =>
  page.evaluate((id) => JSON.parse(document.getElementById(id).dataset.scAnim || '[]'), id);
// In the saved file played to t: which of the probe points (drawing
// units) the morphing layer covers.
async function covers(page, svg, t, id, pts) {
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  const out = await p2.evaluate(
    ([t, id, pts]) => {
      const s = document.querySelector('svg');
      s.pauseAnimations();
      s.setCurrentTime(t);
      const el = document.getElementById(id);
      const inv = el.getCTM().inverse().multiply(s.getCTM());
      return pts.map(([x, y]) => {
        const q = new DOMPoint(x, y).matrixTransform(inv);
        const p = s.createSVGPoint();
        p.x = q.x;
        p.y = q.y;
        return el.isPointInFill(p);
      });
    },
    [t, id, pts],
  );
  await p2.close();
  return out;
}

test.beforeEach(async ({ page }) => {
  await load(
    page,
    '<rect id="sq" x="100" y="100" width="200" height="200" fill="#2563eb"/>' +
      '<g transform="translate(400 0)"><polygon id="star" points="100,40 125,95 185,100 140,140 155,200 100,170 45,200 60,140 15,100 75,95" fill="#facc15"/></g>' +
      '<path id="ring" d="M600 300a60 60 0 1 0 120 0a60 60 0 1 0-120 0ZM630 300a30 30 0 1 1 60 0a30 30 0 1 1-60 0Z" fill-rule="evenodd" fill="#16a34a"/>',
    800,
    400,
  );
  await page.click('[data-tab="animation"]');
});

test('select a shape and the one above it, add Morph: the shape becomes a path', async ({
  page,
}) => {
  await select(page, 'sq', 'star');
  await page.selectOption('#sc-anim-add', 'morph');
  const id = await page.evaluate(() => window.svgcraft.state.sel[0].id);
  expect(id).toBe('sq');
  expect(await page.evaluate(() => document.getElementById('sq').localName)).toBe('path');
  expect(await anims(page, 'sq')).toEqual([
    {
      p: 'morph',
      dur: 1,
      delay: 0,
      rep: 1,
      dir: 'normal',
      ease: 'inout',
      path: 'star',
      hide: true,
    },
  ]);
  await expect(page.locator('#sc-anim-opts select[data-anim-opt="path"]')).toHaveValue('star');
});

test('the square becomes the star (where the star is), and stays', async ({ page }) => {
  await select(page, 'sq', 'star');
  await page.selectOption('#sc-anim-add', 'morph');
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  const [from, to] = svg
    .match(/<animate attributeName="d" values="([^"]*)"/)[1]
    .split(';')
    .map((d) => d.replace(/[-\d.]+/g, '#'));
  expect(from).toBe(to);
  // The square's corner, and the star's tip and centre (in the drawing).
  const pts = [
    [110, 110],
    [500, 50],
    [500, 130],
  ];
  expect(await covers(page, svg, 0, 'sq', pts)).toEqual([true, false, false]);
  expect(await covers(page, svg, 1, 'sq', pts)).toEqual([false, true, true]);
  expect(await covers(page, svg, 5, 'sq', pts)).toEqual([false, true, true]);
  // The star itself is out of sight in the file.
  expect(svg).toMatch(/<polygon id="star"[^>]*display="none"/);
});

test('a shape with a hole morphs into one without: the hole closes to a point', async ({
  page,
}) => {
  await page.evaluate(() => {
    document
      .getElementById('ring')
      .setAttribute(
        'data-sc-anim',
        JSON.stringify([{ p: 'morph', path: 'sq', dur: 1, ease: 'linear' }]),
      );
    window.svgcraft.commit();
  });
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  const pts = [
    [660, 300],
    [150, 150],
  ];
  expect(await covers(page, svg, 0, 'ring', pts)).toEqual([false, false]);
  expect(await covers(page, svg, 1, 'ring', pts)).toEqual([false, true]);
});

test('a file’s own d animation becomes Morph into a new layer', async ({ page }) => {
  const file =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
    '<path id="p" d="M100 100H200V200H100Z" fill="red" transform="translate(10 0)">' +
    '<animate attributeName="d" values="M100 100H200V200H100Z;M150 80L220 200H80Z;M100 100H200V200H100Z" dur="2s" repeatCount="indefinite"/></path></svg>';
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'm.svg'), file);
  const a = (await anims(page, 'p'))[0];
  expect(a).toMatchObject({ p: 'morph', dur: 1, dir: 'alternate', rep: 0, hide: true });
  const target = await page.evaluate((id) => {
    const t = document.getElementById(id);
    return [t.dataset.name, t.getAttribute('transform'), t.previousElementSibling?.id];
  }, a.path);
  expect(target).toEqual(['Morph target', 'translate(10 0)', undefined]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Kept the file’s 1 animation: edit it in the Animation tab.',
  );
});
