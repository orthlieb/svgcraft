// Right-click menus: on the canvas (the "layers here" list, then
// what the selection can do) and in the Layers panel (a row, or its eye).
import { test, expect, load, select, toScreen } from './fixtures.js';

// a: red square, b: blue disc over its corner, g: a group of two.
const SCENE =
  '<rect id="a" x="100" y="100" width="200" height="200" fill="#f00"/>' +
  '<circle id="b" cx="280" cy="280" r="80" fill="#00f"/>' +
  '<g id="g"><rect id="c" x="500" y="100" width="60" height="60"/><rect id="d" x="600" y="100" width="60" height="60"/></g>';

const ctx = (page) => page.locator('#sc-ctx');
// The open menu's top-level entries, as text ('—' for a divider).
const entries = (page) =>
  ctx(page).evaluate((m) =>
    [...m.children].map((c) =>
      c.localName === 'hr'
        ? '—'
        : (c.querySelector(':scope > span, .sc-sub-btn > span')?.textContent || '').trim(),
    ),
  );
const sel = (page) => page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id).join(','));
async function rightClickDoc(page, x, y) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(ctx(page)).toBeVisible();
}
const item = (page, label) => ctx(page).locator(`button:has(> span:text-is("${label}"))`).first();
async function sub(page, label) {
  await ctx(page).locator(`.sc-sub-btn:has(> span:text-is("${label}"))`).hover();
  return ctx(page).locator('.sc-sub-list:not([hidden])');
}

test.beforeEach(async ({ page }) => {
  await load(page, SCENE);
});

