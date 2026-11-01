// Flipbook: a group's layers shown one at a time, as frames.
import { test, expect, load } from './fixtures.js';

const setAnims = (page, id, list) =>
  page.evaluate(
    ([id, list]) => {
      document.getElementById(id).setAttribute('data-sc-anim', JSON.stringify(list));
      window.svgcraft.commit();
    },
    [id, list],
  );
async function shown(page, svg, t) {
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  const out = await p2.evaluate((t) => {
    const s = document.querySelector('svg');
    s.pauseAnimations();
    s.setCurrentTime(t);
    return ['a', 'b', 'c']
      .filter((id) => getComputedStyle(document.getElementById(id)).display !== 'none')
      .join('');
  }, t);
  await p2.close();
  return out;
}

test.beforeEach(async ({ page }) => {
  await load(
    page,
    '<g id="g"><rect id="a" width="20" height="20"/><rect id="b" x="30" width="20" height="20"/>' +
      '<rect id="c" x="60" width="20" height="20"/><rect id="h" x="90" width="20" height="20" display="none"/></g>' +
      '<rect id="r" x="200" width="20" height="20"/>',
    400,
    200,
  );
});

test('shows each layer in turn, bottom first, and loops', async ({ page }) => {
  await setAnims(page, 'g', [{ p: 'flipbook', dur: 3, rep: 0 }]);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(await shown(page, svg, 0.5)).toBe('a');
  expect(await shown(page, svg, 1.5)).toBe('b');
  expect(await shown(page, svg, 2.5)).toBe('c');
  expect(await shown(page, svg, 3.5)).toBe('a');
});

test('reverse runs the frames backwards; back and forth goes there and back', async ({ page }) => {
  await setAnims(page, 'g', [{ p: 'flipbook', dur: 3, rep: 0, dir: 'reverse' }]);
  let svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(await shown(page, svg, 0.5)).toBe('c');
  expect(await shown(page, svg, 2.5)).toBe('a');
  // a b c b: four frames over twice the length.
  await setAnims(page, 'g', [{ p: 'flipbook', dur: 3, rep: 0, dir: 'alternate' }]);
  svg = await page.evaluate(() => window.svgcraft.serialize());
  const seq = [];
  for (const t of [0.5, 2, 3.5, 5]) seq.push(await shown(page, svg, t));
  expect(seq).toEqual(['a', 'b', 'c', 'b']);
});

test('a set number of times stays on the last frame', async ({ page }) => {
  await setAnims(page, 'g', [{ p: 'flipbook', dur: 3, rep: 2 }]);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(await shown(page, svg, 9)).toBe('c');
});

test('needs a group of two or more; reopening leaves nothing behind', async ({ page }) => {
  await page.click('[data-tab="animation"]');
  await page.evaluate(() => {
    window.svgcraft.state.sel = [document.getElementById('r')];
    window.svgcraft.commit();
  });
  await page.selectOption('#sc-anim-add', 'flipbook');
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'Flipbook needs a group of two or more objects: its frames, bottom one first.',
  );
  await page.click('#sc-alert-close');
  await setAnims(page, 'g', [{ p: 'flipbook' }]);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'f.svg'), svg);
  expect(await page.evaluate(() => document.querySelectorAll('#sc-doc [data-sc-gen]').length)).toBe(
    0,
  );
  await expect(page.locator('#sc-alert')).toBeHidden();
});
