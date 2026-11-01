// Image → Crop to Drawing / Selection, and Select → Inverse / All / Deselect.
import { test, expect, load, menu, menuOff, action } from './fixtures.js';

// a: filled rect, b: stroked circle (stroke 10), c: hidden, d: nested in g.
const SCENE =
  '<rect id="a" x="100.5" y="120" width="100" height="50" fill="#f00"/>' +
  '<circle id="b" cx="400" cy="300" r="50" fill="none" stroke="#00f" stroke-width="10"/>' +
  '<rect id="c" x="0" y="0" width="20" height="20" display="none"/>' +
  '<g id="g"><rect id="d" x="500" y="400" width="40" height="40"/></g>';

// Artboard size, the doc-space geometry top-left of a/b, the selection,
// the status message and the guides.
const info = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    const corner = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const b = el.getBBox();
      const m = document.getElementById('sc-doc').getCTM().inverse().multiply(el.getCTM());
      const p = new DOMPoint(b.x, b.y).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    return {
      w: s.w,
      h: s.h,
      a: corner('a'),
      b: corner('b'),
      sel: s.sel.map((e) => e.id).join(','),
      // The status bar's news, or an error shown above it.
      msg:
        document.getElementById('sc-msg').textContent ||
        (!document.getElementById('sc-alert').hidden &&
          document.getElementById('sc-alert-text').textContent) ||
        '',
      guides: s.guides.map((g) => g.axis + g.pos).join(' '),
    };
  });

const screenPos = (page, id) =>
  page.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: r.x, y: r.y };
  }, id);

const selectIds = (page, ...ids) =>
  page.evaluate((ids) => {
    window.svgcraft.setTool('select');
    window.svgcraft.state.sel = ids.map((id) => document.getElementById(id));
    window.svgcraft.syncActions();
  }, ids);

function expectPoint(p, x, y) {
  expect(p.x).toBeCloseTo(x, 2);
  expect(p.y).toBeCloseTo(y, 2);
}

test.describe('Crop to Drawing', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, SCENE, 800, 600, 'c.svg');
    // Pushed straight into state, so it isn't part of any history entry.
    await page.evaluate(() => window.svgcraft.state.guides.push({ axis: 'x', pos: 150 }));
  });

  test('fits the artboard to the paint box of the visible drawing', async ({ page }) => {
    await menu(page, 'Object', 'cropToDrawing');
    const i = await info(page);
    expect([i.w, i.h]).toEqual([440, 320]);
    expect(i.msg).toBe('Cropped to the drawing: 440 × 320 px.');
  });

  test('shifts content and guides by the crop corner', async ({ page }) => {
    await menu(page, 'Object', 'cropToDrawing');
    const i = await info(page);
    expectPoint(i.a, 0.5, 0);
    expectPoint(i.b, 250, 130);
    expect(i.guides).toBe('x50');
  });

  test('nothing jumps on screen', async ({ page }) => {
    const before = await screenPos(page, 'a');
    await menu(page, 'Object', 'cropToDrawing');
    const after = await screenPos(page, 'a');
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('undo restores size and position (unhistoried guide is gone)', async ({ page }) => {
    await menu(page, 'Object', 'cropToDrawing');
    await menu(page, 'Edit', 'undo');
    const i = await info(page);
    expect([i.w, i.h]).toEqual([800, 600]);
    expectPoint(i.a, 100.5, 120);
    // The guide was never committed, so the restored snapshot has none.
    expect(i.guides).toBe('');
  });

  test('stroke scales with the element transform', async ({ page }) => {
    await load(
      page,
      '<rect id="a" x="0" y="0" width="100" height="100" fill="none" stroke="#000" stroke-width="4" transform="translate(300 200) scale(2)"/>',
    );
    await menu(page, 'Object', 'cropToDrawing');
    const i = await info(page);
    expect([i.w, i.h]).toEqual([208, 208]);
    const vb = await page.evaluate(() => window.svgcraft.serialize().match(/viewBox="[^"]*"/)[0]);
    expect(vb).toBe('viewBox="0 0 208 208"');
  });

  test('an empty drawing says there is nothing to crop to', async ({ page }) => {
    await load(page, '<rect id="c" x="0" y="0" width="20" height="20" display="none"/>');
    await menu(page, 'Object', 'cropToDrawing');
    const i = await info(page);
    expect(i.msg).toBe('There’s nothing visible to crop to.');
    expect([i.w, i.h]).toEqual([800, 600]);
  });
});

test.describe('Crop to Selection', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, SCENE, 800, 600, 'c.svg');
  });

  test('crops to the selection including its stroke', async ({ page }) => {
    await selectIds(page, 'b');
    await menu(page, 'Object', 'cropToSelection');
    const i = await info(page);
    expect([i.w, i.h]).toEqual([110, 110]);
    expectPoint(i.b, 5, 5);
  });

  test('a second crop reports the artboard already fits', async ({ page }) => {
    await selectIds(page, 'b');
    await menu(page, 'Object', 'cropToSelection');
    await menu(page, 'Object', 'cropToSelection');
    const i = await info(page);
    expect(i.msg).toBe('The artboard already fits the selection.');
    expect([i.w, i.h]).toEqual([110, 110]);
  });

  test('with nothing selected it asks for a selection', async ({ page }) => {
    await selectIds(page);
    await menuOff(page, 'Object', 'cropToSelection');
    await action(page, 'cropToSelection');
    const i = await info(page);
    expect(i.msg).toBe('Select something to crop to.');
    expect([i.w, i.h]).toEqual([800, 600]);
  });
});

test.describe('Select menu', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, SCENE, 800, 600, 'c.svg');
  });

  test('Inverse of a top-level item skips hidden items', async ({ page }) => {
    await selectIds(page, 'a');
    await menu(page, 'Select', 'invertSelection');
    expect((await info(page)).sel).toBe('b,g');
  });

  test('Shift+F7 and Ctrl+Shift+I invert the selection', async ({ page }) => {
    await selectIds(page, 'a');
    await menu(page, 'Select', 'invertSelection');
    await page.keyboard.press('Shift+F7');
    expect((await info(page)).sel).toBe('a');
    await page.keyboard.press('Control+Shift+I');
    expect((await info(page)).sel).toBe('b,g');
  });

  test('Inverse of a nested item works at leaf level', async ({ page }) => {
    await selectIds(page, 'd');
    await menu(page, 'Select', 'invertSelection');
    expect((await info(page)).sel).toBe('a,b');
  });

  test('All selects visible top-level items, Deselect clears', async ({ page }) => {
    await menu(page, 'Select', 'selectAll');
    expect((await info(page)).sel).toBe('a,b,g');
    await menu(page, 'Select', 'deselect');
    expect((await info(page)).sel).toBe('');
  });
});
