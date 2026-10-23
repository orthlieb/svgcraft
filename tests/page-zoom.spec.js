import { test, expect, load } from './fixtures.js';

// The page itself never zooms: the browser's zoom keys zoom the canvas
// instead, and Ctrl/⌘ + wheel or a pinch over the panels does nothing.

const zoom = (page) => page.evaluate(() => window.svgcraft.state.zoom);
// Dispatch an event and report whether the page stopped the browser's default.
const blocked = (page, type, init, target = 'body') =>
  page.evaluate(
    ([type, init, target]) => {
      const Ctor = type === 'wheel' ? WheelEvent : type === 'keydown' ? KeyboardEvent : Event;
      const e = new Ctor(type, { bubbles: true, cancelable: true, ...init });
      document.querySelector(target).dispatchEvent(e);
      return e.defaultPrevented;
    },
    [type, init, target],
  );

test.beforeEach(async ({ page }) => {
  await load(page, '<rect x="100" y="100" width="50" height="50"/>', 800, 600);
});

test('the browser’s zoom keys zoom the canvas, even from a field', async ({ page }) => {
  const z0 = await zoom(page);
  await page.keyboard.press('Control+Equal');
  expect(await zoom(page)).toBeCloseTo(z0 * 1.25, 5);
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Minus');
  expect(await zoom(page)).toBeCloseTo(z0 / 1.25, 5);
  await page.keyboard.press('Control+Digit0');
  expect(await zoom(page)).toBeCloseTo(z0, 5);
  for (const code of ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'])
    for (const mod of ['ctrlKey', 'metaKey'])
      expect(await blocked(page, 'keydown', { code, [mod]: true }), `${mod} ${code}`).toBe(true);
  // From a text field too; other Ctrl keys are left alone.
  expect(await blocked(page, 'keydown', { code: 'Equal', ctrlKey: true }, '#sc-zoom-input')).toBe(
    true,
  );
  expect(await blocked(page, 'keydown', { code: 'KeyC', ctrlKey: true }, '#sc-zoom-input')).toBe(
    false,
  );
});

test('Ctrl/⌘ + wheel and pinches don’t zoom the page', async ({ page }) => {
  for (const mod of ['ctrlKey', 'metaKey'])
    expect(await blocked(page, 'wheel', { deltaY: -100, [mod]: true }, '.sc-panel')).toBe(true);
  // A plain wheel still scrolls the panels.
  expect(await blocked(page, 'wheel', { deltaY: 100 }, '.sc-panel')).toBe(false);
  // Safari's trackpad pinch.
  for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
    expect(await blocked(page, t, {}, '.sc-panel')).toBe(true);
  // Touch pinches: the viewport can't scale, and touch-action rules it out.
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain(
    'user-scalable=no',
  );
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe(
    'pan-x pan-y',
  );
});
