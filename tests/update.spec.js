// Updates: a copy of SVGCraft served over the web compares its version with
// the server's and offers to update when there's a newer one; Help → Check
// for Updates… asks at once. (The app is served from a little local
// server, which can pretend a new version has been published.)
import { test, expect, menu, load } from './fixtures.js';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};
let server;
let origin;
let published = null; // the version.js the server gives, once "updated"
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (name === '/src/version.js' && published) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(published);
    }
    const file = path.join(ROOT, name);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server.close());
test.beforeEach(() => (published = null));

const served = async (page) => {
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
};
const publish = (v) => (published = `'use strict';\n\nconst APP_VERSION = '${v}';\n`);
// eslint-disable-next-line no-undef -- the editor's own global
const check = (page) => page.evaluate(() => checkForUpdate());
const bar = (page) => page.locator('#sc-update');

test('src/version.js is up to date with the app’s files', () => {
  // Fails after a change to the app until node scripts/gen-version.mjs is run.
  expect(() =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-version.mjs'), '--check'], {
      stdio: 'pipe',
    }),
  ).not.toThrow();
});

test('the same version: nothing is offered, and Check for Updates says so', async ({ page }) => {
  await served(page);
  await check(page);
  await expect(bar(page)).toBeHidden();
  await menu(page, 'Help', 'checkUpdates');
  await expect(page.locator('#sc-msg')).toContainText('SVGCraft is up to date (version ');
});

test('a newer version is offered; Later puts it off, Update reloads keeping the drawing', async ({
  page,
}) => {
  await served(page);
  await load(page, '<rect id="r" width="40" height="40" fill="#123456"/>');
  publish('0123456789ab');
  await check(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText('A new version of SVGCraft is available');
  // Later: not offered again by itself, but asking still shows it.
  await page.click('#sc-update-later');
  await expect(bar(page)).toBeHidden();
  await check(page);
  await expect(bar(page)).toBeHidden();
  await menu(page, 'Help', 'checkUpdates');
  await expect(bar(page)).toBeVisible();
  // Update reloads: the page now runs the new version, with the drawing.
  await Promise.all([page.waitForEvent('load'), page.click('#sc-update-now')]);
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  // eslint-disable-next-line no-undef -- the editor's own global
  expect(await page.evaluate(() => APP_VERSION)).toBe('0123456789ab');
  await expect(page.locator('#sc-doc rect[fill="#123456"]')).toHaveCount(1);
  await expect(bar(page)).toBeHidden();
});

test('offline, nothing is offered and Check for Updates says why', async ({ page }) => {
  await served(page);
  publish('0123456789ab');
  await page.context().setOffline(true);
  await check(page);
  await expect(bar(page)).toBeHidden();
  await menu(page, 'Help', 'checkUpdates');
  await expect(page.locator('#sc-alert-text')).toContainText('can’t reach the internet');
  // Back online, it looks again at once.
  await page.context().setOffline(false);
  await expect(bar(page)).toBeVisible();
});

test('a copy opened from a file doesn’t look for updates', async ({ page }) => {
  // The fixture's page is index.html from disk.
  await menu(page, 'Help', 'checkUpdates');
  await expect(page.locator('#sc-alert-text')).toContainText('opened from a file');
  await expect(bar(page)).toBeHidden();
});
