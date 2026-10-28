// When animations start: on a click or the pointer over a layer, after
// another layer's animations; and a pause between a loop's runs.
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
const begins = (svg) =>
  [...svg.matchAll(/<(?:animate|animateTransform)\b[^>]*?\bbegin="([^"]*)"/g)].map((m) => m[1]);

test.beforeEach(async ({ page }) => {
  await load(
    page,
    '<rect id="r" x="50" y="50" width="100" height="60" fill="#2563eb"/>' +
      '<circle id="b" cx="300" cy="80" r="30" fill="#16a34a"/>' +
      '<circle id="c" cx="300" cy="200" r="30" fill="#dc2626"/>',
    400,
    300,
  );
  await page.click('[data-tab="animation"]');
});

// The saved file live in a page of its own, to click and point at.
async function live(page, svg) {
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  return p2;
}
const scaleOf = (p, id) =>
  p.evaluate((id) => {
    const m = document.getElementById(id).getScreenCTM();
    const k = document.querySelector('svg').getScreenCTM().a;
    return Math.hypot(m.a, m.b) / k;
  }, id);
const opacityOf = (p, id) =>
  p.evaluate((id) => +getComputedStyle(document.getElementById(id)).opacity, id);

test('On click: waits for the click, then plays', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'pulse', dur: 1, rep: 1, trigger: 'click', scale: 150 }]);
  const svg = await saved(page);
  expect(begins(svg)).toEqual(['r.click', 'r.click']);
  const p2 = await live(page, svg);
  await p2.waitForTimeout(700);
  expect(await scaleOf(p2, 'r')).toBeCloseTo(1, 2);
  await p2.click('#r');
  await p2.waitForTimeout(500);
  expect(await scaleOf(p2, 'r')).toBeGreaterThan(1.2);
  await p2.close();
});

test('an entrance started by a click on another layer stays hidden till then', async ({ page }) => {
  await setAnims(page, 'r', [
    { p: 'fadeIn', dur: 0.4, rep: 1, trigger: 'click', on: 'b', delay: 0.2 },
  ]);
  const svg = await saved(page);
  expect(begins(svg)).toContain('b.click+0.2s');
  const p2 = await live(page, svg);
  await p2.waitForTimeout(400);
  expect(await opacityOf(p2, 'r')).toBe(0);
  await p2.click('#b');
  await p2.waitForTimeout(1000);
  expect(await opacityOf(p2, 'r')).toBe(1);
  await p2.close();
});

test('On hover: a loop runs while the pointer is over the layer', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'spin', dur: 2, rep: 0, ease: 'linear', trigger: 'hover' }]);
  const svg = await saved(page);
  expect(svg).toMatch(
    /begin="r\.mouseover"[^>]*end="r\.mouseout"|end="r\.mouseout"[^>]*begin="r\.mouseover"/,
  );
  const p2 = await live(page, svg);
  const turned = () =>
    p2.evaluate(() => {
      const m = document.getElementById('r').getScreenCTM();
      return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
    });
  await p2.mouse.move(100, 80);
  await p2.waitForTimeout(400);
  expect(Math.abs(await turned())).toBeGreaterThan(20);
  await p2.mouse.move(390, 290);
  await p2.waitForTimeout(200);
  expect(await turned()).toBe(0);
  await p2.close();
});

test('After another layer: starts when its animations end', async ({ page }) => {
  await setAnims(page, 'b', [{ p: 'fadeIn', dur: 1, delay: 0.5 }]);
  await setAnims(page, 'c', [{ p: 'popIn', dur: 0.5, delay: 0.2, afterLayer: 'b' }]);
  let svg = await saved(page);
  expect(begins(svg).filter((b) => b !== '0s')).toEqual(['0.5s', '1.7s', '1.7s', '1.7s']);
  // …and from its click, when it waits for one.
  await setAnims(page, 'b', [{ p: 'fadeIn', dur: 1, delay: 0.5, trigger: 'click' }]);
  svg = await saved(page);
  expect(begins(svg)).toContain('b.click+1.7s');
});

