// An animation's pivot: the point Spin, Pulse, Swing… turn or grow about,
// dragged on the canvas (the ⊕ the Animation tab shows) or typed in, kept
// as fractions of the layer's box, and read back from files that turn
// about a point of their own.
import { test, expect, load, toScreen } from './fixtures.js';

const anims = (page, id = 't') =>
  page.evaluate((id) => JSON.parse(document.getElementById(id).dataset.scAnim || '[]'), id);
const setAnims = (page, id, list) =>
  page.evaluate(
    ([id, list]) => {
      document.getElementById(id).setAttribute('data-sc-anim', JSON.stringify(list));
      window.svgcraft.commit();
    },
    [id, list],
  );
// Click the triangle, as the Move tool picks it.
const pick = async (page) => {
  const q = await toScreen(page, 70, 40);
  await page.mouse.click(q.x, q.y);
};
const saved = (page) => page.evaluate(() => window.svgcraft.serialize());

// A triangle whose box is 40 × 40 from (50, 10): its centre isn't (50, 50).
const TRI = '<path id="t" d="M50 50L90 50L70 10Z" fill="#dc2626"/>';

test('Spin turns about the pivot: the box’s top-left corner here', async ({ page }) => {
  await load(page, TRI, 100, 100);
  await setAnims(page, 't', [{ p: 'spin', dur: 2, rep: 0, ease: 'linear', origin: [0, 0] }]);
  expect(await saved(page)).toMatch(/values="0 50 10;360 50 10"/);
  // Without one, its centre.
  await setAnims(page, 't', [{ p: 'spin', dur: 2, rep: 0, ease: 'linear' }]);
  expect(await saved(page)).toMatch(/values="0 70 30;360 70 30"/);
});

test('a file spinning about a point of its own comes in as Spin with that pivot', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="t" d="M50 50L90 50L70 10Z" fill="red">' +
        '<animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="5s" from="0 50 50" to="360 50 50" repeatCount="indefinite"/>' +
        '</path></svg>',
      'x.svg',
    ),
  );
  expect(await anims(page)).toEqual([
    {
      p: 'spin',
      dur: 5,
      delay: 0,
      rep: 0,
      dir: 'normal',
      ease: 'linear',
      turns: 1,
      origin: [0, 1],
    },
  ]);
  await expect(page.locator('#sc-alert-text')).toHaveText('');
});

test('pivots come back from a saved file, for turns and grows alike', async ({ page }) => {
  await load(page, TRI, 100, 100);
  for (const a of [
    { p: 'spin', turns: 1 },
    { p: 'pulse', scale: 130 },
    { p: 'swing', angle: 20, pivot: 'top' },
    { p: 'tada' },
    { p: 'flip', axis: 'vertical' },
    { p: 'zoomIn' },
  ]) {
    const want = { dur: 1.5, delay: 0, rep: 2, dir: 'normal', ease: 'linear', ...a };
    await setAnims(page, 't', [{ ...want, origin: [0.25, 0.9] }]);
    const svg = await saved(page);
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'p.svg'), svg);
    const [got] = await anims(page);
    expect(got.p, a.p).toBe(a.p);
    expect(got.origin, a.p).toEqual([0.25, 0.9]);
    await load(page, TRI, 100, 100);
  }
});

test('the ⊕ on the canvas drags the pivot, snaps to the corners, and double-click resets it', async ({
  page,
}) => {
  await load(page, TRI, 100, 100);
  await page.click('[data-tab="animation"]');
  await pick(page);
  await page.selectOption('#sc-anim-add', 'spin');
  const mark = page.locator('#sc-sel [data-anim-origin], [data-anim-origin]');
  await expect(mark).toHaveCount(1);
  // At the centre, (70, 30).
  const at = async () => {
    const b = await mark.locator('circle').boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const c = await toScreen(page, 70, 30);
  const [mx, my] = await at();
  expect(Math.abs(mx - c.x) + Math.abs(my - c.y)).toBeLessThan(2);
  // Dragged near the box's top-left (50, 10): it snaps there.
  const tl = await toScreen(page, 50.6, 10.6);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move((mx + tl.x) / 2, (my + tl.y) / 2);
  await page.mouse.move(tl.x, tl.y);
  await page.mouse.up();
  expect((await anims(page))[0].origin).toEqual([0, 0]);
  await expect(page.locator('[data-anim-opt="originX"]')).toHaveValue('0');
  await expect(page.locator('[data-anim-opt="originY"]')).toHaveValue('0');
  // The layer itself didn't move.
  expect(await page.evaluate(() => document.getElementById('t').getAttribute('transform'))).toBe(
    null,
  );
  // Undo puts it back.
  await page.keyboard.press('Control+z');
  expect((await anims(page))[0].origin).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  expect((await anims(page))[0].origin).toEqual([0, 0]);
  // (Undo and redo leave nothing selected.)
  await pick(page);
  // Double-click: the centre again.
  const [x2, y2] = await at();
  await page.mouse.dblclick(x2, y2);
  expect((await anims(page))[0].origin).toBeUndefined();
  // Typed: 25% across.
  await page.fill('[data-anim-opt="originX"]', '25');
  await page.keyboard.press('Enter');
  expect((await anims(page))[0].origin).toEqual([0.25, 0.5]);
  await page.waitForTimeout(100);
  await page.fill('[data-anim-opt="originY"]', '110');
  await page.keyboard.press('Enter');
  expect((await anims(page))[0].origin).toEqual([0.25, 1.1]);
  // Only with the Animation tab showing.
  await page.click('[data-tab="props"]');
  await expect(mark).toHaveCount(0);
  await page.click('[data-tab="animation"]');
  await expect(mark).toHaveCount(1);
});

test('Swing’s pivot dragged elsewhere reads Custom; choosing Top puts it back', async ({
  page,
}) => {
  await load(page, TRI, 100, 100);
  await setAnims(page, 't', [
    { p: 'swing', dur: 1, rep: 0, ease: 'inout', angle: 15, pivot: 'top', origin: [0.1, 0.2] },
  ]);
  await page.click('[data-tab="animation"]');
  await pick(page);
  await expect(page.locator('[data-anim-opt="pivot"]')).toHaveValue('custom');
  await page.selectOption('[data-anim-opt="pivot"]', 'top');
  const [a] = await anims(page);
  expect(a.pivot).toBe('top');
  expect(a.origin).toBeUndefined();
  expect(await saved(page)).toMatch(/values="0 70 10;15 70 10;/);
});

test('a preset that doesn’t turn shows no pivot', async ({ page }) => {
  await load(page, TRI, 100, 100);
  await page.click('[data-tab="animation"]');
  await pick(page);
  await page.selectOption('#sc-anim-add', 'fadeIn');
  await expect(page.locator('[data-anim-origin]')).toHaveCount(0);
  await expect(page.locator('[data-anim-opt="originX"]')).toHaveCount(0);
});
