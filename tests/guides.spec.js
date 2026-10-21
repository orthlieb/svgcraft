import { test, expect, menu, toScreen, APP_URL } from './fixtures.js';

// Rulers, ruler guides, smart guides and snapping.

const A = (x = 100, y = 100) =>
  `<rect id="a" x="${x}" y="${y}" width="120" height="80" fill="#2563eb"/>`;
const B = '<rect id="b" x="400" y="300" width="100" height="100" fill="#dc2626"/>';

// Open the two-rect document, with guides given as "axis:pos …".
const open = (page, guides = '', a = A()) =>
  page.evaluate(
    ([g, a, b]) =>
      window.svgcraft.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"${g ? ` data-sc-guides="${g}"` : ''}>${a}${b}</svg>`,
        'g.svg',
      ),
    [guides, a, B],
  );

const guides = (page) =>
  page.evaluate(() => window.svgcraft.state.guides.map((g) => `${g.axis}:${g.pos}`).join(' '));

// #id's box in document coordinates: [x, y, w, h].
const box = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const v = document.getElementById('sc-view').getCTM().inverse();
    const r = el.getBBox();
    const p = new DOMPoint(r.x, r.y).matrixTransform(v.multiply(el.getCTM()));
    return [p.x, p.y, r.width, r.height];
  }, id);

function expectBox(b, want) {
  want.forEach((v, i) => expect(b[i], ['x', 'y', 'w', 'h'][i]).toBeCloseTo(v, 1));
}

const smartClasses = (page) =>
  page.locator('#sc-smart line').evaluateAll((ls) => ls.map((l) => l.getAttribute('class')));

// Drag with the mouse between two document points; `during` runs before
// the button is released and its result is returned.
async function dragDoc(page, a, z, { steps = 8, during } = {}) {
  const s = await toScreen(page, ...a);
  const t = await toScreen(page, ...z);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps });
  const out = await during?.();
  await page.mouse.up();
  return out;
}

const rulers = async (page) => ({
  h: await page.locator('#sc-ruler-h').boundingBox(),
  v: await page.locator('#sc-ruler-v').boundingBox(),
});

test.describe('rulers', () => {
  test('rulers sit along the top and left of the stage', async ({ page }) => {
    const { h, v } = await rulers(page);
    const st = await page.locator('#sc-stage').boundingBox();
    expect(Math.round(h.height)).toBe(18);
    expect(Math.round(v.width)).toBe(18);
    expect(Math.round(st.x - v.x)).toBe(18);
    expect(Math.round(st.y - h.y)).toBe(18);
  });

  test('the ruler canvas draws ticks', async ({ page }) => {
    // More than background + one colour means something was drawn on it.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.getElementById('sc-ruler-h');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          const set = new Set();
          for (let i = 0; i < d.length; i += 4) set.add(d[i] + ',' + d[i + 1]);
          return set.size;
        }),
      )
      .toBeGreaterThan(2);
  });
});

