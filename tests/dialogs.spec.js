import { test, expect, load, select, menu } from './fixtures.js';

// Every dialog is a native <dialog> shown modally: it's in the top layer,
// focus stays inside it, the page behind is inert, and Esc runs the
// dialog's own Cancel.

const DIALOGS = [
  ['#sc-newguide', (page) => menu(page, 'View', 'newGuide')],
  ['#sc-newicon', (page) => menu(page, 'File', 'newIcon')],
  ['#sc-cleansvg', (page) => menu(page, 'File', 'exportCleanSvg')],
  ['#sc-appicons', (page) => menu(page, 'File', 'exportAppIcons')],
  ['#sc-fileinfo', (page) => menu(page, 'File', 'fileInfo')],
  [
    '#sc-fx',
    async (page) => {
      await select(page, 'r');
      await menu(page, 'Object', 'layerStyle');
    },
  ],
  [
    '#sc-ask',
    async (page) => {
      await page.click('[data-tab="swatches"]');
      await page.click('[data-lib="swatches"] [data-lib-act="add"]');
    },
  ],
];

test.beforeEach(({ page }) =>
  load(page, '<rect id="r" x="20" y="20" width="100" height="60" fill="#2563eb"/>', 400, 300),
);

for (const [id, open] of DIALOGS) {
  test(`${id} is a modal <dialog>: focus stays in, Esc cancels`, async ({ page }) => {
    await open(page);
    const dlg = page.locator(id);
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((d) => [d.localName, d.open, d.matches(':modal')])).toEqual([
      'dialog',
      true,
      true,
    ]);
    // Tab round the dialog: focus never reaches the page behind it (past
    // the last control it may go to the browser's own UI, then back).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(
        await dlg.evaluate(
          (d) => d.contains(document.activeElement) || document.activeElement === document.body,
        ),
      ).toBe(true);
    }
    // Esc runs Cancel, so the dialog can be opened again afterwards.
    await dlg.evaluate((d) => d.querySelector('input, button')?.focus());
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect(await dlg.evaluate((d) => d.open)).toBe(false);
    await open(page);
    await expect(dlg).toBeVisible();
  });
}

test('the page behind a dialog is inert', async ({ page }) => {
  await menu(page, 'File', 'newIcon');
  expect(await page.evaluate(() => document.querySelector('.sc-main').matches(':modal'))).toBe(
    false,
  );
  // A click on the canvas doesn't reach it.
  const before = await page.evaluate(() => window.svgcraft.state.sel.length);
  await page.mouse.click(300, 300);
  expect(await page.evaluate(() => window.svgcraft.state.sel.length)).toBe(before);
  await expect(page.locator('#sc-newicon')).toBeVisible();
});

test('Esc in Layer Style puts the layer back as it was', async ({ page }) => {
  await select(page, 'r');
  await menu(page, 'Object', 'layerStyle');
  await page.click('#sc-fx [data-fx-page="ds"] button');
  expect(
    await page.evaluate(() => document.getElementById('r').getAttribute('data-sc-fx')),
  ).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-fx')).toBeHidden();
  expect(
    await page.evaluate(() => document.getElementById('r').getAttribute('data-sc-fx')),
  ).toBeNull();
});
