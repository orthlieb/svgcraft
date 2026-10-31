import fs from 'node:fs';
import { test, expect, tab } from './fixtures.js';
import { readZip, makeZip } from './zip.js';

// Export writes one zip: the SVGCraft library plus GIMP palette, CSS and SVG
// files for other apps. Import reads that zip, a zip of such files, or any
// of them on their own, plus GIMP gradients.

const LIB_KEY = 'svgcraft.library.v1';
const msg = (page) => page.locator('#sc-msg');
const stored = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), LIB_KEY);
const EMPTY = { swatches: [], gradients: [], patterns: [], symbols: [] };

// Start from a known library (kinds left out keep what they have).
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
const PATTERNS = [
  { name: 'Dots', w: 10, h: 10, svg: '<circle cx="5" cy="5" r="2" fill="currentColor"/>' },
];
const MY_SYMBOL = {
  name: 'Badge',
  category: 'Mine',
  w: 20,
  h: 10,
  svg: '<rect width="20" height="10" rx="3"/>',
};
const LIB = { swatches: SWATCHES, gradients: GRADIENTS, patterns: PATTERNS, symbols: [MY_SYMBOL] };
// A library without its ids.
const plain = (lib) =>
  Object.fromEntries(
    Object.keys(EMPTY).map((k) => [
      k,
      lib[k].map((x) => Object.fromEntries(Object.entries(x).filter(([p]) => p !== 'id'))),
    ]),
  );

// Export from a panel's button; returns the zip's files as strings.
async function exportZip(page, kind = 'swatches') {
  await tab(page, kind);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click(`[data-lib="${kind}"] [data-lib-act="export"]`),
  ]);
  expect(dl.suggestedFilename()).toBe('svgcraft-library.zip');
  const files = readZip(fs.readFileSync(await dl.path()));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('utf8')]));
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

test.describe('export', () => {
  test.beforeEach(({ page }) => setLib(page, LIB));

  test('one zip from any panel, with a file per format', async ({ page }) => {
    const files = await exportZip(page);
    expect(Object.keys(files)).toEqual([
      'svgcraft-library.json',
      'swatches.gpl',
      'swatches.css',
      'gradients.svg',
      'gradients.css',
      'patterns.svg',
      'symbols.svg',
      'README.txt',
    ]);
    expect(JSON.parse(files['svgcraft-library.json'])).toMatchObject({
      app: 'svgcraft',
      kind: 'library',
      version: 1,
      ...plain(LIB),
    });
    expect(files['README.txt']).toContain('swatches.gpl');
    await expect(msg(page)).toHaveText('Exported the library as svgcraft-library.zip.');
    // Every panel's button exports the same thing.
    for (const tab of ['gradients', 'patterns']) {
      const again = await exportZip(page, tab);
      expect(again['svgcraft-library.json']).toBe(files['svgcraft-library.json']);
    }
  });

  test('swatches: GIMP palette and CSS variables', async ({ page }) => {
    const files = await exportZip(page);
    expect(files['swatches.gpl'].split('\n').slice(0, 4)).toEqual([
      'GIMP Palette',
      'Name: SVGCraft',
      'Columns: 8',
      '#',
    ]);
    expect(files['swatches.gpl']).toContain('185  28  28\tBrick red');
    expect(files['swatches.css']).toContain('--brick-red: #b91c1c;');
    expect(files['swatches.css']).toContain('--ghost: rgba(18,52,86,0.5);');
  });

  test('gradients: SVG with samples, and CSS', async ({ page }) => {
    const files = await exportZip(page);
    const svg = files['gradients.svg'];
    expect(await renders(page, svg)).toBe(true);
    expect(svg).toContain(
      '<linearGradient id="sunset" data-name="Sunset" x1="0.5" y1="1" x2="0.5" y2="0">',
    );
    expect(svg).toContain('<stop offset="1" stop-color="#fb923c" stop-opacity="0.5"/>');
    expect(svg).toContain('<radialGradient id="glow"');
    expect(svg).toContain('fill="url(#sunset)"');
    expect(files['gradients.css']).toContain(
      '--sunset: linear-gradient(0deg, #1e1b4b 0%, #9d174d 55%, rgba(251,146,60,0.5) 100%);',
    );
    expect(files['gradients.css']).toContain(
      '--glow: radial-gradient(circle, #ffffff 0%, rgba(0,0,0,0) 100%);',
    );
  });

  test('patterns and the symbol sprite', async ({ page }) => {
    const files = await exportZip(page);
    expect(await renders(page, files['patterns.svg'])).toBe(true);
    expect(files['patterns.svg']).toContain(
      '<pattern id="dots" data-name="Dots" patternUnits="userSpaceOnUse" width="10" height="10" color="#1f2937">',
    );
    const sprite = files['symbols.svg'];
    expect(await renders(page, sprite)).toBe(true);
    expect(sprite).toContain(
      '<symbol id="badge" viewBox="0 0 20 10" data-name="Badge" data-category="Mine">',
    );
    expect(sprite).toContain('<use href="#badge"');
  });

  test('the built-in icons go in the sprite with their credit', async ({ page }) => {
    const builtins = await page.evaluate(() => window.SC_SYMBOLS);
    await setLib(page, { symbols: builtins });
    const sprite = (await exportZip(page))['symbols.svg'];
    expect((sprite.match(/<symbol /g) || []).length).toBe(builtins.length);
    expect(sprite).toContain('data-credit="Font Awesome Free 6.7.2 — CC BY 4.0"');
    expect(sprite).toContain('<desc>Credits: Font Awesome Free 6.7.2 — CC BY 4.0.');
  });

  test('empty kinds are left out', async ({ page }) => {
    await setLib(page, { ...EMPTY, swatches: SWATCHES });
    const files = await exportZip(page);
    expect(Object.keys(files)).toEqual([
      'svgcraft-library.json',
      'swatches.gpl',
      'swatches.css',
      'README.txt',
    ]);
  });
});

