// End-to-end smoke test of the core drawing workflow: drawing tools, the
// selection's transparency / move / scale, erasers, undo / redo, export,
// import sanitising, autosave across reload and the mobile layout.
import fs from 'node:fs';
import { test, expect, load, toScreen } from './fixtures.js';

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Hello' : undefined));
});

const count = (page) => page.evaluate(() => document.getElementById('sc-doc').children.length);
const has = (page, sel) => page.evaluate((sel) => !!document.querySelector(sel), sel);
const lastHTML = (page) =>
  page.evaluate(() => document.getElementById('sc-doc').lastElementChild.outerHTML);

// Press at the first doc point, move through the rest, release.
async function drag(page, pts) {
  const s = [];
  for (const [x, y] of pts) s.push(await toScreen(page, x, y));
  await page.mouse.move(s[0].x, s[0].y);
  await page.mouse.down();
  for (const q of s.slice(1)) await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
}

async function clickDoc(page, x, y) {
  const s = await toScreen(page, x, y);
  await page.mouse.click(s.x, s.y);
}

// Numbers in a path d (or any string), for approximate comparison.
const nums = (s) => s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
function expectPathD(d, want) {
  expect(d.replace(/[-\d.\s]+/g, ' ').trim()).toBe(want.replace(/[-\d.\s]+/g, ' ').trim());
  const a = nums(d);
  const b = nums(want);
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 1));
}

// Reload, keeping localStorage (the app's autosave and preferences).
async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

// Pen clicks are spaced out so they don't count as a double-click.
const PEN_GAP = 400;

test.describe('drawing tools', () => {
  test('Pencil draws a smoothed path from the drag', async ({ page }) => {
    await page.keyboard.press('b');
    await drag(page, [
      [100, 100],
      [150, 140],
      [200, 110],
      [260, 160],
      [300, 120],
    ]);
    expect(await count(page)).toBe(1);
    const d = await page.evaluate(() => document.querySelector('#sc-doc path').getAttribute('d'));
    expect(d).toMatch(/^M100 100C/);
  });

  test('Pen: clicks make corners, a drag makes a smooth point, Enter ends', async ({ page }) => {
    await page.keyboard.press('p');
    for (const [x, y, curve] of [
      [100, 300, false],
      [200, 250, true],
      [300, 320, false],
    ]) {
      const s = await toScreen(page, x, y);
      await page.mouse.move(s.x, s.y);
      await page.mouse.down();
      if (curve) {
        const t = await toScreen(page, x + 40, y);
        await page.mouse.move(t.x, t.y, { steps: 3 });
      }
      await page.mouse.up();
      await page.waitForTimeout(PEN_GAP);
    }
    await page.keyboard.press('Enter');
    expect(await count(page)).toBe(1);
    const d = await page.evaluate(() =>
      document.getElementById('sc-doc').lastElementChild.getAttribute('d'),
    );
    expectPathD(d, 'M100 300C100 300 160 250 200 250C240 250 300 320 300 320');
  });

  test('Pen: clicking the first point closes the path', async ({ page }) => {
    await page.keyboard.press('p');
    for (const [x, y] of [
      [500, 100],
      [600, 100],
      [550, 200],
      [500, 100],
    ]) {
      await clickDoc(page, x, y);
      await page.waitForTimeout(PEN_GAP);
    }
    expect(await count(page)).toBe(1);
    const html = await lastHTML(page);
    expect(html).toMatch(/^<path /);
    const d = await page.evaluate(() =>
      document.getElementById('sc-doc').lastElementChild.getAttribute('d'),
    );
    expectPathD(d, 'M500 100L600 100L550 200Z');
    // Drawn with the current paint.
    expect(html).toContain('fill="#e8a33d"');
    expect(html).toContain('stroke="#1f2933"');
    expect(html).toContain('stroke-width="3"');
  });

  test('Rectangle, Ellipse, Line and Type each add one element', async ({ page }) => {
    await page.keyboard.press('r');
    await drag(page, [
      [400, 300],
      [500, 380],
    ]);
    await page.keyboard.press('o');
    await drag(page, [
      [550, 300],
      [650, 380],
    ]);
    await page.keyboard.press('l');
    await drag(page, [
      [600, 450],
      [750, 520],
    ]);
    await page.keyboard.press('t');
    await clickDoc(page, 100, 500);
    await page.waitForTimeout(100);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Control+Enter');

    expect(await count(page)).toBe(4);
    const rect = page.locator('#sc-doc rect');
    await expect(rect).toHaveAttribute('x', '400');
    await expect(rect).toHaveAttribute('y', '300');
    await expect(rect).toHaveAttribute('width', '100');
    await expect(rect).toHaveAttribute('height', '80');
    await expect(page.locator('#sc-doc ellipse')).toHaveCount(1);
    await expect(page.locator('#sc-doc line, #sc-doc path')).toHaveCount(1);
    const text = page.locator('#sc-doc text');
    await expect(text).toHaveText('Hello');
    await expect(text).toHaveAttribute('x', '100');
    await expect(text).toHaveAttribute('y', '500');
    await expect(text.locator('tspan')).toHaveText('Hello');
  });
});

