import { test, expect, load, menu, toScreen } from './fixtures.js';

// Icon work: File → New Icon… (templates, margins as guides), the pixel
// grid, Snap to Pixel, keylines, and the Icon Preview window.

const state = (page, k) => page.evaluate((k) => window.svgcraft.state[k], k);
const guides = (page) =>
  page.evaluate(() => window.svgcraft.state.guides.map((g) => `${g.axis}${g.pos}`));
const dialog = (page) => page.locator('#sc-newicon');

async function newIcon(page, setup) {
  await menu(page, 'File', 'newIcon');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-ni="ok"]')).toBeFocused();
  if (setup) await setup();
  await dialog(page).locator('[data-ni="ok"]').click();
  await expect(dialog(page)).toBeHidden();
}

// Drag with the current tool between two document points.
async function drag(page, [x0, y0], [x1, y1]) {
  const a = await toScreen(page, x0, y0);
  const b = await toScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test.describe('New Icon', () => {
  test('a 24 px icon with margin and centre guides, in place of an empty tab', async ({ page }) => {
    await newIcon(page);
    expect([await state(page, 'w'), await state(page, 'h')]).toEqual([24, 24]);
    expect(await guides(page)).toEqual(['x2', 'x22', 'y2', 'y22', 'x12', 'y12']);
    expect(await state(page, 'fileName')).toBe('icon-24');
    // The untouched Untitled-1 tab made way for it.
    await expect(page.locator('.sc-doctab')).toHaveCount(1);
    expect(await state(page, 'keylines')).toBe(true);
    expect(await state(page, 'pixelGrid')).toBe(true);
    expect(await state(page, 'snapPixel')).toBe(true);
    await expect(page.locator('#sc-iconprev')).toBeVisible();
    await expect(page.locator('[data-action="togglePixelGrid"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The guides are saved with the drawing, and a second icon gets its own tab.
    expect(await page.evaluate(() => window.svgcraft.serialize())).toContain(
      'data-sc-guides="x:2 x:22 y:2 y:22 x:12 y:12"',
    );
    await newIcon(page);
    expect(await state(page, 'fileName')).toBe('icon-24-2');
    await expect(page.locator('.sc-doctab')).toHaveCount(2);
  });

  test('sizes up to 2048, the margin follows the size until it’s edited', async ({ page }) => {
    await newIcon(page, async () => {
      await dialog(page).locator('[data-ni-size="2048"]').click();
      await expect(page.locator('#sc-ni-margin')).toHaveValue('171');
      await expect(page.locator('#sc-ni-pixels')).not.toBeChecked();
      await dialog(page).locator('[data-ni-size="1024"]').click();
      await expect(page.locator('#sc-ni-size')).toHaveValue('1024');
      await expect(page.locator('#sc-ni-margin')).toHaveValue('85');
      await page.fill('#sc-ni-margin', '64');
      await page.dispatchEvent('#sc-ni-margin', 'input');
      await dialog(page).locator('[data-ni-size="512"]').click();
      await expect(page.locator('#sc-ni-margin')).toHaveValue('64');
      await page.uncheck('#sc-ni-centre');
      await page.uncheck('#sc-ni-preview');
    });
    expect(await state(page, 'w')).toBe(512);
    expect(await guides(page)).toEqual(['x64', 'x448', 'y64', 'y448']);
    expect(await state(page, 'pixelGrid')).toBe(false);
    await expect(page.locator('#sc-iconprev')).toBeHidden();
  });

  test('templates from the Android and Apple guidelines', async ({ page }) => {
    await newIcon(page, async () => {
      await page.selectOption('#sc-ni-template', 'adaptive');
      await expect(page.locator('#sc-ni-size')).toHaveValue('432');
      await expect(page.locator('#sc-ni-margin')).toHaveValue('84');
      await expect(page.locator('#sc-ni-note')).toContainText('66 dp safe zone');
      await page.uncheck('#sc-ni-centre');
    });
    // Visible area (72 in) and safe zone (84 in) on both axes.
    expect(await guides(page)).toEqual([
      'x84',
      'x348',
      'x72',
      'x360',
      'y84',
      'y348',
      'y72',
      'y360',
    ]);
    // The keylines sit in the safe zone, the innermost guides.
    expect(
      await page.evaluate(() => +document.querySelector('#sc-keylines circle').getAttribute('r')),
    ).toBe(132);

    await newIcon(page, async () => {
      await page.selectOption('#sc-ni-template', 'ios');
      await expect(page.locator('#sc-ni-note')).toContainText('rounds the corners itself');
      await page.uncheck('#sc-ni-centre');
    });
    expect(await state(page, 'w')).toBe(1024);
    expect(await guides(page)).toEqual([]);
    expect(await state(page, 'keylines')).toBe(false);

    await newIcon(page, async () => {
      await page.selectOption('#sc-ni-template', 'macos');
      await page.uncheck('#sc-ni-centre');
    });
    expect(await guides(page)).toEqual(['x100', 'x924', 'y100', 'y924']);

    // Picking a size afterwards goes back to Custom.
    await menu(page, 'File', 'newIcon');
    await page.selectOption('#sc-ni-template', 'material');
    await dialog(page).locator('[data-ni-size="48"]').click();
    await expect(page.locator('#sc-ni-template')).toHaveValue('');
    await expect(page.locator('#sc-ni-note')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  });

  test('File → New is still a plain 800 × 600 with no guides', async ({ page }) => {
    await newIcon(page);
    await menu(page, 'File', 'new');
    expect([await state(page, 'w'), await state(page, 'h')]).toEqual([800, 600]);
    expect(await guides(page)).toEqual([]);
  });
});

test.describe('pixel grid and keylines', () => {
  test('the pixel grid shows from 600%, over the visible artboard', async ({ page }) => {
    await load(page, '', 40, 30);
    await menu(page, 'View', 'togglePixelGrid');
    const d = () => page.locator('#sc-pixgrid').getAttribute('d');
    await menu(page, 'View', 'zoom100');
    expect(await d()).toBe('');
    // Fit (over 600% for so small an artboard): a line per pixel edge,
    // 41 + 31 of them.
    await menu(page, 'View', 'fit');
    expect(await state(page, 'zoom')).toBeGreaterThan(6);
    const path = await d();
    expect((path.match(/M/g) || []).length).toBe(41 + 31);
    expect(path).toMatch(/^M0 0V30/);
    await menu(page, 'View', 'togglePixelGrid');
    expect(await d()).toBe('');
  });

  test('keylines follow the margin guides', async ({ page }) => {
    await newIcon(page, async () => {
      await dialog(page).locator('[data-ni-size="32"]').click();
      await page.fill('#sc-ni-margin', '4');
      await page.dispatchEvent('#sc-ni-margin', 'input');
    });
    const keylines = () =>
      page.evaluate(() => ({
        r: +document.querySelector('#sc-keylines circle').getAttribute('r'),
        rects: [...document.querySelectorAll('#sc-keylines rect')].map((r) =>
          ['x', 'y', 'width', 'height'].map((k) => +(+r.getAttribute(k)).toFixed(2)),
        ),
        lines: document.querySelectorAll('#sc-keylines line').length,
      }));
    expect(await keylines()).toEqual({
      r: 12,
      rects: [
        [5.2, 5.2, 21.6, 21.6],
        [6.4, 4, 19.2, 24],
        [4, 6.4, 24, 19.2],
      ],
      lines: 4,
    });
    await menu(page, 'View', 'toggleKeylines');
    await expect(page.locator('#sc-keylines > *')).toHaveCount(0);
  });
});

test.describe('Snap to Pixel', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, '', 64, 64);
    await page.evaluate(() => {
      const s = window.svgcraft.state;
      s.snapPixel = true;
      s.smart = false;
      s.strokeOn = true;
    });
    await page.fill('#sc-zoom-input', '800');
    await page.press('#sc-zoom-input', 'Enter');
  });
  const rect = (page) =>
    page.evaluate(() => {
      const r = [...document.querySelectorAll('#sc-doc rect')].at(-1);
      return ['x', 'y', 'width', 'height'].map((k) => +r.getAttribute(k));
    });

  test('even strokes land on whole pixels, odd ones on half pixels', async ({ page }) => {
    await page.evaluate(() => (window.svgcraft.state.strokeWidth = 2));
    await page.evaluate(() => window.svgcraft.setTool('rect'));
    await drag(page, [3.3, 4.6], [20.8, 18.2]);
    expect(await rect(page)).toEqual([3, 5, 18, 13]);

    await page.evaluate(() => (window.svgcraft.state.strokeWidth = 1));
    await page.evaluate(() => window.svgcraft.setTool('rect'));
    await drag(page, [30.2, 30.9], [40.1, 44.2]);
    expect(await rect(page)).toEqual([30.5, 30.5, 10, 14]);
  });

  test('moving keeps a shape on the pixel grid', async ({ page }) => {
    await load(page, '<rect id="r" x="10" y="10" width="8" height="8" fill="#000"/>', 64, 64);
    await page.evaluate(() => (window.svgcraft.state.snapPixel = true));
    await page.evaluate(() => window.svgcraft.setTool('select'));
    await drag(page, [14, 14], [21.3, 19.6]);
    // Its top-left corner, in document pixels.
    const t = await page.evaluate(() => {
      const r = document.getElementById('r');
      const m = r.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix();
      const p = new DOMPoint(r.x.baseVal.value, r.y.baseVal.value).matrixTransform(m);
      return [p.x, p.y];
    });
    expect(t.map((v) => +v.toFixed(3))).toEqual([17, 16]);
  });
});

