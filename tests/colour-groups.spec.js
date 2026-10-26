import { test, expect, load, action } from './fixtures.js';

// Layer → Group by Colour…: groups taken apart, layers regrouped one group
// per colour, and the drawing looking just the same.

const RED = '#dc2626';
const BLUE = '#2563eb';

const groups = (page) =>
  page.$$eval('#sc-doc > g', (gs) =>
    gs.map((g) => `${g.getAttribute('data-name')}: ${[...g.children].map((c) => c.id).join(' ')}`),
  );
// The canvas as drawn, without the selection overlay.
const picture = async (page) => {
  await action(page, 'deselect');
  return page.locator('#sc-stage').screenshot();
};
const run = async (page, answer = 'ok') => {
  await action(page, 'groupByColour');
  await expect(page.locator('#sc-ask')).toBeVisible();
  await expect(page.locator('#sc-ask')).toContainText('taken apart');
  await page.click(`#sc-ask [data-ask="${answer}"]`);
};

test('apart from overlaps, one group per colour, out of the old groups', async ({ page }) => {
  await load(
    page,
    `<g id="old" data-name="Old group" transform="translate(10 0)">` +
      `<rect id="a" x="0" y="0" width="40" height="40" fill="${RED}"/>` +
      `<circle id="b" cx="120" cy="20" r="20" fill="${BLUE}"/></g>` +
      `<circle id="c" cx="220" cy="20" r="20" fill="${RED}"/>` +
      `<rect id="d" x="300" y="0" width="40" height="40" fill="${BLUE}"/>`,
    400,
    100,
  );
  const before = await picture(page);
  await run(page);
  expect(await groups(page)).toEqual([`${RED}: a c`, `${BLUE}: b d`]);
  await expect(page.locator('#old')).toHaveCount(0);
  await expect(page.locator('#sc-msg')).toContainText(
    'Grouped 4 layers by colour: 2 colours in 2 groups.',
  );
  expect(await picture(page)).toEqual(before);
  // One undo puts it all back.
  await page.keyboard.press('Control+z');
  await expect(page.locator('#old > *')).toHaveCount(2);
});

test('where colours overlap, the stacking is kept with a second group', async ({ page }) => {
  // Red under blue under red, each overlapping the next.
  await load(
    page,
    `<rect id="a" x="0" y="0" width="60" height="60" fill="${RED}"/>` +
      `<rect id="b" x="30" y="30" width="60" height="60" fill="${BLUE}"/>` +
      `<rect id="c" x="60" y="60" width="60" height="60" fill="${RED}"/>` +
      // Far from the blue one: joins the second red group.
      `<rect id="e" x="250" y="0" width="30" height="30" fill="${RED}"/>`,
    300,
    150,
  );
  const before = await picture(page);
  await run(page);
  expect(await groups(page)).toEqual([`${RED}: a`, `${BLUE}: b`, `${RED} 2: c e`]);
  expect(await picture(page)).toEqual(before);
});

test('groups whose look depends on them stay whole; Cancel changes nothing', async ({ page }) => {
  await load(
    page,
    `<g id="faded" opacity="0.5"><rect id="a" width="60" height="60" fill="${RED}"/>` +
      `<rect id="b" x="30" y="30" width="60" height="60" fill="${BLUE}"/></g>` +
      `<g id="plain"><rect id="c" x="200" width="40" height="40" fill="url(#sky)"/></g>` +
      `<g id="moving" data-sc-anim='[{"p":"spin"}]'><rect id="m" x="100" y="100" width="20" height="20" fill="${RED}"/>` +
      `<rect id="n" x="130" y="100" width="20" height="20" fill="${RED}"/></g>` +
      `<defs><linearGradient id="sky" data-name="Sky"><stop offset="0" stop-color="#fff"/>` +
      `<stop offset="1" stop-color="#00f"/></linearGradient></defs>`,
    300,
    150,
  );
  const html = await page.evaluate(() => window.svgcraft.serialize());
  await run(page, 'cancel');
  expect(await page.evaluate(() => window.svgcraft.serialize())).toBe(html);

  const before = await picture(page);
  await run(page);
  // The faded group is grouped whole, and so is the animated one (by its
  // one colour); a gradient fill groups by its name.
  expect(await groups(page)).toEqual(['Mixed: faded', 'Sky: c', `${RED}: moving`]);
  await expect(page.locator('#moving')).toHaveAttribute('data-sc-anim', /spin/);
  expect(await picture(page)).toEqual(before);
});

test('greyed out with nothing to group', async ({ page }) => {
  await load(page, '');
  await page.click('.sc-menu-btn:text-is("Layer")');
  await expect(
    page.locator('.sc-menu-list:not([hidden]) [data-action="groupByColour"]'),
  ).toBeDisabled();
});
