import { test, expect, load, select, menu, action } from './fixtures.js';

// The features built side by side work together: a clipping group or a text
// on a path made into a symbol keeps its generated defs (clipPath, path copy)
// through later commits, and still renders in every instance.

const pixels = (page, pts) =>
  page.evaluate(async (pts) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, pts);
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
async function answer(page, value) {
  await expect(page.locator('#sc-ask')).toBeVisible();
  if (value != null) await page.fill('#sc-ask .sc-ask-input', value);
  await page.click('#sc-ask [data-ask="ok"]');
}
// Make a few unrelated changes, each committed, so any pruning has run.
async function churn(page) {
  for (let i = 0; i < 3; i++) {
    await select(page, 'other');
    await page.keyboard.press('ArrowRight');
    await tick(page);
  }
}

test('a clipping group made into a symbol stays clipped', async ({ page }) => {
  await load(
    page,
    '<rect id="other" x="350" y="250" width="10" height="10" fill="#000"/>' +
      '<rect id="art" x="40" y="40" width="120" height="120" fill="#dc2626"/>' +
      '<circle id="c" cx="100" cy="100" r="40" fill="#000"/>',
    400,
    300,
  );
  await select(page, 'art', 'c');
  await action(page, 'clipMake');
  await tick(page);
  const g = await page.evaluate(() => document.querySelector('#sc-doc [data-sc-clip]').id || '');
  await page.evaluate(() => {
    const el = document.querySelector('#sc-doc [data-sc-clip]');
    if (!el.id) el.id = 'cg';
  });
  await select(page, g || 'cg');
  await menu(page, 'Object', 'makeSymbol');
  await answer(page, 'Clipped');
  await tick(page);
  await churn(page);
  await expect(page.locator('#sc-defs clipPath')).toHaveCount(1);
  // Inside the circle: red. Inside the square but outside the circle: clear.
  const [inside, corner] = await pixels(page, [
    [100, 100],
    [45, 45],
  ]);
  expect(inside.slice(0, 3)).toEqual([220, 38, 38]);
  expect(corner[3]).toBe(0);
});

test('a text on a path made into a symbol keeps following its path', async ({ page }) => {
  await load(
    page,
    '<rect id="other" x="350" y="250" width="10" height="10" fill="#000"/>' +
      '<path id="arc" d="M60 200 A140 140 0 0 1 340 200" fill="none" stroke="#999"/>' +
      '<text id="t" x="60" y="100" font-family="sans-serif" font-size="40" fill="#000">Hello curve</text>',
    400,
    300,
  );
  await select(page, 't', 'arc');
  await menu(page, 'Object', 'textOnPath');
  await tick(page);
  const tp = await page.locator('#sc-defs path[data-sc-tp]').count();
  expect(tp).toBe(1);
  await select(page, 't', 'arc');
  await menu(page, 'Object', 'makeSymbol');
  await answer(page, 'Curved');
  await tick(page);
  await churn(page);
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(1);
  // Glyphs still drawn: dark pixels along the arc's top.
  const dark = await page.evaluate(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(60, 20, 280, 120).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 60) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(300);
});