test.describe('import', () => {
  test('the exported zip brings everything back, once', async ({ page }) => {
    await setLib(page, LIB);
    await tab(page, 'swatches');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-lib="swatches"] [data-lib-act="export"]'),
    ]);
    const zip = fs.readFileSync(await dl.path());
    await setLib(page, EMPTY);
    await importFile(page, 'svgcraft-library.zip', zip);
    await expect(msg(page)).toHaveText('Imported 3 swatches, 2 gradients, 1 pattern, 1 symbol.');
    expect(plain(await stored(page))).toEqual(plain(LIB));
    await importFile(page, 'svgcraft-library.zip', zip);
    await expect(msg(page)).toHaveText('Nothing new in that library.');
  });

  test('a zip without the library file: its palettes, gradients and SVGs', async ({ page }) => {
    await setLib(page, LIB);
    const files = await exportZip(page);
    await setLib(page, EMPTY);
    // Deflated, in a folder, as an archiver would make it. CSS and the
    // README aren't read.
    const zip = makeZip(
      Object.entries(files)
        .filter(([n]) => n !== 'svgcraft-library.json')
        .map(([n, t]) => [`kit/${n}`, t]),
      { deflate: true },
    );
    await importFile(page, 'kit.zip', zip);
    await expect(msg(page)).toHaveText('Imported 3 swatches, 2 gradients, 1 pattern, 1 symbol.');
    const lib = plain(await stored(page));
    // A GIMP palette has no alpha, so the half-transparent swatch is opaque.
    expect(lib.swatches.map((x) => [x.name, x.c, x.a])).toEqual([
      ['Brick red', '#b91c1c', 1],
      ['Sky', '#38bdf8', 1],
      ['Ghost', '#123456', 1],
    ]);
    expect(lib.gradients).toEqual(GRADIENTS);
    expect(lib.patterns).toEqual(PATTERNS);
    expect(lib.symbols).toEqual([MY_SYMBOL]);

    await importFile(page, 'junk.zip', makeZip([['notes.txt', 'hello']]));
    await expect(page.locator('#sc-alert-text')).toContainText('isn’t a library');
  });

  test('a GIMP palette on its own, with GIMP 3 alpha', async ({ page }) => {
    await setLib(page, EMPTY);
    await importFile(
      page,
      'gimp3.gpl',
      Buffer.from('GIMP Palette\nName: x\nChannels: RGBA\n#\n255 0 0 128 Half red\n0 0 255 255\n'),
    );
    await expect(msg(page)).toHaveText('Imported 2 swatches.');
    expect((await stored(page)).swatches.map(({ name, c, a }) => [name, c, a])).toEqual([
      ['Half red', '#ff0000', 0.5],
      ['#0000ff', '#0000ff', 1],
    ]);
  });

  test('a GIMP gradient, with an off-centre midpoint', async ({ page }) => {
    await setLib(page, EMPTY);
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

  test('any SVG: gradients (with shared stops), patterns and symbols', async ({ page }) => {
    await setLib(page, EMPTY);
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
    const stops = [
      { o: 0, c: '#ff0000', a: 1 },
      { o: 1, c: '#0000ff', a: 0.25 },
    ];
    expect(lib.gradients.map((g) => [g.name, g.angle, g.stops])).toEqual([
      ['base', 0, stops],
      ['Red to blue', -90, stops],
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
    await expect(page.locator('#sc-alert-text')).toContainText('isn’t a library');
  });
});

test.describe('a new definition under a name you already use', () => {
  const MINE = {
    swatches: [
      { id: 'sky', name: 'Sky', c: '#38bdf8', a: 1 },
      { id: 'sea', name: 'Sea', c: '#0e7490', a: 1 },
    ],
    gradients: [{ id: 'sunset', ...GRADIENTS[0] }],
  };
  // Sky and Sunset are new definitions under names in use; "Ocean" is the
  // same colour as Sea (skipped quietly); Night is new.
  const INCOMING = {
    swatches: [
      { name: 'sky', c: '#000080', a: 1 },
      { name: 'Ocean', c: '#0e7490', a: 1 },
      { name: 'Night', c: '#111111', a: 1 },
    ],
    gradients: [{ ...GRADIENTS[0], angle: 0 }],
  };
  const importIncoming = (page) =>
    importFile(page, 'theirs.json', Buffer.from(JSON.stringify(INCOMING)));
  const dialog = (page) => page.locator('#sc-ask');
  const lib = async (page) => {
    const l = await stored(page);
    return {
      swatches: l.swatches.map((x) => [x.name, x.c]),
      gradients: l.gradients.map((x) => [x.name, x.angle]),
    };
  };

  test.beforeEach(({ page }) => setLib(page, MINE));

  test('asks once, and Keep both renames the imported ones', async ({ page }) => {
    await importIncoming(page);
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#sc-ask-title')).toHaveText('Name clash');
    await expect(dialog(page).locator('.sc-ask-text')).toContainText(
      '2 imported items have the same name as ones you have but a different definition: “sky”, “Sunset”.',
    );
    await expect(dialog(page).locator('[data-ask="ok"]')).toHaveText('Keep both');
    await expect(dialog(page).locator('[data-ask="alt"]')).toHaveText('Replace mine');
    await expect(dialog(page).locator('[data-ask="cancel"]')).toHaveText('Skip them');
    await expect(dialog(page).locator('[data-ask="ok"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(msg(page)).toHaveText('Imported 2 swatches, 1 gradient.');
    expect(await lib(page)).toEqual({
      swatches: [
        ['Sky', '#38bdf8'],
        ['Sea', '#0e7490'],
        ['sky 2', '#000080'],
        ['Night', '#111111'],
      ],
      gradients: [
        ['Sunset', 90],
        ['Sunset 2', 0],
      ],
    });
  });

  test('Replace mine keeps your names and places', async ({ page }) => {
    await importIncoming(page);
    await dialog(page).locator('[data-ask="alt"]').click();
    await expect(msg(page)).toHaveText('Imported 1 swatch. Replaced 1 swatch, 1 gradient.');
    expect(await lib(page)).toEqual({
      swatches: [
        ['Sky', '#000080'],
        ['Sea', '#0e7490'],
        ['Night', '#111111'],
      ],
      gradients: [['Sunset', 0]],
    });
    expect((await stored(page)).swatches[0].id).toBe('sky');
  });

  test('Skip them (or Esc) imports only the rest', async ({ page }) => {
    await importIncoming(page);
    await page.keyboard.press('Escape');
    await expect(msg(page)).toHaveText('Imported 1 swatch. Skipped 2 with a name you already use.');
    expect(await lib(page)).toEqual({
      swatches: [
        ['Sky', '#38bdf8'],
        ['Sea', '#0e7490'],
        ['Night', '#111111'],
      ],
      gradients: [['Sunset', 90]],
    });
    // The dialog's buttons are back to normal for the next prompt.
    await importIncoming(page);
    await dialog(page).locator('[data-ask="cancel"]').click();
    await tab(page, 'swatches');
    await page.click('[data-lib="swatches"] [data-lib-act="reset"]');
    await expect(dialog(page).locator('[data-ask="cancel"]')).toHaveText('Cancel');
    await expect(dialog(page).locator('[data-ask="alt"]')).toBeHidden();
  });
});
