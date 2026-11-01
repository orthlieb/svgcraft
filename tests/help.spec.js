// Help: help.html is built from the README (scripts/gen-help.mjs) and must
// match it; every ? in the editor opens a topic that exists.
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, menu, load, tab } from './fixtures.js';

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
    'on-a-phone',
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
  await page.click('.sc-menu-btn:text-is("File")');
  await page.click('.sc-menu-list:not([hidden]) [data-action="imageSize"]');
  await expect(page.locator('#sc-imagesize')).toBeVisible();
  await page.keyboard.press('F1');
  await page.click('#sc-imagesize .sc-help-btn');
  await page.keyboard.press('Escape');
  await tab(page, 'gradients');
  await page.locator('[data-tab="gradients"]').locator('xpath=..').locator('.sc-help-btn').click();
  expect(await opened(page)).toEqual([
    ['help.html', 'svgcraft-help'],
    ['help.html#scale-document', 'svgcraft-help'],
    ['help.html#scale-document', 'svgcraft-help'],
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

test('every topic opens with its screenshot, and every screenshot is used', async () => {
  // Topics are the README's ### headings; each starts with an image of what
  // it's about (taken by scripts/gen-help-screens.mjs).
  const topics = [...HELP.matchAll(/<article id="([^"]+)"[^>]*>\s*<h3>[\s\S]*?<\/h3>\s*(<\w+)/g)];
  expect(topics.length).toBeGreaterThan(40);
  const bare = topics.filter(([, , first]) => first !== '<figure').map(([, id]) => id);
  expect(bare, 'topics without a screenshot first').toEqual([]);
  // Sections with no topics open with one too.
  const sections = [
    ...HELP.matchAll(/<section id="([^"]+)">\s*<h2>[\s\S]*?<\/h2>\s*([\s\S]*?)<\/section>/g),
  ];
  for (const [, id, inner] of sections)
    if (!inner.includes('<article'))
      expect(inner, `#${id}`).toMatch(/^<div class="intro" data-find>\s*<figure>/);
  // Every image is in the repo, and every file in docs/help is used.
  const used = new Set([...HELP.matchAll(/<img\s+src="([^"]+)"/g)].map((m) => m[1]));
  for (const src of used) expect(fs.existsSync(path.join(ROOT, src)), src).toBe(true);
  const files = fs.readdirSync(path.join(ROOT, 'docs/help')).map((f) => `docs/help/${f}`);
  expect(
    files.filter((f) => !used.has(f)),
    'unused screenshots',
  ).toEqual([]);
});
