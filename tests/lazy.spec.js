// Features loaded when first used: none of them at startup, each one on its
// first use (and listed for the offline cache).
import { test, expect, load, menu } from './fixtures.js';

const LAZY = ['symbols-library.js', 'src/trace.js', 'src/source.js', 'src/app-icons.js'];
const loaded = (page) => page.$$eval('script[src]', (ss) => ss.map((s) => s.getAttribute('src')));

test('the startup download leaves them out; they’re prefetched for later', async ({ page }) => {
  const scripts = await loaded(page);
  for (const f of LAZY) {
    if (f === 'symbols-library.js') continue; // a fresh library fetches it straight away
    expect(scripts).not.toContain(f);
  }
  const prefetch = await page.$$eval('link[rel="prefetch"]', (ls) =>
    ls.map((l) => l.getAttribute('href')),
  );
  expect(prefetch.sort()).toEqual([...LAZY].sort());
});

test('each opens on first use', async ({ page }) => {
  await load(page, '<rect id="r" width="50" height="50" fill="#2563eb"/>');
  await menu(page, 'Window', 'toggleSource');
  await expect(page.locator('#sc-source')).toBeVisible();
  await expect(page.locator('#sc-src-code')).toContainText('<rect');
  await page.keyboard.press('Control+u');
  await expect(page.locator('#sc-source')).toBeHidden();

  await menu(page, 'File', 'exportAppIcons');
  await expect(page.locator('dialog.sc-appicons')).toBeVisible();
  await page.keyboard.press('Escape');

  // The built-in symbols fill the library once they arrive.
  await page.click('[data-tab="symbols"]');
  await page.click('.sc-sym-tabs [data-symtab="lib"], button:text-is("Library")');
  await expect(page.locator('.sc-sym-name', { hasText: 'Arrow right' }).first()).toBeVisible();

  expect(await loaded(page)).toEqual(
    expect.arrayContaining(['src/source.js', 'src/app-icons.js', 'symbols-library.js']),
  );
});
