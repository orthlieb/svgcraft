// File → Save writes back to the file the drawing came from; Save As…
// picks a new one; the link survives a reload. (The browser's file pickers
// are stood in for by files in the page's private file system, which are
// real, writable files.)
import { test, expect, menu } from './fixtures.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// The private file system needs a web origin, not a file on disk: serve the
// app from a little local server for these tests.
const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};
let server;
let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
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
const served = async (page) => {
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
};
test.beforeEach(async ({ page }) => served(page));

const pickers = (page) =>
  page.evaluate(() => {
    window.__picks = { open: 0, save: 0 };
    window.showOpenFilePicker = async () => {
      window.__picks.open++;
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle(window.__openName)];
    };
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.__picks.save++;
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(window.__saveName || suggestedName, { create: true });
    };
  });
const writeFile = (page, name, text) =>
  page.evaluate(
    async ([name, text]) => {
      const root = await navigator.storage.getDirectory();
      const w = await (await root.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    [name, text],
  );
// Reading while a save is still writing the file can fail (NotReadableError);
// that reads as empty, so expect.poll tries again.
const readFile = (page, name) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    try {
      return await (await (await root.getFileHandle(name)).getFile()).text();
    } catch (e) {
      if (e.name === 'NotReadableError') return '';
      throw e;
    }
  }, name);
const picks = (page) => page.evaluate(() => window.__picks);
const tab = (page) => page.locator('.sc-doctab[aria-selected="true"] .sc-doctab-name');
const recolour = (page, fill) =>
  page.evaluate((fill) => {
    document.querySelector('#sc-doc rect').setAttribute('fill', fill);
    window.svgcraft.commit();
  }, fill);
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="50" height="50" fill="#ff0000"/></svg>';

test('Open, edit, Save: the same file is written; the * goes', async ({ page }) => {
  await pickers(page);
  await writeFile(page, 'logo.svg', LOGO);
  await page.evaluate(() => (window.__openName = 'logo.svg'));
  await page.keyboard.press('Control+o');
  await expect(tab(page)).toHaveText(/^logo\.svg /);
  await recolour(page, '#0000ff');
  await expect(tab(page)).toHaveText(/^logo\.svg\* /);
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(page, 'logo.svg')).toContain('#0000ff');
  await expect(tab(page)).toHaveText(/^logo\.svg /);
  await expect(page.locator('#sc-msg')).toHaveText('Saved logo.svg');
  expect((await picks(page)).save).toBe(0);
});

test('a new drawing asks where once, then saves there', async ({ page }) => {
  await pickers(page);
  await page.evaluate(() => {
    window.__saveName = 'sketch.svg';
    const s = window.svgcraft;
    s.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="9" height="9"/></svg>',
      'Untitled-1.svg',
    );
  });
  await menu(page, 'File', 'save');
  await expect.poll(() => picks(page)).toEqual({ open: 0, save: 1 });
  await expect.poll(() => readFile(page, 'sketch.svg')).toContain('<rect');
  await expect(tab(page)).toHaveText(/^sketch\.svg /);
  await recolour(page, '#00ff00');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(page, 'sketch.svg')).toContain('#00ff00');
  expect((await picks(page)).save).toBe(1);
});

test('Save As… writes a new file and saves there from then on', async ({ page }) => {
  await pickers(page);
  await writeFile(page, 'logo.svg', LOGO);
  await page.evaluate(() => (window.__openName = 'logo.svg'));
  await menu(page, 'File', 'open');
  await expect(tab(page)).toHaveText(/^logo\.svg /);
  await recolour(page, '#123456');
  await page.evaluate(() => (window.__saveName = 'logo-copy.svg'));
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => readFile(page, 'logo-copy.svg')).toContain('#123456');
  await expect(tab(page)).toHaveText(/^logo-copy\.svg /);
  await recolour(page, '#654321');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(page, 'logo-copy.svg')).toContain('#654321');
  // The original is as it was.
  expect(await readFile(page, 'logo.svg')).toBe(LOGO);
});

test('after a reload, Save still goes back to the file', async ({ page }) => {
  await pickers(page);
  await writeFile(page, 'logo.svg', LOGO);
  await page.evaluate(() => (window.__openName = 'logo.svg'));
  await page.keyboard.press('Control+o');
  await expect(tab(page)).toHaveText(/^logo\.svg /);
  await page.waitForTimeout(600); // kept in this browser
  await served(page);
  await pickers(page);
  await expect(tab(page)).toHaveText(/^logo\.svg /);
  await recolour(page, '#abcdef');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(page, 'logo.svg')).toContain('#abcdef');
  expect((await picks(page)).save).toBe(0);
});

test.describe('a browser that can’t write files', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const k of ['showSaveFilePicker', 'showOpenFilePicker']) {
        delete Window.prototype[k];
        delete window[k];
      }
    });
    await served(page);
  });
  test('Save downloads the SVG, and the menu says so', async ({ page }) => {
    await page.evaluate(() =>
      window.svgcraft.openSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>',
        'dot.svg',
      ),
    );
    await page.click('.sc-menu-btn:text-is("File")');
    await expect(page.locator('.sc-menu-list:not([hidden]) [data-action="save"] span')).toHaveText(
      'Download SVG',
    );
    await expect(page.locator('.sc-menu-list:not([hidden]) [data-action="saveAs"]')).toBeHidden();
    // (Nor is Install shown where the browser hasn't offered installing.)
    await expect(
      page.locator('.sc-menu-list:not([hidden]) [data-action="installApp"]'),
    ).toBeHidden();
    await page.keyboard.press('Escape');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+s'),
    ]);
    expect(dl.suggestedFilename()).toBe('dot.svg');
  });
});
