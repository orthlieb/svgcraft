import { test, expect, load, select, action, stageBox } from './fixtures.js';

// Stroke Align (Inside / Center / Outside). Results are checked by
// rasterising the exported SVG to a canvas and sampling pixels, since what
// matters is what the stroke looks like, not how the clip / mask is built.

const props = '#sc-appearance';

// Colour names of the export at doc points (the doc is 300 × 200).
const px = (page, pts) =>
  page.evaluate(async (pts) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 300, 200);
    return pts.map(([a, b]) => {
      const d = x.getImageData(a, b, 1, 1).data;
      if (d[3] < 20) return 'clear';
      if (d[0] > 200 && d[2] < 80) return 'red';
      if (d[2] > 200 && d[0] < 80) return 'blue';
      return d.join(',');
    });
  }, pts);

// The aligned clip / mask is synced in a microtask, so poll the pixels.
const expectPx = (page, pts, want) => expect.poll(() => px(page, pts)).toEqual(want);

// Width field, checked alignment button, and #a's drawn stroke-width.
const ui = (page) =>
  page.evaluate(
    (props) => ({
      w: document.querySelector(`${props} [data-bind="strokeWidth"]`).value,
      on: [...document.querySelectorAll(`${props} [data-stroke-align]`)].find(
        (b) => b.getAttribute('aria-checked') === 'true',
      )?.dataset.strokeAlign,
      attr: document.getElementById('a')?.getAttribute('stroke-width'),
    }),
    props,
  );

const align = (page, k) => page.click(`${props} button[data-stroke-align="${k}"]`);
const saDefs = (page) => page.locator('#sc-defs [data-sc-sa]');

async function setWidth(page, v) {
  const w = page.locator(`${props} [data-bind="strokeWidth"]`);
  await w.fill(String(v));
  await w.press('Enter');
  // Leave the field so Ctrl+Z reaches the app, not the input's text undo.
  await w.blur();
}

// A 100 × 100 square at 100..200 × 50..150 with a 20-wide red stroke.
const RECT = (fill = '#00f', extra = '') =>
  `<rect id="a" x="100" y="50" width="100" height="100" fill="${fill}" stroke="#f00" stroke-width="20" ${extra}/>`;

// Probes along y=100 crossing the left edge (x=100): 15 and 5 outside,
// 5 and 15 inside, and the centre.
const P = [
  [85, 100],
  [95, 100],
  [105, 100],
  [115, 100],
  [150, 100],
];