test.describe('Icon Preview', () => {
  const win = (page) => page.locator('#sc-iconprev');
  const rows = (page) => win(page).locator('.sc-ip-row:not([hidden])');

  test('every size, on the theme’s background, updates and zooms', async ({ page }) => {
    await load(page, '<rect width="48" height="24" fill="#2563eb"/>', 48, 24);
    await page.keyboard.press('Control+Alt+p');
    await expect(win(page)).toBeVisible();
    await expect(page.locator('[data-action="toggleIconPreview"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The tests run in dark mode: one row, on dark.
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveAttribute('data-bg', 'dark');
    await expect(win(page).locator('[data-ip-bg="dark"]')).toHaveAttribute('aria-checked', 'true');
    const imgs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.sc-ip-dark img')].map((i) => [
          i.width,
          i.height,
          i.complete && i.naturalWidth > 0,
          i.src,
        ]),
      );
    await expect.poll(async () => (await imgs()).every((x) => x[2])).toBe(true);
    const first = await imgs();
    // Wider than tall: each fits its square.
    expect(first.map((x) => [x[0], x[1]])).toEqual([
      [16, 8],
      [24, 12],
      [32, 16],
      [48, 24],
      [64, 32],
      [128, 64],
    ]);
    // A change redraws them.
    await page.evaluate(() => {
      document.querySelector('#sc-doc rect').setAttribute('fill', '#ff0000');
      window.svgcraft.commit();
    });
    await expect.poll(async () => (await imgs())[0][3]).not.toBe(first[0][3]);

    // Clicking a size shows the canvas at that size.
    await win(page).locator('.sc-ip-dark [data-size="32"]').click();
    expect(await state(page, 'zoom')).toBeCloseTo(32 / 48);

    // Pick the background; the choice is remembered.
    await win(page).locator('[data-ip-bg="all"]').click();
    await expect(rows(page)).toHaveCount(3);
    await win(page).locator('[data-ip-bg="light"]').click();
    await expect(rows(page)).toHaveAttribute('data-bg', 'light');
    await page.keyboard.press('Control+Alt+p');
    await expect(win(page)).toBeHidden();
    await page.reload();
    await page.waitForFunction(() => !!window.svgcraft);
    await menu(page, 'View', 'toggleIconPreview');
    await expect(rows(page)).toHaveAttribute('data-bg', 'light');
    // Esc in the window closes it.
    await win(page).locator('[data-ip-bg="dark"]').focus();
    await page.keyboard.press('Escape');
    await expect(win(page)).toBeHidden();
  });
});

test('view settings for icon work are remembered', async ({ page }) => {
  await menu(page, 'View', 'togglePixelGrid');
  await menu(page, 'View', 'toggleSnapPixel');
  await menu(page, 'View', 'toggleKeylines');
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  for (const k of ['pixelGrid', 'snapPixel', 'keylines']) expect(await state(page, k)).toBe(true);
  await expect(page.locator('[data-action="toggleSnapPixel"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
