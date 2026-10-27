import { test, expect, load } from './fixtures.js';

// Phones only preview (open, tabs, pan / pinch-zoom, fit); tablets and up
// get the editor.

const DRAWING =
  '<rect id="r" x="20" y="20" width="160" height="120" fill="#2563eb"/>' +
  '<circle id="c" cx="230" cy="100" r="40" fill="#dc2626"/>';
const preview = (page) =>
  page.evaluate(() => document.documentElement.classList.contains('sc-preview'));

test.describe('phone, portrait', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('is a viewer that fits the screen', async ({ page }) => {
    expect(await preview(page)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    for (const sel of [
      '.sc-menus',
      '.sc-options',
      '.sc-tools',
      '.sc-panel',
      '#sc-undo',
      '.sc-export',
    ])
      await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator('.sc-menubar-end [data-action="open"]')).toBeVisible();
    await expect(page.locator('.sc-menubar-end [data-action="fit"]')).toBeVisible();
    await expect(page.locator('.sc-preview-note')).toBeVisible();
    // The canvas takes the height between the tabs and the status bar.
    const stage = await page.locator('#sc-stage').boundingBox();
    expect(stage.height).toBeGreaterThan(600);
    expect(stage.x + stage.width).toBeLessThanOrEqual(390);
  });

  test('only the Hand tool: tool keys, shortcuts and drags do not edit', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    const before = await page.evaluate(() => window.svgcraft.serialize());
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    await page.keyboard.press('r');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    await page.evaluate(() => window.svgcraft.setTool('rect'));
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('hand');
    const pan0 = await page.evaluate(() => window.svgcraft.state.panX);
    const b = await page.locator('#sc-stage').boundingBox();
    await page.mouse.move(b.x + 200, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 300, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.svgcraft.state.panX)).toBeCloseTo(pan0 - 80, 0);
    expect(await page.evaluate(() => window.svgcraft.serialize())).toBe(before);
    await expect(page.locator('#sc-doc-title')).not.toContainText('*');
  });

  test('zoom keys and Fit still work', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    const z0 = await page.evaluate(() => window.svgcraft.state.zoom);
    await page.keyboard.press('+');
    expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBeCloseTo(z0 * 1.25);
    await page.click('.sc-menubar-end [data-action="fit"]');
    expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBeCloseTo(z0);
  });

  test('Open loads a file into a tab of its own', async ({ page }) => {
    await page.setInputFiles('#sc-file', {
      name: 'poster.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${DRAWING}</svg>`,
      ),
    });
    await expect(page.locator('#sc-doc-title')).toHaveText(/^poster\.svg @/);
    await expect(page.locator('#sc-doc circle')).toHaveCount(1);
  });

  const bar = (page, act) => page.locator(`.sc-menubar-end [data-action="${act}"]`);
  const openFile = (page, name, body) =>
    page.setInputFiles('#sc-file', {
      name,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">${body}</svg>`,
      ),
    });

  test('the toolbar fits: Play, Layers, Background and Share beside Open and Fit', async ({
    page,
  }) => {
    for (const act of ['open', 'fit', 'toggleAnimations', 'peekLayers', 'previewBg', 'shareDoc'])
      await expect(bar(page, act)).toBeVisible();
    const end = await page.locator('.sc-menubar-end').boundingBox();
    expect(end.x + end.width).toBeLessThanOrEqual(390);
  });

  test('▶ plays the animations and ■ stops them', async ({ page }) => {
    await load(
      page,
      '<rect id="r" width="50" height="50" data-sc-anim=\'[{"p":"spin","dur":1,"rep":0}]\'/>',
      300,
      200,
    );
    await bar(page, 'toggleAnimations').click();
    await expect(page.locator('#sc-doc animateTransform')).toHaveCount(1);
    await expect(bar(page, 'toggleAnimations')).toHaveAttribute('aria-label', 'Stop');
    await bar(page, 'toggleAnimations').click();
    await expect(page.locator('#sc-doc animateTransform')).toHaveCount(0);
    await expect(bar(page, 'toggleAnimations')).toHaveAttribute('aria-label', 'Play animations');
  });

  test('Layers shows and hides layers in the preview only', async ({ page }) => {
    await load(page, DRAWING + '<rect id="off" width="10" height="10" display="none"/>', 300, 200);
    const saved = await page.evaluate(() => window.svgcraft.serialize());
    await bar(page, 'peekLayers').click();
    const rows = page.locator('#sc-peek-list li');
    await expect(rows).toHaveCount(3);
    // Top first, as in the Layers panel; the file's hidden layer shows as hidden.
    await expect(rows.nth(0)).toHaveClass(/off/);
    await rows.nth(1).locator('.sc-peek-eye').click();
    await expect(page.locator('#c')).toBeHidden();
    await rows.nth(0).locator('.sc-peek-eye').click();
    await expect(page.locator('#off')).toBeVisible();
    // Nothing of it is saved.
    expect(await page.evaluate(() => window.svgcraft.serialize())).toBe(saved);
    await page.click('[data-peek="close"]');
    // Leaving the preview brings back the drawing as it is.
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator('#c')).toBeVisible();
    await expect(page.locator('#off')).toBeHidden();
  });

  test('Layers: a long list stays put while you tap down it; Hide all, Show all', async ({
    page,
  }) => {
    const rects = Array.from(
      { length: 20 },
      (_, i) => `<rect id="r${i}" x="${i * 10}" y="0" width="8" height="8"/>`,
    ).join('');
    await load(page, `<g id="g">${rects}</g>`, 300, 200);
    await bar(page, 'peekLayers').click();
    const list = page.locator('#sc-peek-list');
    await list.evaluate((ul) => (ul.scrollTop = ul.scrollHeight));
    const scrolled = await list.evaluate((ul) => ul.scrollTop);
    expect(scrolled).toBeGreaterThan(100);
    // Tap the same spot twice, as a finger would, without scrolling.
    const last = await page
      .locator('#sc-peek-list li')
      .last()
      .locator('.sc-peek-eye')
      .boundingBox();
    const tapAt = () => page.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
    await tapAt();
    expect(await list.evaluate((ul) => ul.scrollTop)).toBe(scrolled);
    await expect(page.locator('#r0')).toBeHidden();
    await tapAt();
    await expect(page.locator('#r0')).toBeVisible();

    // Every row has a preview, a hidden layer's too.
    await expect(page.locator('#sc-peek-list .sc-thumb')).toHaveCount(21);
    await tapAt();
    await expect(page.locator('#sc-peek-list li').last().locator('.sc-thumb rect')).toHaveCount(1);
    await tapAt();

    // Hiding the group dims what's in it.
    await list.evaluate((ul) => (ul.scrollTop = 0));
    await page.locator('#sc-peek-list li').first().locator('.sc-peek-eye').click();
    await expect(page.locator('#sc-peek-list li.under')).toHaveCount(20);

    await page.click('[data-peek="none"]');
    await expect(page.locator('#sc-peek-list li.off')).toHaveCount(21);
    for (const id of ['g', 'r5']) await expect(page.locator(`#${id}`)).toBeHidden();
    await page.click('[data-peek="all"]');
    await expect(page.locator('#sc-peek-list li.off')).toHaveCount(0);
    await expect(page.locator('#r5')).toBeVisible();
  });

  test('Background cycles checkerboard, white and black, and is remembered', async ({ page }) => {
    const fill = () =>
      page.evaluate(() => getComputedStyle(document.getElementById('sc-board-bg')).fill);
    expect(await fill()).toContain('url');
    await bar(page, 'previewBg').click();
    expect(await fill()).toBe('rgb(255, 255, 255)');
    await bar(page, 'previewBg').click();
    expect(await fill()).toBe('rgb(0, 0, 0)');
    await page.reload();
    await page.evaluate(() => window.svgcraft.ready);
    expect(await fill()).toBe('rgb(0, 0, 0)');
    await bar(page, 'previewBg').click();
    expect(await fill()).toContain('url');
  });

  test('Share sends the SVG and a PNG to the share sheet', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    await page.evaluate(() => {
      navigator.canShare = () => true;
      navigator.share = async (d) => {
        window.shared = d.files.map((f) => `${f.name} ${f.type}`);
      };
    });
    await bar(page, 'shareDoc').click();
    await expect
      .poll(() => page.evaluate(() => window.shared))
      .toEqual(['test.svg image/svg+xml', 'test.png image/png']);
  });

  test('the text view shows the SVG source to copy; the same button goes back', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await load(page, DRAWING);
    const btn = page.locator('[data-action="phoneSource"]');
    const src = page.locator('#sc-source');
    await expect(src).toBeHidden();
    await btn.tap();
    await expect(src).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveAttribute('aria-label', 'Drawing view');
    // It fills the screen under the toolbar.
    const box = await src.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(389);
    expect(box.y + box.height).toBeGreaterThanOrEqual(799);
    await expect(page.locator('#sc-src-code')).toContainText('<circle');
    await page.locator('#sc-src-copy').tap();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/<circle\s+id="c"/);
    // Back to the drawing.
    await btn.tap();
    await expect(src).toBeHidden();
    await expect(btn).toHaveAttribute('aria-label', 'Text view');
    await expect(page.locator('#sc-stage')).toBeVisible();
  });

  test('double-tap zooms in on the spot, and again fits', async ({ page }) => {
    await load(page, DRAWING, 300, 200);
    await bar(page, 'fit').click();
    const zoom = () => page.evaluate(() => window.svgcraft.state.zoom);
    const fitted = await zoom();
    const b = await page.locator('#sc-stage').boundingBox();
    const dbl = async () => {
      await page.touchscreen.tap(b.x + 150, b.y + 300);
      await page.touchscreen.tap(b.x + 150, b.y + 300);
    };
    await dbl();
    expect(await zoom()).toBeCloseTo(fitted < 1 ? 1 : fitted * 2);
    await dbl();
    expect(await zoom()).toBeCloseTo(fitted);
  });

  test('swiping along the tab bar changes drawing', async ({ page }) => {
    await openFile(page, 'a.svg', '<rect width="5" height="5"/>');
    await openFile(page, 'b.svg', '<circle cx="5" cy="5" r="5"/>');
    await expect(page.locator('#sc-doc-title')).toHaveText(/^b\.svg/);
    const t = await page.locator('#sc-doctabs').boundingBox();
    const swipe = async (from, to) => {
      await page.mouse.move(t.x + from, t.y + t.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + to, t.y + t.height / 2, { steps: 4 });
      await page.mouse.up();
    };
    // Right to left: the next one (there is none); left to right: back to a.svg.
    await swipe(250, 100);
    await expect(page.locator('#sc-doc-title')).toHaveText(/^b\.svg/);
    await swipe(100, 250);
    await expect(page.locator('#sc-doc-title')).toHaveText(/^a\.svg/);
  });
});

test.describe('phone, landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('is a viewer too', async ({ page }) => {
    expect(await preview(page)).toBe(true);
    await expect(page.locator('.sc-tools')).toBeHidden();
  });
});

test.describe('tablet, portrait', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('gets the editor, with nothing off-screen', async ({ page }) => {
    expect(await preview(page)).toBe(false);
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
    await expect(page.locator('.sc-tools')).toBeVisible();
    await expect(page.locator('.sc-preview-note')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      820,
    );
    const toggle = await page.locator('.sc-panel-toggle').boundingBox();
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(820);
  });
});

test('growing a window past phone size switches back to the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => preview(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => preview(page)).toBe(false);
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
  await expect(page.locator('.sc-tools')).toBeVisible();
});
