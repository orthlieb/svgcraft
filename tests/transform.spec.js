// Edit → Transform submenu, the quick rotate commands, and the Free Transform
// session (numeric fields, Again with Copy, handle modes, cancel / commit).
import { test, expect, load, select, action, toScreen } from './fixtures.js';

const RECT = '<rect id="r" x="100" y="100" width="200" height="100" fill="#2563eb"/>';
const NESTED =
  '<g id="g" transform="translate(500 300) scale(2)"><rect id="n" x="0" y="0" width="40" height="20" fill="#dc2626"/></g>';

// Doc-space corners (TL, TR, BR, BL of the bbox) of an element, through every
// transform between it and the document.
const corners = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const M = document.getElementById('sc-view').getCTM().inverse().multiply(el.getCTM());
    const r = el.getBBox();
    return [
      [r.x, r.y],
      [r.x + r.width, r.y],
      [r.x + r.width, r.y + r.height],
      [r.x, r.y + r.height],
    ].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(M);
      return [p.x, p.y];
    });
  }, id);

function expectCorners(actual, want, digits = 2) {
  expect(actual).toHaveLength(want.length);
  actual.forEach(([x, y], i) => {
    expect(x, `corner ${i} x`).toBeCloseTo(want[i][0], digits);
    expect(y, `corner ${i} y`).toBeCloseTo(want[i][1], digits);
  });
}

const extent = (c) => {
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

// Rotate (x, y) by `deg` (clockwise on screen, as SVG's y-down rotate) about (cx, cy).
const rotate = ([x, y], deg, cx, cy) => {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

const field = (page, k) => page.locator(`.sc-opt.on [data-tf="${k}"]`);
async function setField(page, k, v) {
  await field(page, k).fill(String(v));
  await field(page, k).press('Enter');
}
const tfOpen = (page) => page.evaluate(() => !!window.svgcraft.state.tf);

// The Edit menu's Transform submenu (Object has a Combine Shapes one too).
const transformSub = (page) =>
  page
    .locator('.sc-submenu')
    .filter({ has: page.locator('.sc-sub-btn', { hasText: 'Transform' }) });

test.describe('Edit → Transform submenu', () => {
  test('opens on hover and lists its ten commands', async ({ page }) => {
    await page.click('.sc-menu-btn:text-is("Edit")');
    const sub = transformSub(page);
    await sub.locator('.sc-sub-btn').hover();
    await expect(page.locator('.sc-sub-list:not([hidden])')).toHaveCount(1);
    await expect(sub.locator('.sc-sub-list')).toBeVisible();
    await expect(sub.locator('.sc-sub-list button')).toHaveCount(10);
  });

  test('keyboard: ArrowRight enters the submenu, ArrowLeft leaves it', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await page.focus('.sc-menu-btn:text-is("Edit")');
    await page.keyboard.press('ArrowDown');
    const onSubBtn = () =>
      page.evaluate(() => document.activeElement.classList.contains('sc-sub-btn'));
    for (let i = 0; i < 12 && !(await onSubBtn()); i++) await page.keyboard.press('ArrowDown');
    expect(await onSubBtn()).toBe(true);

    const sub = transformSub(page);
    await page.keyboard.press('ArrowRight');
    // Nothing transformed yet, so Again is greyed out and skipped.
    await expect(sub.locator('[data-action="again"]')).toBeDisabled();
    await expect(sub.locator('[data-action="tfScale"]')).toBeFocused();
    await expect(page.locator(':focus')).toHaveText(/^\s*Scale\s*$/);

    await page.keyboard.press('ArrowLeft');
    await expect(sub.locator('.sc-sub-btn')).toBeFocused();
    await expect(page.locator(':focus')).toHaveText(/^\s*Transform\s*$/);
    await expect(sub.locator('.sc-sub-list')).toBeHidden();
  });
});

test.describe('quick rotate commands', () => {
  test('Rotate 90° CW turns the shape about its centre', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'rot90cw');
    // 200×100 centred on (200, 150) → 100×200, same centre.
    expectCorners(await corners(page, 'r'), [
      [250, 50],
      [250, 250],
      [150, 250],
      [150, 50],
    ]);
  });

  test('180° + 90° CCW + 90° CCW composes to a net 90° CW turn', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    for (const a of ['rot90cw', 'rot180', 'rot90ccw', 'rot90ccw']) await action(page, a);
    // 90 + 180 − 90 − 90 = 90°: the same corners as a single clockwise turn.
    expectCorners(await corners(page, 'r'), [
      [250, 50],
      [250, 250],
      [150, 250],
      [150, 50],
    ]);
  });

  test('rotating a layer inside a scaled group keeps its centre', async ({ page }) => {
    await load(page, RECT + NESTED);
    await select(page, 'n');
    const before = extent(await corners(page, 'n'));
    expect(before.w).toBeCloseTo(80, 2);
    expect(before.h).toBeCloseTo(40, 2);
    await action(page, 'rot90cw');
    const after = extent(await corners(page, 'n'));
    expect(after.cx).toBeCloseTo(before.cx, 2);
    expect(after.cy).toBeCloseTo(before.cy, 2);
    expect(after.w).toBeCloseTo(40, 2);
    expect(after.h).toBeCloseTo(80, 2);
    await page.keyboard.press('Control+z');
    expectCorners(await corners(page, 'n'), [
      [500, 300],
      [580, 300],
      [580, 340],
      [500, 340],
    ]);
  });
});

