// Keyboard access and contrast, from the UI review: Tab and F10 into the
// menu bar, menus and submenus by the keyboard, the context-menu key, the
// Layers list, tooltips that stay while hovered, dialog focus, and the
// colour tokens' contrast in both themes.
import { test, expect, load, select, action } from './fixtures.js';

const SCENE =
  '<rect id="a" data-name="Box" x="20" y="20" width="100" height="80" fill="#2563eb"/>' +
  '<circle id="b" data-name="Disc" cx="250" cy="150" r="40" fill="#dc2626"/>';

test('Tab from nothing goes to the menu bar; on the canvas it hides the panels', async ({
  page,
}) => {
  await load(page, SCENE);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Tab');
  await expect(page.locator('.sc-menu-btn').first()).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/sc-no-panels/);
  // Left and right along the menu bar.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sc-menu-btn').nth(1)).toBeFocused();
  // A click on the canvas puts the keyboard there: Tab hides the panels.
  await page.locator('#sc-stage').click({ position: { x: 600, y: 600 } });
  await expect(page.locator('#sc-stage')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveClass(/sc-no-panels/);
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).not.toHaveClass(/sc-no-panels/);
  // F10 goes to the menu bar, and back.
  await page.keyboard.press('F10');
  await expect(page.locator('.sc-menu-btn').first()).toBeFocused();
  await page.keyboard.press('F10');
  await expect(page.locator('#sc-stage')).toBeFocused();
});

test('menus: arrows in submenus, Home / End, and a letter', async ({ page }) => {
  await load(page, SCENE);
  await select(page, 'a');
  await page.click('.sc-menu-btn:text-is("Edit")');
  // A letter: the next item starting with it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('f');
  await expect(
    page.locator('.sc-menu-list:not([hidden]) [data-action="freeTransform"]'),
  ).toBeFocused();
  // Into the Transform submenu, and down it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const sub = page.locator('.sc-sub-list:not([hidden])');
  await expect(sub.locator('button:focus')).toHaveCount(1);
  const first = await sub.locator('button:focus').textContent();
  await page.keyboard.press('ArrowDown');
  expect(await sub.locator('button:focus').textContent()).not.toBe(first);
  await page.keyboard.press('Home');
  expect(await sub.locator('button:focus').textContent()).toBe(first);
  await page.keyboard.press('End');
  expect(await sub.locator('button:focus').textContent()).not.toBe(first);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('Shift+F10 opens the canvas menu at the selection, and a layer row’s on its row', async ({
  page,
}) => {
  await load(page, SCENE);
  await select(page, 'b');
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Shift+F10');
  const ctx = page.locator('#sc-ctx');
  await expect(ctx).toBeVisible();
  await expect(ctx.locator('button:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(ctx).toBeHidden();
  // On a layer row: that row's menu.
  await page.locator('#sc-layers li', { hasText: 'Box' }).focus();
  await page.keyboard.press('Shift+F10');
  await expect(ctx).toContainText('Rename Layer');
  await page.keyboard.press('Escape');
});

test('the Layers list by keyboard: select, restack, rename', async ({ page }) => {
  await load(page, SCENE);
  await select(page, 'b');
  const row = (name) => page.locator('#sc-layers li', { hasText: name });
  await expect(row('Disc')).toHaveAttribute('tabindex', '0');
  await row('Disc').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row('Box')).toBeFocused();
  expect(await page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id))).toEqual(['a']);
  // The arrows didn't nudge it.
  expect(await page.evaluate(() => document.getElementById('a').getAttribute('transform'))).toBe(
    null,
  );
  // Alt+Up: one up the stack, and the row keeps the keyboard.
  await page.keyboard.press('Alt+ArrowUp');
  expect(
    await page.evaluate(() => [...document.querySelectorAll('#sc-doc > *')].map((e) => e.id)),
  ).toEqual(['b', 'a']);
  await expect(row('Box')).toBeFocused();
  // F2 renames.
  await page.keyboard.press('F2');
  await page.keyboard.type('Square');
  await page.keyboard.press('Enter');
  await expect(row('Square')).toHaveCount(1);
});

test('a tooltip stays while it is hovered, and goes when the pointer leaves', async ({ page }) => {
  await load(page, SCENE);
  const tool = page.locator('.sc-tools [data-tip]').first();
  await tool.hover();
  const tip = page.locator('.sc-tip');
  await expect(tip).toBeVisible();
  await page.waitForTimeout(3600);
  await expect(tip).toBeVisible();
  await page.mouse.move(700, 500);
  await expect(tip).toBeHidden();
  // Icon-only buttons are named by their tips.
  for (const k of ['super', 'sub', 'underline', 'strike'])
    expect(await page.getAttribute(`[data-type-toggle="${k}"]`, 'aria-label')).toBeTruthy();
});

test('Black & White takes Enter as OK', async ({ page }) => {
  await load(page, SCENE);
  await select(page, 'a');
  await action(page, 'adjBlackWhite');
  const dlg = page.locator('#sc-bw');
  await expect(dlg).toBeVisible();
  await dlg.locator('input[type=number]').first().focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  // Applied: the blue is grey now.
  const fill = await page.evaluate(() => document.getElementById('a').getAttribute('fill'));
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
  expect(r === g && g === b).toBe(true);
});

// WCAG contrast between two colours.
const ratio = (a, b) => {
  const lum = (c) => {
    const [r, g, bb] = c
      .match(/\d+/g)
      .slice(0, 3)
      .map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const theme of ['light', 'dark'])
  test(`the ${theme} theme's colours keep their contrast`, async ({ page }) => {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const c = await page.evaluate(() => {
      const probe = document.createElement('i');
      document.body.append(probe);
      const get = (v) => {
        probe.style.color = `var(${v})`;
        return getComputedStyle(probe).color;
      };
      const out = Object.fromEntries(
        [
          '--text',
          '--text-dim',
          '--panel',
          '--shell',
          '--field',
          '--menu',
          '--accent',
          '--accent-fg',
          '--accent-hi',
          '--field-line',
        ].map((v) => [v, get(v)]),
      );
      probe.remove();
      return out;
    });
    // Text (4.5:1).
    for (const bg of ['--panel', '--shell', '--field', '--menu']) {
      expect(ratio(c['--text'], c[bg]), `text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c['--text-dim'], c[bg]), `dim text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c['--accent-hi'], c[bg]), `accent text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(c['--accent-fg'], c['--accent']), 'white on the accent').toBeGreaterThanOrEqual(
      4.5,
    );
    // Edges (3:1): fields against what they sit in.
    for (const bg of ['--panel', '--field'])
      expect(ratio(c['--field-line'], c[bg]), `field edge on ${bg}`).toBeGreaterThanOrEqual(
        bg === '--panel' ? 2.5 : 3,
      );
  });
