// Shell UI: theme switching, keyboard menu navigation, scrubby labels, the
// toolbar paint chips, panel tabs, the zoom field and View → Show Grid.
import { test, expect, menu, load, action, tab } from './fixtures.js';

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

const row = (page, name) =>
  page.locator('#sc-layers li', {
    has: page.locator('.sc-layer-name', { hasText: new RegExp(`^${name}$`) }),
  });

test('menus are keyboard navigable', async ({ page }) => {
  // Something to undo, so Undo is live.
  await load(page, '<rect id="a" width="10" height="10"/>');
  await action(page, 'selectAll');
  await action(page, 'duplicate');
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
  await expect(page.locator('#sc-appearance [data-bind=strokeWidth]')).toHaveValue('8');
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

  test('the default button sets black fill and white stroke; there is no None button', async ({
    page,
  }) => {
    await page.click('.sc-tb-default');
    expect(
      await page.evaluate(() => [window.svgcraft.state.fill, window.svgcraft.state.stroke]),
    ).toEqual(['#000000', '#ffffff']);
    // As in Photoshop: the two small buttons sit above the chips.
    const box = (s) => page.locator(s).boundingBox();
    const [def, swap, fill] = [
      await box('.sc-tb-default'),
      await box('.sc-tb-swap'),
      await box('#sc-tb-fill'),
    ];
    expect(def.y + def.height).toBeLessThanOrEqual(fill.y + 1);
    expect(swap.y + swap.height).toBeLessThanOrEqual(fill.y + 1);
    expect(def.x).toBeLessThan(swap.x);
    await expect(page.locator('.sc-chips [data-action="paintNone"]')).toHaveCount(0);
  });
});

