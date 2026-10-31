import { test, expect, load, select, menu, tab } from './fixtures.js';

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
      await menu(page, 'Layer', 'layerStyle');
    },
  ],
  [
    '#sc-ask',
    async (page) => {
      await tab(page, 'swatches');
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
  await menu(page, 'Layer', 'layerStyle');
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

// Every dialog has a drag bar: its title, with the ⠿ grip on the left.
test('every dialog’s title bar has the grip and is the drag handle', async ({ page }) => {
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll('dialog')].map((d) => {
      const t = d.querySelector(':scope > .sc-dialog-title');
      return [
        d.id,
        !!t && getComputedStyle(t, '::before').content,
        !!t && getComputedStyle(t).cursor,
      ];
    }),
  );
  expect(bars.length).toBeGreaterThanOrEqual(12);
  for (const [id, grip, cursor] of bars) {
    expect(grip, id).toMatch(/⠿/);
    expect(cursor, id).toBe('move');
  }
});

for (const [id, open] of DIALOGS) {
  test(`${id} drags by its title bar and stays where it's put`, async ({ page }) => {
    await open(page);
    const dlg = page.locator(id);
    const bar = dlg.locator('.sc-dialog-title');
    const a = await dlg.boundingBox();
    const t = await bar.boundingBox();
    // Grab the bar near its left end (by the grip) and move it.
    await page.mouse.move(t.x + 8, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 8 - 120, t.y + t.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const b = await dlg.boundingBox();
    expect(b.x).toBeCloseTo(a.x - 120, 0);
    expect(b.y).toBeCloseTo(a.y + 60, 0);
    // Closed and opened again: in the same place.
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await open(page);
    const c = await dlg.boundingBox();
    expect([c.x, c.y].map(Math.round)).toEqual([b.x, b.y].map(Math.round));
    // It can't be dragged off screen.
    const t2 = await bar.boundingBox();
    await page.mouse.move(t2.x + 8, t2.y + 5);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 5 });
    await page.mouse.up();
    const d = await dlg.boundingBox();
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
  });
}