test('Pause between runs: each run, then the wait', async ({ page }) => {
  await setAnims(page, 'r', [{ p: 'spin', dur: 1, rep: 0, ease: 'linear', pause: 2 }]);
  const svg = await saved(page);
  expect(svg).toMatch(/dur="3s"/);
  const p2 = await live(page, svg);
  const at = (t) =>
    p2.evaluate((t) => {
      const s = document.querySelector('svg');
      s.pauseAnimations();
      s.setCurrentTime(t);
      const m = document.getElementById('r').getScreenCTM();
      return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
    }, t);
  expect(Math.abs(await at(0.5))).toBe(180);
  expect(await at(2)).toBe(0);
  expect(Math.abs(await at(3.5))).toBe(180);
  await p2.close();
});

test('click, hover and pause come back from Export Clean SVG', async ({ page }) => {
  const list = [
    {
      p: 'pulse',
      dur: 1,
      delay: 0.3,
      rep: 0,
      dir: 'normal',
      ease: 'inout',
      scale: 130,
      trigger: 'click',
      on: 'b',
      pause: 1.5,
    },
  ];
  await setAnims(page, 'r', list);
  await setAnims(page, 'c', [
    {
      p: 'spin',
      dur: 2,
      delay: 0,
      rep: 0,
      dir: 'normal',
      ease: 'linear',
      turns: 1,
      trigger: 'hover',
    },
  ]);
  const clean = await page.evaluate(() =>
    // eslint-disable-next-line no-undef -- the editor's own globals
    cleanSvgText(window.svgcraft.serialize(), { ...CLEAN_DEFAULTS }),
  );
  // The ids the triggers name survive (shortened), and still match.
  const ids = [...clean.matchAll(/begin="([\w-]+)\.(click|mouseover)/g)].map((m) => m[1]);
  for (const id of ids) expect(clean).toContain(`id="${id}"`);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'x.svg'), clean);
  const back = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc [data-sc-anim]')].map((el) => {
      const a = JSON.parse(el.dataset.scAnim)[0];
      const on = a.on && document.getElementById(a.on);
      return { ...a, on: on ? `${on.getAttribute('cx')},${on.getAttribute('cy')}` : a.on };
    }),
  );
  expect(back).toEqual([
    { ...list[0], on: '300,80' },
    {
      p: 'spin',
      dur: 2,
      delay: 0,
      rep: 0,
      dir: 'normal',
      ease: 'linear',
      turns: 1,
      trigger: 'hover',
    },
  ]);
  await expect(page.locator('#sc-alert')).toBeHidden();
});

test('the Start, Clicking and Pause fields', async ({ page }) => {
  await page.evaluate(() => document.getElementById('r').removeAttribute('id'));
  await page.evaluate(() => {
    document
      .querySelector('#sc-doc rect')
      .setAttribute('data-sc-anim', JSON.stringify([{ p: 'pulse' }]));
    window.svgcraft.state.sel = [document.querySelector('#sc-doc rect')];
    window.svgcraft.commit();
  });
  const start = page.locator('#sc-anim-timing [data-anim-opt="trigger"]');
  await start.selectOption('click');
  const rect = await page.evaluate(() => {
    const r = document.querySelector('#sc-doc rect');
    return [r.id, JSON.parse(r.dataset.scAnim)[0].trigger];
  });
  expect(rect[0]).toMatch(/^layer-\d+$/);
  expect(rect[1]).toBe('click');
  const on = page.locator('#sc-anim-timing [data-anim-opt="on"]');
  await expect(on.locator('option')).toHaveText(['This layer', 'circle #b', 'circle #c']);
  await on.selectOption({ label: 'circle #c' });
  const pause = page.locator('#sc-anim-timing [data-anim-opt="pause"]');
  await pause.fill('1.5');
  await pause.dispatchEvent('change');
  expect(
    await page.evaluate(() => JSON.parse(document.querySelector('#sc-doc rect').dataset.scAnim)[0]),
  ).toMatchObject({ trigger: 'click', on: 'c', pause: 1.5 });
  await expect(page.locator('#sc-anim-list .sc-anim-name')).toHaveText([
    'Pulse · 1 s · ∞ · on click',
  ]);
});
