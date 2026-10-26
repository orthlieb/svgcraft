import { test, expect, load, select, action, menuOff } from './fixtures.js';

// Layer → Merge Down (Merge Layers, Merge Group) and Merge Visible: one
// vector layer, the drawing looking just the same.

const RED = '#dc2626';
const BLUE = '#2563eb';

const top = (page) =>
  page.$$eval('#sc-doc > *', (els) =>
    els.map((e) => `${e.localName}${e.dataset.name ? ` ${e.dataset.name}` : ''}`),
  );
const picture = async (page) => {
  await action(page, 'deselect');
  return page.locator('#sc-stage').screenshot();
};
// How the canvas changed: pixels that changed a lot (a real difference),
// and edge pixels anti-aliased a hair differently, as a circle redrawn as
// a path is.
const changed = (page, a, b) =>
  page.evaluate(
    async ([a, b]) => {
      const img = (src) =>
        new Promise((r) => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = src;
        });
      const [ia, ib] = await Promise.all([img(a), img(b)]);
      const c = document.createElement('canvas');
      c.width = ia.width;
      c.height = ia.height;
      const x = c.getContext('2d');
      x.drawImage(ia, 0, 0);
      const da = x.getImageData(0, 0, c.width, c.height).data;
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(ib, 0, 0);
      const db = x.getImageData(0, 0, c.width, c.height).data;
      // Edge pixels shift a little; a real change (a colour, a missing
      // shape) moves a pixel a long way.
      let edges = 0;
      let big = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(...[0, 1, 2].map((k) => Math.abs(da[i + k] - db[i + k])));
        if (d > 160) big++;
        else if (d > 48) edges++;
      }
      return { big, edges };
    },
    [a, b].map((buf) => `data:image/png;base64,${buf.toString('base64')}`),
  );
const same = async (page, before) => {
  const d = await changed(page, before, await picture(page));
  expect(d.big).toBe(0);
  expect(d.edges).toBeLessThan(100);
};
const subpaths = (page) =>
  page.$eval('#sc-doc > path', (p) => (p.getAttribute('d').match(/M/gi) || []).length);
const label = async (page) => {
  await page.click('.sc-menu-btn:text-is("Layer")');
  const t = await page
    .locator('.sc-menu-list:not([hidden]) [data-action="mergeDown"] span')
    .textContent();
  await page.keyboard.press('Escape');
  return t;
};

test('Merge Down joins two alike shapes into one path, named after the lower', async ({ page }) => {
  await load(
    page,
    `<rect id="a" data-name="Lower" x="10" y="10" width="40" height="40" fill="${RED}"/>` +
      `<circle id="b" data-name="Upper" cx="120" cy="30" r="20" fill="${RED}"/>`,
    200,
    100,
  );
  const before = await picture(page);
  await select(page, 'b');
  expect(await label(page)).toBe('Merge Down');
  await page.keyboard.press('Control+e');
  await expect.poll(() => top(page)).toEqual(['path Lower']);
  expect(await subpaths(page)).toBe(2);
  await expect(page.locator('#sc-msg')).toContainText('Merged 2 shapes into one path.');
  await same(page, before);
  await page.keyboard.press('Control+z');
  expect(await top(page)).toEqual(['rect Lower', 'circle Upper']);
});

test('overlapping solid fills are united; overlapping strokes become a group', async ({ page }) => {
  const two = (extra) =>
    `<rect id="a" x="10" y="10" width="60" height="60" fill="${BLUE}"${extra}/>` +
    `<rect id="b" x="40" y="40" width="60" height="60" fill="${BLUE}"${extra}/>`;
  await load(page, two(''), 150, 150);
  const before = await picture(page);
  await select(page, 'a', 'b');
  expect(await label(page)).toBe('Merge Layers');
  await action(page, 'mergeDown');
  await expect(page.locator('#sc-doc > path')).toHaveCount(1);
  await expect(page.locator('#sc-doc > rect')).toHaveCount(0);
  expect(await subpaths(page)).toBe(1);
  await same(page, before);

  // With strokes, the inner edges would vanish in a union: a group instead.
  await load(page, two(' stroke="#000000" stroke-width="4"'), 150, 150);
  const stroked = await picture(page);
  await select(page, 'a', 'b');
  await action(page, 'mergeDown');
  expect(await top(page)).toEqual(['g']);
  await expect(page.locator('#sc-msg')).toContainText('into one group');
  await same(page, stroked);
});

test('different styles merge into one group, where the topmost was', async ({ page }) => {
  await load(
    page,
    `<rect id="a" x="10" y="10" width="40" height="40" fill="${RED}"/>` +
      `<rect id="mid" x="200" y="10" width="20" height="20" fill="#000000"/>` +
      `<text id="t" data-name="Words" x="60" y="40" font-size="20">Hi</text>`,
    300,
    100,
  );
  const before = await picture(page);
  await select(page, 'a', 't');
  await action(page, 'mergeDown');
  expect(await top(page)).toEqual(['rect', 'g Words']);
  await expect(page.locator('#sc-doc > g > *')).toHaveCount(2);
  await same(page, before);
});

test('Merge Group turns a group of alike shapes into one path', async ({ page }) => {
  await load(
    page,
    `<g id="g" data-name="Dots" transform="translate(20 10) scale(2)" fill="${RED}">` +
      `<circle cx="10" cy="10" r="5"/><circle cx="30" cy="10" r="5"/><circle cx="50" cy="10" r="5"/></g>`,
    200,
    100,
  );
  const before = await picture(page);
  await select(page, 'g');
  expect(await label(page)).toBe('Merge Group');
  await action(page, 'mergeDown');
  await expect.poll(() => top(page)).toEqual(['path Dots']);
  expect(await subpaths(page)).toBe(3);
  await same(page, before);
});

test('Merge Visible leaves hidden layers alone; greyed out with nothing to merge', async ({
  page,
}) => {
  await load(
    page,
    `<rect id="a" x="10" y="10" width="30" height="30" fill="${RED}"/>` +
      `<rect id="h" x="60" y="10" width="30" height="30" fill="${BLUE}" display="none"/>` +
      `<rect id="b" x="110" y="10" width="30" height="30" fill="${RED}"/>`,
    200,
    100,
  );
  await page.keyboard.press('Control+Shift+e');
  await expect.poll(() => top(page)).toEqual(['rect', 'path']);
  await expect(page.locator('#h')).toHaveAttribute('display', 'none');

  // One layer and nothing below it: nothing to merge.
  await load(page, `<rect id="only" width="10" height="10"/>`);
  await select(page, 'only');
  await menuOff(page, 'Layer', 'mergeDown');
  await menuOff(page, 'Layer', 'mergeVisible');
});
