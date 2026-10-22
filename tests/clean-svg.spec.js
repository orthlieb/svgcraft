import fs from 'node:fs';
import { test, expect, menu } from './fixtures.js';

// File → Export Clean SVG…: plain SVG without SVGCraft's editing data, that
// draws exactly like Save as SVG.

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" data-sc-guides="x:10 y:10">
  <title>Badge</title>
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
    <linearGradient id="unused"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
  </defs>
  <g id="grp" data-name="Shapes">
    <rect id="r" x="10.123456" y="10" width="80" height="50" rx="6" fill="url(#lg)" stroke="#000000" stroke-width="6"
      data-stroke-align="inside" data-sc-fx='{"ds":{"c":"#000000","o":60,"a":120,"d":4,"sp":0,"s":3}}' data-name="Card"/>
    <circle cx="140" cy="40" r="25.55555" fill="#16a34a" opacity="1" data-sc-lock="all"/>
  </g>
  <g><g><path d="M 10 100 L 60 100 L 35 80 Z" fill="#f59e0b"/></g></g>
  <g data-name="Empty"></g>
  <rect id="ghost" x="120" y="80" width="30" height="20" fill="#ff00ff" display="none"/>
</svg>`;

async function setUp(page) {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'badge.svg'), SCENE);
  // Let the generated defs (shadow filter, inside-stroke clip) settle.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
}

// Export with some options set; returns the file's text.
async function exportClean(page, set = {}) {
  await menu(page, 'File', 'exportCleanSvg');
  const dlg = page.locator('#sc-cleansvg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-cs-btn="ok"]')).toBeFocused();
  for (const [k, v] of Object.entries(set)) {
    const el = dlg.locator(`[data-cs="${k}"]`);
    if (typeof v === 'boolean') await el.setChecked(v);
    else await el.fill(String(v));
  }
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    dlg.locator('[data-cs-btn="ok"]').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('badge.min.svg');
  return fs.readFileSync(await dl.path(), 'utf8');
}

// Rasterise two SVGs at 2× and count differing pixels.
const diff = (page, a, b) =>
  page.evaluate(
    async ([a, b]) => {
      const draw = async (s) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 240;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 400, 240);
        return ctx.getImageData(0, 0, 400, 240).data;
      };
      const [p, q] = await Promise.all([draw(a), draw(b)]);
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if ([0, 1, 2, 3].some((k) => Math.abs(p[i + k] - q[i + k]) > 2)) n++;
      return n;
    },
    [a, b],
  );

test.beforeEach(({ page }) => setUp(page));

test('defaults: minified, no editing data, and it looks the same', async ({ page }) => {
  const full = await page.evaluate(() => window.svgcraft.serialize());
  // At full precision the clean file draws exactly the same pixels.
  expect(await diff(page, full, await exportClean(page, { decimals: 6 }))).toBe(0);
  const clean = await exportClean(page, { decimals: 2 });
  expect(clean).not.toMatch(/data-|xml:space|\n/);
  // Gone: the unused gradient, the hidden layer, empty and bare groups.
  expect(clean).not.toContain('unused');
  expect(clean).not.toContain('#ff00ff');
  expect(clean.match(/<g[\s>]/g) || []).toHaveLength(0);
  // Kept and drawn: the gradient, the shadow filter and the inside-stroke clip,
  // under short ids.
  expect(clean).toMatch(/<linearGradient id="[0-9a-z]"/);
  expect(clean).toMatch(/fill="url\(#[0-9a-z]\)"/);
  expect(clean).toMatch(/filter="url\(#[0-9a-z]\)"/);
  expect(clean).toContain('<title>Badge</title>');
  // Rounded numbers, tight path data, defaults dropped, viewBox only.
  expect(clean).toContain('x="10.12"');
  expect(clean).toContain('r="25.56"');
  expect(clean).toContain('d="M10 100L60 100L35 80Z"');
  expect(clean).not.toContain('opacity="1"');
  expect(clean).toMatch(/^<svg [^>]*viewBox="0 0 200 120"/);
  expect(clean).not.toMatch(/^<svg [^>]*\b(width|height)=/);
  expect(clean.length).toBeLessThan(full.length);
  await expect(page.locator('#sc-msg')).toContainText('Exported badge.min.svg:');
  // Save as SVG still keeps everything: the working copy is untouched.
  expect(await page.evaluate(() => window.svgcraft.serialize())).toContain('data-sc-fx');
});

test('options: readable, sized, hidden layers, no File Info, more decimals', async ({ page }) => {
  const clean = await exportClean(page, {
    minify: false,
    responsive: false,
    hidden: false,
    meta: false,
    decimals: 4,
  });
  expect(clean.split('\n').length).toBeGreaterThan(5);
  expect(clean).toMatch(/^<svg [^>]*width="200" height="120"/);
  expect(clean).toContain('#ff00ff');
  expect(clean).not.toContain('<title>');
  expect(clean).toContain('x="10.1235"');
  // Long ids stay (only referenced ones), unreferenced ones go.
  expect(clean).toContain('id="lg"');
  expect(clean).not.toContain('id="grp"');
  expect(clean).not.toMatch(/data-/);
  // The choices are remembered for next time.
  await menu(page, 'File', 'exportCleanSvg');
  await expect(page.locator('[data-cs="minify"]')).not.toBeChecked();
  await expect(page.locator('[data-cs="decimals"]')).toHaveValue('4');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sc-cleansvg')).toBeHidden();
});

test('currentColor for one-colour icons', async ({ page }) => {
  const clean = await exportClean(page, { currentColor: true });
  expect(clean).toContain('fill="currentColor"');
  expect(clean).toContain('stroke="currentColor"');
  // Gradients stay gradients.
  expect(clean).toMatch(/fill="url\(#[0-9a-z]\)"/);
  expect(clean).not.toContain('#16a34a');
  expect(clean).not.toContain('#f59e0b');
});