test.describe('selection', () => {
  test.beforeEach(async ({ page }) => {
    await load(
      page,
      '<rect id="r" x="400" y="300" width="100" height="80" fill="#e8a33d" stroke="#1f2933" stroke-width="3"/>',
    );
    await page.keyboard.press('v');
    await clickDoc(page, 450, 340);
  });

  // Doc-space position of a point of the rect, through its transform.
  const rectPoint = (page, x, y) =>
    page.evaluate(
      ([x, y]) => {
        const el = document.getElementById('r');
        const m = document.getElementById('sc-doc').getCTM().inverse().multiply(el.getCTM());
        const p = new DOMPoint(x, y).matrixTransform(m);
        return { x: p.x, y: p.y, a: m.a, d: m.d };
      },
      [x, y],
    );

  test('fill alpha and layer opacity apply to the selection', async ({ page }) => {
    await page.locator('#sc-fill-a').fill('40');
    await page.locator('#sc-transparency [data-bind="opacity"]').fill('70');
    const rect = page.locator('#sc-doc rect');
    await expect(rect).toHaveAttribute('fill-opacity', '0.4');
    await expect(rect).toHaveAttribute('opacity', '0.7');
  });

  test('dragging moves the selection', async ({ page }) => {
    await drag(page, [
      [450, 340],
      [470, 360],
    ]);
    await expect(page.locator('#sc-doc rect')).toHaveAttribute(
      'transform',
      'matrix(1 0 0 1 20 20)',
    );
  });

  test('dragging the SE handle scales about the opposite corner', async ({ page }) => {
    const hb = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(hb.x + 4, hb.y + 4);
    await page.mouse.down();
    await page.mouse.move(hb.x + 54, hb.y + 54, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#sc-doc rect')).toHaveAttribute('transform', /^matrix\(/);
    const tl = await rectPoint(page, 400, 300);
    expect(tl.x).toBeCloseTo(400, 1);
    expect(tl.y).toBeCloseTo(300, 1);
    expect(tl.a).toBeGreaterThan(1.3);
    expect(tl.d).toBeGreaterThan(1.3);
  });
});

test.describe('erasers and history', () => {
  test('the Cut eraser splits a stroke in two', async ({ page }) => {
    await page.keyboard.press('b');
    await drag(page, [
      [100, 100],
      [150, 140],
      [200, 110],
      [260, 160],
      [300, 120],
    ]);
    expect(await count(page)).toBe(1);
    await page.keyboard.press('e');
    await page.click('[data-eraser="cut"]');
    const mid = await page.evaluate(() => {
      const p = document.querySelector('#sc-doc path');
      const q = p.getPointAtLength(p.getTotalLength() / 2);
      return [q.x, q.y];
    });
    await drag(page, [
      [mid[0], mid[1] - 20],
      [mid[0], mid[1] + 20],
    ]);
    expect(await count(page)).toBe(2);
  });

  test('the Object eraser removes a shape; undo / redo restore it', async ({ page }) => {
    await load(
      page,
      '<rect x="400" y="300" width="100" height="80"/><ellipse cx="600" cy="340" rx="50" ry="40"/>',
    );
    await page.keyboard.press('e');
    await page.click('[data-eraser="object"]');
    await drag(page, [
      [600, 330],
      [600, 350],
    ]);
    expect(await count(page)).toBe(1);
    expect(await has(page, '#sc-doc ellipse')).toBe(false);
    await page.keyboard.press('Control+z');
    expect(await has(page, '#sc-doc ellipse')).toBe(true);
    await page.keyboard.press('Control+Shift+z');
    expect(await has(page, '#sc-doc ellipse')).toBe(false);
  });
});

test.describe('export', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, '<path d="M100 100L300 120" stroke="#000"/>');
  });

  test('Download SVG saves a standalone SVG of the artboard', async ({ page }) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sc-export')]);
    const svg = fs.readFileSync(await dl.path(), 'utf8');
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="600" viewBox="0 0 800 600">/,
    );
    expect(svg).toContain('<path d="M100 100L300 120"');
  });

  test('File → Export PNG @2× saves a PNG', async ({ page }) => {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page
        .click('.sc-menu-btn:text-is("File")')
        .then(() => page.click('.sc-menu-list:not([hidden]) [data-action="exportPng2"]')),
    ]);
    const png = fs.readFileSync(await dl.path());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width / height: 2× the 800 × 600 artboard.
    expect(png.readUInt32BE(16)).toBe(1600);
    expect(png.readUInt32BE(20)).toBe(1200);
  });
});

