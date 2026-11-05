// The animation check (diagnostics.html): run in a browser that plays SVG
// animation, it finds the tiny animation and the About page's file playing.
import { test, expect } from './fixtures.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Served over http: a file:// page can't look inside its <object>.
let server;
let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const type = f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.html') ? 'text/html' : '';
    res.writeHead(200, type ? { 'content-type': type } : {}).end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.afterAll(() => server.close());

test('the animation check reports the About animation playing', async ({ browser }) => {
  test.setTimeout(60000);
  const page = await browser.newPage();
  await page.goto(`${base}/diagnostics.html`);
  const report = page.locator('#report');
  await expect(report).not.toHaveText(/^Running/, { timeout: 30000 });
  const text = await report.textContent();
  expect(text).toContain('Tiny inline animation: clock running');
  expect(text).toMatch(/File: about\/animated\.svg/);
  expect(text).toMatch(/Summary: Everything that has started plays/);
  expect(text).not.toMatch(/started, NO change/);
  await page.close();
});

test('the animation check takes another file, and only one on the site', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(`${base}/diagnostics.html?svg=docs/help/morph-live.svg`);
  await expect(page.locator('#file')).toHaveText('docs/help/morph-live.svg');
  await page.goto(`${base}/diagnostics.html?svg=https://example.com/x.svg`);
  await expect(page.locator('#file')).toHaveText('about/animated.svg');
  await page.close();
});