test.describe('the canvas menu', () => {
  test('right-clicking a layer selects it and offers what it can do', async ({ page }) => {
    await select(page, 'a');
    await rightClickDoc(page, 330, 330);
    expect(await sel(page)).toBe('b');
    const e = await entries(page);
    for (const want of ['Cut', 'Copy', 'Duplicate', 'Free Transform', 'Arrange', 'Deselect'])
      expect(e).toContain(want);
    // Only what applies: one shape can't be ungrouped, distributed or traced.
    for (const not of ['Ungroup', 'Image Trace…', 'Create Outlines', 'Clear Effects'])
      expect(e).not.toContain(not);
    expect(e[0]).not.toBe('—');
    expect(e.at(-1)).not.toBe('—');
    expect(e.join()).not.toContain('—,—');
    await page.keyboard.press('Escape');
    await expect(ctx(page)).toBeHidden();
  });

  test('Objects Here lists the objects under the pointer, top first, to pick one', async ({
    page,
  }) => {
    await rightClickDoc(page, 250, 250);
    const list = await sub(page, 'Objects Here');
    await expect(list.locator('button')).toHaveText(['circle #b', 'rect #a']);
    await expect(list.locator('button').first()).toHaveAttribute('aria-checked', 'true');
    await list.locator('button:has-text("rect #a")').click();
    await expect(ctx(page)).toBeHidden();
    expect(await sel(page)).toBe('a');
  });

  test('a single layer under the pointer has no Objects Here', async ({ page }) => {
    await rightClickDoc(page, 120, 120);
    expect(await entries(page)).not.toContain('Objects Here');
  });

  test('a command runs from it, closes it, and undoes', async ({ page }) => {
    await rightClickDoc(page, 120, 120);
    await item(page, 'Duplicate').click();
    await expect(ctx(page)).toBeHidden();
    await expect(page.locator('#sc-doc > rect')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#sc-doc > rect')).toHaveCount(1);
  });

  test('its submenus run their commands', async ({ page }) => {
    await rightClickDoc(page, 120, 120);
    await (await sub(page, 'Arrange')).locator('button:has-text("Bring to Front")').click();
    expect(await page.evaluate(() => document.getElementById('sc-doc').lastElementChild.id)).toBe(
      'a',
    );
  });

  test('a group can be ungrouped; two layers can be grouped', async ({ page }) => {
    await rightClickDoc(page, 530, 130);
    expect(await sel(page)).toBe('g');
    expect(await entries(page)).toContain('Ungroup');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.svgcraft.state.sel = ['a', 'b'].map((id) => document.getElementById(id));
    });
    await rightClickDoc(page, 120, 120);
    expect(await sel(page), 'right-clicking inside the selection keeps it').toBe('a,b');
    expect(await entries(page)).toContain('Group');
    // Two can be aligned; distributing takes three.
    const align = await sub(page, 'Align');
    await expect(align).toContainText('Left Edges');
    await expect(align).not.toContainText('Horizontally');
  });

  test('with nothing selected or under it: paste, select all and zoom', async ({ page }) => {
    await select(page);
    await rightClickDoc(page, 700, 500);
    const e = await entries(page);
    expect(e).toEqual(expect.arrayContaining(['Select All', 'Fit on Screen', 'Zoom In']));
    expect(e).not.toContain('Cut');
    await item(page, 'Select All').click();
    expect(await sel(page)).toBe('a,b,g');
  });

  test('during Free Transform it offers the transform’s own commands', async ({ page }) => {
    await select(page, 'a');
    await page.keyboard.press('Alt+t');
    await rightClickDoc(page, 120, 120);
    const e = await entries(page);
    expect(e).toEqual(
      expect.arrayContaining(['Scale', 'Rotate', 'Rotate 180°', 'Commit Transform']),
    );
    expect(e).not.toContain('Cut');
    await item(page, 'Cancel Transform').click();
    await expect(ctx(page)).toBeHidden();
  });

  test('editing text keeps the browser’s own menu', async ({ page }) => {
    await load(page, '<text id="t" x="100" y="200" font-size="40">Hello</text>');
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef -- the editor's own global
      editTextLayer(document.getElementById('t'));
    });
    const prevented = await page.evaluate(() => {
      const ed = document.querySelector('.sc-type-edit');
      const r = ed.getBoundingClientRect();
      const e = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.x + 5,
        clientY: r.y + 5,
      });
      ed.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(ctx(page)).toBeHidden();
  });

  test('text and image layers get their own commands', async ({ page }) => {
    await load(
      page,
      '<text id="t" x="100" y="200" font-size="60">Hello</text>' +
        '<image id="i" x="400" y="100" width="100" height="100" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="/>',
    );
    await rightClickDoc(page, 150, 185);
    expect(await entries(page)).toEqual(expect.arrayContaining(['Create Outlines']));
    await page.keyboard.press('Escape');
    await rightClickDoc(page, 450, 150);
    expect(await sel(page)).toBe('i');
    expect(await entries(page)).toContain('Image Trace…');
  });

  test('works from the keyboard: arrows, a submenu and Enter', async ({ page }) => {
    await rightClickDoc(page, 120, 120);
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'Cut')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item(page, 'Fit to Selection')).toBeFocused();
    for (const b of await ctx(page).locator(':scope > button, .sc-sub-btn').all())
      if ((await b.textContent()).includes('Arrange')) await b.focus();
    await page.keyboard.press('ArrowRight');
    const list = ctx(page).locator('.sc-sub-list:not([hidden])');
    await expect(list.locator('button').first()).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(list).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(ctx(page)).toBeHidden();
  });
});

