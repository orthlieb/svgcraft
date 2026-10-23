import { test, expect, load, menu, toScreen } from './fixtures.js';

// The Shape tool group (U), Photoshop's: Rectangle, Ellipse, Triangle,
// Polygon / Star, Line with arrowheads and Custom Shape, one toolbar
// button with a flyout; a click without dragging asks for an exact size.

const tool = (page) => page.evaluate(() => window.svgcraft.state.tool);
async function drag(page, [x0, y0], [x1, y1], mods = []) {
  const a = await toScreen(page, x0, y0);
  const b = await toScreen(page, x1, y1);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
const last = (page, sel = '#sc-doc > *') => page.locator(sel).last();
// eslint-disable-next-line no-undef -- the editor's own global
const box = (page) => page.evaluate(() => bboxDoc(document.querySelector('#sc-doc > :last-child')));

test.beforeEach(async ({ page }) => {
  await load(page, '', 400, 300);
});

test('U picks the group’s tool, Shift+U steps through it; the button follows', async ({ page }) => {
  await page.keyboard.press('u');
  expect(await tool(page)).toBe('rect');
  const order = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+u');
    order.push(await tool(page));
  }
  expect(order).toEqual(['ellipse', 'triangle', 'polygon', 'line', 'custom', 'rect']);
  // R, O and L still pick theirs, and U comes back to the last one used.
  await page.keyboard.press('l');
  await page.keyboard.press('v');
  await page.keyboard.press('u');
  expect(await tool(page)).toBe('line');
  const btn = page.locator('#sc-shape-btn');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'Line');
  // The flyout: right-click (or hold) the button, pick a tool.
  await btn.click({ button: 'right' });
  await expect(page.locator('#sc-shape-menu')).toBeVisible();
  await expect(page.locator('[data-shape-tool="line"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-shape-tool="triangle"]');
  await expect(page.locator('#sc-shape-menu')).toBeHidden();
  expect(await tool(page)).toBe('triangle');
  await expect(btn).toHaveAttribute('aria-label', 'Triangle');
  // A plain click on the button picks its current tool.
  await page.keyboard.press('v');
  await btn.click();
  expect(await tool(page)).toBe('triangle');
});

test('triangles and polygons fill the box you drag; a star is live in Properties', async ({
  page,
}) => {
  await page.keyboard.press('u');
  await page.keyboard.press('Shift+u');
  await page.keyboard.press('Shift+u');
  await drag(page, [20, 20], [120, 100]);
  expect(await last(page).getAttribute('points')).toBe('70,20 120,100 20,100');
  // Polygon: six sides, filling the box exactly.
  await page.keyboard.press('Shift+u');
  await page.fill('[data-shape-opt="sides"]', '6');
  await page.locator('[data-shape-opt="sides"]').press('Enter');
  await drag(page, [150, 20], [250, 120]);
  expect(await last(page).evaluate((el) => el.points.length)).toBe(6);
  expect(await box(page)).toEqual({ x: 150, y: 20, w: 100, h: 100 });
  // Properties: make it a five-pointed star.
  await page.click('[data-tab="props"]');
  await expect(page.locator('#sc-shape-props [data-shape-poly]')).toBeVisible();
  await expect(page.locator('[data-shape-prop="sides"]')).toHaveValue('6');
  await page.fill('[data-shape-prop="sides"]', '5');
  await page.locator('[data-shape-prop="sides"]').press('Enter');
  await page.fill('[data-shape-prop="ratio"]', '50');
  await page.locator('[data-shape-prop="ratio"]').press('Enter');
  expect(await last(page).evaluate((el) => el.points.length)).toBe(10);
  expect(await box(page)).toEqual({ x: 150, y: 20, w: 100, h: 100 });
  await page.evaluate(() => window.svgcraft.undo());
  expect(await last(page).evaluate((el) => el.points.length)).toBe(5);
  // Points edited by hand: no longer live, so Properties leaves it alone.
  await page.evaluate(() => {
    const el = document.querySelector('#sc-doc > :last-child');
    el.setAttribute('points', '150,20 250,20 200,120');
    window.svgcraft.commit();
  });
  await expect(page.locator('#sc-shape-props')).toBeHidden();
});

