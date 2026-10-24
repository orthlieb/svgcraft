// Shell UI: theme switching, keyboard menu navigation, scrubby labels, the
// toolbar paint chips, panel tabs, the zoom field and View → Show Grid.
import { test, expect, menu } from './fixtures.js';

test.use({ colorScheme: 'light', viewport: { width: 1280, height: 780 } });

const LIGHT_BG = 'rgb(230, 230, 230)';
const DARK_BG = 'rgb(37, 37, 37)';
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'none');
const activeText = (page) => page.evaluate(() => document.activeElement.textContent.trim());

// Reload, keeping localStorage (the app's autosave and preferences).
async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

test.describe('theme', () => {
  test('follows the system scheme by default', async ({ page }) => {
    expect(await theme(page)).toBe('none');
    expect(await bg(page)).toBe(LIGHT_BG);
  });

  test('the theme button toggles to dark and it survives a reload', async ({ page }) => {
    await page.click('#sc-theme-btn');
    expect(await theme(page)).toBe('dark');
    expect(await bg(page)).toBe(DARK_BG);
    expect(await page.evaluate(() => localStorage.getItem('svgcraft.theme'))).toBe('dark');
    await reload(page);
    expect(await theme(page)).toBe('dark');
    expect(await bg(page)).toBe(DARK_BG);
  });

  test('View → Match System goes back to the system scheme', async ({ page }) => {
    await page.click('#sc-theme-btn');
    await menu(page, 'View', 'themeSystem');
    expect(await theme(page)).toBe('none');
    expect(await bg(page)).toBe(LIGHT_BG);
  });
});

test('menus are keyboard navigable', async ({ page }) => {
  await page.focus('.sc-menu-btn:text-is("Edit")');
  await page.keyboard.press('ArrowDown');
  expect(await activeText(page)).toBe('UndoCtrl+Z');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sc-menu-btn[aria-expanded=true]')).toHaveText('Image');
  expect(await activeText(page)).toBe('Image Size…Ctrl+Alt+I');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-menu-list:not([hidden])')).toHaveCount(0);
});

test('dragging a scrubby label changes the stroke width everywhere', async ({ page }) => {
  await page.keyboard.press('b');
  const lb = await page.locator('.sc-opt.on .sc-scrub').first().boundingBox();
  await page.mouse.move(lb.x + 10, lb.y + 5);
  await page.mouse.down();
  await page.mouse.move(lb.x + 40, lb.y + 5, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.svgcraft.state.strokeWidth)).toBe(8);
  await expect(page.locator('[data-pane="props"] [data-bind=strokeWidth]')).toHaveValue('8');
});

test.describe('toolbar paint chips', () => {
  test('clicking the stroke chip makes stroke the active paint', async ({ page }) => {
    await page.click('#sc-tb-stroke', { position: { x: 17, y: 17 } });
    expect(await page.evaluate(() => window.svgcraft.state.active)).toBe('stroke');
    await expect(page.locator('.sc-paint[data-target=stroke]')).toHaveClass(/\bactive\b/);
  });

  test('the swap button exchanges fill and stroke', async ({ page }) => {
    const paints = () =>
      page.evaluate(() => [window.svgcraft.state.fill, window.svgcraft.state.stroke]);
    expect(await paints()).toEqual(['#e8a33d', '#1f2933']);
    await page.click('.sc-tb-swap');
    expect(await paints()).toEqual(['#1f2933', '#e8a33d']);
  });
});

test('panel tabs switch panes', async ({ page }) => {
  await page.click('[data-tab=swatches]');
  await expect(page.locator('#sc-palette')).toBeVisible();
  await expect(page.locator('[data-pane=color]')).toBeHidden();
});

test('the zoom field sets the zoom and the document title', async ({ page }) => {
  await page.fill('#sc-zoom-input', '200');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.svgcraft.state.zoom)).toBe(2);
  await expect(page.locator('#sc-doc-title')).toHaveText('Untitled-1.svg @ 200% (SVG)');
});

test('View → Show Grid updates state, checkbox and menu checkmark', async ({ page }) => {
  await menu(page, 'View', 'toggleGrid');
  expect(await page.evaluate(() => window.svgcraft.state.grid)).toBe(true);
  await expect(page.locator('#sc-grid')).toBeChecked();
  await expect(page.locator('[data-action=toggleGrid]').first()).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the options bar shows the tool icon', async ({ page }) => {
  await expect(page.locator('#sc-opt-icon svg')).toHaveCount(1);
});

// Panel tabs: each has its panel's icon; the open one also shows its name,
// the others have it as their tooltip. Animation has a tab of its own.
test('panel tabs show icons, and the open tab its name', async ({ page }) => {
  const tabs = page.locator('[role="tab"][data-tab]');
  await expect(tabs).toHaveCount(9);
  for (const t of await tabs.all()) {
    await expect(t.locator('svg')).toHaveCount(1);
    expect(await t.getAttribute('data-tip')).toBe(await t.getAttribute('aria-label'));
  }
  const name = (tab) => page.locator(`[data-tab="${tab}"] span`);
  await expect(name('props')).toBeVisible();
  await expect(name('animation')).toBeHidden();
  await page.click('[data-tab="animation"]');
  await expect(name('animation')).toBeVisible();
  await expect(name('props')).toBeHidden();
  await expect(page.locator('[data-pane="animation"]')).toBeVisible();
  await expect(page.locator('[data-pane="props"]')).toBeHidden();
  // Nothing selected: what to do, and Play for the whole drawing.
  await expect(page.locator('#sc-anim-none')).toBeVisible();
  await expect(
    page.locator('[data-pane="animation"] [data-action="toggleAnimations"]'),
  ).toBeVisible();
});
