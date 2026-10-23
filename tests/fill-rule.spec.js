import { test, expect, load, select } from './fixtures.js';

// Object → Path → <item>, through the submenu as a user would.
async function pathMenu(page, act) {
  await page.click('.sc-menu-btn:text-is("Object")');
  await page.hover('.sc-sub-btn:has-text("Path")');
  await page.click(`.sc-sub-list:not([hidden]) [data-action="${act}"]`);
}

// Fill rule (Properties, Object → Path) and Reverse Path Direction.

// A square with a square inside, both running the same way: under non-zero
// the inside is filled; under even-odd it's a hole.
const DONUT =
  '<rect id="bg" width="300" height="200" fill="#ffffff"/>' +
  '<path id="d" fill="#2563eb" d="M50 20H250V180H50ZM100 60H200V140H100Z"/>';
const section = (page) => page.locator('#sc-fillrule-props');
const rule = (page, id) =>
  page.evaluate((id) => getComputedStyle(document.getElementById(id)).fillRule, id);
const attr = (page, id, a) =>
  page.evaluate(([id, a]) => document.getElementById(id)?.getAttribute(a), [id, a]);
const centre = (page) =>
  page.evaluate(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(150, 100, 1, 1).data].slice(0, 3);
  });
const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

test.beforeEach(async ({ page }) => {
  await load(page, DONUT, 300, 200);
  await page.click('[data-tab="props"]');
});

test('Properties sets the fill rule; non-zero writes nothing; undo restores', async ({ page }) => {
  await select(page, 'bg');
  await page.evaluate(() => window.svgcraft.commit());
  await expect(section(page)).toBeHidden();
  await select(page, 'd');
  await page.evaluate(() => window.svgcraft.commit());
  await expect(section(page)).toBeVisible();
  await expect(page.locator('[data-fill-rule="nonzero"]')).toHaveAttribute('aria-checked', 'true');
  expect(await centre(page)).toEqual(BLUE);

  await page.click('[data-fill-rule="evenodd"]');
  expect(await attr(page, 'd', 'fill-rule')).toBe('evenodd');
  await expect(page.locator('[data-fill-rule="evenodd"]')).toHaveAttribute('aria-checked', 'true');
  expect(await centre(page)).toEqual(WHITE);
  expect(await page.evaluate(() => window.svgcraft.serialize())).toContain('fill-rule="evenodd"');

  await page.click('[data-fill-rule="nonzero"]');
  expect(await attr(page, 'd', 'fill-rule')).toBeNull();
  expect(await centre(page)).toEqual(BLUE);

  await page.evaluate(() => window.svgcraft.undo());
  expect(await rule(page, 'd')).toBe('evenodd');
});

test('the Object → Path menu, groups, inherited rules and mixed selections', async ({ page }) => {
  await load(
    page,
    '<g id="g" fill-rule="evenodd"><path id="a" d="M0 0H50V50H0ZM10 10H40V40H10Z"/><polygon id="b" points="60,0 110,0 110,50"/></g>' +
      '<path id="c" style="fill-rule:evenodd" d="M120 0H170V50H120Z"/><path id="e" d="M180 0H230V50H180Z"/>',
    300,
    100,
  );
  // Inside a group that makes it even-odd, non-zero has to be written out.
  await select(page, 'g');
  await pathMenu(page, 'fillRuleNonzero');
  expect([await attr(page, 'a', 'fill-rule'), await attr(page, 'b', 'fill-rule')]).toEqual([
    'nonzero',
    'nonzero',
  ]);
  expect([await rule(page, 'a'), await rule(page, 'b')]).toEqual(['nonzero', 'nonzero']);
  // A style declaration is replaced too.
  await select(page, 'c');
  await pathMenu(page, 'fillRuleNonzero');
  expect(await rule(page, 'c')).toBe('nonzero');
  expect(await attr(page, 'c', 'style')).toBeNull();
  // A mixed selection shows neither choice.
  await page.evaluate(() => document.getElementById('c').setAttribute('fill-rule', 'evenodd'));
  await select(page, 'c', 'e');
  await page.evaluate(() => window.svgcraft.commit());
  await expect(page.locator('[data-fill-rule][aria-checked="true"]')).toHaveCount(0);
});

test('Reverse Path Direction: paths, shapes and lines run the other way', async ({ page }) => {
  await load(
    page,
    '<path id="p" d="M0 0L10 0L10 10Z"/><path id="o" d="M0 20C5 20 10 25 10 30" fill="none" stroke="#000"/>' +
      '<polygon id="g" points="0,40 10,40 10,50"/><line id="l" x1="0" y1="60" x2="20" y2="70" stroke="#000"/>' +
      '<rect id="r" x="30" y="0" width="20" height="10" fill="#f00"/>',
    100,
    100,
  );
  await select(page, 'p', 'o', 'g', 'l', 'r');
  await pathMenu(page, 'reversePath');
  await expect(page.locator('#sc-msg')).toHaveText('Reversed 5 paths.');
  // Closed: same start, the other way round. Open: from the other end,
  // with the curve's handles swapped.
  expect(await attr(page, 'p', 'd')).toBe('M0 0L10 10L10 0Z');
  expect(await attr(page, 'o', 'd')).toBe('M10 30C10 25 5 20 0 20');
  expect(await attr(page, 'g', 'points')).toBe('10,50 10,40 0,40');
  expect(
    await page.evaluate(() =>
      ['x1', 'y1', 'x2', 'y2'].map((k) => document.getElementById('l').getAttribute(k)),
    ),
  ).toEqual(['20', '70', '0', '60']);
  // A rectangle becomes a path (keeping its id and paint), still selected.
  expect(await page.evaluate(() => document.getElementById('r').localName)).toBe('path');
  expect(await attr(page, 'r', 'fill')).toBe('#f00');
  expect(await page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id))).toContain('r');
  // Twice is the original again.
  await page.click('#sc-fillrule-props [data-action="reversePath"]');
  expect(await attr(page, 'p', 'd')).toBe('M0 0L10 0L10 10Z');
  expect(await attr(page, 'o', 'd')).toBe('M0 20C5 20 10 25 10 30');
});

test('reversing one loop makes a hole under non-zero', async ({ page }) => {
  // Two separate paths combined by hand: reverse the inner one, join them.
  await load(
    page,
    '<rect width="300" height="200" fill="#fff"/><path id="d" fill="#2563eb" d="M50 20H250V180H50Z"/>' +
      '<path id="i" d="M100 60H200V140H100Z"/>',
    300,
    200,
  );
  await select(page, 'i');
  await pathMenu(page, 'reversePath');
  await page.evaluate(() => {
    const d = document.getElementById('d');
    d.setAttribute('d', d.getAttribute('d') + document.getElementById('i').getAttribute('d'));
    document.getElementById('i').remove();
    window.svgcraft.commit();
  });
  expect(await rule(page, 'd')).toBe('nonzero');
  expect(await centre(page)).toEqual(WHITE);
});

test('locked layers are left alone', async ({ page }) => {
  await page.evaluate(() => document.getElementById('d').setAttribute('data-sc-lock', 'all'));
  await select(page, 'd');
  await pathMenu(page, 'fillRuleEvenodd');
  await expect(page.locator('#sc-msg')).toContainText('is locked');
  expect(await attr(page, 'd', 'fill-rule')).toBeNull();
  await pathMenu(page, 'reversePath');
  expect(await attr(page, 'd', 'd')).toBe('M50 20H250V180H50ZM100 60H200V140H100Z');
});