test.describe('filled rect', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, RECT(), 300, 200);
    await select(page, 'a');
  });

  test('center straddles the edge', async ({ page }) => {
    await expectPx(page, P, ['clear', 'red', 'red', 'blue', 'blue']);
    expect(await ui(page)).toEqual({ w: '20', on: 'center', attr: '20' });
  });

  test('inside draws the stroke within the shape', async ({ page }) => {
    await align(page, 'inside');
    await expectPx(page, P, ['clear', 'clear', 'red', 'red', 'blue']);
    // Drawn twice as wide and clipped; the field still shows the set width.
    expect(await ui(page)).toEqual({ w: '20', on: 'inside', attr: '40' });
    await expect(page.locator('#a')).toHaveAttribute('clip-path', /^url\(#sc-sa-\d+\)$/);
  });

  test('outside draws the stroke beyond the shape', async ({ page }) => {
    await align(page, 'outside');
    await expectPx(page, P, ['red', 'red', 'blue', 'blue', 'blue']);
    expect(await ui(page)).toEqual({ w: '20', on: 'outside', attr: '40' });
    await expect(page.locator('#a')).toHaveAttribute('paint-order', 'stroke');
  });

  test('back to center restores the stroke and drops the defs', async ({ page }) => {
    await align(page, 'inside');
    await expect(saDefs(page)).toHaveCount(1);
    await align(page, 'outside');
    await align(page, 'center');
    await expectPx(page, P, ['clear', 'red', 'red', 'blue', 'blue']);
    expect(await ui(page)).toEqual({ w: '20', on: 'center', attr: '20' });
    await expect(saDefs(page)).toHaveCount(0);
    await expect(page.locator('#a')).not.toHaveAttribute('clip-path', /./);
    await expect(page.locator('#a')).not.toHaveAttribute('paint-order', /./);
  });

  test('a duplicate gets its own clip', async ({ page }) => {
    await align(page, 'inside');
    await action(page, 'duplicate');
    await expect(page.locator('#sc-doc rect')).toHaveCount(2);
    await expect(saDefs(page)).toHaveCount(2);
    const clips = await page
      .locator('#sc-doc rect')
      .evaluateAll((els) => els.map((e) => e.getAttribute('clip-path')));
    for (const c of clips) expect(c).toMatch(/^url\(#sc-sa-\d+\)$/);
    expect(new Set(clips).size).toBe(2);
  });
});

test.describe('unfilled rect', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, RECT('none'), 300, 200);
    await select(page, 'a');
  });

  test('outside with no fill masks the inner half', async ({ page }) => {
    await align(page, 'outside');
    await expectPx(page, P, ['red', 'red', 'clear', 'clear', 'clear']);
    await expect(page.locator('#a')).toHaveAttribute('mask', /^url\(#sc-sa-\d+\)$/);
    const id = (await page.locator('#a').getAttribute('mask')).slice(5, -1);
    await expect(page.locator(`#sc-defs mask#${id}[data-sc-sa]`)).toHaveCount(1);
    // The export carries the mask too.
    expect(await page.evaluate(() => window.svgcraft.serialize())).toMatch(
      new RegExp(`<mask[^>]*id="${id}"`),
    );
  });

  test('inside with no fill clips to the shape', async ({ page }) => {
    await align(page, 'outside');
    await align(page, 'inside');
    await expectPx(page, P, ['clear', 'clear', 'red', 'red', 'clear']);
    await expect(page.locator('#a')).not.toHaveAttribute('mask', /./);
    await expect(page.locator('#a')).toHaveAttribute('clip-path', /^url\(#sc-sa-\d+\)$/);
  });

  test('changing the width keeps the alignment', async ({ page }) => {
    await align(page, 'inside');
    await setWidth(page, 10);
    await expectPx(
      page,
      [
        [95, 100],
        [105, 100],
        [115, 100],
      ],
      ['clear', 'red', 'clear'],
    );
    expect(await ui(page)).toEqual({ w: '10', on: 'inside', attr: '20' });
  });

  test('the clip follows geometry changes, and undo / redo of them', async ({ page }) => {
    await align(page, 'inside');
    await setWidth(page, 10);
    // Widen the rect to 100..250 as a committed change.
    await page.evaluate(() => {
      document.getElementById('a').setAttribute('width', 150);
      window.svgcraft.commit();
    });
    await expectPx(
      page,
      [
        [245, 100],
        [255, 100],
        [195, 100],
      ],
      ['red', 'clear', 'clear'],
    );

    await page.keyboard.press('Control+z');
    await expect(page.locator('#a')).toHaveAttribute('width', '100');
    await expectPx(
      page,
      [
        [195, 100],
        [205, 100],
        [245, 100],
      ],
      ['red', 'clear', 'clear'],
    );

    await page.keyboard.press('Control+y');
    await expect(page.locator('#a')).toHaveAttribute('width', '150');
    await expectPx(
      page,
      [
        [245, 100],
        [255, 100],
        [195, 100],
      ],
      ['red', 'clear', 'clear'],
    );
  });

  test('undo of a width change restores the aligned stroke', async ({ page }) => {
    await align(page, 'inside');
    await setWidth(page, 10);
    await expectPx(
      page,
      [
        [105, 100],
        [115, 100],
      ],
      ['red', 'clear'],
    );
    await page.keyboard.press('Control+z');
    await expect(page.locator('#a')).toHaveAttribute('stroke-width', '40');
    await expect(page.locator('#a')).toHaveAttribute('data-stroke-align', 'inside');
    await expectPx(
      page,
      [
        [95, 100],
        [105, 100],
        [115, 100],
      ],
      ['clear', 'red', 'red'],
    );
  });
});

test('an open path cannot be aligned and stays centred', async ({ page }) => {
  await load(
    page,
    '<path id="a" d="M50 50 L200 50 L200 150" fill="none" stroke="#f00" stroke-width="20"/>',
    300,
    200,
  );
  await select(page, 'a');
  await align(page, 'inside');
  expect(await ui(page)).toEqual({ w: '20', on: 'center', attr: '20' });
  await expect(page.locator('#a')).not.toHaveAttribute('data-stroke-align', /./);
  await expect(saDefs(page)).toHaveCount(0);
});

test('a rect drawn with Outside set in the options bar keeps it through export', async ({
  page,
}) => {
  await load(page, '', 300, 200);
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('rect');
    s.state.strokeOn = true;
    s.state.strokeWidth = 6;
  });
  await page.click('.sc-opt.on button[data-stroke-align="outside"]');
  const st = await stageBox(page);
  await page.mouse.move(st.x + 300, st.y + 200);
  await page.mouse.down();
  await page.mouse.move(st.x + 400, st.y + 300, { steps: 4 });
  await page.mouse.up();
  const r = page.locator('#sc-doc rect');
  await expect(r).toHaveCount(1);
  await expect(r).toHaveAttribute('data-stroke-align', 'outside');
  await expect(r).toHaveAttribute('stroke-width', '12');
  await expect(r).toHaveAttribute('paint-order', 'stroke');

  // Export keeps it, and reopening the export brings it back.
  const out = await page.evaluate(() => window.svgcraft.serialize());
  expect(out).toMatch(/data-stroke-align="outside"/);
  expect(out).toMatch(/paint-order="stroke"/);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'rt.svg'), out);
  await expect(r).toHaveCount(1);
  await expect(r).toHaveAttribute('data-stroke-align', 'outside');
  await expect(r).toHaveAttribute('stroke-width', '12');
});

test('Crop to Drawing includes an outside stroke', async ({ page }) => {
  await load(page, RECT('#00f', 'data-stroke-align="outside" paint-order="stroke"'), 300, 200);
  await action(page, 'cropToDrawing');
  // 100 wide + 10 of outside stroke on each side.
  expect(await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h])).toEqual([
    120, 120,
  ]);
});
