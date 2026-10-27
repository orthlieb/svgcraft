// The shared [data-tip] tooltip: show delay, placement, top layer, auto-hide,
// sweeping, hiding on leave / press, edge clamping, dialogs and keyboard focus.
// The app uses real timers (450 ms show delay, 3 s life), so some waits are fixed.
import { test, expect } from './fixtures.js';

const VW = 1400;
const PEN_TIP = 'Pen (P)Click for corners, drag for curves. Click the first point to close.';

// The tip's state right now (no auto-waiting, for timing-sensitive checks).
const tipState = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('.sc-tip');
    const r = t.getBoundingClientRect();
    return {
      open: t.matches(':popover-open'),
      popover: t.popover,
      hidden: t.hidden,
      text: t.textContent,
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
    };
  });

// Hover el and wait out the show delay.
async function hoverAndWait(page, locator) {
  await locator.hover();
  await expect.poll(async () => (await tipState(page)).hidden).toBe(false);
}

test('a tool tip waits for the delay, then shows beside the tool in the top layer', async ({
  page,
}) => {
  const pen = page.locator('[data-tool="pen"]');
  await pen.hover();
  await page.waitForTimeout(150);
  expect((await tipState(page)).hidden).toBe(true);

  await page.waitForTimeout(500);
  const s = await tipState(page);
  const pr = await pen.boundingBox();
  expect(s.hidden).toBe(false);
  expect(s.text).toBe(PEN_TIP);
  // The shortcut ends the title, in parentheses.
  await expect(page.locator('.sc-tip b')).toHaveText('Pen (P)');
  // Right of the tool, vertically centred on it.
  expect(s.x).toBeGreaterThan(pr.x + pr.width);
  expect(Math.abs(s.y + s.h / 2 - (pr.y + pr.height / 2))).toBeLessThan(2);
  // In the top layer: a manual popover that is open.
  expect(s.popover).toBe('manual');
  expect(s.open).toBe(true);
});

test('the tip hides itself after ~3 s and stays hidden while hovering on', async ({ page }) => {
  const pen = page.locator('[data-tool="pen"]');
  await hoverAndWait(page, pen);
  await page.waitForTimeout(3000);
  const s = await tipState(page);
  expect(s.hidden).toBe(true);
  expect(s.open).toBe(false);

  const pr = await pen.boundingBox();
  await page.mouse.move(pr.x + 5, pr.y + 5);
  await page.waitForTimeout(100);
  expect((await tipState(page)).hidden).toBe(true);
});

test('sweeping to the next tool shows its tip straight away; leaving hides it', async ({
  page,
}) => {
  await hoverAndWait(page, page.locator('[data-tool="eraser"]'));
  await page.locator('[data-tool="gradient"]').hover();
  await page.waitForTimeout(60);
  expect((await tipState(page)).text).toBe(
    'Gradient (G)Drag across a shape to lay a linear or radial gradient.',
  );
  await page.mouse.move(700, 450);
  await page.waitForTimeout(60);
  expect((await tipState(page)).hidden).toBe(true);
});

test('pressing the mouse hides the tip', async ({ page }) => {
  await hoverAndWait(page, page.locator('#sc-shape-btn'));
  await page.mouse.down();
  await page.mouse.up();
  expect((await tipState(page)).hidden).toBe(true);
});

test('an options-bar tip near the top shows below, inside the viewport', async ({ page }) => {
  await hoverAndWait(page, page.locator('[data-action="undo"]').last());
  const s = await tipState(page);
  expect(s.text).toBe('Undo (Ctrl+Z)');
  expect(s.y).toBeGreaterThanOrEqual(0);
  expect(s.open).toBe(true);
});

test('a tip at the right edge is clamped into the viewport', async ({ page }) => {
  await hoverAndWait(page, page.locator('.sc-menubar-end [data-tip]').last());
  const s = await tipState(page);
  expect(s.text).toBe('Download SVG (Ctrl+S)');
  expect(s.x + s.w).toBeLessThanOrEqual(VW - 4);
});

test('a tip shows in the top layer above an open modal dialog', async ({ page }) => {
  // The app has no native <dialog> with tips, so open a test one with a
  // [data-tip] button; the tip handlers are delegated from document.
  await page.evaluate(() => {
    const d = document.createElement('dialog');
    d.innerHTML = '<button data-tip="Dialog tip">Hover me</button>';
    document.body.append(d);
    d.showModal();
  });
  await hoverAndWait(page, page.locator('dialog[open] [data-tip]'));
  const s = await tipState(page);
  expect(s.text).toBe('Dialog tip');
  expect(s.open).toBe(true);
  await page.evaluate(() => document.querySelector('dialog[open]').close());
});

test('keyboard focus shows the tip', async ({ page }) => {
  await page.mouse.move(700, 450);
  await page.locator('[data-tool="gradient"]').focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(50);
  const s = await tipState(page);
  expect(s.text).toBe(PEN_TIP);
  expect(s.open).toBe(true);
});
