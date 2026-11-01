// Artboards: the page is the first; the Artboard tool (Shift+O) adds more
// by dragging on the pasteboard, moves and resizes them, and Del deletes
// one. Saved, the viewBox covers them all and they're listed, so the file
// reopens with them; Export Artboards writes one SVG per artboard.
import { test, expect, load, dragDoc } from './fixtures.js';

const SCENE =
  '<rect id="a" x="10" y="10" width="80" height="80" fill="#dc2626"/>' +
  '<rect id="b" x="260" y="10" width="80" height="80" fill="#2563eb"/>';

const boards = (page) => page.evaluate(() => window.svgcraft.state.boards.map((b) => ({ ...b })));

const drag = (page, from, to) => dragDoc(page, [from, to]);

async function withTwo(page) {
  await load(page, SCENE, 200, 100);
  // At 100%, so the pasteboard beside the page is in view.
  await page.evaluate(() => {
    const s = window.svgcraft.state;
    [s.zoom, s.panX, s.panY] = [1, 40, 60];
    // eslint-disable-next-line no-undef -- the editor's own global
    applyView();
  });
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Shift+O');
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('artboard');
  // A second artboard round the blue square, off the page.
  await drag(page, [250, 0], [350, 100]);
  expect(await boards(page)).toEqual([{ name: 'Artboard 2', x: 250, y: 0, w: 100, h: 100 }]);
}

test('the Artboard tool adds, moves, resizes and deletes artboards, each one undo step', async ({
  page,
}) => {
  await withTwo(page);
  await expect(page.locator('#sc-boards .sc-board-page')).toHaveCount(1);
  await expect(page.locator('#sc-board-names .sc-board-name')).toHaveText([
    'Artboard 1',
    'Artboard 2',
  ]);
  await expect(page.locator('#sc-board-name')).toHaveValue('Artboard 2');
  // Move it 20 right, then size it from its corner.
  await drag(page, [300, 50], [320, 50]);
  expect((await boards(page))[0]).toMatchObject({ x: 270, y: 0 });
  await drag(page, [370, 100], [390, 120]);
  expect((await boards(page))[0]).toMatchObject({ w: 120, h: 120 });
  // Renamed in the options bar.
  await page.fill('#sc-board-name', 'Icon');
  await page.press('#sc-board-name', 'Enter');
  expect((await boards(page))[0].name).toBe('Icon');
  // Del deletes it; the art stays.
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Delete');
  expect(await boards(page)).toEqual([]);
  await expect(page.locator('#b')).toHaveCount(1);
  // Undo walks back through it all.
  await page.keyboard.press('Control+z');
  expect((await boards(page))[0].name).toBe('Icon');
  await page.keyboard.press('Control+z');
  expect((await boards(page))[0].name).toBe('Artboard 2');
});

test('the page can’t be deleted or moved, but sizes from its corner', async ({ page }) => {
  await withTwo(page);
  await drag(page, [100, 50], [140, 50]);
  // Picked, not moved.
  await expect(page.locator('#sc-board-name')).toHaveValue('Artboard 1');
  expect(await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h])).toEqual([
    200, 100,
  ]);
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#sc-alert-text')).toContainText('can’t be deleted');
  await drag(page, [200, 100], [220, 110]);
  expect(await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h])).toEqual([
    220, 110,
  ]);
});

test('saved, the file covers every artboard and reopens with them', async ({ page }) => {
  await withTwo(page);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(svg).toMatch(/viewBox="0 0 350 100"/);
  expect(svg).toContain('data-sc-artboards=');
  await page.evaluate((t) => window.svgcraft.openSvg(t, 're.svg'), svg);
  expect(await boards(page)).toEqual([{ name: 'Artboard 2', x: 250, y: 0, w: 100, h: 100 }]);
  expect(await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h])).toEqual([
    200, 100,
  ]);
  // The art stays where it was, measured from the page's corner.
  expect(await page.locator('#b').getAttribute('x')).toBe('260');
});

test('Export Artboards writes one clean SVG per artboard, cut to it', async ({ page }) => {
  await withTwo(page);
  const files = await page.evaluate(() => {
    /* eslint-disable no-undef -- the editor's own globals */
    const dl = window.download;
    window.download = () => {};
    const out = exportArtboards();
    window.download = dl;
    /* eslint-enable no-undef */
    return out.map(([name, text]) => [
      name,
      text.match(/viewBox="([^"]+)"/)[1],
      text.includes('data-sc-'),
    ]);
  });
  expect(files).toEqual([
    ['Artboard 1.svg', '0 0 200 100', false],
    ['Artboard 2.svg', '250 0 100 100', false],
  ]);
});
