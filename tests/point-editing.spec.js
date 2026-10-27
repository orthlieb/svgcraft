// Point editing (the Node tool): path parsing round-trips, shape → node
// conversion, and the interactive edits — drag, insert, smooth, delete,
// close / open, marquee, nudge — including on transformed elements.
import { test, expect, toScreen, pickMarquee } from './fixtures.js';

// Press-drag-release between two document points.
async function drag(page, from, to) {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function dblclickAt(page, x, y) {
  const p = await toScreen(page, x, y);
  await page.mouse.dblclick(p.x, p.y);
}

const nodes = (page) => page.locator('#sc-nodes [data-node]');
const pathD = (page) =>
  page.evaluate(() => document.querySelector('#sc-doc path').getAttribute('d'));

// The node tool ignores a double-click that lands within 500 ms of the click
// that picked the shape (it was the "pick" click, not an "add point" one).
async function settleTarget(page) {
  await page.waitForFunction(
    () => performance.now() - (window.svgcraft.tools.node.targetedAt ?? -1e9) > 500,
  );
}

// Draw a 200 × 100 rect with the Rectangle tool, then double-click it with
// the Move tool to start point editing.
async function drawAndEditRect(page) {
  await page.keyboard.press('r');
  await drag(page, [200, 200], [400, 300]);
  await page.keyboard.press('v');
  await dblclickAt(page, 300, 250);
  await expect(nodes(page)).toHaveCount(4);
}

test.describe('path data round-trips through parsePathD → nodesD', () => {
  const cases = [
    'M10 10 L100 10 L100 100 Z',
    'm10 10 h50 v40 h-50 z m70 0 h20 v20 z',
    'M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80',
    'M10 80 Q 52.5 10, 95 80 T 180 80',
    'M80 80 A 45 45, 0, 0, 0, 125 125 L 125 80 Z',
    'M230 80 A 45 45 0 1 0 275 125 L 275 80 Z',
    'M10 10a5 3 30 1015 15',
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'M0 0L10 10ZL20 0',
    'M3.5 7.25c.5-1 1.75-2 3-2s2.5 1 3 2-.5 3-3 3-3.5-2-3-3z',
  ];
  for (const d of cases) {
    test(`keeps the geometry of "${d}"`, async ({ page }) => {
      const r = await page.evaluate((d) => {
        const { parsePathD, nodesD } = window.svgcraft;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.getElementById('sc-stage');
        const a = document.createElementNS(NS, 'path');
        a.setAttribute('d', d);
        svg.append(a);
        const c = document.createElementNS(NS, 'path');
        c.setAttribute('d', nodesD(parsePathD(d)));
        svg.append(c);
        const la = a.getTotalLength();
        const lc = c.getTotalLength();
        let maxErr = 0;
        for (let k = 0; k <= 50; k++) {
          const p = a.getPointAtLength((la * k) / 50);
          const q = c.getPointAtLength((lc * k) / 50);
          maxErr = Math.max(maxErr, Math.hypot(p.x - q.x, p.y - q.y));
        }
        a.remove();
        c.remove();
        return { la, lc, maxErr };
      }, d);
      expect(Math.abs(r.la - r.lc), 'length difference').toBeLessThan(0.05);
      expect(r.maxErr, 'max sampled point distance').toBeLessThan(0.05);
    });
  }
});

test('shapeNodes converts basic shapes to paths of the same length (±0.3%)', async ({ page }) => {
  const shapes = await page.evaluate(() => {
    const { shapeNodes, nodesD } = window.svgcraft;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.getElementById('sc-stage');
    const mkEl = (t, a) => {
      const e = document.createElementNS(NS, t);
      for (const k in a) e.setAttribute(k, a[k]);
      svg.append(e);
      return e;
    };
    return [
      ['rect', { x: 10, y: 10, width: 80, height: 40 }],
      ['rect', { x: 10, y: 10, width: 80, height: 40, rx: 8 }],
      ['circle', { cx: 50, cy: 50, r: 30 }],
      ['ellipse', { cx: 50, cy: 50, rx: 40, ry: 20 }],
      ['polygon', { points: '0,0 50,0 25,40' }],
      ['line', { x1: 0, y1: 0, x2: 30, y2: 40 }],
    ].map(([t, a]) => {
      const e = mkEl(t, a);
      const p = mkEl('path', { d: nodesD(shapeNodes(e)) });
      const r = {
        shape: `${t} ${JSON.stringify(a)}`,
        a: e.getTotalLength(),
        p: p.getTotalLength(),
      };
      e.remove();
      p.remove();
      return r;
    });
  });
  for (const r of shapes)
    expect(Math.abs(r.a - r.p) / r.a, `relative length error for ${r.shape}`).toBeLessThan(0.003);
});

test('double-clicking a rect enters point editing; dragging a corner converts it and undo/redo work', async ({
  page,
}) => {
  await drawAndEditRect(page);
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('node');

  await drag(page, [400, 300], [450, 350]);
  const last = () =>
    page.evaluate(() => {
      const el = document.querySelector('#sc-doc').lastElementChild;
      return { tag: el.localName, d: el.getAttribute('d') };
    });
  expect(await last()).toEqual({ tag: 'path', d: 'M200 200L400 200L450 350L200 300Z' });

  await page.keyboard.press('Control+z');
  expect((await last()).tag).toBe('rect');
  await expect(nodes(page), 'still point-editing the restored rect').toHaveCount(4);

  await page.keyboard.press('Control+Shift+z');
  expect(await last()).toEqual({ tag: 'path', d: 'M200 200L400 200L450 350L200 300Z' });
});

test('double-click on an edge inserts a point; Smooth gives it collinear handles; Delete removes it', async ({
  page,
}) => {
  await drawAndEditRect(page);
  await drag(page, [400, 300], [450, 350]);
  await settleTarget(page);

  await dblclickAt(page, 300, 200);
  await expect(nodes(page)).toHaveCount(5);
  expect(await pathD(page)).toBe('M200 200L300 200L400 200L450 350L200 300Z');

  await page.click('[data-node-cmd="smooth"]');
  const hnds = page.locator('#sc-nodes [data-hnd]');
  await expect(hnds).toHaveCount(2);

  // Drag one handle off-axis: the opposite handle must follow (stay collinear).
  const hb = await hnds.nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 20, hb.y - 60, { steps: 5 });
  await page.mouse.up();
  const angleErr = await page.evaluate(() => {
    const n = window.svgcraft.tools.node.subs[0].nodes.find((n) => n.hin && n.hout);
    const a = Math.atan2(n.hin.y - n.y, n.hin.x - n.x);
    const b = Math.atan2(n.hout.y - n.y, n.hout.x - n.x);
    return Math.abs(Math.abs(a - b) - Math.PI);
  });
  expect(angleErr, 'angle between handles minus π (rad)').toBeCloseTo(0, 4);

  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(4);
});

