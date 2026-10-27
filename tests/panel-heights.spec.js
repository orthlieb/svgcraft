// Panel group heights, as in Photoshop: a tabbed group keeps its height
// (its content scrolls inside), so the Layers list doesn't move under the
// pointer; dividers resize the groups; Layers always keeps room.
import { test, expect, load } from './fixtures.js';

const rowTop = (page) => page.$eval('#sc-layers li', (li) => li.getBoundingClientRect().top);
const groupH = (page, i) =>
  page.$eval(
    `#sc-panel > .sc-pgroup:nth-of-type(${i + 1})`,
    (g) => g.getBoundingClientRect().height,
  );

test('selecting a shape doesn’t shuffle the Layers list', async ({ page }) => {
  await load(page, '<rect id="r" x="10" y="10" width="50" height="50" rx="4"/>');
  const before = await rowTop(page);
  // A rectangle brings its corner settings into Properties.
  await page.click('#sc-layers li');
  await expect(page.locator('#sc-corner-props')).toBeVisible();
  expect(await rowTop(page)).toBe(before);
});

test('Layers keeps room however tall the panels above are', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await load(page, '<rect id="r" width="50" height="50"/>');
  const layers = page.locator('#sc-panel > .sc-pgroup.sc-grow');
  const box = await layers.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(179);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
  await expect(page.locator('#sc-layers li').first()).toBeInViewport();
});

test('a divider resizes the group above it, remembered; Reset Workspace undoes it', async ({
  page,
}) => {
  const split = page.locator('.sc-psplit').first();
  const h0 = await groupH(page, 0);
  const b = await split.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y - 60, { steps: 4 });
  await page.mouse.up();
  const h1 = await groupH(page, 0);
  expect(h1).toBeLessThan(h0 - 50);
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  expect(Math.abs((await groupH(page, 0)) - h1)).toBeLessThan(2);
  // The keyboard moves it too.
  await page.locator('.sc-psplit').first().focus();
  await page.keyboard.press('ArrowDown');
  expect(Math.abs((await groupH(page, 0)) - (h1 + 10))).toBeLessThan(2);

  await page.click('.sc-menu-btn:text-is("Window")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="resetWorkspace"]');
  expect(Math.abs((await groupH(page, 0)) - h0)).toBeLessThan(2);
});
