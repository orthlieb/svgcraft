import { test, expect, menu } from './fixtures.js';

// Window: every panel by name, the docked / floating windows, and the
// workspace (icon strip, hiding the panels, Reset Workspace).

const item = (page, act) => page.locator(`.sc-menu-list:not([hidden]) [data-action="${act}"]`);
const ticked = async (page, act) => {
  await page.click('.sc-menu-btn:text-is("Window")');
  const on = await item(page, act).getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  return on === 'true';
};
const group = (page, i) => page.locator('#sc-panel > .sc-pgroup').nth(i);

test('a panel by name opens on its tab, ticked; chosen again it folds away', async ({ page }) => {
  expect(await ticked(page, 'panelColor')).toBe(true);
  expect(await ticked(page, 'panelSwatches')).toBe(false);
  await menu(page, 'Window', 'panelSwatches');
  await expect(page.locator('[data-tab="swatches"]')).toHaveAttribute('aria-selected', 'true');
  expect(await ticked(page, 'panelSwatches')).toBe(true);
  expect(await ticked(page, 'panelColor')).toBe(false);
  await menu(page, 'Window', 'panelSwatches');
  await expect(group(page, 0)).toHaveClass(/collapsed/);
  // Layers, folded, unfolds.
  await group(page, 2).locator('.sc-pcollapse').click();
  await menu(page, 'Window', 'panelLayers');
  await expect(group(page, 2)).not.toHaveClass(/collapsed/);
});

test('a panel brings the panels back from Tab, or pops out of the icon strip', async ({ page }) => {
  await page.locator('#sc-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  await expect(page.locator('#sc-panel')).toBeHidden();
  expect(await ticked(page, 'togglePanels')).toBe(true);
  await menu(page, 'Window', 'panelCharacter');
  await expect(page.locator('#sc-panel')).toBeVisible();
  await expect(page.locator('[data-pane="character"]')).toBeVisible();

  await menu(page, 'Window', 'toggleDock');
  expect(await ticked(page, 'toggleDock')).toBe(true);
  await menu(page, 'Window', 'panelGradients');
  await expect(page.locator('#sc-panel > .sc-pgroup.sc-popout')).toHaveCount(1);
  await expect(page.locator('[data-pane="gradients"]')).toBeVisible();
});

test('SVG Source and Icon Preview open from Window, not View', async ({ page }) => {
  await page.click('.sc-menu-btn:text-is("View")');
  for (const act of ['toggleSource', 'toggleIconPreview', 'togglePanels'])
    await expect(item(page, act)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await menu(page, 'Window', 'toggleSource');
  await expect(page.locator('#sc-source')).toBeVisible();
  expect(await ticked(page, 'toggleSource')).toBe(true);
});

test('Reset Workspace puts panels, docked windows and dialogs back', async ({ page }) => {
  // Mess it all up.
  await group(page, 1).locator('.sc-pcollapse').click();
  await page.click('[data-tab="swatches"]');
  await menu(page, 'Window', 'toggleSource');
  await page.click('#sc-src-dock');
  await menu(page, 'Window', 'toggleIconPreview');
  const sp = await page.locator('#sc-dock-splitter').boundingBox();
  await page.mouse.move(sp.x + 2, sp.y + 200);
  await page.mouse.down();
  await page.mouse.move(sp.x - 98, sp.y + 200, { steps: 3 });
  await page.mouse.up();
  await page.evaluate(() => {
    const d = document.getElementById('sc-newguide');
    d.style.left = '10px';
    d.style.top = '10px';
  });
  await menu(page, 'Window', 'toggleDock');

  await menu(page, 'Window', 'resetWorkspace');
  await expect(page.locator('#sc-msg')).toContainText('Workspace reset.');
  await expect(page.locator('#sc-panel > .sc-pgroup.collapsed')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('sc-dock-icons'))).toBe(false);
  await expect(page.locator('[data-tab="color"]')).toHaveAttribute('aria-selected', 'true');
  // Both windows docked, the column back to its standard width.
  expect(await page.$$eval('#sc-dock > :not([hidden])', (els) => els.map((e) => e.id))).toEqual([
    'sc-iconprev',
    'sc-dock-divider',
    'sc-source',
  ]);
  expect(await page.locator('#sc-dock').evaluate((e) => e.offsetWidth)).toBe(380);
  expect(await page.evaluate(() => document.getElementById('sc-newguide').style.left)).toBe('');
  // And it stays reset after a reload.
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await expect(page.locator('#sc-panel > .sc-pgroup.collapsed')).toHaveCount(0);
});
