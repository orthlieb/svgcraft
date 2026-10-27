import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { test, expect, menu } from './fixtures.js';

// Help → About: the About page opens in its own tab, and the page itself
// loads its screenshots and fits a phone.

const ABOUT_URL = pathToFileURL(path.resolve(import.meta.dirname, '..', 'about.html')).href;

// Record window.open calls instead of opening tabs.
const stubOpen = (page) =>
  page.evaluate(() => {
    window.__opened = [];
    window.open = (url, target) => window.__opened.push([url, target]);
  });
const opened = (page) => page.evaluate(() => window.__opened);

test('the Help menu opens the About page, its features and shortcuts', async ({ page }) => {
  await stubOpen(page);
  await menu(page, 'Help', 'about');
  await menu(page, 'Help', 'aboutFeatures');
  await menu(page, 'Help', 'aboutShortcuts');
  expect(await opened(page)).toEqual([
    ['about.html', 'svgcraft-about'],
    ['about.html#features', 'svgcraft-about'],
    ['about.html#shortcuts', 'svgcraft-about'],
  ]);
});

test.describe('phone preview', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('reaches About through Info, and still fits', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await stubOpen(page);
    await page.click('.sc-menubar-end [data-action="phoneInfo"]');
    await page.click('#sc-pinfo-about');
    expect(await opened(page)).toEqual([['about.html', 'svgcraft-about']]);
    await expect(page.locator('#sc-pinfo')).toBeHidden();
  });
});

for (const [width, scheme] of [
  [1280, 'dark'],
  [390, 'light'],
]) {
  test(`the About page loads its screenshots at ${width}px (${scheme})`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(ABOUT_URL);
    await expect(page.locator('h1')).toContainText('SVG editor');
    for (const id of ['features', 'shortcuts', 'credits'])
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.locator('a[href="index.html"]').first()).toBeVisible();
    const imgs = await page.evaluate(async () =>
      Promise.all(
        [...document.images].map(async (img) => {
          img.loading = 'eager';
          await img.decode().catch(() => {});
          return [img.getAttribute('src'), img.naturalWidth, img.alt.length > 0];
        }),
      ),
    );
    expect(imgs.length).toBeGreaterThanOrEqual(8);
    for (const [src, w, hasAlt] of imgs) {
      expect(w, src).toBeGreaterThan(0);
      if (src.startsWith('about/')) expect(hasAlt, src).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(errors).toEqual([]);
    await page.close();
  });
}
