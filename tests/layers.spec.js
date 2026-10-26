// The Layers panel: the imported tree, Photoshop-style row selection,
// grouping, drag-and-drop restacking (which must never move anything on
// screen), collapsing, editing nested layers and canvas auto-select.
import { test, expect } from './fixtures.js';

// At 900 px tall the Layers list scrolls and the lower rows are clipped, so
// drops can miss them; give the panel room to show the whole tree.
test.use({ viewport: { width: 1400, height: 1300 } });

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="#7c3aed" stroke-width="8">
  <circle data-name="Sun" cx="50" cy="50" r="30"/>
  <g data-name="Hills" transform="translate(0 20)"><path d="M10 160 Q60 100 110 160"/><path d="M80 160 Q130 110 190 160"/></g>
  <rect data-name="Frame" x="5" y="5" width="190" height="190"/></svg>`;

const placeScene = (page) =>
  page.evaluate((svg) => window.svgcraft.placeSvg(svg, 'scene.svg'), SCENE);

// The rows as "indent:name", top (front) to bottom (back).
const tree = (page) =>
  page.$$eval('#sc-layers li', (ls) =>
    ls.map((l) => `${l.style.paddingLeft}:${l.querySelector('.sc-layer-name').textContent}`),
  );

const row = (page, name) =>
  page.locator('#sc-layers li', {
    has: page.locator('.sc-layer-name', { hasText: new RegExp(`^${name}$`) }),
  });

const selNames = (page) =>
  page.evaluate(() =>
    window.svgcraft.state.sel.map((e) => e.getAttribute('data-name') || e.localName),
  );

// Where every leaf is drawn (doc space) and how it's painted, to prove a
// restack moves nothing visually.
const onScreen = (page) =>
  page.evaluate(() => {
    const v = document.getElementById('sc-view').getCTM().inverse();
    return [...document.querySelectorAll('#sc-doc circle, #sc-doc path, #sc-doc rect')]
      .map((el) => {
        const r = el.getBBox();
        const p = new DOMPoint(r.x, r.y).matrixTransform(v.multiply(el.getCTM()));
        const cs = getComputedStyle(el);
        return `${el.getAttribute('data-name') || el.localName}@${p.x.toFixed(1)},${p.y.toFixed(1)} ${cs.stroke} ${cs.fill}`;
      })
      .sort();
  });

// Top-left of the selected layer's box, in doc space.
const selTopLeft = (page) =>
  page.evaluate(() => {
    const el = window.svgcraft.state.sel[0];
    const v = document.getElementById('sc-view').getCTM().inverse();
    const r = el.getBBox();
    const p = new DOMPoint(r.x, r.y).matrixTransform(v.multiply(el.getCTM()));
    return { x: p.x, y: p.y };
  });

const BEFORE = [
  'Frame@305.0,205.0 rgb(124, 58, 237) none',
  'Sun@320.0,220.0 rgb(124, 58, 237) none',
  'path@310.0,350.0 rgb(124, 58, 237) none',
  'path@380.0,355.0 rgb(124, 58, 237) none',
];

async function groupSunAndFrame(page) {
  await row(page, 'Sun').click();
  await row(page, 'Frame').click({ modifiers: ['Control'] });
  await page.click('.sc-layers-foot [data-action="group"]');
}

// The full restack sequence the drag test walks through.
async function dragSunAbove(page) {
  await row(page, 'Sun').dragTo(row(page, 'scene.svg'), { targetPosition: { x: 40, y: 4 } });
}
async function dragFrameIntoHills(page) {
  const h = (await row(page, 'Hills').boundingBox()).height;
  await row(page, 'Frame').dragTo(row(page, 'Hills'), { targetPosition: { x: 60, y: h / 2 } });
}
async function dragSunToEmptyArea(page) {
  const list = await page.locator('#sc-layers').boundingBox();
  await row(page, 'Sun').dragTo(page.locator('#sc-layers'), {
    targetPosition: { x: 50, y: list.height - 5 },
  });
}

// Frame ends up nested in Hills inside scene.svg (every level transformed).
const RESTACKED = [
  '4px:scene.svg',
  '20px:Group 1',
  '20px:Hills',
  '36px:Frame',
  '36px:path',
  '36px:path',
  '4px:Sun',
];
async function restack(page) {
  await groupSunAndFrame(page);
  await dragSunAbove(page);
  await dragFrameIntoHills(page);
  await dragSunToEmptyArea(page);
  expect(await tree(page)).toEqual(RESTACKED);
}

test('an imported file shows as a tree, front-most first, with root paint inherited', async ({
  page,
}) => {
  await placeScene(page);
  expect(await tree(page)).toEqual([
    '4px:scene.svg',
    '20px:Frame',
    '20px:Hills',
    '36px:path',
    '36px:path',
    '20px:Sun',
  ]);
  expect(await onScreen(page)).toEqual(BEFORE);
});

test('Ctrl-click toggles rows into the selection; Shift-click selects a normalised range', async ({
  page,
}) => {
  await placeScene(page);
  await row(page, 'Sun').click();
  await row(page, 'Frame').click({ modifiers: ['Control'] });
  expect(await selNames(page)).toEqual(['Sun', 'Frame']);

  // Frame..Sun covers Hills too, but not Hills' children.
  await row(page, 'Frame').click();
  await row(page, 'Sun').click({ modifiers: ['Shift'] });
  expect(await selNames(page)).toEqual(['Sun', 'Hills', 'Frame']);
});

test('the folder button groups the selected layers without moving them', async ({ page }) => {
  await placeScene(page);
  await groupSunAndFrame(page);
  expect(await tree(page)).toEqual([
    '4px:scene.svg',
    '20px:Group 1',
    '36px:Frame',
    '36px:Sun',
    '20px:Hills',
    '36px:path',
    '36px:path',
  ]);
  expect(await onScreen(page)).toEqual(BEFORE);
});

test('dragging rows restacks above, into a group and to the back, never moving anything', async ({
  page,
}) => {
  await placeScene(page);
  await groupSunAndFrame(page);

  await dragSunAbove(page);
  expect(await tree(page)).toEqual([
    '4px:Sun',
    '4px:scene.svg',
    '20px:Group 1',
    '36px:Frame',
    '20px:Hills',
    '36px:path',
    '36px:path',
  ]);
  expect(await onScreen(page)).toEqual(BEFORE);

  await dragFrameIntoHills(page);
  expect(await tree(page)).toEqual([
    '4px:Sun',
    '4px:scene.svg',
    '20px:Group 1',
    '20px:Hills',
    '36px:Frame',
    '36px:path',
    '36px:path',
  ]);
  expect(await onScreen(page)).toEqual(BEFORE);

  // The empty area under the rows sends a layer to the very back.
  await dragSunToEmptyArea(page);
  expect(await tree(page)).toEqual(RESTACKED);
  expect(
    await page.evaluate(() =>
      document.querySelector('#sc-doc').firstElementChild.getAttribute('data-name'),
    ),
  ).toBe('Sun');
  expect(await onScreen(page)).toEqual(BEFORE);
});

test('a group row’s twisty collapses and expands its children', async ({ page }) => {
  await placeScene(page);
  await restack(page);
  await row(page, 'Hills').locator('.sc-twisty').click();
  expect(await tree(page)).toEqual(['4px:scene.svg', '20px:Group 1', '20px:Hills', '4px:Sun']);
  await row(page, 'Hills').locator('.sc-twisty').click();
  expect(await tree(page)).toEqual(RESTACKED);
});

test('a deeply nested layer nudges and aligns in doc space; undo restores it', async ({ page }) => {
  await placeScene(page);
  await restack(page);
  await page.keyboard.press('v');
  await row(page, 'Frame').click();

  const b0 = await selTopLeft(page);
  await page.keyboard.press('Shift+ArrowRight');
  const b1 = await selTopLeft(page);
  expect(b1.x - b0.x).toBeCloseTo(10, 2);
  expect(b1.y - b0.y).toBeCloseTo(0, 2);

  // Alone, it aligns to the artboard.
  await page.evaluate(() => window.svgcraft.cmds.alignLeft());
  expect((await selTopLeft(page)).x).toBeCloseTo(0, 2);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await onScreen(page)).toEqual(BEFORE);
});

test('canvas auto-select picks the clicked layer or its top-level group', async ({ page }) => {
  await placeScene(page);
  await restack(page);
  await page.keyboard.press('v');

  // A point on a hill's stroke, in page pixels.
  const onHill = (t) =>
    page.evaluate((t) => {
      const el = document.querySelector('#sc-doc g[data-name="Hills"] path');
      const p = el.getPointAtLength(el.getTotalLength() * t).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    }, t);
  const picked = () =>
    page.evaluate(() =>
      window.svgcraft.state.sel.map(
        (e) =>
          `${e.localName} ${e.getAttribute('data-name') ?? ''} < ${e.parentNode.getAttribute('data-name')}`,
      ),
    );

  await page.click('[data-autosel="layer"]');
  let p = await onHill(0.5);
  await page.mouse.click(p.x, p.y);
  expect(await picked()).toEqual(['path  < Hills']);

  await page.click('[data-autosel="group"]');
  p = await onHill(0.2);
  await page.keyboard.press('Escape');
  await page.mouse.click(p.x, p.y);
  expect((await picked()).map((s) => s.split(' < ')[0])).toEqual(['g scene.svg']);
});

test('copying a nested layer keeps its inherited paint and composed transform', async ({
  page,
}) => {
  await placeScene(page);
  await restack(page);
  await row(page, 'Frame').click();
  const svg = await page.evaluate(() => window.svgcraft.serialize({ selection: true }));
  expect(svg).toMatch(/stroke="#7c3aed"/);
  expect(svg).toMatch(/fill="none"/);
  expect(svg).toMatch(/transform="matrix/);
});

test('previews fill in after the rows, every one of them, hidden layers too', async ({ page }) => {
  const rects = Array.from(
    { length: 300 },
    (_, i) => `<rect x="${(i % 20) * 10}" y="${Math.floor(i / 20) * 10}" width="8" height="8"/>`,
  ).join('');
  await page.evaluate(
    (body) =>
      window.svgcraft.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">${body}<circle id="off" cx="9" cy="9" r="5" display="none"/></svg>`,
        'many.svg',
      ),
    rects,
  );
  const drawn = () =>
    page.$$eval('#sc-layers .sc-thumb', (ts) => ts.filter((t) => t.children.length).length);
  // The rows are there at once, with their previews still to come.
  const atOnce = await page.evaluate(() => {
    window.svgcraft.commit();
    return {
      rows: document.querySelectorAll('#sc-layers li').length,
      drawn: [...document.querySelectorAll('#sc-layers .sc-thumb')].filter((t) => t.children.length)
        .length,
    };
  });
  expect(atOnce).toEqual({ rows: 301, drawn: 0 });
  // Then all of them, past the 150 that used to be the limit.
  await expect.poll(drawn, { timeout: 15000 }).toBe(301);
  // The hidden circle's preview shows the circle.
  await expect(page.locator('#sc-layers li.hidden .sc-thumb circle')).toHaveCount(1);
});

test('a group’s row previews what’s in it', async ({ page }) => {
  await placeScene(page);
  const hills = page.locator('#sc-layers li', {
    has: page.locator('.sc-layer-name', { hasText: /^Hills$/ }),
  });
  await expect(hills.locator('.sc-thumb path')).toHaveCount(2);
});

test('dragging layers onto New copies them in place; onto the bin deletes them', async ({
  page,
}) => {
  await placeScene(page);
  const sun = () => page.$$eval('#sc-doc circle', (cs) => cs.map((c) => c.getAttribute('cx')));
  await row(page, 'Sun').dragTo(page.locator('.sc-layers-foot [data-action="duplicate"]'));
  // A copy right above it, in the same place, and selected.
  await expect.poll(sun).toEqual(['50', '50']);
  expect(
    await page.evaluate(() => window.svgcraft.state.sel[0].previousElementSibling.localName),
  ).toBe('circle');
  await page.keyboard.press('Control+z');
  await expect.poll(sun).toEqual(['50']);

  await row(page, 'Frame').dragTo(page.locator('.sc-layers-foot [data-action="delete"]'));
  await expect(row(page, 'Frame')).toHaveCount(0);
  await expect(page.locator('#sc-doc rect')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Frame')).toHaveCount(1);
});
