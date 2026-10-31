import { test, expect, load, menu } from './fixtures.js';

// Image → Image Size… scales the artboard and everything on it; Image →
// Canvas Size… resizes the artboard around an anchor without scaling.

const SCENE =
  '<rect id="r" x="20" y="20" width="60" height="40" fill="#2563eb" stroke="#111111" stroke-width="4"' +
  ` data-sc-fx='{"ds":{"c":"#000000","o":60,"a":120,"d":6,"sp":0,"s":4}}'/>` +
  '<g id="g" transform="rotate(10 150 50)"><circle id="c" cx="150" cy="50" r="25" fill="#16a34a"/>' +
  '<text id="t" x="120" y="90" font-size="14">Hi</text></g>';
const st = (page) =>
  page.evaluate(() => {
    const s = window.svgcraft.state;
    const box = (id) => {
      // The shape's own geometry, in document units (not its stroke or shadow).
      // eslint-disable-next-line no-undef -- the editor's own global
      const b = bboxDoc(document.getElementById(id));
      return [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 100) / 100);
    };
    return {
      w: s.w,
      h: s.h,
      guides: s.guides.map((g) => `${g.axis}${g.pos}`),
      r: box('r'),
      c: box('c'),
      fx: JSON.parse(document.getElementById('r').dataset.scFx),
    };
  });
const dlg = (page, id) => page.locator(`#${id}`);
// Pixels that differ between two SVGs drawn at the same size.
const differ = (page, a, b, w, h) =>
  page.evaluate(
    async ([a, b, w, h]) => {
      const draw = async (svg) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        return c.getContext('2d').getImageData(0, 0, w, h).data;
      };
      const [p, q] = [await draw(a), await draw(b)];
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if (Math.max(...[0, 1, 2, 3].map((k) => Math.abs(p[i + k] - q[i + k]))) > 40) n++;
      return n;
    },
    [a, b, w, h],
  );

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 200, 100);
  await page.evaluate(() => {
    const s = window.svgcraft.state;
    s.guides.push({ axis: 'x', pos: 50 }, { axis: 'y', pos: 20 });
    window.svgcraft.commit();
  });
});

test('Image Size scales everything, effects included; undo puts it back', async ({ page }) => {
  const before = await st(page);
  const svg0 = await page.evaluate(() => window.svgcraft.serialize());
  await menu(page, 'Image', 'imageSize');
  await expect(dlg(page, 'sc-imagesize')).toBeVisible();
  await expect(page.locator('[data-is="was"]')).toHaveText('Now 200 × 100 px.');
  await expect(page.locator('[data-is="w"]')).toBeFocused();
  await page.keyboard.type('400');
  // Proportions are kept.
  await expect(page.locator('[data-is="h"]')).toHaveValue('200');
  await page.keyboard.press('Enter');
  await expect(dlg(page, 'sc-imagesize')).toBeHidden();
  await expect(page.locator('#sc-msg')).toHaveText('Image size: 200 × 100 px → 400 × 200 px.');
  const after = await st(page);
  expect(after.w).toBe(400);
  expect(after.h).toBe(200);
  expect(after.guides).toEqual(['x100', 'y40']);
  for (const k of ['r', 'c'])
    after[k].forEach((v, i) => expect(v).toBeCloseTo(before[k][i] * 2, 1));
  expect(after.fx.ds).toMatchObject({ d: 12, s: 8, o: 60, a: 120 });
  // It looks the same, twice the size.
  const svg1 = await page.evaluate(() => window.svgcraft.serialize());
  expect(await differ(page, svg0, svg1, 400, 200)).toBeLessThan(400 * 200 * 0.01);
  await page.evaluate(() => window.svgcraft.undo());
  expect(await st(page)).toEqual(before);
});