test('lines get arrowheads in their own colour, from the options bar or Properties', async ({
  page,
}) => {
  await page.keyboard.press('l');
  await page.check('[data-shape-opt="arrowEnd"]');
  await drag(page, [20, 150], [200, 150]);
  const line = last(page);
  const marker = await line.getAttribute('marker-end');
  expect(marker).toMatch(/^url\(#sc-arrow-\d+\)$/);
  expect(await line.getAttribute('marker-start')).toBeNull();
  expect(
    await page.evaluate(
      (m) => document.querySelector(`${m.slice(4, -1)} path`).getAttribute('fill'),
      marker,
    ),
  ).toBe('context-stroke');
  // A second line shares the marker.
  await drag(page, [20, 200], [200, 200]);
  expect(await last(page).getAttribute('marker-end')).toBe(marker);
  // Properties adds one at the start.
  await page.click('[data-tab="props"]');
  await page.check('[data-shape-prop="arrowStart"]');
  expect(await last(page).getAttribute('marker-start')).toBe(marker);
  // Saved files carry the marker; reopened, the arrows are still there.
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(svg).toMatch(/<marker [^>]*orient="auto-start-reverse"/);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'arrows.svg'), svg);
  expect(await page.locator('#sc-doc line[marker-end]').count()).toBe(2);
  expect(await page.locator('#sc-defs marker').count()).toBe(1);
});

test('Custom Shape draws a library symbol into the box, proportions kept', async ({ page }) => {
  await page.keyboard.press('u');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+u');
  expect(await tool(page)).toBe('custom');
  const pick = page.locator('#sc-custom-shape');
  await expect(pick.locator('option')).not.toHaveCount(0);
  await pick.selectOption({ label: 'Arrow right' });
  await drag(page, [100, 50], [300, 150]);
  const use = last(page);
  expect(await use.evaluate((el) => el.localName)).toBe('use');
  expect(await use.getAttribute('data-name')).toBe('Arrow right');
  // Fitted in 200 × 100 and centred: as tall as the box.
  const b = await box(page);
  expect(b.h).toBeCloseTo(100, 0);
  expect(b.x + b.w / 2).toBeCloseTo(200, 0);
  expect(await tool(page)).toBe('custom');
});

test('a click without dragging asks for an exact size', async ({ page }) => {
  await page.click('[data-tab="props"]');
  await page.selectOption('#sc-units', 'mm');
  await page.keyboard.press('u');
  const at = await toScreen(page, 50, 40);
  await page.mouse.click(at.x, at.y);
  const dlg = page.locator('#sc-createshape');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#sc-cs-shape-title')).toHaveText('Create Rectangle');
  await expect(dlg.locator('[data-doc-unit]').first()).toHaveText('mm');
  await page.fill('[data-cs-shape="w"]', '20');
  await page.fill('[data-cs-shape="h"]', '10');
  await page.keyboard.press('Enter');
  const b = await box(page);
  expect([b.x, b.y]).toEqual([50, 40]);
  expect(b.w).toBeCloseTo((20 * 96) / 25.4, 1);
  expect(b.h).toBeCloseTo((10 * 96) / 25.4, 1);
  // A polygon from its centre, with its own sides.
  await page.keyboard.press('Shift+u');
  await page.keyboard.press('Shift+u');
  await page.keyboard.press('Shift+u');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#sc-cs-shape-title')).toHaveText('Create Polygon');
  await expect(dlg.locator('[data-cs-for="polygon"]')).toBeVisible();
  await expect(dlg.locator('[data-cs-for="rect"]')).toBeHidden();
  await page.fill('[data-cs-shape="sides"]', '8');
  await dlg.locator('[data-cs-shape="centre"]').check();
  await page.click('[data-cs-shape-btn="ok"]');
  expect(await last(page).evaluate((el) => el.points.length)).toBe(8);
  const p = await box(page);
  expect(p.x + p.w / 2).toBeCloseTo(50, 1);
  expect(p.y + p.h / 2).toBeCloseTo(40, 1);
  // Cancel draws nothing.
  const n = await page.locator('#sc-doc > *').count();
  await page.mouse.click(at.x, at.y);
  await page.click('[data-cs-shape-btn="cancel"]');
  await expect(page.locator('#sc-doc > *')).toHaveCount(n);
});

