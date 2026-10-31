import { test, expect, load, select, tab } from './fixtures.js';

// What comes back when a drawing is reopened (a reload, Open, or paste):
// pattern tiles keep drawing in their paint's colour, ids stay put, and a
// file can't take over the editor's own ids.

const RECT = '<rect id="a" x="20" y="20" width="200" height="120" fill="#2563eb"/>';

// The <pattern> behind #a's fill, and how its tile is painted.
const patternOf = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('#sc-doc rect');
    const id = /#([^)]+)\)/.exec(r.getAttribute('fill'))?.[1];
    const p = id && document.getElementById(id);
    return (
      p && { id, color: p.getAttribute('color'), tile: p.firstElementChild.getAttribute('fill') }
    );
  });

async function reload(page) {
  // Drawings are saved to IndexedDB shortly after each change.
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

test.beforeEach(async ({ page }) => {
  await load(page, RECT, 300, 200);
  await select(page, 'a');
  await tab(page, 'patterns');
  await page.locator('#sc-patlib .sc-tile[aria-label="Dots"]').click();
});

test('a pattern fill keeps its colour, and its id, across reloads', async ({ page }) => {
  const before = await patternOf(page);
  expect(before).toEqual({
    id: expect.stringMatching(/^sc-pat-/),
    color: '#2563eb',
    tile: 'currentColor',
  });
  for (let i = 0; i < 2; i++) {
    await reload(page);
    expect(await patternOf(page)).toEqual(before);
  }
});

test('a pattern fill keeps its colour through Save and reopen, and paste', async ({ page }) => {
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'again.svg'), svg);
  expect(await patternOf(page)).toMatchObject({ color: '#2563eb', tile: 'currentColor' });
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'again.svg'), svg);
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-defs pattern')].map((p) => [
      p.getAttribute('color'),
      p.firstElementChild.getAttribute('fill'),
    ]),
  );
  expect(tiles.length).toBeGreaterThanOrEqual(2);
  for (const t of tiles) expect(t).toEqual(['#2563eb', 'currentColor']);
});

test('an icon’s currentColor from the root is still pinned', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="#dc2626" fill="none" stroke="currentColor"><path id="p" d="M2 2h20v20H2z"/></svg>',
      'icon.svg',
    ),
  );
  expect(await page.evaluate(() => document.getElementById('p').getAttribute('stroke'))).toBe(
    '#dc2626',
  );
});

test('a file can’t take the editor’s own ids', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="sc-view" width="10" height="10"/><rect id="sc-doc" x="20" width="10" height="10"/></svg>',
      'odd.svg',
    ),
  );
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc rect')].map((r) => r.id),
  );
  expect(ids).toEqual(['sc-view-2', 'sc-doc-2']);
  expect(await page.evaluate(() => document.getElementById('sc-view').localName)).toBe('g');
});

test('a gradient fill keeps its stops, and its id, across reloads', async ({ page }) => {
  await tab(page, 'gradients');
  await page.locator('#sc-gradlib .sc-tile').first().click();
  const grad = () =>
    page.evaluate(() => {
      const r = document.querySelector('#sc-doc rect');
      const id = /#([^)]+)\)/.exec(r.getAttribute('fill'))?.[1];
      const g = id && document.getElementById(id);
      return g && { id, stops: [...g.querySelectorAll('stop')].map((s) => s.outerHTML) };
    });
  const before = await grad();
  expect(before.id).toMatch(/^sc-grad-/);
  for (let i = 0; i < 2; i++) {
    await reload(page);
    expect(await grad()).toEqual(before);
  }
});
