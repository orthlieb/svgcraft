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
  await page.click('.sc-menu-btn:text-is("Object")');
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
  await menuOff(page, 'Object', 'mergeDown');
  await menuOff(page, 'Object', 'mergeVisible');
});

// Three or four layers, some alike: a group, the alike ones in it joined.
const kids = (page) =>
  page.$$eval('#sc-doc > g > *', (els) =>
    els.map((e) =>
      e.localName === 'path'
        ? `path ${e.getAttribute('fill')} ×${(e.getAttribute('d').match(/M/gi) || []).length}`
        : `${e.localName} ${e.getAttribute('fill')}`,
    ),
  );

test('four layers, three alike: a group of one joined path and the odd one out', async ({
  page,
}) => {
  await load(
    page,
    `<rect id="a" x="10" y="10" width="40" height="40" fill="${RED}"/>` +
      `<rect id="b" x="70" y="10" width="40" height="40" fill="${BLUE}"/>` +
      `<rect id="c" x="130" y="10" width="40" height="40" fill="${RED}"/>` +
      `<circle id="d" data-name="Dot" cx="210" cy="30" r="20" fill="${RED}"/>`,
    260,
    60,
  );
  const before = await picture(page);
  await select(page, 'a', 'b', 'c', 'd');
  expect(await label(page)).toBe('Merge Layers');
  await page.keyboard.press('Control+e');
  await expect.poll(() => top(page)).toEqual(['g Dot']);
  expect(await kids(page)).toEqual([`path ${RED} ×3`, `rect ${BLUE}`]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Merged 4 layers into a group of 2: the alike shapes are joined into one path.',
  );
  await same(page, before);
  // One undo step.
  await page.keyboard.press('Control+z');
  expect(await top(page)).toEqual(['rect', 'rect', 'rect', 'circle Dot']);
});

test('two colours, two each, overlapping their own: two united paths', async ({ page }) => {
  await load(
    page,
    `<circle id="a" cx="30" cy="30" r="25" fill="${RED}"/>` +
      `<circle id="b" cx="150" cy="30" r="25" fill="${BLUE}"/>` +
      `<circle id="c" cx="60" cy="30" r="25" fill="${RED}"/>` +
      `<circle id="d" cx="180" cy="30" r="25" fill="${BLUE}"/>`,
    240,
    60,
  );
  const before = await picture(page);
  await select(page, 'a', 'b', 'c', 'd');
  await page.keyboard.press('Control+e');
  await expect.poll(() => kids(page)).toEqual([`path ${RED} ×1`, `path ${BLUE} ×1`]);
  await expect(page.locator('#sc-msg')).toContainText('joined into 2 paths');
  await same(page, before);
});

test('an alike shape stays apart when joining would lift it over another', async ({ page }) => {
  // Red, then blue over it, then red over the blue: the top red can't move
  // down to the first without going under the blue.
  await load(
    page,
    `<rect id="a" x="10" y="10" width="60" height="60" fill="${RED}"/>` +
      `<rect id="b" x="40" y="40" width="60" height="60" fill="${BLUE}"/>` +
      `<rect id="c" x="70" y="70" width="60" height="60" fill="${RED}"/>`,
    160,
    160,
  );
  const before = await picture(page);
  await select(page, 'a', 'b', 'c');
  await page.keyboard.press('Control+e');
  await expect.poll(() => kids(page)).toEqual([`rect ${RED}`, `rect ${BLUE}`, `rect ${RED}`]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Merged 3 layers into one group: none could join without changing how it looks.',
  );
  await same(page, before);
});

test('Merge Group joins the alike shapes inside a mixed group', async ({ page }) => {
  await load(
    page,
    `<g id="g" data-name="Icons"><rect x="10" y="10" width="40" height="40" fill="${RED}"/>` +
      `<rect x="70" y="10" width="40" height="40" fill="${BLUE}"/>` +
      `<rect x="130" y="10" width="40" height="40" fill="${RED}"/></g>`,
    200,
    60,
  );
  const before = await picture(page);
  await select(page, 'g');
  expect(await label(page)).toBe('Merge Group');
  await page.keyboard.press('Control+e');
  await expect.poll(() => kids(page)).toEqual([`path ${RED} ×2`, `rect ${BLUE}`]);
  expect(await top(page)).toEqual(['g Icons']);
  await same(page, before);
});
