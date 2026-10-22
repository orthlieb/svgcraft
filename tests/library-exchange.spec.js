import fs from 'node:fs';
import { test, expect } from './fixtures.js';

// Exporting the libraries in formats other apps read (ASE, GPL, CSS, SVG
// gradients / patterns, SVG sprite) and importing those, plus GIMP gradients
// and gradients, patterns and symbols from any SVG.

const LIB_KEY = 'svgcraft.library.v1';
const msg = (page) => page.locator('#sc-msg');
const stored = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), LIB_KEY);

// Start from a known library (other kinds keep their built-ins).
async function setLib(page, parts) {
  await page.evaluate(
    ([k, parts]) => {
      const cur = JSON.parse(localStorage.getItem(k) || 'null') || {};
      localStorage.setItem(k, JSON.stringify({ ...cur, ...parts }));
    },
    [LIB_KEY, parts],
  );
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

const SWATCHES = [
  { name: 'Brick red', c: '#b91c1c', a: 1 },
  { name: 'Sky', c: '#38bdf8', a: 1 },
  { name: 'Ghost', c: '#123456', a: 0.5 },
];
const GRADIENTS = [
  {
    name: 'Sunset',
    type: 'linear',
    angle: 90,
    stops: [
      { o: 0, c: '#1e1b4b', a: 1 },
      { o: 0.55, c: '#9d174d', a: 1 },
      { o: 1, c: '#fb923c', a: 0.5 },
    ],
  },
  {
    name: 'Glow',
    type: 'radial',
    angle: 0,
    stops: [
      { o: 0, c: '#ffffff', a: 1 },
      { o: 1, c: '#000000', a: 0 },
    ],
  },
];
const MY_SYMBOL = {
  name: 'Badge',
  category: 'Mine',
  w: 20,
  h: 10,
  svg: '<rect width="20" height="10" rx="3"/>',
};

const panel = { swatches: 'swatches', gradients: 'gradients', patterns: 'patterns' };
async function openPanel(page, kind) {
  if (kind === 'symbols') {
    await page.click('[data-tab="symbols"]');
    await page.click('[data-symview="lib"]');
  } else await page.click(`[data-tab="${panel[kind]}"]`);
}
// Export from a panel's menu; returns [file name, contents].
async function exportAs(page, kind, label, binary = false) {
  await openPanel(page, kind);
  await page.click(`[data-lib="${kind}"] [data-lib-act="export"]`);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click(`.sc-popmenu [role="menuitem"]:has-text("${label}")`),
  ]);
  const buf = fs.readFileSync(await dl.path());
  return [dl.suggestedFilename(), binary ? buf : buf.toString('utf8')];
}
const importFile = (page, name, buffer) =>
  page.setInputFiles('#sc-lib-file', { name, mimeType: 'application/octet-stream', buffer });