test('panel tabs switch panes', async ({ page }) => {
  await tab(page, 'character');
  await expect(page.locator('[data-pane=character]')).toBeVisible();
  await expect(page.locator('[data-pane=props]')).toBeHidden();
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
  await expect(tabs).toHaveCount(10);
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

test('menu items and buttons are greyed out until they can run', async ({ page }) => {
  await load(
    page,
    '<rect id="a" data-name="A" width="50" height="50"/>' +
      '<circle id="b" data-name="B" cx="40" cy="40" r="20"/>',
  );
  const clip = page.locator('.sc-layers-foot [data-action="clipMake"]');
  const item = (act) => page.locator(`.sc-menu-list:not([hidden]) [data-action="${act}"]`);

  // Nothing selected: no crop to selection, no clipping mask.
  await expect(clip).toBeDisabled();
  await page.click('.sc-menu-btn:text-is("Image")');
  await expect(item('cropToSelection')).toBeDisabled();
  await expect(item('cropToDrawing')).toBeEnabled();
  await page.keyboard.press('Escape');

  // One layer: crop works; a clipping mask still needs two.
  await row(page, 'B').click();
  await expect(clip).toBeDisabled();
  await page.click('.sc-menu-btn:text-is("Image")');
  await expect(item('cropToSelection')).toBeEnabled();
  await page.keyboard.press('Escape');

  // Two layers: the clipping mask is live, and makes one.
  await row(page, 'A').click({ modifiers: ['Shift'] });
  await expect(clip).toBeEnabled();
  await clip.click();
  await expect(page.locator('#sc-doc > [data-sc-clip]')).toHaveCount(1);
  // The clipping group alone is selected now: one layer again.
  await expect(clip).toBeDisabled();
});

test('a greyed-out item’s shortcut does nothing', async ({ page }) => {
  await load(
    page,
    '<rect id="a" data-name="A" width="50" height="50"/>' +
      '<circle id="b" data-name="B" cx="40" cy="40" r="20"/>',
  );
  const html = () => page.evaluate(() => document.getElementById('sc-doc').innerHTML);
  const before = await html();
  // One layer: no clipping mask, and nothing to bring forward past.
  await row(page, 'B').click();
  await page.keyboard.press('Control+Alt+KeyG');
  await page.keyboard.press('Control+Shift+BracketRight');
  expect(await html()).toBe(before);
  await expect(page.locator('#sc-msg')).not.toContainText('Select the art');
  // Two: Ctrl+Alt+G makes the mask.
  await row(page, 'A').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+Alt+KeyG');
  await expect(page.locator('#sc-doc > [data-sc-clip]')).toHaveCount(1);
});

test('panel groups collapse to their tabs, and stay that way', async ({ page }) => {
  const groups = page.locator('#sc-panel > .sc-pgroup');
  const colour = groups.nth(0);
  const props = groups.nth(1);
  const chevron = (g) => g.locator('.sc-pcollapse');
  const layersH = () => groups.nth(2).evaluate((g) => g.getBoundingClientRect().height);

  const tall = await layersH();
  await chevron(colour).click();
  await expect(colour).toHaveClass(/collapsed/);
  await expect(chevron(colour)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sc-appearance')).toBeHidden();
  // Layers takes the room.
  expect(await layersH()).toBeGreaterThan(tall);

  // Clicking a tab opens the group on that tab.
  await tab(page, 'props');
  await expect(colour).not.toHaveClass(/collapsed/);
  await expect(page.locator('#sc-appearance')).toBeVisible();

  // Double-clicking the tab bar folds it; selecting text switches to
  // Character without unfolding it, Type → Character does.
  await props.locator('.sc-ptabs').dblclick({ position: { x: 200, y: 10 } });
  await expect(props).toHaveClass(/collapsed/);
  await load(page, '<text id="t" x="10" y="40">Hi</text>');
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    s.setSel?.([document.getElementById('t')]);
  });
  await page.locator('#sc-layers li').first().click();
  await expect(page.locator('[data-tab="character"]')).toHaveAttribute('aria-selected', 'true');
  await expect(props).toHaveClass(/collapsed/);
  await menu(page, 'Type', 'showCharacter');
  await expect(props).not.toHaveClass(/collapsed/);

  // Remembered after a reload.
  await chevron(groups.nth(2)).click();
  await page.reload();
  await expect(groups.nth(2)).toHaveClass(/collapsed/);
  await expect(page.locator('#sc-layers')).toBeHidden();
  await expect(colour).not.toHaveClass(/collapsed/);
});

test('» collapses the panels to icons that pop each panel out', async ({ page }) => {
  const panel = page.locator('#sc-panel');
  const toggle = page.locator('.sc-dock-toggle');
  const icon = (name) => page.locator(`.sc-dock-icon[data-tip="${name}"]`);
  const popout = page.locator('#sc-panel > .sc-pgroup.sc-popout');
  const props = page.locator('#sc-panel > .sc-pgroup').nth(1);
  // Fold Properties first: a pop-out shows it open, and leaves it folded.
  await props.locator('.sc-pcollapse').click();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect((await panel.boundingBox()).width).toBeLessThan(50);
  await expect(page.locator('#sc-panel > .sc-pgroup:visible')).toHaveCount(0);
  await expect(page.locator('.sc-dock-icon')).toHaveCount(7);

  // An icon pops its panel out, on that tab, left of the strip.
  await icon('Character').click();
  await expect(popout).toHaveCount(1);
  await expect(page.locator('[data-pane="character"]')).toBeVisible();
  await expect(icon('Character')).toHaveAttribute('aria-pressed', 'true');
  const pb = await popout.boundingBox();
  expect(pb.x + pb.width).toBeLessThanOrEqual((await panel.boundingBox()).x);
  // The same icon again puts it away; another icon swaps it.
  await icon('Character').click();
  await expect(popout).toHaveCount(0);
  await icon('Properties').click();
  await expect(page.locator('[data-pane="props"]')).toBeVisible();
  await expect(popout.locator('.sc-pcollapse')).toBeHidden();
  // Esc, or a click elsewhere, puts it away.
  await page.keyboard.press('Escape');
  await expect(popout).toHaveCount(0);
  await expect(props).toHaveClass(/collapsed/);
  await icon('Layers').click();
  await expect(page.locator('#sc-layers')).toBeVisible();
  await page.mouse.click(400, 400);
  await expect(popout).toHaveCount(0);

  // A menu command that shows a panel pops it out.
  await menu(page, 'Type', 'showCharacter');
  await expect(page.locator('[data-pane="character"]')).toBeVisible();
  await expect(icon('Character')).toHaveAttribute('aria-pressed', 'true');

  // Remembered after a reload; « brings the panels back.
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('#sc-appearance')).toBeVisible();
  expect((await panel.boundingBox()).width).toBeGreaterThan(250);
  await expect(props).toHaveClass(/collapsed/);
});

// Icons are inlined wherever they're used, some copies in hidden menus: an
// id (a gradient's, a clip's) would repeat, and Chrome draws nothing that
// points at one inside a hidden copy.
test('no icon relies on an id', async ({ page }) => {
  const bad = await page.evaluate(() =>
    Object.entries(window.SC_ICONS)
      .filter(([, svg]) => /\sid=|url\(#|href="#/.test(svg))
      .map(([k]) => k),
  );
  expect(bad).toEqual([]);
});