test.describe('import', () => {
  const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<style>.a{stroke:#ff0000}</style><script>window.pwned=1</script>' +
    '<circle class="a" cx="12" cy="12" r="10" onclick="x()"/><path d="M8 12h8"/></svg>';

  test('opening an SVG strips scripts / handlers and inlines styles and root paint', async ({
    page,
  }) => {
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'icon.svg'), ICON);
    const html = await page.evaluate(() => document.getElementById('sc-doc').innerHTML);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('onclick');
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    expect(await count(page)).toBe(2);
    const circle = page.locator('#sc-doc circle');
    await expect(circle).toHaveAttribute('style', 'stroke:rgb(255, 0, 0)');
    await expect(circle).toHaveAttribute('fill', 'none');
    await expect(circle).toHaveAttribute('stroke-width', '2');
    const path = page.locator('#sc-doc path');
    await expect(path).toHaveAttribute('fill', 'none');
    await expect(path).toHaveAttribute('stroke', '#000000');
    await expect(path).toHaveAttribute('stroke-width', '2');
  });

  test('placing an SVG adds a group that Ctrl+Shift+G ungroups', async ({ page }) => {
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'icon.svg'), ICON);
    await page.evaluate((t) => window.svgcraft.placeSvg(t), ICON);
    expect(await count(page)).toBe(3);
    await page.keyboard.press('Control+Shift+g');
    expect(await count(page)).toBe(4);
  });
});

test('the drawing is autosaved and restored on reload', async ({ page }) => {
  await load(
    page,
    '<rect x="10" y="10" width="50" height="50"/><circle cx="200" cy="200" r="20"/>',
  );
  await page.keyboard.press('r');
  await drag(page, [
    [400, 300],
    [500, 380],
  ]);
  expect(await count(page)).toBe(3);
  // Open drawings are kept in IndexedDB (database "svgcraft", key "docs").
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const r = indexedDB.open('svgcraft', 1);
            r.onsuccess = () => {
              const q = r.result.transaction('kv').objectStore('kv').get('docs');
              q.onsuccess = () => resolve(q.result?.docs?.[0]?.svg === window.svgcraft.serialize());
            };
            r.onerror = () => resolve(false);
          }),
      ),
    )
    .toBe(true);
  await reload(page);
  expect(await count(page)).toBe(3);
});