test('Close toggles the closing Z; marquee picks points; Shift+Arrow nudges them', async ({
  page,
}) => {
  await drawAndEditRect(page);
  await drag(page, [400, 300], [450, 350]);

  await page.click('[data-node-cmd="close"]');
  expect(await pathD(page)).not.toMatch(/Z/i);
  await page.click('[data-node-cmd="close"]');
  expect(await pathD(page)).toMatch(/Z/i);

  // Marquee across the top edge picks its two corners (200,200) and (400,200).
  await drag(page, [150, 150], [420, 230]);
  expect(await page.evaluate(() => window.svgcraft.tools.node.picked.length)).toBe(2);

  const before = await pathD(page);
  await page.keyboard.press('Shift+ArrowDown');
  expect(await pathD(page)).not.toBe(before);
  expect(await pathD(page)).toBe('M200 210L400 210L450 350L200 300Z');
});

test('point markers sit on the shape of a rotated ellipse', async ({ page }) => {
  await page.keyboard.press('o');
  await drag(page, [600, 200], [800, 300]);
  await page.keyboard.press('v');
  await page.evaluate(() => {
    const el = document.querySelector('#sc-doc ellipse');
    el.setAttribute('transform', 'rotate(30 700 250)');
    window.svgcraft.commit();
  });
  await dblclickAt(page, 700, 250);
  await expect(nodes(page).first()).toBeVisible();
  // The first node is the ellipse's rightmost point (800,250) in its own space.
  const off = await page.evaluate(() => {
    const n = document.querySelector('#sc-nodes [data-node]').getBoundingClientRect();
    const el = document.querySelector('#sc-doc ellipse');
    const p = new DOMPoint(800, 250).matrixTransform(el.getScreenCTM());
    return [p.x - (n.x + n.width / 2), p.y - (n.y + n.height / 2)];
  });
  expect(off[0]).toBeCloseTo(0, 0);
  expect(off[1]).toBeCloseTo(0, 0);
});

