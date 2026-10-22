import fs from 'node:fs';
import { test, expect, load, menu } from './fixtures.js';

// Tabs for open documents, kept in IndexedDB across reloads, with a * on a
// tab whose drawing differs from the version last opened or saved.

const tabs = (page) => page.locator('#sc-doctabs .sc-doctab');
const tabNames = (page) =>
  tabs(page).evaluateAll((ts) =>
    ts.map((t) => (t.querySelector('.sc-doctab-name').textContent || '').replace(/ @ .*/, '')),
  );
const active = (page) => page.locator('#sc-doctabs .sc-doctab[aria-selected="true"]');
const shapes = (page) => page.locator('#sc-doc > *').count();

async function drawRect(page) {
  await page.keyboard.press('r');
  const b = await page.locator('#sc-stage').boundingBox();
  await page.mouse.move(b.x + 300, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 380, b.y + 260, { steps: 4 });
  await page.mouse.up();
}

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

// Wait until the debounced save has written the current state.
const settled = (page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const r = indexedDB.open('svgcraft', 1);
            r.onsuccess = () => {
              const q = r.result.transaction('kv').objectStore('kv').get('docs');
              q.onsuccess = () => {
                const cur = q.result?.docs?.find((d) => d.id === q.result.active);
                resolve(cur?.svg === window.svgcraft.serialize());
              };
            };
            r.onerror = () => resolve(false);
          }),
      ),
    )
    .toBe(true);