test.describe('the Layers panel menus', () => {
  const row = (page, name) => page.locator(`#sc-layers li:has(.sc-layer-name:text-is("${name}"))`);

  test('a row: selects it, renames it and runs layer commands', async ({ page }) => {
    await select(page, 'b');
    await row(page, 'rect #a').click({ button: 'right' });
    await expect(ctx(page)).toBeVisible();
    expect(await sel(page)).toBe('a');
    const e = await entries(page);
    expect(e).toEqual(
      expect.arrayContaining(['Rename Layer…', 'Duplicate', 'Delete', 'Merge Visible']),
    );
    expect(e).not.toContain('Free Transform');
    await item(page, 'Rename Layer…').click();
    await page.keyboard.type('Square');
    await page.keyboard.press('Enter');
    await expect(row(page, 'Square')).toHaveCount(1);
  });

  test('Copy and Paste Layer Style carry effects, blend mode and opacity', async ({ page }) => {
    await page.evaluate(() => {
      const a = document.getElementById('a');
      a.setAttribute('data-sc-fx', JSON.stringify({ ds: { on: true } }));
      a.style.mixBlendMode = 'multiply';
      a.setAttribute('opacity', '0.5');
      window.svgcraft.commit();
    });
    await row(page, 'rect #a').click({ button: 'right' });
    await item(page, 'Copy Effects').click();
    await row(page, 'circle #b').click({ button: 'right' });
    await item(page, 'Paste Effects').click();
    const b = await page.evaluate(() => {
      const b = document.getElementById('b');
      return [!!b.getAttribute('data-sc-fx'), b.style.mixBlendMode, b.getAttribute('opacity')];
    });
    expect(b).toEqual([true, 'multiply', '0.5']);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => document.getElementById('b').hasAttribute('data-sc-fx'))).toBe(
      false,
    );
  });

  test('the eye: hide this layer, or every other layer', async ({ page }) => {
    const shown = () =>
      page.evaluate(() =>
        ['a', 'b', 'g', 'c', 'd']
          .filter((id) => document.getElementById(id).getAttribute('display') !== 'none')
          .join(','),
      );
    await row(page, 'rect #c').locator('.sc-eye').click({ button: 'right' });
    await item(page, 'Hide All Others').click();
    expect(await shown()).toBe('g,c');
    await row(page, 'rect #c').locator('.sc-eye').click({ button: 'right' });
    await item(page, 'Show All Others').click();
    expect(await shown()).toBe('a,b,g,c,d');
    await row(page, 'rect #c').locator('.sc-eye').click({ button: 'right' });
    await item(page, 'Hide This').click();
    expect(await shown()).toBe('a,b,g,d');
  });
});

test.describe('only what would do something', () => {
  test('Arrange offers only the ways the layer can go', async ({ page }) => {
    // a is the bottom layer: it can only come up.
    await rightClickDoc(page, 150, 150);
    expect(await sel(page)).toBe('a');
    await expect((await sub(page, 'Arrange')).locator('button > span')).toHaveText([
      'Bring to Front',
      'Bring Forward',
    ]);
    await page.keyboard.press('Escape');
    // g is on top: it can only go down.
    await rightClickDoc(page, 530, 130);
    await expect((await sub(page, 'Arrange')).locator('button > span')).toHaveText([
      'Send Backward',
      'Send to Back',
    ]);
  });

  test('Copy Layer Style needs a style; Select Inverse needs something left', async ({ page }) => {
    await rightClickDoc(page, 150, 150);
    expect(await entries(page)).not.toContain('Copy Effects');
    expect(await entries(page)).toContain('Select Inverse');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.getElementById('a').setAttribute('data-sc-fx', '{"shadow":{"on":true}}');
      window.svgcraft.commit();
    });
    await rightClickDoc(page, 150, 150);
    expect(await entries(page)).toContain('Copy Effects');
    await page.keyboard.press('Escape');
    // Everything selected: nothing left to invert to.
    await page.keyboard.press('Control+a');
    await rightClickDoc(page, 150, 150);
    expect(await entries(page)).not.toContain('Select Inverse');
  });

  test('100% only when not at 100%', async ({ page }) => {
    await rightClickDoc(page, 760, 560);
    expect(await entries(page)).toContain('100%');
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-undef -- the editor's own global
    await page.evaluate(() => zoomAt(1));
    await rightClickDoc(page, 400, 400);
    expect(await entries(page)).not.toContain('100%');
  });

  test('Play Animations when something is animated, Stop while it plays', async ({ page }) => {
    await rightClickDoc(page, 760, 560);
    expect(await entries(page)).not.toContain('Play Animations');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.getElementById('a').setAttribute('data-sc-anim', '[{"p":"spin","rep":0}]');
      window.svgcraft.commit();
    });
    await rightClickDoc(page, 760, 560);
    await item(page, 'Play Animations').click();
    await expect(ctx(page)).toBeHidden();
    expect(await page.evaluate(() => animPlay.playing)).toBe(true); // eslint-disable-line no-undef
    await rightClickDoc(page, 760, 560);
    await item(page, 'Stop Animations').click();
    expect(await page.evaluate(() => animPlay.playing)).toBe(false); // eslint-disable-line no-undef
  });
});
