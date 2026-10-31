// Image → Adjustments (Desaturate, Black & White…, Threshold…) and Image →
// Mode → Grayscale: the colours themselves are rewritten, in the selected
// layers or the whole drawing.
import { test, expect, load, select } from './fixtures.js';

// Image → (submenu) → item.
async function imageMenu(page, sub, act) {
  await page.click('.sc-menu-btn:text-is("Image")');
  await page.hover(`.sc-sub-btn:has-text("${sub}")`);
  await page.click(`.sc-sub-list [data-action="${act}"]`);
}

// A 2×1 PNG: one pure red pixel, one pure blue.
const PNG = (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 1;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 1, 1);
    x.fillStyle = '#0000ff';
    x.fillRect(1, 0, 1, 1);
    return c.toDataURL('image/png');
  });
const pixels = (page, id) =>
  page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 2;
          c.height = 1;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          resolve([...x.getImageData(0, 0, 2, 1).data]);
        };
        img.src = document.getElementById(id).getAttribute('href');
      }),
    id,
  );
const attr = (page, id, a) => page.locator(`#${id}`).getAttribute(a);
const stops = (page, id) =>
  page.$$eval(`#${id} stop`, (ss) => ss.map((s) => s.getAttribute('stop-color')));

// g is shared by a and b. Reflecting, it isn't adopted on load (which would
// give each shape its own); across the whole box it draws as if padded.
const SCENE = async (page) =>
  load(
    page,
    '<defs><linearGradient id="g" spreadMethod="reflect"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#00ff00"/></linearGradient></defs>' +
      '<rect id="a" x="10" y="10" width="40" height="40" fill="url(#g)" stroke="#0000ff" stroke-width="4"/>' +
      '<rect id="b" x="60" y="10" width="40" height="40" fill="url(#g)"/>' +
      '<circle id="c" cx="150" cy="30" r="20" style="fill:#ff0000;stroke:rgba(0,0,255,0.5)"' +
      ' data-sc-fx=\'{"ds":{"on":true,"c":"#ff0000","o":35,"a":120,"d":5,"sp":0,"s":5}}\'/>',
    300,
    100,
  );

test('Desaturate greys the whole drawing; one undo step', async ({ page }) => {
  await SCENE(page);
  await page.keyboard.press('Shift+Control+u');
  // Desaturate: (max + min) / 2.
  await expect.poll(() => attr(page, 'a', 'stroke')).toBe('#808080');
  expect(await stops(page, 'g')).toEqual(['#808080', '#808080']);
  expect(await attr(page, 'c', 'style')).toMatch(/fill:\s*#808080/);
  expect(await attr(page, 'c', 'style')).toMatch(/stroke:\s*rgba\(128, 128, 128, 0\.5\)/);
  expect(JSON.parse(await attr(page, 'c', 'data-sc-fx')).ds.c).toBe('#808080');
  await page.keyboard.press('Control+z');
  expect(await attr(page, 'a', 'stroke')).toBe('#0000ff');
  expect(await stops(page, 'g')).toEqual(['#ff0000', '#00ff00']);
});

test('with layers selected only they change; a shared gradient gets a copy', async ({ page }) => {
  await SCENE(page);
  await select(page, 'a');
  await imageMenu(page, 'Mode', 'modeGrayscale');
  // Grayscale: the eye's brightness, 0.299 R + 0.587 G + 0.114 B.
  await expect.poll(() => attr(page, 'a', 'stroke')).toBe('#1d1d1d');
  const own = (await attr(page, 'a', 'fill')).match(/#([^)]+)/)[1];
  expect(own).not.toBe('g');
  expect(await stops(page, own)).toEqual(['#4c4c4c', '#969696']);
  // b keeps the original gradient, still in colour.
  expect(await attr(page, 'b', 'fill')).toBe('url(#g)');
  expect(await stops(page, 'g')).toEqual(['#ff0000', '#00ff00']);
  expect(await attr(page, 'c', 'style')).toMatch(/fill:\s*#ff0000/);
});

test('Black & White: hue sliders, previewed; Cancel puts it back', async ({ page }) => {
  await SCENE(page);
  await page.keyboard.press('Alt+Shift+Control+b');
  const dlg = page.locator('#sc-bw');
  await expect(dlg).toBeVisible();
  // Defaults: Reds 40% → pure red is 40% of 255.
  await expect(dlg.locator('[data-adj="r"] input[type="number"]')).toHaveValue('40');
  await expect.poll(() => stops(page, 'g')).toEqual(['#666666', '#666666']);
  // Reds up to 100%: the preview follows.
  await dlg.locator('[data-adj="r"] input[type="number"]').fill('100');
  await expect.poll(() => stops(page, 'g')).toEqual(['#ffffff', '#666666']);
  await dlg.locator('[data-adj-btn="cancel"]').click();
  await expect(dlg).toBeHidden();
  expect(await stops(page, 'g')).toEqual(['#ff0000', '#00ff00']);
  await expect(page.locator('#sc-redo')).toBeDisabled();
  // OK keeps it, as one step.
  await imageMenu(page, 'Adjustments', 'adjBlackWhite');
  await dlg.locator('[data-adj-btn="ok"]').click();
  await expect.poll(() => stops(page, 'g')).toEqual(['#666666', '#666666']);
  await page.keyboard.press('Control+z');
  expect(await stops(page, 'g')).toEqual(['#ff0000', '#00ff00']);
});

test('Threshold: black below the level, white from it; embedded images too', async ({ page }) => {
  const png = await PNG(page);
  await load(
    page,
    `<rect id="l" width="10" height="10" fill="#c0c0c0"/><rect id="d" x="20" width="10" height="10" fill="#404040"/>` +
      `<image id="im" x="40" width="20" height="10" href="${png}"/>`,
    100,
    20,
  );
  await imageMenu(page, 'Adjustments', 'adjThreshold');
  const dlg = page.locator('#sc-threshold');
  await expect(dlg.locator('[data-adj="t"] input[type="number"]')).toHaveValue('128');
  await dlg.locator('[data-adj-btn="ok"]').click();
  await expect.poll(() => attr(page, 'l', 'fill')).toBe('#ffffff');
  expect(await attr(page, 'd', 'fill')).toBe('#000000');
  // Red (luma 76) and blue (29) both fall below 128.
  expect(await pixels(page, 'im')).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
});

test('with nothing to change, the adjustments are greyed out', async ({ page }) => {
  await load(page, '');
  await page.click('.sc-menu-btn:text-is("Image")');
  for (const a of ['adjBlackWhite', 'adjThreshold', 'adjDesaturate', 'modeGrayscale'])
    await expect(page.locator(`.sc-menu-list [data-action="${a}"]`)).toBeDisabled();
});