test('Image Size in percent, unlinked, without scaling effects; Cancel', async ({ page }) => {
  const before = await st(page);
  await menu(page, 'Image', 'imageSize');
  await page.selectOption('[data-is="unit"]', 'pct');
  await expect(page.locator('[data-is="w"]')).toHaveValue('100');
  await page.locator('[data-is="lock"]').uncheck();
  await page.locator('[data-is="fx"]').uncheck();
  await page.fill('[data-is="w"]', '50');
  await expect(page.locator('[data-is="h"]')).toHaveValue('100');
  // Back to pixels: the same size, in pixels.
  await page.selectOption('[data-is="unit"]', 'px');
  await expect(page.locator('[data-is="w"]')).toHaveValue('100');
  await page.click('[data-is-btn="ok"]');
  const after = await st(page);
  expect([after.w, after.h]).toEqual([100, 100]);
  expect(after.guides).toEqual(['x25', 'y20']);
  expect(after.r[2]).toBeCloseTo(before.r[2] / 2, 1);
  expect(after.r[3]).toBe(before.r[3]);
  expect(after.fx).toEqual(before.fx);
  // Cancel changes nothing; neither does a size of zero.
  await menu(page, 'Image', 'imageSize');
  await page.fill('[data-is="w"]', '999');
  await page.click('[data-is-btn="cancel"]');
  await menu(page, 'Image', 'imageSize');
  await page.fill('[data-is="w"]', '0');
  await page.click('[data-is-btn="ok"]');
  // Said in the dialog, which stays open.
  await expect(page.locator('#sc-imagesize .sc-dlg-err')).toHaveText(
    'Enter a width and height above zero.',
  );
  await page.keyboard.press('Escape');
  expect((await st(page)).w).toBe(100);
});

test('Canvas Size grows around the centre without scaling or jumping', async ({ page }) => {
  const before = await st(page);
  const onScreen = () => page.locator('#r').boundingBox();
  const at = await onScreen();
  await menu(page, 'Image', 'canvasSize');
  await expect(dlg(page, 'sc-canvassize')).toBeVisible();
  await expect(page.locator('[data-cv-anchor="0.5,0.5"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.type('300');
  await page.fill('[data-cv="h"]', '160');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-msg')).toHaveText('Canvas size: 200 × 100 px → 300 × 160 px.');
  const after = await st(page);
  expect([after.w, after.h]).toEqual([300, 160]);
  // Shifted by half the growth, whole pixels, nothing scaled.
  expect(after.r).toEqual([before.r[0] + 50, before.r[1] + 30, before.r[2], before.r[3]]);
  expect(after.guides).toEqual(['x100', 'y50']);
  expect(after.fx).toEqual(before.fx);
  // The drawing doesn't move on screen.
  const now = await onScreen();
  expect(now.x).toBeCloseTo(at.x, 0);
  expect(now.y).toBeCloseTo(at.y, 0);
  await page.evaluate(() => window.svgcraft.undo());
  expect(await st(page)).toEqual(before);
});

test('Canvas Size: relative, and anchored to a corner or an edge', async ({ page }) => {
  const before = await st(page);
  // Add 40 px to the right and bottom: anchored top-left, nothing moves.
  await menu(page, 'Image', 'canvasSize');
  await page.locator('[data-cv="rel"]').check();
  await expect(page.locator('[data-cv="w"]')).toHaveValue('0');
  await page.fill('[data-cv="w"]', '40');
  await page.fill('[data-cv="h"]', '40');
  await page.click('[data-cv-anchor="0,0"]');
  await expect(page.locator('[data-cv-anchor="0,0"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-cv-btn="ok"]');
  let s = await st(page);
  expect([s.w, s.h]).toEqual([240, 140]);
  expect(s.r).toEqual(before.r);
  // Trim 40 px off the left: anchored right, everything moves left.
  await menu(page, 'Image', 'canvasSize');
  // The anchor starts at the centre again.
  await expect(page.locator('[data-cv-anchor="0.5,0.5"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-cv="rel"]').check();
  await page.fill('[data-cv="w"]', '-40');
  await page.fill('[data-cv="h"]', '0');
  await page.click('[data-cv-anchor="1,0.5"]');
  await page.click('[data-cv-btn="ok"]');
  s = await st(page);
  expect([s.w, s.h]).toEqual([200, 140]);
  expect(s.r[0]).toBe(before.r[0] - 40);
  expect(s.guides).toEqual(['x10', 'y20']);
  // Too small is refused.
  await menu(page, 'Image', 'canvasSize');
  await page.fill('[data-cv="w"]', '0');
  await page.click('[data-cv-btn="ok"]');
  await expect(page.locator('#sc-canvassize .sc-dlg-err')).toHaveText(
    'The canvas must be 1 to 20,000 px each way.',
  );
  await expect(page.locator('#sc-canvassize')).toBeVisible();
});
