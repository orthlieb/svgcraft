import { test, expect, load, menu } from './fixtures.js';

// Document units (Properties → Document): lengths shown and typed in mm,
// cm, in or pt; page-size presets; real-world width and height in the
// saved file, with the viewBox still in pixels.

const st = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    return { w: +s.w.toFixed(2), h: +s.h.toFixed(2), units: s.units };
  });
const root = (page) =>
  page.evaluate(() => {
    const r = new DOMParser().parseFromString(
      window.svgcraft.serialize(),
      'image/svg+xml',
    ).documentElement;
    return ['width', 'height', 'viewBox'].map((a) => r.getAttribute(a));
  });
const MM = 96 / 25.4;

test.beforeEach(async ({ page }) => {
  await load(page, '<rect id="r" x="20" y="20" width="60" height="40"/>', 200, 100);
  await page.click('[data-tab="props"]');
});

test('units change what’s shown, not the drawing; undo puts them back', async ({ page }) => {
  await expect(page.locator('#sc-units')).toHaveValue('px');
  await page.selectOption('#sc-units', 'mm');
  expect(await st(page)).toEqual({ w: 200, h: 100, units: 'mm' });
  await expect(page.locator('#sc-w')).toHaveValue('52.92');
  await expect(page.locator('#sc-h')).toHaveValue('26.46');
  await expect(page.locator('#sc-docsize')).toHaveText('52.92 × 26.46 mm');
  await expect(page.locator('#sc-w + [data-doc-unit]')).toHaveText('mm');
  // The grid takes a round size in the new units.
  await expect(page.locator('#sc-grid-size')).toHaveValue('5');
  // Saved with its real size; the viewBox (and the drawing) stay in px.
  expect(await root(page)).toEqual(['52.92mm', '26.46mm', '0 0 200 100']);
  expect(await page.locator('#r').getAttribute('width')).toBe('60');
  // Typing a size in mm.
  await page.fill('#sc-w', '100');
  await page.locator('#sc-w').press('Enter');
  expect((await st(page)).w).toBeCloseTo(100 * MM, 1);
  await page.evaluate(() => window.svgcraft.undo());
  await page.evaluate(() => window.svgcraft.undo());
  expect(await st(page)).toEqual({ w: 200, h: 100, units: 'px' });
  expect(await root(page)).toEqual(['200', '100', '0 0 200 100']);
});

test('page presets set the size and units; orientation swaps them', async ({ page }) => {
  // The artboard is wider than tall, so the page comes out landscape.
  await page.selectOption('#sc-page', 'a4');
  expect(await st(page)).toEqual({ w: 1122.52, h: 793.7, units: 'mm' });
  await expect(page.locator('#sc-msg')).toHaveText('Page size: A4, landscape.');
  expect(await root(page)).toEqual(['297mm', '210mm', '0 0 1122.52 793.7']);
  await page.click('#sc-orient');
  await expect(page.locator('#sc-msg')).toHaveText('Portrait.');
  expect(await st(page)).toEqual({ w: 793.7, h: 1122.52, units: 'mm' });
  await expect(page.locator('#sc-page')).toHaveValue('a4');
  // A portrait page stays portrait when the preset changes.
  await page.selectOption('#sc-page', 'letter');
  expect(await st(page)).toEqual({ w: 816, h: 1056, units: 'in' });
  expect(await root(page)).toEqual(['8.5in', '11in', '0 0 816 1056']);
  // Any other size is Custom.
  await page.fill('#sc-w', '10');
  await page.locator('#sc-w').press('Enter');
  await expect(page.locator('#sc-page')).toHaveValue('');
});

test('fields, guides, the grid and Canvas Size work in the units', async ({ page }) => {
  await page.selectOption('#sc-units', 'mm');
  // New Guide at 10 mm.
  await menu(page, 'View', 'newGuide');
  await expect(page.locator('#sc-newguide [data-doc-unit]')).toHaveText('mm');
  await page.locator('#sc-newguide input[type="number"]').fill('10');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.svgcraft.state.guides.at(-1).pos)).toBeCloseTo(
    10 * MM,
    2,
  );
  // The grid size in mm.
  await page.fill('#sc-grid-size', '5');
  await page.locator('#sc-grid-size').press('Enter');
  expect(await page.evaluate(() => window.svgcraft.state.gridSize)).toBeCloseTo(5 * MM, 2);
  // Canvas Size in mm, not rounded to pixels.
  await menu(page, 'File', 'canvasSize');
  await expect(page.locator('[data-cv="w"]')).toHaveValue('52.92');
  await page.fill('[data-cv="w"]', '60');
  await page.click('[data-cv-btn="ok"]');
  await expect(page.locator('#sc-msg')).toHaveText(
    'Canvas size: 52.92 × 26.46 mm → 60 × 26.46 mm.',
  );
  expect((await st(page)).w).toBeCloseTo(60 * MM, 2);
  // Image Size offers mm or percent.
  await menu(page, 'File', 'imageSize');
  await expect(page.locator('[data-is="unit"] option')).toHaveText(['mm', '%']);
  await expect(page.locator('[data-is="w"]')).toHaveValue('60');
  await page.keyboard.press('Escape');
  // The transform fields: W in mm sizes the selection in mm.
  await page.evaluate(() => {
    window.svgcraft.setTool('select');
    window.svgcraft.state.sel = [document.getElementById('r')];
  });
  await page.keyboard.press('Alt+t');
  const wf = page.locator('[data-tf="w"]');
  await expect(wf).toHaveValue(/^15\.8[78]$/);
  await wf.fill('20');
  await wf.press('Enter');
  expect(
    await page.evaluate(() => document.getElementById('r').getBoundingClientRect().width > 0),
  ).toBe(true);
  // eslint-disable-next-line no-undef -- the editor's own global
  expect(await page.evaluate(() => bboxDoc(document.getElementById('r')).w)).toBeCloseTo(
    20 * MM,
    1,
  );
});

test('files in real units open at their real size, in their units', async ({ page }) => {
  // SVGCraft's own: same size and units back.
  await page.selectOption('#sc-page', 'a5');
  const saved = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'a5.svg'), saved);
  expect(await st(page)).toEqual({ w: 793.7, h: 559.37, units: 'mm' });
  // Another app's, drawn in mm (its viewBox is in mm): scaled to pixels,
  // keeping its real size.
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="m" x="10" y="10" width="10" height="5"/></svg>',
      'mm.svg',
    ),
  );
  expect(await st(page)).toEqual({ w: 377.95, h: 188.98, units: 'mm' });
  // eslint-disable-next-line no-undef -- the editor's own global
  const b = await page.evaluate(() => bboxDoc(document.getElementById('m')));
  expect(b.x).toBeCloseTo(10 * MM, 1);
  expect(b.w).toBeCloseTo(10 * MM, 1);
  expect(await root(page)).toEqual(['100mm', '50mm', '0 0 377.95 188.98']);
  // Inches without a viewBox; picas show as points.
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in"><rect width="96" height="96"/></svg>',
      'in.svg',
    ),
  );
  expect(await st(page)).toEqual({ w: 192, h: 96, units: 'in' });
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="6pc" height="3pc" viewBox="0 0 96 48"/>',
      'pc.svg',
    ),
  );
  expect(await st(page)).toEqual({ w: 96, h: 48, units: 'pt' });
  // Plain pixel sizes are left alone, even when they differ from the viewBox.
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 512 512"/>',
      'icon.svg',
    ),
  );
  expect(await st(page)).toEqual({ w: 512, h: 512, units: 'px' });
});
