// SVGCraft as an app: the manifest, and the service worker that keeps it
// working offline. Service workers need a web origin, not file://, so these
// tests serve the folder over HTTP.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const test = base.extend({
  // A static server for the repo, on a free port, for each test.
  // eslint-disable-next-line no-empty-pattern
  origin: async ({}, use) => {
    const server = http.createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        const index = path.join(file, 'index.html');
        if (fs.existsSync(index)) return res.end(fs.readFileSync(index));
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${server.address().port}`);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  },
});

test('the manifest names the app and its icons, which exist', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  expect(m).toMatchObject({ name: 'SVGCraft', display: 'standalone', start_url: './' });
  const sizes = m.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect(fs.existsSync(path.join(root, i.src)), i.src).toBe(true);
  expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toContain(
    '<link rel="manifest" href="manifest.webmanifest" />',
  );
});

test('once opened, SVGCraft loads offline', async ({ page, context, origin }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${origin}/index.html`);
  await page.evaluate(() => window.svgcraft.ready);
  // The worker installs, keeping what index.html loads, then takes over.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  // Every script ran: the editor is all there, and edits work.
  await expect(page.locator('.sc-menu-btn')).toHaveCount(10);
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="r" width="5" height="5"/></svg>',
      'offline.svg',
    ),
  );
  await expect(page.locator('#sc-doc #r')).toHaveCount(1);
  await context.setOffline(false);
});

test('opened from disk, no service worker is registered', async ({ page }) => {
  await page.goto(`file://${path.join(root, 'index.html')}`);
  await page.evaluate(() => window.svgcraft.ready);
  expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
});
