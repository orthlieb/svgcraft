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

// Wait until the debounced save has written the current state: the same
// tabs, and the active one's drawing.
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
                const ids = (q.result?.docs || []).map((d) => d.id).join();
                const cur = q.result?.docs?.find((d) => d.id === q.result.active);
                resolve(
                  ids === window.svgcraft.docs.map((d) => d.id).join() &&
                    cur?.svg === window.svgcraft.serialize(),
                );
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
  await page.click('[data-nd-btn="ok"]');
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
  // It opens File → New….
  await page.click('#sc-doctabs .sc-doctab-new');
  await expect(page.locator('#sc-newdoc')).toBeVisible();
  await page.keyboard.press('Enter');
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

test('Export (a download) clears the * and is named after the tab', async ({ page }) => {
  await openFile(page, 'logo.svg', '<rect width="50" height="50"/>');
  await drawRect(page);
  expect(await tabNames(page)).toEqual(['logo.svg*']);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sc-export')]);
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
  await page.click('[data-nd-btn="ok"]');
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

test('a reload straight after a change still keeps it', async ({ page }) => {
  await openFile(page, 'a.svg', '<rect width="50" height="50"/>');
  await settled(page);
  // No waiting for the save: the reload itself writes it.
  await drawRect(page);
  await menu(page, 'File', 'new');
  await page.click('[data-nd-btn="ok"]');
  await reload(page);
  expect(await tabNames(page)).toEqual(['a.svg*', 'Untitled-1.svg']);
  await tabs(page).first().click();
  await expect(page.locator('#sc-doc rect')).toHaveCount(2);
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

test('closing a changed tab asks first; Cancel keeps it, Don’t Save drops it', async ({ page }) => {
  await drawRect(page);
  await menu(page, 'File', 'new');
  await page.click('[data-nd-btn="ok"]');
  await tabs(page).first().locator('.sc-doctab-x').click();
  await expect(page.locator('#sc-ask')).toBeVisible();
  await expect(page.locator('#sc-ask-title')).toHaveText(
    'Save changes to Untitled-1.svg before closing?',
  );
  // Save is the default; Enter on a focused Cancel cancels.
  await expect(page.locator('#sc-ask [data-ask="ok"]')).toHaveText('Save');
  await page.focus('#sc-ask [data-ask="cancel"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-ask')).toBeHidden();
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).first().locator('.sc-doctab-x').click();
  await page.click('#sc-ask [data-ask="cancel"]');
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).first().locator('.sc-doctab-x').click();
  await page.click('#sc-ask [data-ask="alt"]');
  expect(await tabNames(page)).toEqual(['Untitled-2.svg']);
});

test('closing a clean tab needs no confirmation; the last one leaves a blank workspace', async ({
  page,
}) => {
  await openFile(page, 'a.svg', '<rect width="50" height="50"/>');
  await openFile(page, 'b.svg', '<rect width="50" height="50"/>');
  await menu(page, 'File', 'closeDoc');
  expect(await tabNames(page)).toEqual(['a.svg']);
  await expect(page.locator('#sc-ask')).toBeHidden();
  // Middle-click closes too.
  await tabs(page).first().click({ button: 'middle' });
  await expect(tabs(page)).toHaveCount(0);
  expect(await shapes(page)).toBe(0);
  await expect(page.locator('#sc-nodoc')).toBeVisible();
});

test('with every tab closed, only New and Open work until one is made', async ({ page }) => {
  await load(page, '<rect id="r" width="50" height="50"/>');
  await page.evaluate(() => window.svgcraft.markSaved?.());
  await tabs(page).first().locator('.sc-doctab-x').click();
  const ask = page.locator('#sc-ask');
  if (await ask.isVisible()) await ask.locator('[data-ask="alt"]').click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator('#sc-nodoc')).toBeVisible();
  await expect(page.locator('#sc-stage')).toBeHidden();
  await expect(page).toHaveTitle('SVGCraft');
  await expect(page.locator('#sc-docsize')).toHaveText('');

  // The menus: New / Open on, everything that needs a drawing off.
  const item = (act) => page.locator(`.sc-menu-list:not([hidden]) [data-action="${act}"]`);
  await page.click('.sc-menu-btn:text-is("File")');
  await expect(item('new')).toBeEnabled();
  await expect(item('open')).toBeEnabled();
  await expect(item('save')).toBeDisabled();
  await expect(item('closeDoc')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.click('.sc-menu-btn:text-is("Edit")');
  await expect(item('undo')).toBeDisabled();
  await page.keyboard.press('Escape');
  // Panels and tools can't be used, and shortcuts do nothing.
  expect(await page.evaluate(() => document.querySelector('#sc-panel > .sc-pgroup').inert)).toBe(
    true,
  );
  await page.keyboard.press('Control+a');
  await page.keyboard.press('r');
  expect(await page.evaluate(() => window.svgcraft.state.sel.length)).toBe(0);

  // Still blank after a reload.
  await page.reload();
  await page.evaluate(() => window.svgcraft.ready);
  await expect(page.locator('#sc-nodoc')).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);

  // New… makes a drawing and everything comes back.
  await page.click('#sc-nodoc [data-action="new"]');
  await expect(page.locator('#sc-newdoc')).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await tabNames(page)).toEqual(['Untitled-1.svg']);
  await expect(page.locator('#sc-nodoc')).toBeHidden();
  await expect(page.locator('#sc-stage')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#sc-panel > .sc-pgroup').inert)).toBe(
    false,
  );
  await page.click('.sc-menu-btn:text-is("File")');
  await expect(item('save')).toBeEnabled();
  await expect(item('closeDoc')).toBeEnabled();
  await page.keyboard.press('Escape');

  // Opening a file from the blank workspace gives it a tab of its own.
  await tabs(page).first().locator('.sc-doctab-x').click();
  await expect(page.locator('#sc-nodoc')).toBeVisible();
  await openFile(page, 'c.svg', '<circle cx="50" cy="50" r="20"/>');
  expect(await tabNames(page)).toEqual(['c.svg']);
  await expect(page.locator('#sc-doc circle')).toHaveCount(1);
});

test('a drawing autosaved by the previous version is brought over', async ({ page }) => {
  // What the old version left: set up as the next load starts, after this
  // page has saved its own tabs on the way out.
  await page.addInitScript(() => {
    localStorage.removeItem('svgcraft.docs.pending');
    localStorage.setItem(
      'svgcraft.v1',
      JSON.stringify({
        name: 'legacy',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="old" width="10" height="10"/></svg>',
      }),
    );
    // Opening the database waits for this to finish.
    indexedDB.deleteDatabase('svgcraft');
  });
  await reload(page);
  expect(await tabNames(page)).toEqual(['legacy.svg']);
  await expect(page.locator('#sc-doc #old')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('svgcraft.v1'))).toBeNull();
});