test('Photoshop’s keys: P B, D, Ctrl+D, Ctrl+J, brackets, rulers, guides, grid, Tab', async ({
  page,
}) => {
  await load(
    page,
    '<rect id="a" width="40" height="40"/><rect id="b" x="50" width="40" height="40"/>',
  );
  const s = () => page.evaluate(() => window.svgcraft.state);
  await page.keyboard.press('p');
  expect(await tool(page)).toBe('pen');
  await page.keyboard.press('b');
  expect(await tool(page)).toBe('pencil');
  // D: black fill, white stroke.
  await page.keyboard.press('d');
  expect(
    await page.evaluate(() => [window.svgcraft.state.fill, window.svgcraft.state.stroke]),
  ).toEqual(['#000000', '#ffffff']);
  // Ctrl+J duplicates, Ctrl+D deselects.
  await page.keyboard.press('v');
  await page.evaluate(() => (window.svgcraft.state.sel = [document.getElementById('a')]));
  await page.keyboard.press('Control+j');
  await expect(page.locator('#sc-doc > rect')).toHaveCount(3);
  await page.keyboard.press('Control+d');
  expect((await s()).sel).toEqual([]);
  // Ctrl+] / [ one step, Ctrl+Shift+] / [ all the way.
  const order = () =>
    page.evaluate(() => [...document.querySelectorAll('#sc-doc > rect')].map((r) => r.id));
  await page.evaluate(() => (window.svgcraft.state.sel = [document.getElementById('a')]));
  await page.keyboard.press('Control+Shift+BracketRight');
  expect((await order()).at(-1)).toBe('a');
  await page.keyboard.press('Control+BracketLeft');
  expect((await order()).at(-2)).toBe('a');
  await page.keyboard.press('Control+Shift+BracketLeft');
  expect((await order())[0]).toBe('a');
  await page.keyboard.press('Control+BracketRight');
  expect((await order())[1]).toBe('a');
  // [ and ]: the stroke width.
  const w0 = (await s()).strokeWidth;
  await page.keyboard.press('BracketRight');
  expect((await s()).strokeWidth).toBe(w0 + 1);
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  expect((await s()).strokeWidth).toBe(w0 - 1);
  // Rulers, guides, grid, snap.
  const r0 = (await s()).rulers;
  await page.keyboard.press('Control+r');
  expect((await s()).rulers).toBe(!r0);
  const g0 = (await s()).guidesOn;
  await page.keyboard.press('Control+Semicolon');
  expect((await s()).guidesOn).toBe(!g0);
  await page.keyboard.press('Control+Quote');
  expect((await s()).grid).toBe(true);
  await page.keyboard.press('Control+Shift+Semicolon');
  expect((await s()).snap).toBe(true);
  // Image and Canvas Size.
  await page.keyboard.press('Control+Alt+i');
  await expect(page.locator('#sc-imagesize')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+c');
  await expect(page.locator('#sc-canvassize')).toBeVisible();
  await page.keyboard.press('Escape');
  // Tab hides the panels, Shift+Tab just the right-hand ones.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  await expect(page.locator('#sc-panel')).toBeHidden();
  await expect(page.locator('.sc-tools')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('.sc-tools')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#sc-panel')).toBeHidden();
  await expect(page.locator('.sc-tools')).toBeVisible();
  await menu(page, 'View', 'togglePanels');
  await expect(page.locator('#sc-panel')).toBeVisible();
});

test('tips end with the shortcut, as the menus show it', async ({ page }) => {
  const title = async (sel) => {
    await page.mouse.move(700, 450);
    await page.waitForTimeout(100);
    await page.hover(sel);
    const t = page.locator('.sc-tip');
    await expect(t).toBeVisible();
    return (await t.locator('b').count()) ? t.locator('b').textContent() : t.textContent();
  };
  expect(await title('[data-tool="select"]')).toBe('Move (V)');
  expect(await title('[data-tool="pencil"]')).toBe('Pencil (B)');
  expect(await title('#sc-shape-btn')).toBe('Rectangle (U)');
  expect(await title('#sc-redo')).toBe('Redo (Ctrl+Shift+Z)');
  expect(await title('.sc-tb-swap')).toBe('Swap fill and stroke (X)');
  // Tips with no shortcut are as they were.
  expect(await title('#sc-theme-btn')).toBe('Switch to light');
});
