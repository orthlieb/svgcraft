/* global cursorFor -- src/cursors.js, in the page */
import { test, expect, toScreen } from './fixtures.js';

// Photoshop's pointers (src/cursors.js): each tool's, and the badges that
// Shift, Alt and the pointer's place add.

const stageCursor = (page) => page.$eval('#sc-stage', (s) => s.style.cursor);
const named = (page, name) => page.evaluate((n) => cursorFor[n], name);
const expectCursor = async (page, name) =>
  expect.poll(() => stageCursor(page)).toBe(await named(page, name));
const hover = async (page, x, y) => {
  const q = await toScreen(page, x, y);
  await page.mouse.move(q.x, q.y);
};

test.beforeEach(async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">' +
        '<path id="p" d="M300 200H500V400H300Z" fill="#2563eb"/>' +
        '<rect id="r" x="600" y="100" width="100" height="100" fill="#dc2626"/></svg>',
      'cursors.svg',
    ),
  );
});

test('each tool has its Photoshop pointer', async ({ page }) => {
  for (const [key, name] of [
    ['v', 'move+move'],
    ['b', 'pencil'],
    ['i', 'eyedropper'],
    ['t', 'text'],
  ]) {
    await page.keyboard.press(key);
    await hover(page, 100, 500);
    await expectCursor(page, name);
  }
});

test('Edit Points: white arrow over shapes, the marquee’s cross or lasso with + and −', async ({
  page,
}) => {
  await page.keyboard.press('a');
  await hover(page, 100, 500);
  // Nothing to edit yet: the white arrow.
  await expectCursor(page, 'direct');
  await page.evaluate(() => window.svgcraft.tools.node.target(document.getElementById('p')));
  await hover(page, 100, 520);
  await expectCursor(page, 'cross');
  await page.keyboard.down('Shift');
  await expectCursor(page, 'cross+add');
  await page.keyboard.up('Shift');
  await expectCursor(page, 'cross');
  // Another shape, to pick up instead: the white arrow.
  await hover(page, 650, 150);
  await expectCursor(page, 'direct');
  // A point marker shows it too.
  expect(await page.$eval('#sc-nodes [data-node]', (n) => getComputedStyle(n).cursor)).toBe(
    await named(page, 'direct'),
  );

  await page.click('[data-marquee="lasso"]');
  await hover(page, 100, 500);
  await expectCursor(page, 'lasso');
  await page.keyboard.down('Alt');
  await expectCursor(page, 'lasso+sub');
  await page.keyboard.up('Alt');
  await page.keyboard.down('Shift');
  await expectCursor(page, 'lasso+add');
  await page.keyboard.up('Shift');
});

test('Pen: * starts a path, o over its first point closes it', async ({ page }) => {
  await page.keyboard.press('p');
  await hover(page, 100, 100);
  await expectCursor(page, 'pen+new');
  for (const [x, y] of [
    [100, 100],
    [200, 100],
    [200, 200],
  ]) {
    await hover(page, x, y);
    await page.mouse.down();
    await page.mouse.up();
  }
  await hover(page, 150, 250);
  await expectCursor(page, 'pen');
  await hover(page, 101, 101);
  await expectCursor(page, 'pen+close');
});
