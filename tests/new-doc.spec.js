import { test, expect, menu } from './fixtures.js';

// File → New…: Photoshop's New Document dialog, with presets by category,
// any units, orientation, a background layer, and what you made last.

const st = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    return { w: +s.w.toFixed(2), h: +s.h.toFixed(2), units: s.units, name: s.fileName };
  });
const dlg = (page) => page.locator('#sc-newdoc');
const open = async (page) => {
  await menu(page, 'File', 'new');
  await expect(dlg(page)).toBeVisible();
};

test('opens on the defaults with the name ready to type; Create makes the tab', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('[data-nd="name"]')).toBeFocused();
  await expect(page.locator('[data-nd="name"]')).toHaveValue('Untitled-2');
  await expect(page.locator('[data-nd="w"]')).toHaveValue('800');
  await expect(page.locator('[data-nd="h"]')).toHaveValue('600');
  // Nothing made yet: it opens on Web, and Recent says so.
  await expect(page.locator('[data-nd-cat="web"]')).toHaveAttribute('aria-selected', 'true');
  await page.click('[data-nd-cat="recent"]');
  await expect(page.locator('#sc-nd-presets')).toHaveText('Documents you make show up here.');
  await page.fill('[data-nd="name"]', 'poster');
  await page.keyboard.press('Enter');
  await expect(dlg(page)).toBeHidden();
  expect(await st(page)).toEqual({ w: 800, h: 600, units: 'px', name: 'poster' });
  await expect(page.locator('#sc-doctabs .sc-doctab')).toHaveCount(2);
  // Nothing on it, and nothing to save yet.
  await expect(page.locator('#sc-doc > *')).toHaveCount(0);
  await expect(page.locator('#sc-doc-title')).toHaveText(/^poster\.svg @/);
});

test('presets fill in the size and units; orientation swaps them', async ({ page }) => {
  await open(page);
  await page.click('[data-nd-cat="print"]');
  await page.locator('.sc-nd-preset', { hasText: 'A4' }).first().click();
  await expect(page.locator('[data-nd="units"]')).toHaveValue('mm');
  await expect(page.locator('[data-nd="w"]')).toHaveValue('210');
  await expect(page.locator('[data-nd="h"]')).toHaveValue('297');
  await expect(page.locator('[data-nd-unit]').first()).toHaveText('mm');
  await expect(page.locator('[data-nd-orient="portrait"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-nd-orient="landscape"]');
  await expect(page.locator('[data-nd="w"]')).toHaveValue('297');
  // Same size in other units.
  await page.selectOption('[data-nd="units"]', 'in');
  await expect(page.locator('[data-nd="w"]')).toHaveValue('11.69');
  await page.selectOption('[data-nd="units"]', 'mm');
  await page.click('[data-nd-btn="ok"]');
  expect(await st(page)).toMatchObject({ w: 1122.52, h: 793.7, units: 'mm' });
  // Double-clicking a preset makes it straight away.
  await open(page);
  await page.click('[data-nd-cat="social"]');
  await page.locator('.sc-nd-preset', { hasText: 'Story / Reel' }).dblclick();
  await expect(dlg(page)).toBeHidden();
  expect(await st(page)).toMatchObject({ w: 1080, h: 1920, units: 'px' });
});

test('a background is a locked Background layer; Recent remembers', async ({ page }) => {
  await open(page);
  await page.selectOption('[data-nd="bg"]', 'custom');
  await expect(page.locator('[data-nd="colour"]')).toBeVisible();
  await page.locator('[data-nd="colour"]').fill('#336699');
  await page.fill('[data-nd="w"]', '300');
  await page.fill('[data-nd="h"]', '200');
  await page.click('[data-nd-btn="ok"]');
  const bg = page.locator('#sc-doc > rect');
  await expect(bg).toHaveCount(1);
  expect(
    await bg.evaluate((r) =>
      ['width', 'height', 'fill', 'data-name', 'data-sc-lock'].map((a) => r.getAttribute(a)),
    ),
  ).toEqual(['300', '200', '#336699', 'Background', 'position']);
  // A fresh document isn't marked as changed.
  await expect(page.locator('#sc-doc-title')).not.toHaveText(/\*/);
  // Next time: the last settings, and Recent lists the size.
  await open(page);
  await expect(page.locator('[data-nd-cat="recent"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-nd="w"]')).toHaveValue('300');
  await expect(page.locator('[data-nd="bg"]')).toHaveValue('custom');
  await expect(page.locator('.sc-nd-preset').first()).toContainText('300 × 200 px');
  // Too big is refused; Cancel makes nothing.
  await page.fill('[data-nd="w"]', '50000');
  await page.click('[data-nd-btn="ok"]');
  await expect(page.locator('#sc-newdoc .sc-dlg-err')).toHaveText(
    'The document must be 1 to 20,000 px each way.',
  );
  await expect(page.locator('[data-nd="w"]')).toHaveAttribute('aria-invalid', 'true');
  await page.click('[data-nd-btn="cancel"]');
  await expect(page.locator('#sc-doctabs .sc-doctab')).toHaveCount(2);
  // Icon templates hand over to New Icon.
  await open(page);
  await page.click('[data-nd-btn="icon"]');
  await expect(dlg(page)).toBeHidden();
  await expect(page.locator('#sc-newicon')).toBeVisible();
});
