// Shared fixtures: every test gets `page` with SVGCraft loaded from disk and
// fails if the page logs an uncaught error or a console error.
import { test as base, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const APP_URL = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;

export const test = base.extend({
  // Playwright fixtures must destructure their dependencies, even none.
  // eslint-disable-next-line no-empty-pattern
  errors: async ({}, use) => use([]),
  page: async ({ page, errors }, use) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      // Web fonts can't load offline; that's not an app error.
      if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|net::ERR_/.test(m.text()))
        errors.push(`console: ${m.text()}`);
    });
    // Each test gets a fresh browser context, so storage starts empty.
    // Web fonts load from Google on CI but not offline, and a font arriving
    // mid-test re-wraps paragraph text. Block them so every run lays text out
    // with the same fallback fonts; tests check what the app writes instead.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(APP_URL);
    await page.waitForFunction(() => !!window.svgcraft);
    // Drawings kept in the browser are read back asynchronously.
    await page.evaluate(() => window.svgcraft.ready);
    await use(page);
    expect(errors, 'page errors').toEqual([]);
  },
});
export { expect };

// Replace the document with an SVG body in a viewBox of w × h.
export async function load(page, body, w = 800, h = 600, name = 'test.svg') {
  await page.evaluate(
    ([body, w, h, name]) =>
      window.svgcraft.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`,
        name,
      ),
    [body, w, h, name],
  );
}

// Select elements by id with the Move tool, reading their style into the panels.
export async function select(page, ...ids) {
  await page.evaluate((ids) => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = ids.map((id) => document.getElementById(id));
    if (s.state.sel[0]) s.readStyle(s.state.sel[0]);
    s.syncActions();
  }, ids);
}

// Run a command as its shortcut would, even where its menu item is greyed
// out (so a test can check the command's own refusal).
export async function action(page, name) {
  await page.evaluate((name) => {
    if (!document.querySelector(`[data-action="${name}"]`)) throw new Error(`no ${name}`);
    window.svgcraft.actions[name]();
  }, name);
}

// Open a top-level menu by its label and click one of its items.
export async function menu(page, label, act) {
  await page.click(`.sc-menu-btn:text-is("${label}")`);
  await page.click(`.sc-menu-list:not([hidden]) [data-action="${act}"]`);
}

// Open a top-level menu, check one of its items is greyed out, and close it.
export async function menuOff(page, label, act) {
  await page.click(`.sc-menu-btn:text-is("${label}")`);
  await expect(page.locator(`.sc-menu-list:not([hidden]) [data-action="${act}"]`)).toBeDisabled();
  await page.keyboard.press('Escape');
}

// The stage's bounding box in page pixels.
export const stageBox = (page) => page.locator('#sc-stage').boundingBox();

// Page-pixel position of a document point under the current zoom / pan.
export async function toScreen(page, x, y) {
  return page.evaluate(
    ([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(
        document.getElementById('sc-doc').getScreenCTM(),
      );
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
}

// Pick Edit Points' selection shape from its toolbar flyout.
export async function pickMarquee(page, shape) {
  await page.click('#sc-node-btn', { button: 'right' });
  await page.click(`#sc-node-menu [data-marquee="${shape}"]`);
}

// The libraries (Swatches, Gradients, Patterns, Symbols) are tabs of the
// Libraries window; the rest are panel tabs. Going to a panel tab puts the
// window away, as it floats over the canvas.
export const LIB_TABS = ['swatches', 'gradients', 'patterns', 'symbols'];
export async function tab(page, name) {
  if (LIB_TABS.includes(name)) {
    if (await page.locator('#sc-libraries').isHidden()) {
      await menu(page, 'Window', 'toggleLibraries');
      await parkLibraries(page);
    }
    return page.click(`#sc-libraries [data-tab="${name}"]`);
  }
  await closeLibraries(page);
  return page.click(`[data-tab="${name}"]`);
}
export async function closeLibraries(page) {
  if (await page.locator('#sc-libraries').isVisible()) await page.click('#sc-lib-close');
}
// Out of the way of the canvas and the toolbars: bottom right, over the
// lower panels.
export const parkLibraries = (page) =>
  page.evaluate(() => {
    const w = document.getElementById('sc-libraries');
    w.style.left = `${innerWidth - w.offsetWidth - 4}px`;
    w.style.top = `${innerHeight - w.offsetHeight - 24}px`;
  });