test.describe('ruler guides', () => {
  test('guides are dragged out of the top and left rulers', async ({ page }) => {
    await open(page);
    const { h, v } = await rulers(page);
    let t = await toScreen(page, 300, 250);
    await page.mouse.move(h.x + 200, h.y + 8);
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 6 });
    await page.mouse.up();
    t = await toScreen(page, 400, 300);
    await page.mouse.move(v.x + 8, v.y + 200);
    await page.mouse.down();
    // A fraction of a pixel off still lands on a whole unit.
    await page.mouse.move(t.x + 0.4, t.y, { steps: 6 });
    await page.mouse.up();
    expect(await guides(page)).toBe('y:250 x:400');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(2);
  });

  test('the Move tool drags a guide, Shift stepping in 10s', async ({ page }) => {
    await open(page, 'y:250 x:400');
    await page.keyboard.press('v');
    const g0 = await toScreen(page, 400, 50);
    const g1 = await toScreen(page, 603, 50);
    await page.mouse.move(g0.x, g0.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(g1.x, g1.y, { steps: 5 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    expect(await guides(page)).toBe('y:250 x:600');
  });

  test('dragging a guide onto a ruler deletes it, and undo brings it back', async ({ page }) => {
    await open(page, 'y:250 x:600');
    await page.keyboard.press('v');
    const { h } = await rulers(page);
    const g0 = await toScreen(page, 700, 250);
    await page.mouse.move(g0.x, g0.y);
    await page.mouse.down();
    await page.mouse.move(g0.x, h.y + 5, { steps: 5 });
    await page.mouse.up();
    expect(await guides(page)).toBe('x:600');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    expect(await guides(page)).toBe('y:250 x:600');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(2);
  });
});

test.describe('snapping', () => {
  test('a rect corner drawn near a guide snaps onto it', async ({ page }) => {
    await open(page, 'y:250 x:600');
    await page.keyboard.press('r');
    await dragDoc(page, [150, 254], [250, 330], { steps: 4 });
    const r = page.locator('#sc-doc rect').last();
    await expect(page.locator('#sc-doc rect')).toHaveCount(3);
    await expect(r).toHaveAttribute('y', '250');
  });

  test('moving a shape snaps its edge to a guide and shows a smart guide', async ({ page }) => {
    await open(page, 'y:250 x:600');
    await page.keyboard.press('v');
    // Right edge 220 + 377 = 597, 3 short of the guide.
    const during = await dragDoc(page, [160, 140], [160 + 377, 140 + 13], {
      during: () => smartClasses(page),
    });
    expectBox(await box(page, 'a'), [480, 113, 120, 80]);
    expect(during).toContain('sc-smart guide');
    await expect(page.locator('#sc-smart line')).toHaveCount(0);
  });

  test('moving a shape snaps its centre to the artboard centre', async ({ page }) => {
    await open(page, 'y:250 x:600', A(480, 113));
    await page.keyboard.press('v');
    // Centre 540 - 138 = 402, 2 off the artboard centre 400.
    const during = await dragDoc(page, [540, 160], [540 - 138, 160 + 3], {
      during: () => smartClasses(page),
    });
    expectBox(await box(page, 'a'), [340, 116, 120, 80]);
    expect(during).toContain('sc-smart board');
  });

  test('moving a shape snaps its edges to another object', async ({ page }) => {
    await open(page, 'y:250 x:600', A(340, 116));
    await page.keyboard.press('v');
    // Right edge 460 + 37 = 497, 3 short of b's right edge (500). (Its top,
    // y=300, isn't used: that's also the artboard's centre line.)
    let during = await dragDoc(page, [400, 140], [400 + 37, 140], {
      during: () => smartClasses(page),
    });
    expectBox(await box(page, 'a'), [380, 116, 120, 80]);
    expect(during).toContain('sc-smart obj');
    // The old script's drag: 116 + 158 puts a's bottom at 354, 4 off b's
    // vertical centre (350), so the top lands at 270, not on b's top.
    await page.keyboard.press('Control+z');
    expectBox(await box(page, 'a'), [340, 116, 120, 80]);
    during = await dragDoc(page, [400, 140], [400, 140 + 158], {
      during: () => smartClasses(page),
    });
    expectBox(await box(page, 'a'), [340, 270, 120, 80]);
    expect(during).toContain('sc-smart obj');
  });

  test('holding Ctrl moves freely without snapping', async ({ page }) => {
    await open(page, 'y:250 x:600', A(340, 300));
    await page.keyboard.press('v');
    // Top 300 → 303 sits within snapping range of b's top, but Ctrl is held.
    // Grab a left of b (they overlap from x=400), or b gets moved instead.
    const s = await toScreen(page, 360, 340);
    const t = await toScreen(page, 360, 343);
    await page.mouse.move(s.x, s.y);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const b = await box(page, 'a');
    expect(b[0]).toBeCloseTo(340, 1);
    expect(b[1]).toBeCloseTo(303, 0);
  });
});

test.describe('guides in files', () => {
  test('the export carries guides and reopening restores them', async ({ page }) => {
    await open(page, 'y:250 x:600');
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    expect(svg).toContain('data-sc-guides="y:250 x:600"');
    await page.evaluate(() => window.svgcraft.state.guides.splice(0));
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'rt.svg'), svg);
    expect(await guides(page)).toBe('y:250 x:600');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(2);
  });

  test('copying a selection leaves the guides out', async ({ page }) => {
    await open(page, 'y:250 x:600');
    const svg = await page.evaluate(() => {
      const s = window.svgcraft;
      s.state.sel = [document.getElementById('a')];
      return s.serialize({ selection: true });
    });
    expect(svg).toContain('id="a"');
    expect(svg).not.toMatch(/data-sc-guides/);
  });

  test('guides in an opened file are read', async ({ page }) => {
    await page.evaluate(() =>
      window.svgcraft.openSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" data-sc-guides="x:200 x:600 y:150 y:450"><rect x="250" y="200" width="300" height="200" rx="20" fill="#7c3aed"/></svg>',
        'layout.svg',
      ),
    );
    expect(await guides(page)).toBe('x:200 x:600 y:150 y:450');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(4);
  });
});