// Is this SVG well formed, and does a browser draw it?
const renders = (page, svg) =>
  page.evaluate(async (svg) => {
    if (new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'))
      return false;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    return img.naturalWidth > 0;
  }, svg);

// A hand-built ASE with one swatch per colour model.
function aseOf(entries) {
  const blocks = entries.map(([name, model, vals]) => {
    const len = 2 + (name.length + 1) * 2 + 4 + vals.length * 4 + 2;
    const b = Buffer.alloc(6 + len);
    let p = b.writeUInt16BE(1, 0);
    p = b.writeUInt32BE(len, p);
    p = b.writeUInt16BE(name.length + 1, p);
    for (const ch of name) p = b.writeUInt16BE(ch.charCodeAt(0), p);
    p += 2;
    p += b.write(model, p, 'latin1');
    for (const v of vals) p = b.writeFloatBE(v, p);
    b.writeUInt16BE(2, p);
    return b;
  });
  const head = Buffer.alloc(12);
  head.write('ASEF', 0, 'latin1');
  head.writeUInt16BE(1, 4);
  head.writeUInt32BE(blocks.length, 8);
  return Buffer.concat([head, ...blocks]);
}

test('the Export button opens a menu of formats, and Esc closes it', async ({ page }) => {
  await openPanel(page, 'swatches');
  const btn = page.locator('[data-lib="swatches"] [data-lib-act="export"]');
  await btn.click();
  const items = page.locator('.sc-popmenu [role="menuitem"]');
  await expect(items).toHaveText([
    /SVGCraft library.*\.json/,
    /Adobe Swatch Exchange.*\.ase/,
    /GIMP \/ Inkscape palette.*\.gpl/,
    /CSS variables.*\.css/,
  ]);
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-popmenu')).toHaveCount(0);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  // Clicking the button again, or anywhere else, closes it too.
  await btn.click();
  await btn.click();
  await expect(page.locator('.sc-popmenu')).toHaveCount(0);
  await btn.click();
  await page.mouse.click(5, 300);
  await expect(page.locator('.sc-popmenu')).toHaveCount(0);

  await openPanel(page, 'gradients');
  await page.click('[data-lib="gradients"] [data-lib-act="export"]');
  await expect(items).toHaveText([/SVGCraft library/, /SVG gradients/, /CSS gradients/]);
  await page.keyboard.press('Escape');
  await openPanel(page, 'symbols');
  await page.click('[data-lib="symbols"] [data-lib-act="export"]');
  await expect(items).toHaveText([/SVGCraft library/, /my symbols/, /all symbols/]);
});

test.describe('swatches', () => {
  test.beforeEach(({ page }) => setLib(page, { swatches: SWATCHES }));

  test('ASE: Adobe’s binary format, round trip', async ({ page }) => {
    const [name, buf] = await exportAs(page, 'swatches', 'Adobe Swatch Exchange', true);
    expect(name).toBe('svgcraft-swatches.ase');
    expect(buf.toString('latin1', 0, 4)).toBe('ASEF');
    expect(buf.readUInt16BE(4)).toBe(1);
    expect(buf.readUInt32BE(8)).toBe(3);
    // First block: a colour entry named "Brick red", RGB 0xb9 0x1c 0x1c.
    expect(buf.readUInt16BE(12)).toBe(1);
    expect(buf.readUInt16BE(18)).toBe(10); // 9 chars + NUL
    const nameBE = Buffer.from(buf.subarray(20, 38)).swap16().toString('utf16le');
    expect(nameBE).toBe('Brick red');
    expect(buf.toString('latin1', 40, 44)).toBe('RGB ');
    expect(Math.round(buf.readFloatBE(44) * 255)).toBe(0xb9);
    expect(Math.round(buf.readFloatBE(48) * 255)).toBe(0x1c);

    await setLib(page, { swatches: [] });
    await importFile(page, name, buf);
    await expect(msg(page)).toHaveText('Imported 3 swatches.');
    // ASE has no alpha, so the half-transparent swatch comes back opaque.
    expect((await stored(page)).swatches.map(({ name, c, a }) => [name, c, a])).toEqual([
      ['Brick red', '#b91c1c', 1],
      ['Sky', '#38bdf8', 1],
      ['Ghost', '#123456', 1],
    ]);
  });

  test('ASE: CMYK, Gray and Lab swatches become RGB', async ({ page }) => {
    await setLib(page, { swatches: [] });
    await importFile(
      page,
      'print.ase',
      aseOf([
        ['Cyan', 'CMYK', [1, 0, 0, 0]],
        ['Mid grey', 'Gray', [0.5]],
        ['Lab white', 'LAB ', [1, 0, 0]],
      ]),
    );
    await expect(msg(page)).toHaveText('Imported 3 swatches.');
    const sw = (await stored(page)).swatches;
    expect(sw.map((x) => x.name)).toEqual(['Cyan', 'Mid grey', 'Lab white']);
    expect(sw[0].c).toBe('#00ffff');
    expect(sw[1].c).toBe('#808080');
    expect(sw[2].c).toMatch(/^#f[c-f]f[c-f]f[c-f]$/);
  });

  test('GPL: GIMP / Inkscape palette, round trip, and GIMP 3 alpha', async ({ page }) => {
    const [name, text] = await exportAs(page, 'swatches', 'GIMP');
    expect(name).toBe('svgcraft-swatches.gpl');
    expect(text.split('\n').slice(0, 4)).toEqual([
      'GIMP Palette',
      'Name: SVGCraft',
      'Columns: 8',
      '#',
    ]);
    expect(text).toContain('185  28  28\tBrick red');

    await setLib(page, { swatches: [] });
    await importFile(page, name, Buffer.from(text));
    await expect(msg(page)).toHaveText('Imported 3 swatches.');
    expect((await stored(page)).swatches.map((x) => x.c)).toEqual([
      '#b91c1c',
      '#38bdf8',
      '#123456',
    ]);

    await importFile(
      page,
      'gimp3.gpl',
      Buffer.from('GIMP Palette\nName: x\nChannels: RGBA\n#\n255 0 0 128 Half red\n'),
    );
    await expect(msg(page)).toHaveText('Imported 1 swatch.');
    expect((await stored(page)).swatches.at(-1)).toMatchObject({
      name: 'Half red',
      c: '#ff0000',
      a: 0.5,
    });
  });

  test('CSS variables keep alpha', async ({ page }) => {
    const [name, css] = await exportAs(page, 'swatches', 'CSS variables');
    expect(name).toBe('svgcraft-swatches.css');
    expect(css).toContain('--brick-red: #b91c1c;');
    expect(css).toContain('--sky: #38bdf8;');
    expect(css).toContain('--ghost: rgba(18,52,86,0.5);');
  });
});

test.describe('gradients', () => {
  test.beforeEach(({ page }) => setLib(page, { gradients: GRADIENTS }));

  test('SVG: draws a sample of each, and round-trips', async ({ page }) => {
    const [name, svg] = await exportAs(page, 'gradients', 'SVG gradients');
    expect(name).toBe('svgcraft-gradients.svg');
    expect(await renders(page, svg)).toBe(true);
    expect(svg).toContain(
      '<linearGradient id="sunset" data-name="Sunset" x1="0.5" y1="1" x2="0.5" y2="0">',
    );
    expect(svg).toContain('<stop offset="1" stop-color="#fb923c" stop-opacity="0.5"/>');
    expect(svg).toContain('<radialGradient id="glow"');
    expect(svg).toContain('fill="url(#sunset)"');

    await setLib(page, { gradients: [] });
    await importFile(page, name, Buffer.from(svg));
    await expect(msg(page)).toHaveText('Imported 2 gradients.');
    const back = (await stored(page)).gradients.map(({ name, type, angle, stops }) => ({
      name,
      type,
      angle,
      stops,
    }));
    expect(back).toEqual(GRADIENTS);
    // Importing again adds nothing.
    await importFile(page, name, Buffer.from(svg));
    await expect(msg(page)).toHaveText('Nothing new in that library.');
  });

  test('CSS gradients', async ({ page }) => {
    const [name, css] = await exportAs(page, 'gradients', 'CSS gradients');
    expect(name).toBe('svgcraft-gradients.css');
    expect(css).toContain(
      '--sunset: linear-gradient(0deg, #1e1b4b 0%, #9d174d 55%, rgba(251,146,60,0.5) 100%);',
    );
    expect(css).toContain('--glow: radial-gradient(circle, #ffffff 0%, rgba(0,0,0,0) 100%);');
  });

  test('GGR: GIMP gradients, with an off-centre midpoint', async ({ page }) => {
    await setLib(page, { gradients: [] });
    const ggr = [
      'GIMP Gradient',
      'Name: Fire',
      '2',
      '0 0.15 0.5 1 0 0 1 1 1 0 1 0 0',
      '0.5 0.75 1 1 1 0 1 1 1 1 0 0 0',
    ].join('\n');
    await importFile(page, 'fire.ggr', Buffer.from(ggr));
    await expect(msg(page)).toHaveText('Imported 1 gradient.');
    const [g] = (await stored(page)).gradients;
    expect(g).toMatchObject({ name: 'Fire', type: 'linear', angle: 0 });
    expect(g.stops.map((s) => [s.o, s.c, s.a])).toEqual([
      [0, '#ff0000', 1],
      [0.15, '#ff8000', 1],
      [0.5, '#ffff00', 1],
      [1, '#ffffff', 0],
    ]);
  });
});

test('any SVG: gradients (with shared stops), patterns and symbols', async ({ page }) => {
  await setLib(page, { gradients: [], patterns: [], symbols: [] });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
      xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
    <defs>
      <linearGradient id="base"><stop offset="0" style="stop-color:red"/><stop offset="100%" stop-color="rgb(0, 0, 255)" style="stop-opacity:0.25"/></linearGradient>
      <linearGradient id="down" inkscape:label="Red to blue" xlink:href="#base" x1="0" y1="0" x2="0" y2="1"/>
      <pattern id="dots" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="5" cy="5" r="2" fill="currentColor"/></pattern>
      <pattern id="box" viewBox="5 5 4 4" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="5" y="5" width="2" height="2"/></pattern>
      <pattern id="bb" patternContentUnits="objectBoundingBox" width="1" height="1"><rect width=".5" height=".5"/></pattern>
    </defs>
    <symbol id="star" viewBox="-12 -12 24 24"><title>Star</title><path d="M0-10L3 0 0 10-3 0z"/></symbol>
    <symbol id="nobox"><rect width="5" height="5"/></symbol>
  </svg>`;
  await importFile(page, 'kit.svg', Buffer.from(svg));
  await expect(msg(page)).toHaveText('Imported 2 gradients, 2 patterns, 1 symbol.');
  const lib = await stored(page);
  expect(lib.gradients.map((g) => [g.name, g.angle, g.stops])).toEqual([
    [
      'base',
      0,
      [
        { o: 0, c: '#ff0000', a: 1 },
        { o: 1, c: '#0000ff', a: 0.25 },
      ],
    ],
    [
      'Red to blue',
      -90,
      [
        { o: 0, c: '#ff0000', a: 1 },
        { o: 1, c: '#0000ff', a: 0.25 },
      ],
    ],
  ]);
  expect(lib.patterns.map((p) => [p.name, p.w, p.h])).toEqual([
    ['dots', 10, 10],
    ['box', 4, 4],
  ]);
  expect(lib.patterns[1].svg).toContain('translate(-5 -5)');
  expect(lib.symbols).toEqual([
    expect.objectContaining({ name: 'Star', category: 'kit', w: 24, h: 24 }),
  ]);
  expect(lib.symbols[0].svg).toMatch(/^<g transform="translate\(12 12\)"><path /);

  await importFile(page, 'bad.svg', Buffer.from('<svg><unclosed></svg>'));
  await expect(msg(page)).toContainText('isn’t a library');
});

test('patterns: SVG with a sample of each, round trip', async ({ page }) => {
  const [name, svg] = await exportAs(page, 'patterns', 'SVG patterns');
  expect(name).toBe('svgcraft-patterns.svg');
  expect(await renders(page, svg)).toBe(true);
  expect(svg).toContain(
    '<pattern id="stripes" data-name="Stripes" patternUnits="userSpaceOnUse" width="8" height="8" color="#1f2937">',
  );
  const before = (await stored(page))?.patterns;
  const n = (svg.match(/<pattern /g) || []).length;
  expect(n).toBe(9);
  await setLib(page, { patterns: [] });
  await importFile(page, name, Buffer.from(svg));
  await expect(msg(page)).toHaveText('Imported 9 patterns.');
  const after = (await stored(page)).patterns;
  expect(after.map(({ name, w, h }) => [name, w, h])).toEqual(
    (before || after).map(({ name, w, h }) => [name, w, h]),
  );
});

test('symbols: an SVG sprite of my symbols or all, round trip', async ({ page }) => {
  // Only built-ins: nothing of mine to export.
  await openPanel(page, 'symbols');
  await page.click('[data-lib="symbols"] [data-lib-act="export"]');
  await page.click('.sc-popmenu [role="menuitem"]:has-text("my symbols")');
  await expect(msg(page)).toContainText('No saved symbols');

  const builtins = await page.evaluate(() => window.SC_SYMBOLS);
  await setLib(page, { symbols: [...builtins, MY_SYMBOL] });
  const [name, mine] = await exportAs(page, 'symbols', 'my symbols');
  expect(name).toBe('svgcraft-symbols.svg');
  expect(await renders(page, mine)).toBe(true);
  expect(mine).toContain(
    '<symbol id="badge" viewBox="0 0 20 10" data-name="Badge" data-category="Mine">',
  );
  expect(mine).toContain('<use href="#badge"');
  expect((mine.match(/<symbol /g) || []).length).toBe(1);
  expect(mine).not.toContain('Font Awesome');

  const [, all] = await exportAs(page, 'symbols', 'all symbols');
  expect((all.match(/<symbol /g) || []).length).toBe(builtins.length + 1);
  expect(all).toContain('data-credit="Font Awesome Free 6.7.2 — CC BY 4.0"');
  expect(all).toContain('<desc>Credits: Font Awesome Free 6.7.2 — CC BY 4.0.');
  expect(await renders(page, all)).toBe(true);

  await setLib(page, { symbols: builtins });
  await importFile(page, name, Buffer.from(mine));
  await expect(msg(page)).toHaveText('Imported 1 symbol.');
  expect((await stored(page)).symbols.at(-1)).toMatchObject(MY_SYMBOL);
  // The built-ins are already there, so the full sprite adds nothing new.
  await importFile(page, 'all.svg', Buffer.from(all));
  await expect(msg(page)).toHaveText('Nothing new in that library.');
});
