// Swing, Heartbeat, Jello and Flip; Stagger across a group's layers or a
// text's letters; Typewriter. Each is checked by playing the saved file in
// a page of its own and looking at where things are at given moments.
import { test, expect, load, select as pickIds } from './fixtures.js';

const select = async (page, ...ids) => {
  await pickIds(page, ...ids);
  await page.evaluate(() => window.svgcraft.commit());
};
const setAnims = (page, id, list) =>
  page.evaluate(
    ([id, list]) => {
      document.getElementById(id).setAttribute('data-sc-anim', JSON.stringify(list));
      window.svgcraft.commit();
    },
    [id, list],
  );
const saved = (page) => page.evaluate(() => window.svgcraft.serialize());
// Run `fn` (with the svg element) in the saved file played to `t` seconds.
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
// A point of an element (in its own units) on the page, in drawing units.
const where = (s, [id, x, y]) => {
  const el = document.getElementById(id);
  const k = s.getBoundingClientRect().width / s.viewBox.baseVal.width;
  const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
  const m = el.getScreenCTM();
  return { x: p.x / k, y: p.y / k, deg: (Math.atan2(m.b, m.a) * 180) / Math.PI, sx: m.a / k };
};

test.beforeEach(async ({ page }) => {
  await load(
    page,
    '<rect id="r" x="100" y="100" width="80" height="40" fill="#2563eb" transform="translate(20 10)"/>' +
      '<g id="g"><rect id="a" x="10" y="200" width="20" height="20"/><rect id="b" x="40" y="200" width="20" height="20"/><rect id="c" x="70" y="200" width="20" height="20"/></g>' +
      '<text id="t" x="300" y="100" font-size="30" fill="#dc2626">Hi <tspan font-weight="700">you</tspan></text>',
    600,
    400,
  );
  await page.click('[data-tab="animation"]');
});

test('Swing turns back and forth about the top, which stays put', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'swing', dur: 2, rep: 0, ease: 'linear', angle: 20 }]);
  const svg = await saved(page);
  const top = await at(page, svg, 0, where, ['r', 140, 100]);
  const q = await at(page, svg, 0.5, where, ['r', 140, 100]);
  const q3 = await at(page, svg, 1.5, where, ['r', 140, 100]);
  expect(q.x).toBeCloseTo(top.x, 1);
  expect(q.y).toBeCloseTo(top.y, 1);
  expect(q.deg).toBeCloseTo(20, 0);
  expect(q3.deg).toBeCloseTo(-20, 0);
});

test('Heartbeat beats twice about the centre; Flip turns it over and back', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'heartbeat', dur: 1, rep: 1, scale: 150 }]);
  let svg = await saved(page);
  const c0 = await at(page, svg, 0, where, ['r', 140, 120]);
  const beat = await at(page, svg, 0.14, where, ['r', 140, 120]);
  expect(beat.sx).toBeCloseTo(1.5, 1);
  expect(beat.x).toBeCloseTo(c0.x, 1);
  expect((await at(page, svg, 0.28, where, ['r', 140, 120])).sx).toBeCloseTo(1, 1);
  expect((await at(page, svg, 0.42, where, ['r', 140, 120])).sx).toBeCloseTo(1.5, 1);
  await setAnims(page, 'r', [{ p: 'flip', dur: 1, rep: 1, ease: 'linear' }]);
  svg = await saved(page);
  const half = await at(page, svg, 0.5, where, ['r', 140, 120]);
  expect(half.sx).toBeCloseTo(-1, 1);
  expect(half.x).toBeCloseTo(c0.x, 1);
});

test('Jello wobbles about the centre and settles', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'jello', dur: 1.2, rep: 1, angle: 12 }]);
  const svg = await saved(page);
  const c0 = await at(page, svg, 0, where, ['r', 140, 120]);
  for (const t of [0.2, 0.4, 0.6]) {
    const c = await at(page, svg, t, where, ['r', 140, 120]);
    expect(c.x).toBeCloseTo(c0.x, 1);
    expect(c.y).toBeCloseTo(c0.y, 1);
  }
  const end = await at(page, svg, 1.5, where, ['r', 100, 100]);
  const rest = await at(page, svg, 0, where, ['r', 100, 100]);
  expect(end.x).toBeCloseTo(rest.x, 1);
});

const opacityOf = (s, ids) =>
  ids.map((id) => +getComputedStyle(document.getElementById(id)).opacity);