const openFile = (page, name, body) =>
  page.setInputFiles('#sc-file', {
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`,
    ),
  });

test('starts with one clean Untitled-1 tab', async ({ page }) => {
  await expect(tabs(page)).toHaveCount(1);
  expect(await tabNames(page)).toEqual(['Untitled-1.svg']);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg @ [\d.]+% \(SVG\)$/);
});

test('a change adds a *, and undoing back to the saved version removes it', async ({ page }) => {
  await drawRect(page);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg\* @/);
  expect(await page.title()).toBe('Untitled-1.svg* · SVGCraft');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg @/);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg\* @/);
});

test('File → New opens another tab; each tab keeps its drawing and history', async ({ page }) => {
  await drawRect(page);
  await menu(page, 'File', 'new');
  await expect(tabs(page)).toHaveCount(2);
  expect(await tabNames(page)).toEqual(['Untitled-1.svg*', 'Untitled-2.svg']);
  expect(await shapes(page)).toBe(0);
  await drawRect(page);
  await drawRect(page);
  expect(await shapes(page)).toBe(2);

  await tabs(page).first().click();
  expect(await shapes(page)).toBe(1);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg\*/);
  // Undo here undoes this tab's own last step.
  await page.keyboard.press('Control+z');
  expect(await shapes(page)).toBe(0);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-1\.svg @/);

  await tabs(page).nth(1).click();
  expect(await shapes(page)).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await shapes(page)).toBe(1);
});

test('the + button in the tab bar makes a new document', async ({ page }) => {
  await page.click('#sc-doctabs .sc-doctab-new');
  expect(await tabNames(page)).toEqual(['Untitled-1.svg', 'Untitled-2.svg']);
  await expect(active(page)).toHaveAttribute('data-doc', /.+/);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^Untitled-2\.svg/);
});

test('Open puts a file in its own tab, reusing an untouched Untitled one', async ({ page }) => {
  await openFile(page, 'first.svg', '<rect width="50" height="50"/>');
  await expect(tabs(page)).toHaveCount(1);
  expect(await tabNames(page)).toEqual(['first.svg']);
  await openFile(page, 'second.svg', '<circle cx="50" cy="50" r="20"/>');
  expect(await tabNames(page)).toEqual(['first.svg', 'second.svg']);
  await expect(page.locator('#sc-doc circle')).toHaveCount(1);
  await tabs(page).first().click();
  await expect(page.locator('#sc-doc rect')).toHaveCount(1);
  await expect(page.locator('#sc-doc circle')).toHaveCount(0);
});

test('Save as SVG clears the * and downloads under the tab name', async ({ page }) => {
  await openFile(page, 'logo.svg', '<rect width="50" height="50"/>');
  await drawRect(page);
  expect(await tabNames(page)).toEqual(['logo.svg*']);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(dl.suggestedFilename()).toBe('logo.svg');
  expect(fs.readFileSync(await dl.path(), 'utf8')).toContain('<rect');
  expect(await tabNames(page)).toEqual(['logo.svg']);
  // PNG export doesn't count as saving the drawing.
  await drawRect(page);
  const [png] = await Promise.all([
    page.waitForEvent('download'),
    menu(page, 'File', 'exportPng1'),
  ]);
  expect(png.suggestedFilename()).toBe('logo.png');
  expect(await tabNames(page)).toEqual(['logo.svg*']);
});

test('open tabs, their * and the active one come back after a reload', async ({ page }) => {
  await openFile(page, 'a.svg', '<rect width="50" height="50"/>');
  await openFile(page, 'b.svg', '<circle cx="50" cy="50" r="20"/>');
  await drawRect(page);
  await menu(page, 'File', 'new');
  await tabs(page).nth(1).click();
  await settled(page);
  await reload(page);
  expect(await tabNames(page)).toEqual(['a.svg', 'b.svg*', 'Untitled-1.svg']);
  await expect(active(page)).toContainText('b.svg*');
  await expect(page.locator('#sc-doc circle')).toHaveCount(1);
  await expect(page.locator('#sc-doc rect')).toHaveCount(1);
  await tabs(page).first().click();
  await expect(page.locator('#sc-doc rect')).toHaveCount(1);
  await expect(page.locator('#sc-doc circle')).toHaveCount(0);
});

test('a reload keeps the zoom of the active tab', async ({ page }) => {
  await load(page, '<rect width="50" height="50"/>');
  await page.fill('#sc-zoom-input', '250');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const r = indexedDB.open('svgcraft', 1);
            r.onsuccess = () => {
              const q = r.result.transaction('kv').objectStore('kv').get('docs');
              q.onsuccess = () => resolve(q.result?.docs?.[0]?.view?.zoom);
            };
          }),
      ),
    )
    .toBe(2.5);
  await reload(page);
  expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBeCloseTo(2.5);
});

test('closing a changed tab asks first; Cancel keeps it, Close drops it', async ({ page }) => {
  await drawRect(page);
  await menu(page, 'File', 'new');
  await tabs(page).first().locator('.sc-doctab-x').click();
  await expect(page.locator('#sc-ask')).toBeVisible();
  await expect(page.locator('#sc-ask-title')).toHaveText('Close Untitled-1.svg?');
  await page.click('#sc-ask [data-ask="cancel"]');
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).first().locator('.sc-doctab-x').click();
  await page.click('#sc-ask [data-ask="ok"]');
  expect(await tabNames(page)).toEqual(['Untitled-2.svg']);
});

test('closing a clean tab needs no confirmation; the last one leaves a fresh tab', async ({
  page,
}) => {
  await openFile(page, 'a.svg', '<rect width="50" height="50"/>');
  await openFile(page, 'b.svg', '<rect width="50" height="50"/>');
  await menu(page, 'File', 'closeDoc');
  expect(await tabNames(page)).toEqual(['a.svg']);
  await expect(page.locator('#sc-ask')).toBeHidden();
  // Middle-click closes too.
  await tabs(page).first().click({ button: 'middle' });
  expect(await tabNames(page)).toEqual(['Untitled-1.svg']);
  expect(await shapes(page)).toBe(0);
});

test('a drawing autosaved by the previous version is brought over', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'svgcraft.v1',
      JSON.stringify({
        name: 'legacy',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="old" width="10" height="10"/></svg>',
      }),
    );
    return new Promise((resolve) => {
      const r = indexedDB.deleteDatabase('svgcraft');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await reload(page);
  expect(await tabNames(page)).toEqual(['legacy.svg']);
  await expect(page.locator('#sc-doc #old')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('svgcraft.v1'))).toBeNull();
});
