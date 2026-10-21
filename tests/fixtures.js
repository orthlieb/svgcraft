// Shared fixtures: every test gets `page` with Svgcraft loaded from disk and
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
    await page.goto(APP_URL);
    await page.waitForFunction(() => !!window.svgcraft);
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
  }, ids);
}

// Run a data-action, as a menu or options-bar click would.
export async function action(page, name) {
  await page.evaluate((name) => {
    const b = [...document.querySelectorAll(`[data-action="${name}"]`)][0];
    b.click();
  }, name);
}

// Open a top-level menu by its label and click one of its items.
export async function menu(page, label, act) {
  await page.click(`.sc-menu-btn:text-is("${label}")`);
  await page.click(`.sc-menu-list:not([hidden]) [data-action="${act}"]`);
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