test('Stagger sends a group’s animation to each layer in turn', async ({ page }) => {
  await setAnims(page, 'g', [
    { p: 'fadeIn', dur: 1, delay: 0.5, rep: 1, ease: 'linear', stagger: 1 },
  ]);
  const svg = await saved(page);
  expect(svg.match(/<animate [^>]*data-sc-gen=""/g)).toHaveLength(3);
  // a starts at 0.5, b at 1.5, c at 2.5 (hidden until then).
  expect(await at(page, svg, 0.2, opacityOf, ['a', 'b', 'c'])).toEqual([0, 0, 0]);
  const mid = await at(page, svg, 2, opacityOf, ['a', 'b', 'c']);
  expect(mid[0]).toBe(1);
  expect(mid[1]).toBeCloseTo(0.5, 1);
  expect(mid[2]).toBe(0);
  expect(await at(page, svg, 4, opacityOf, ['a', 'b', 'c'])).toEqual([1, 1, 1]);
  // Reopened, the group keeps the setting; nothing generated is left over.
  await page.evaluate((t) => window.svgcraft.openSvg(t, 's.svg'), svg);
  expect(await page.evaluate(() => document.querySelectorAll('#sc-doc [data-sc-gen]').length)).toBe(
    0,
  );
  expect(
    await page.evaluate(() => JSON.parse(document.getElementById('g').dataset.scAnim)[0].stagger),
  ).toBe(1);
  await expect(page.locator('#sc-alert-text')).toHaveText('');
});

const letterState = () =>
  [...document.querySelectorAll('#t tspan[data-sc-gen]')].map((sp) => {
    const cs = getComputedStyle(sp);
    return cs.visibility === 'hidden' ? 0 : +cs.fillOpacity;
  });

test('Stagger on text runs it letter by letter; reopening joins them up', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('t').innerHTML);
  await setAnims(page, 't', [{ p: 'fadeIn', dur: 0.5, rep: 1, ease: 'linear', stagger: 0.5 }]);
  const svg = await saved(page);
  // H, i, y, o, u: five letters, the space left alone.
  expect(await at(page, svg, 1.25, letterState)).toEqual([1, 1, 0.5, 0, 0]);
  expect(await at(page, svg, 9, letterState)).toEqual([1, 1, 1, 1, 1]);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 't.svg'), svg);
  expect(await page.evaluate(() => document.getElementById('t').innerHTML)).toBe(before);
});

test('Typewriter shows the letters one by one, and needs text', async ({ page }) => {
  await setAnims(page, 't', [{ p: 'typewriter', dur: 6, rep: 1 }]);
  const svg = await saved(page);
  // Five letters, each at (i + 1) / 6 of the run: 1 s, 2 s, … 5 s.
  expect(await at(page, svg, 0.5, letterState)).toEqual([0, 0, 0, 0, 0]);
  expect(await at(page, svg, 2.5, letterState)).toEqual([1, 1, 0, 0, 0]);
  expect(await at(page, svg, 7, letterState)).toEqual([1, 1, 1, 1, 1]);
  await select(page, 'r');
  await page.selectOption('#sc-anim-add', 'typewriter');
  await expect(page.locator('#sc-alert-text')).toHaveText('Typewriter needs text.');
});

test('▶ Play splits the letters for the preview and puts them back', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('t').innerHTML);
  await setAnims(page, 't', [{ p: 'typewriter', dur: 2, rep: 1 }]);
  await page.click('.sc-anim-top [data-action="toggleAnimations"]');
  await expect(page.locator('#t tspan[data-sc-gen]')).toHaveCount(5);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('t').innerHTML)).toBe(before);
});

test('the Stagger field shows for a group and for letters', async ({ page }) => {
  await setAnims(page, 'g', [{ p: 'pulse' }]);
  await select(page, 'g');
  const st = page.locator('#sc-anim-opts [data-anim-opt="stagger"]');
  await expect(st).toHaveValue('0');
  await st.fill('0.25');
  await st.dispatchEvent('change');
  expect(
    await page.evaluate(() => JSON.parse(document.getElementById('g').dataset.scAnim)[0].stagger),
  ).toBe(0.25);
  await page.evaluate(() => document.activeElement.blur());
  await setAnims(page, 't', [{ p: 'spin' }]);
  await select(page, 't');
  await expect(st).toHaveCount(0);
  await setAnims(page, 't', [{ p: 'fadeIn' }]);
  await select(page, 't');
  await expect(st).toHaveCount(1);
});

test('Stroke pulse thickens the outline and back; it needs a stroke', async ({ page }) => {
  await load(
    page,
    '<circle id="o" cx="100" cy="100" r="50" fill="none" stroke="#000" stroke-width="4"/><rect id="n" width="10" height="10"/>',
    300,
    200,
  );
  await page.click('[data-tab="animation"]');
  await setAnims(page, 'o', [{ p: 'strokePulse', dur: 2, rep: 1, ease: 'linear', scale: 300 }]);
  const svg = await saved(page);
  const width = () => +getComputedStyle(document.getElementById('o')).strokeWidth.replace('px', '');
  expect(await at(page, svg, 0, width)).toBeCloseTo(4, 1);
  expect(await at(page, svg, 1, width)).toBeCloseTo(12, 1);
  expect(await at(page, svg, 1.5, width)).toBeCloseTo(8, 1);
  expect(await at(page, svg, 3, width)).toBeCloseTo(4, 1);
  await select(page, 'n');
  await page.selectOption('#sc-anim-add', 'strokePulse');
  await expect(page.locator('#sc-alert-text')).toHaveText('Stroke pulse needs a stroke.');
});
