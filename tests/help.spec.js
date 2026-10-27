// Help: help.html is built from the README (scripts/gen-help.mjs) and must
// match it; every ? in the editor opens a topic that exists.
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, menu, load } from './fixtures.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const HELP = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8');
const ids = new Set([...HELP.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const stubOpen = (page) =>
  page.evaluate(() => {
    window.__opened = [];
    window.open = (url, target) => window.__opened.push([url, target]);
  });
const opened = (page) => page.evaluate(() => window.__opened);

test('help.html is up to date with the README', () => {
  // Fails after a README edit until node scripts/gen-help.mjs is run.
  expect(() =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-help.mjs'), '--check'], {
      stdio: 'pipe',
    }),
  ).not.toThrow();
});

test('every ? in the editor points at a help topic that exists', async ({ page }) => {
  const topics = await page.evaluate(() => [
    ...[...document.querySelectorAll('dialog[data-help]')].map((d) => d.dataset.help),
    ...Object.values(TAB_HELP), // eslint-disable-line no-undef
    'layers',
    'workspace',
  ]);
  expect(topics.length).toBeGreaterThan(20);
  for (const t of topics) expect(ids, `#${t}`).toContain(t);
  // Every dialog with a title bar has its ?, bar the plain prompts.
  const missing = await page.$$eval('dialog', (ds) =>
    ds.filter((d) => d.querySelector('.sc-dialog-title') && !d.dataset.help).map((d) => d.id),
  );
  expect(missing.sort()).toEqual(['sc-ask', 'sc-peek', 'sc-pinfo']);
});

test('Help → SVGCraft Help, F1 in a dialog, and a panel’s ? open the right topic', async ({
  page,
}) => {
  await stubOpen(page);
  await menu(page, 'Help', 'help');
  await load(page, '<rect id="r" width="10" height="10"/>');
  await page.click('.sc-menu-btn:text-is("Image")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="imageSize"]');
  await expect(page.locator('#sc-imagesize')).toBeVisible();
  await page.keyboard.press('F1');
  await page.click('#sc-imagesize .sc-help-btn');
  await page.keyboard.press('Escape');
  await page.click('[data-tab="gradients"]');
  await page.locator('[data-tab="gradients"]').locator('xpath=..').locator('.sc-help-btn').click();
  expect(await opened(page)).toEqual([
    ['help.html', 'svgcraft-help'],
    ['help.html#image-size', 'svgcraft-help'],
    ['help.html#image-size', 'svgcraft-help'],
    ['help.html#gradients', 'svgcraft-help'],
  ]);
});

test('the help page loads, searches, and lights up a linked topic', async ({ page }) => {
  await page.goto(`${pathToFileURL(path.join(ROOT, 'help.html')).href}#gradients`);
  await expect(page.locator('#gradients')).toHaveClass(/flash/);
  await expect(page.locator('nav a[href="#image-trace"]')).toBeVisible();
  await page.fill('#find', 'keylines');
  await expect(page.locator('#count')).toHaveText(/match/);
  await expect(page.locator('#view-icon-keylines')).toBeVisible();
  await expect(page.locator('#gradients')).toBeHidden();
  await page.fill('#find', '');
  await expect(page.locator('#gradients')).toBeVisible();
});