test.describe('View menu', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'y:250 x:600');
  });

  test('New Guide… adds a guide at a typed position', async ({ page }) => {
    await menu(page, 'View', 'newGuide');
    await page.check('input[name="sc-ng-axis"][value="x"]');
    await page.fill('#sc-newguide input[type="number"]', '123');
    await page.keyboard.press('Enter');
    expect(await guides(page)).toBe('y:250 x:600 x:123');
  });

  test('Lock Guides stops guides being dragged', async ({ page }) => {
    await page.keyboard.press('v');
    await menu(page, 'View', 'toggleLockGuides');
    await expect(page.locator('[data-action="toggleLockGuides"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const lg = await toScreen(page, 600, 500);
    await page.mouse.move(lg.x, lg.y);
    await page.mouse.down();
    await page.mouse.move(lg.x + 60, lg.y, { steps: 3 });
    await page.mouse.up();
    expect(await guides(page)).toBe('y:250 x:600');
    // Unlocked, the same drag moves it.
    await menu(page, 'View', 'toggleLockGuides');
    await page.mouse.move(lg.x, lg.y);
    await page.mouse.down();
    await page.mouse.move(lg.x + 60, lg.y, { steps: 3 });
    await page.mouse.up();
    expect(await guides(page)).not.toBe('y:250 x:600');
  });

  test('Show Guides hides and shows them', async ({ page }) => {
    await menu(page, 'View', 'toggleGuides');
    await expect(page.locator('#sc-guidelines line')).toHaveCount(0);
    await menu(page, 'View', 'toggleGuides');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(2);
  });

  test('Rulers off puts the stage at the wrapper origin', async ({ page }) => {
    await menu(page, 'View', 'toggleRulers');
    await expect(page.locator('#sc-ruler-h')).toBeHidden();
    const off = await page.evaluate(() => {
      const w = document.getElementById('sc-stage-wrap').getBoundingClientRect();
      const s = document.getElementById('sc-stage').getBoundingClientRect();
      return [Math.round(s.x - w.x), Math.round(s.y - w.y)];
    });
    expect(off).toEqual([0, 0]);
    await menu(page, 'View', 'toggleRulers');
    await expect(page.locator('#sc-ruler-h')).toBeVisible();
  });

  test('Clear Guides removes them all', async ({ page }) => {
    await menu(page, 'View', 'clearGuides');
    expect(await guides(page)).toBe('');
    await expect(page.locator('#sc-guidelines .sc-guide')).toHaveCount(0);
  });

  // The page fixture clears localStorage again on page.reload(), so load the
  // app in a second page of the same context, which shares its storage.
  test('the Rulers setting persists to the next load', async ({ page }) => {
    const rulersOnNextLoad = async () => {
      const p2 = await page.context().newPage();
      const errs = [];
      p2.on('pageerror', (e) => errs.push(e.message));
      await p2.goto(APP_URL);
      await p2.waitForFunction(() => !!window.svgcraft);
      const on = await p2.evaluate(() => [
        window.svgcraft.state.rulers,
        !document.getElementById('sc-stage-wrap').classList.contains('no-rulers'),
      ]);
      await p2.close();
      expect(errs).toEqual([]);
      return on;
    };
    await menu(page, 'View', 'toggleRulers');
    expect(await rulersOnNextLoad()).toEqual([false, false]);
    await menu(page, 'View', 'toggleRulers');
    expect(await rulersOnNextLoad()).toEqual([true, true]);
  });
});
