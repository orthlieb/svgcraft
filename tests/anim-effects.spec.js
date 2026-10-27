// Wipe in, Iris in, Blur in, Glow pulse and Shine: effects wrapped round a
// layer when it's saved or played, taken off again when the file reopens.
import { test, expect, load } from './fixtures.js';

const setAnims = (page, id, list) =>
  page.evaluate(
    ([id, list]) => {
      document.getElementById(id).setAttribute('data-sc-anim', JSON.stringify(list));
      window.svgcraft.commit();
    },
    [id, list],
  );
const saved = (page) => page.evaluate(() => window.svgcraft.serialize());
async function at(page, svg, t, fn, arg) {
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  const out = await p2.evaluate(
    ([t, fn, arg]) => {
      const s = document.querySelector('svg');
      s.pauseAnimations();
      s.setCurrentTime(t);
      return new Function('s', 'arg', `return (${fn})(s, arg)`)(s, arg);
    },
    [t, fn.toString(), arg],
  );
  await p2.close();
  return out;
}
// Is the rect drawn at each of these points (fractions across and down it)?
const hits = (s, pts) => {
  const r = document.getElementById('r').getBoundingClientRect();
  return pts.map(([fx, fy]) => {
    const e = document.elementFromPoint(r.x + fx * r.width, r.y + fy * r.height);
    return e?.id === 'r';
  });
};

test.beforeEach(async ({ page }) => {
  await load(
    page,
    '<rect id="r" x="100" y="100" width="200" height="100" fill="#2563eb" transform="rotate(5 200 150)"/>' +
      '<circle id="c" cx="450" cy="150" r="40" fill="#16a34a"/>',
    600,
    400,
  );
});

test('Wipe in uncovers from the side; waiting for its delay it’s hidden', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'wipeIn', dur: 2, delay: 1, ease: 'linear', from: 'left' }]);
  const svg = await saved(page);
  const pts = [
    [0.1, 0.5],
    [0.5, 0.5],
    [0.9, 0.5],
  ];
  expect(await at(page, svg, 0.5, hits, pts)).toEqual([false, false, false]);
  expect(await at(page, svg, 2.1, hits, pts)).toEqual([true, true, false]);
  expect(await at(page, svg, 4, hits, pts)).toEqual([true, true, true]);
});

test('Wipe in from the bottom, and Iris in from the middle', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'wipeIn', dur: 2, ease: 'linear', from: 'bottom' }]);
  let svg = await saved(page);
  expect(
    await at(page, svg, 1, hits, [
      [0.5, 0.15],
      [0.5, 0.85],
    ]),
  ).toEqual([false, true]);
  await setAnims(page, 'r', [{ p: 'irisIn', dur: 2, ease: 'linear' }]);
  svg = await saved(page);
  expect(
    await at(page, svg, 0.8, hits, [
      [0.5, 0.5],
      [0.05, 0.1],
    ]),
  ).toEqual([true, false]);
  expect(
    await at(page, svg, 3, hits, [
      [0.5, 0.5],
      [0.05, 0.1],
    ]),
  ).toEqual([true, true]);
});

test('Blur in sharpens; Glow pulse breathes in its colour', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'blurIn', dur: 1, ease: 'linear', size: 10 }]);
  let svg = await saved(page);
  const blur = () => document.querySelector('feGaussianBlur').stdDeviationX.animVal;
  expect(await at(page, svg, 0, blur)).toBeCloseTo(10, 1);
  expect(await at(page, svg, 0.5, blur)).toBeCloseTo(5, 1);
  expect(await at(page, svg, 2, blur)).toBe(0);
  await setAnims(page, 'c', [{ p: 'glowPulse', dur: 1, ease: 'linear', to: '#ff0000' }]);
  svg = await saved(page);
  const glow = () => {
    const fl = document.querySelector('feFlood');
    return [+getComputedStyle(fl).floodOpacity, getComputedStyle(fl).floodColor];
  };
  expect(await at(page, svg, 0, glow)).toEqual([0, 'rgb(255, 0, 0)']);
  expect((await at(page, svg, 1, glow))[0]).toBeCloseTo(1, 1);
  expect((await at(page, svg, 1.5, glow))[0]).toBeCloseTo(0.5, 1);
});

test('Shine sweeps a highlight over the layer, masked by it', async ({ page }) => {
  await setAnims(page, 'c', [{ p: 'shine', dur: 2, ease: 'linear' }]);
  const svg = await saved(page);
  const state = () => {
    const g = document.querySelector('linearGradient');
    const list = g.gradientTransform.animVal;
    const m = list.numberOfItems ? list.getItem(0).matrix : null;
    const over = document.querySelector('rect[mask]');
    const use = document.querySelector('mask use');
    const target = document.getElementById(use.getAttribute('href').slice(1));
    const b = over.getBBox();
    return {
      tx: m ? m.e : 0,
      target: target.localName,
      box: [b.x, b.y, b.width, b.height],
      // An SVG attribute, not CSS: the layer's shape, whatever its colour.
      maskType: getComputedStyle(use.parentNode).maskType,
    };
  };
  expect(await at(page, svg, 0, state)).toEqual({
    tx: -1,
    target: 'circle',
    box: [410, 110, 80, 80],
    maskType: 'alpha',
  });
  expect(svg).not.toMatch(/style="mask-type/);
  expect((await at(page, svg, 1, state)).tx).toBeCloseTo(0, 1);
});

test('reopening a saved file takes the effects off and keeps the settings', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('sc-doc').innerHTML);
  await setAnims(page, 'r', [{ p: 'wipeIn' }, { p: 'blurIn' }]);
  await setAnims(page, 'c', [{ p: 'shine' }, { p: 'glowPulse' }]);
  const svg = await saved(page);
  expect(svg.match(/<g [^>]*data-sc-gen=""/g)).toHaveLength(4);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'fx.svg'), svg);
  const after = await page.evaluate(() => {
    for (const el of document.querySelectorAll('#sc-doc [data-sc-anim]'))
      el.removeAttribute('data-sc-anim');
    return document.getElementById('sc-doc').innerHTML;
  });
  expect(after).toBe(before);
  expect(
    await page.evaluate(() => document.querySelectorAll('#sc-defs [data-sc-gen]').length),
  ).toBe(0);
  await expect(page.locator('#sc-alert-text')).toHaveText('');
});

test('▶ Play wraps the layers for the preview and unwraps them after', async ({ page }) => {
  await page.click('[data-tab="animation"]');
  await setAnims(page, 'r', [{ p: 'irisIn' }]);
  await setAnims(page, 'c', [{ p: 'shine' }]);
  const before = await page.evaluate(
    () =>
      document.getElementById('sc-doc').innerHTML + document.getElementById('sc-defs').innerHTML,
  );
  await page.click('.sc-anim-top [data-action="toggleAnimations"]');
  await expect(page.locator('#sc-doc g[data-sc-gen]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(
      () =>
        document.getElementById('sc-doc').innerHTML + document.getElementById('sc-defs').innerHTML,
    ),
  ).toBe(before);
});

test('the still drawing (PNG, app icons) keeps every layer and no effects', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'wipeIn' }]);
  const still = await page.evaluate(() => window.svgcraft.serialize({ animate: false }));
  expect(still).not.toContain('undefined');
  expect(still).toMatch(/<rect id="r"/);
  expect(still).not.toMatch(/data-sc-gen/);
});
