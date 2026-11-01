// Global swatches: objects painted with one carry a link beside their plain
// colour, so editing the swatch's colour repaints them all (one undo step).
// Painting any other colour drops the link; it's saved with the file.
import { test, expect, load, select, parkLibraries } from './fixtures.js';

const SCENE =
  '<rect id="a" x="10" y="10" width="40" height="40" fill="#000000"/>' +
  '<rect id="b" x="60" y="10" width="40" height="40" fill="#000000"/>' +
  '<rect id="c" x="110" y="10" width="40" height="40" fill="#000000"/>';

const tile = (page, i) => page.locator('#sc-palette .sc-tile:not(.none)').nth(i);
const attr = (page, id, a) => page.locator(`#${id}`).getAttribute(a);

// The library's first swatch, made global; returns its id and colour.
async function makeGlobal(page) {
  await page.evaluate(() => window.openLibraries('swatches'));
  await parkLibraries(page);
  await tile(page, 0).click();
  await page.click('[data-lib="swatches"] [data-lib-act="global"]');
  await expect(page.locator('[data-lib="swatches"] [data-lib-act="global"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(tile(page, 0)).toHaveClass(/\bglobal\b/);
  // eslint-disable-next-line no-undef -- the editor's own library
  return page.evaluate(() => ({ id: lib.swatches[0].id, c: lib.swatches[0].c }));
}

// Edit the selected swatch's colour, as the colour picker would. (Its
// native chooser isn't opened: headless, it would swallow the keyboard.)
const editColour = (page, c) =>
  page.evaluate((c) => {
    /* eslint-disable no-undef -- the editor's own globals */
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'color') click.call(this);
    };
    editSwatchColour();
    HTMLInputElement.prototype.click = click;
    swatchPicker.value = c;
    swatchPicker.dispatchEvent(new Event('change'));
    /* eslint-enable no-undef */
  }, c);

test('a global swatch repaints every object painted with it, in one undo step', async ({
  page,
}) => {
  await load(page, SCENE, 200, 100);
  const sw = await makeGlobal(page);
  // Paint a and b with it; c stays a plain black that isn't linked.
  await select(page, 'a', 'b');
  await tile(page, 0).click();
  for (const id of ['a', 'b']) {
    expect(await attr(page, id, 'fill')).toBe(sw.c);
    expect(await attr(page, id, 'data-sc-fill-swatch')).toBe(sw.id);
  }
  expect(await attr(page, 'c', 'data-sc-fill-swatch')).toBeNull();

  await editColour(page, '#16a34a');
  for (const id of ['a', 'b']) expect(await attr(page, id, 'fill')).toBe('#16a34a');
  expect(await attr(page, 'c', 'fill')).toBe('#000000');
  await expect(page.locator('#sc-msg')).toContainText('repainted 2 objects');
  // eslint-disable-next-line no-undef -- the editor's own library
  expect(await page.evaluate(() => lib.swatches[0].c)).toBe('#16a34a');

  await page.keyboard.press('Control+z');
  expect(await attr(page, 'a', 'fill')).toBe(sw.c);
});

test('another colour drops the link; new shapes and saved files keep it', async ({ page }) => {
  await load(page, SCENE, 200, 100);
  const sw = await makeGlobal(page);
  await select(page, 'a', 'b');
  await tile(page, 0).click();
  // b gets a colour typed in: no longer linked.
  await select(page, 'b');
  await page.click('[data-tab="props"]');
  await page.fill('#sc-fill-hex', '#2563eb');
  await page.press('#sc-fill-hex', 'Enter');
  expect(await attr(page, 'b', 'data-sc-fill-swatch')).toBeNull();
  // A shape drawn with the global swatch as the fill is linked too.
  await select(page, 'a');
  await page.evaluate(() => window.svgcraft.setTool('rect'));
  const p = await page.evaluate(() => {
    const m = document.getElementById('sc-doc').getScreenCTM();
    return [new DOMPoint(20, 60).matrixTransform(m), new DOMPoint(60, 90).matrixTransform(m)];
  });
  await page.mouse.move(p[0].x, p[0].y);
  await page.mouse.down();
  await page.mouse.move(p[1].x, p[1].y, { steps: 4 });
  await page.mouse.up();
  const drawn = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#sc-doc rect')].at(-1);
    return { fill: r.getAttribute('fill'), link: r.getAttribute('data-sc-fill-swatch') };
  });
  expect(drawn).toEqual({ fill: sw.c, link: sw.id });
  // Saved and reopened, the links are still there.
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((t) => window.svgcraft.openSvg(t, 're.svg'), svg);
  expect(await attr(page, 'a', 'data-sc-fill-swatch')).toBe(sw.id);
});

test('an ordinary swatch edits its colour without touching the drawing', async ({ page }) => {
  await load(page, SCENE, 200, 100);
  await page.evaluate(() => window.openLibraries('swatches'));
  await parkLibraries(page);
  await select(page, 'a');
  await tile(page, 0).click();
  expect(await attr(page, 'a', 'data-sc-fill-swatch')).toBeNull();
  await editColour(page, '#dc2626');
  expect(await attr(page, 'a', 'fill')).not.toBe('#dc2626');
  await expect(tile(page, 0)).not.toHaveClass(/\bglobal\b/);
});