test('points can be picked with an oval too, or from the centre with Alt', async ({ page }) => {
  // A square with a point at each corner and each side's middle.
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">' +
        '<path id="p" d="M300 200L400 200L500 200L500 300L500 400L400 400L300 400L300 300Z" fill="#2563eb"/></svg>',
      'square.svg',
    ),
  );
  await page.keyboard.press('a');
  await page.evaluate(() => window.svgcraft.tools.node.target(document.getElementById('p')));
  await expect(nodes(page)).toHaveCount(8);
  const picked = () =>
    page.evaluate(() => window.svgcraft.tools.node.picked.map(([, n]) => n).sort((a, b) => a - b));

  // A rectangle round the square takes all eight.
  await expect(page.locator('[data-marquee="rect"]')).toHaveAttribute('aria-checked', 'true');
  await drag(page, [290, 190], [510, 410]);
  expect(await picked()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  // An oval the same size misses the corners: just the sides' middles.
  await pickMarquee(page, 'oval');
  await drag(page, [290, 190], [510, 410]);
  // (Its dashed outline goes when the drag ends.)
  await expect(page.locator('#sc-stage ellipse.sc-ov-dash')).toHaveCount(0);
  expect(await picked()).toEqual([1, 3, 5, 7]);

  // Alt pressed during the drag grows it from where the drag starts: here,
  // the square's centre.
  const a = await toScreen(page, 400, 300);
  const b = await toScreen(page, 510, 410);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await picked()).toEqual([1, 3, 5, 7]);

  // A drag begun with Alt takes points away: a rectangle round the top
  // middle drops it; Alt let go and pressed again draws from the centre.
  await page.keyboard.down('Alt');
  await drag(page, [380, 180], [420, 220]);
  await page.keyboard.up('Alt');
  expect(await picked()).toEqual([3, 5, 7]);
  await pickMarquee(page, 'rect');
  const c = await toScreen(page, 430, 400);
  const d = await toScreen(page, 480, 430);
  await page.keyboard.down('Alt');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.keyboard.up('Alt');
  await page.mouse.move(c.x + 5, c.y + 5);
  await page.keyboard.down('Alt');
  await page.mouse.move(d.x, d.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await picked()).toEqual([3, 7]);
  await pickMarquee(page, 'oval');

  // The choice is remembered.
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await expect(page.locator('[data-marquee="oval"]')).toHaveAttribute('aria-checked', 'true');
});

test('points can be picked freeform, with a lasso drawn round them', async ({ page }) => {
  // The same square: a point at each corner and each side's middle.
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">' +
        '<path id="p" d="M300 200L400 200L500 200L500 300L500 400L400 400L300 400L300 300Z" fill="#2563eb"/></svg>',
      'square.svg',
    ),
  );
  await page.keyboard.press('a');
  await page.evaluate(() => window.svgcraft.tools.node.target(document.getElementById('p')));
  await expect(nodes(page)).toHaveCount(8);
  const picked = () =>
    page.evaluate(() => window.svgcraft.tools.node.picked.map(([, n]) => n).sort((a, b) => a - b));
  const lasso = async (pts, mod) => {
    const [first, ...rest] = await Promise.all(pts.map(([x, y]) => toScreen(page, x, y)));
    if (mod) await page.keyboard.down(mod);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const q of rest) await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
    if (mod) await page.keyboard.up(mod);
  };

  // A triangle round the top-left corner takes it and its two neighbours.
  await pickMarquee(page, 'lasso');
  await lasso([
    [280, 180],
    [450, 180],
    [280, 350],
  ]);
  await expect(page.locator('#sc-stage polygon.sc-ov-dash')).toHaveCount(0);
  expect(await picked()).toEqual([0, 1, 7]);

  // Shift adds: a loop round the bottom-right corner.
  await lasso(
    [
      [480, 380],
      [520, 380],
      [520, 420],
      [480, 420],
    ],
    'Shift',
  );
  expect(await picked()).toEqual([0, 1, 4, 7]);

  // Alt takes away: a loop round the top-middle point drops just it.
  await lasso(
    [
      [380, 180],
      [420, 180],
      [420, 220],
      [380, 220],
    ],
    'Alt',
  );
  expect(await picked()).toEqual([0, 4, 7]);

  // The choice is remembered.
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await expect(page.locator('[data-marquee="lasso"]')).toHaveAttribute('aria-checked', 'true');
});

test('the selection shapes sit in Edit Points’ toolbar flyout, like the Shape tools', async ({
  page,
}) => {
  const btn = page.locator('#sc-node-btn');
  const menu = page.locator('#sc-node-menu');
  const checked = () => page.$eval('#sc-node-menu [aria-checked="true"]', (b) => b.dataset.marquee);
  // Held down, the flyout opens beside the toolbar, on the current shape.
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect(menu.locator('[data-marquee="rect"]')).toBeFocused();
  // Arrow keys move through it; Escape closes it.
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[data-marquee="oval"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Picking one switches to Edit Points with it.
  await page.keyboard.press('v');
  await pickMarquee(page, 'lasso');
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('node');
  expect(await checked()).toBe('lasso');
  await expect(btn).toHaveAttribute('data-tip', 'Edit points · Lasso Select');
  // A plain click is just the tool; Shift+A steps through the shapes.
  await page.keyboard.press('v');
  await btn.click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('node');
  await page.keyboard.press('Shift+A');
  expect(await checked()).toBe('rect');
  await page.keyboard.press('Shift+A');
  expect(await checked()).toBe('oval');
  // The options bar no longer carries them.
  await expect(page.locator('.sc-opt [data-marquee]')).toHaveCount(0);
});