test.describe('Free Transform', () => {
  test('menu command opens the session with its options bar', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'freeTransform');
    await expect(page.locator('#sc-opt-name')).toHaveText('Free Transform');
    await expect(page.locator('.sc-opt.on [data-tf]')).toHaveCount(7);
    expect(await tfOpen(page)).toBe(true);
  });

  test('angle field rotates about the centre; Enter commits the session', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'freeTransform');
    await setField(page, 'angle', 30);
    const c = await corners(page, 'r');
    expectCorners(
      c,
      [
        [100, 100],
        [300, 100],
        [300, 200],
        [100, 200],
      ].map((p) => rotate(p, 30, 200, 150)),
    );
    // Top-left lands at (138.40, 56.70).
    expect(c[0][0]).toBeCloseTo(138.4, 1);
    expect(c[0][1]).toBeCloseTo(56.7, 1);

    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.svgcraft.state.tf)).toBeNull();
    await expect(page.locator('#sc-opt-name')).toHaveText('Move');
  });

  test('Again with Copy repeats the last transform: 12 copies × 30° close the circle', async ({
    page,
  }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'freeTransform');
    await setField(page, 'angle', 30);
    await page.keyboard.press('Enter');
    for (let i = 0; i < 11; i++) await page.keyboard.press('Control+Alt+Shift+T');
    const angles = await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc > rect')].map((el) => {
        const m = el.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix();
        return ((((Math.atan2(m.b, m.a) * 180) / Math.PI) % 360) + 360) % 360;
      }),
    );
    expect(angles).toHaveLength(12);
    // Each copy turns 30° further: 30, 60, …, 330, 360 ≡ 0.
    angles.forEach((a, i) => {
      const want = (30 * (i + 1)) % 360;
      expect(Math.min(Math.abs(a - want), 360 - Math.abs(a - want)), `copy ${i + 1}`).toBeCloseTo(
        0,
        2,
      );
    });
  });

  test('Again with Copy builds on the shape’s existing rotation', async ({ page }) => {
    // The original check script's sequence: the rect was left at a net 90°
    // by rot90cw/rot180/rot90ccw/rot90ccw, so 90 + 12 × 30 ≡ 90°.
    await load(page, RECT);
    await select(page, 'r');
    for (const a of ['rot90cw', 'rot180', 'rot90ccw', 'rot90ccw']) await action(page, a);
    await action(page, 'freeTransform');
    await setField(page, 'angle', 30);
    const c = await corners(page, 'r');
    expectCorners(
      c,
      [
        [250, 50],
        [250, 250],
        [150, 250],
        [150, 50],
      ].map((p) => rotate(p, 30, 200, 150)),
    );
    expect(c[0][0]).toBeCloseTo(293.3, 1);
    expect(c[0][1]).toBeCloseTo(88.4, 1);
    await page.keyboard.press('Enter');
    for (let i = 0; i < 11; i++) await page.keyboard.press('Control+Alt+Shift+T');
    await expect(page.locator('#sc-doc > rect')).toHaveCount(12);
    const last = await page.evaluate(() => {
      const els = document.querySelectorAll('#sc-doc > rect');
      const m = els[els.length - 1].transform.baseVal.consolidate().matrix;
      return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    });
    expect(last).toBeCloseTo(90, 2);
  });

  test('numeric X / Y / W / H with and without the link, and skew', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await page.keyboard.press('Alt+t');
    await expect(field(page, 'x')).toHaveValue('100');
    await expect(field(page, 'y')).toHaveValue('100');
    await expect(field(page, 'w')).toHaveValue('200');
    await expect(field(page, 'h')).toHaveValue('100');

    await setField(page, 'w', 400);
    await expect(field(page, 'h')).toHaveValue('100');
    const br = (await corners(page, 'r'))[2];
    expect(br[0]).toBeCloseTo(500, 2);
    expect(br[1]).toBeCloseTo(200, 2);

    await page.click('#sc-tf-link');
    await setField(page, 'w', 200);
    await expect(field(page, 'h')).toHaveValue('50');

    await setField(page, 'x', 0);
    await setField(page, 'y', 10);
    const tl = (await corners(page, 'r'))[0];
    expect(tl[0]).toBeCloseTo(0, 2);
    expect(tl[1]).toBeCloseTo(10, 2);

    await setField(page, 'skx', 20);
    const sk = await corners(page, 'r');
    // A 20° horizontal skew of a 50-high box shifts the top edge by −h·tan 20°.
    expect(sk[0][0] - sk[3][0]).toBeCloseTo(-50 * Math.tan((20 * Math.PI) / 180), 2);
  });

  test('Esc cancels the whole session, leaving nothing to redo', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await page.keyboard.press('Alt+t');
    await setField(page, 'w', 400);
    await page.click('#sc-tf-link');
    await setField(page, 'w', 200);
    await setField(page, 'x', 0);
    await setField(page, 'skx', 20);

    // Clicking the bare stage doesn't end the session.
    await page.locator('#sc-stage').click({ position: { x: 5, y: 5 }, force: true });
    await page.evaluate(() => document.activeElement.blur());
    await select(page, 'r');
    expect(await tfOpen(page)).toBe(true);

    await page.keyboard.press('Escape');
    expectCorners(await corners(page, 'r'), [
      [100, 100],
      [300, 100],
      [300, 200],
      [100, 200],
    ]);
    expect(await page.evaluate(() => window.svgcraft.state.tf)).toBeNull();
    expect(await page.evaluate(() => window.svgcraft.state.sel.length)).toBe(1);
    await expect(page.locator('#sc-redo')).toBeDisabled();
  });

  test('Rotate mode: dragging a corner handle rotates about the centre', async ({ page }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'tfRotate');
    expect(await tfOpen(page)).toBe(true);
    await expect(page.locator('[data-handle="rot"]')).not.toHaveCount(0);
    const h = await page.locator('[data-handle="se"]').boundingBox();
    const from = { x: h.x + 4, y: h.y + 4 };
    const to = { x: h.x - 60, y: h.y + 80 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    // Expected angle: the pointer's sweep about the rect's centre.
    const c = await toScreen(page, 200, 150);
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const a1 = Math.atan2(to.y - c.y, to.x - c.x);
    const want = ((a1 - a0) * 180) / Math.PI;
    const shown = parseFloat(await field(page, 'angle').inputValue());
    expect(shown).not.toBeCloseTo(0, 0);
    expect(shown).toBeCloseTo(want, 0);
    expectCorners(
      await corners(page, 'r'),
      [
        [100, 100],
        [300, 100],
        [300, 200],
        [100, 200],
      ].map((p) => rotate(p, shown, 200, 150)),
      1,
    );
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.svgcraft.state.tf)).toBeNull();
  });

  test('Skew mode: dragging the top edge skews horizontally, bottom edge fixed', async ({
    page,
  }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'tfSkew');
    const hn = await page.locator('[data-handle="n"]').boundingBox();
    await page.mouse.move(hn.x + 4, hn.y + 4);
    await page.mouse.down();
    await page.mouse.move(hn.x + 44, hn.y + 4, { steps: 6 });
    await page.mouse.up();

    const s = await corners(page, 'r');
    expect(s[3][0]).toBeCloseTo(100, 2);
    expect(s[3][1]).toBeCloseTo(200, 2);
    expect(s[2][0]).toBeCloseTo(300, 2);
    expect(s[2][1]).toBeCloseTo(200, 2);
    // 40 screen px to the right, in doc units, over a 100-high box.
    const zoom = await page.evaluate(() => document.getElementById('sc-doc').getScreenCTM().a);
    const dx = 40 / zoom;
    expect(s[0][0]).toBeGreaterThan(100);
    expect(s[0][0]).toBeCloseTo(100 + dx, 1);
    expect(s[0][1]).toBeCloseTo(100, 2);
    const skx = parseFloat(await field(page, 'skx').inputValue());
    expect(skx).toBeCloseTo((-Math.atan(dx / 100) * 180) / Math.PI, 1);
  });

  test('Scale mode hides the rotate knob; switching tools commits the session', async ({
    page,
  }) => {
    await load(page, RECT);
    await select(page, 'r');
    await action(page, 'tfSkew');
    await page.keyboard.press('Enter');
    await action(page, 'tfScale');
    expect(await tfOpen(page)).toBe(true);
    await expect(page.locator('[data-handle="se"]')).toHaveCount(1);
    await expect(page.locator('[data-handle="rot"]')).toHaveCount(0);

    await setField(page, 'w', 300);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('b');
    expect(await page.evaluate(() => window.svgcraft.state.tf)).toBeNull();
    // Committed, not cancelled.
    expect((await corners(page, 'r'))[2][0]).toBeCloseTo(400, 2);
  });
});

test('the rotate handle shows a circle arrow, held while turning', async ({ page }) => {
  await load(page, RECT);
  await page.click('#r');
  const rot = page.locator('[data-handle="rot"]');
  await expect(rot).toHaveCount(1);
  const cursor = (loc) => loc.evaluate((el) => getComputedStyle(el).cursor);
  expect(await cursor(rot)).toMatch(/^url\(.*\) 12 12, grab$/);
  // The scale handles keep their resize arrows.
  expect(await cursor(page.locator('[data-handle="se"]'))).toBe('nwse-resize');

  const h = await rot.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 120, h.y + 60, { steps: 4 });
  expect(await cursor(page.locator('#sc-stage'))).toMatch(/^url\(/);
  await page.mouse.up();
  expect(await cursor(page.locator('#sc-stage'))).toBe('default');
  expect(await page.locator('#r').getAttribute('transform')).toContain('matrix');
});
