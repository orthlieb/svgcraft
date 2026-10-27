import fs from 'node:fs';
import { readZip } from './zip.js';
import { test, expect, load, select, menu, toScreen } from './fixtures.js';

// The Symbols library: the built-in icon set, search and categories,
// placing (and reusing) symbols, drag and drop, Save to Library, rename /
// delete / reset, export / import, and old stored libraries.

const LIB_KEY = 'svgcraft.library.v1';
const SCENE =
  '<rect id="bg" width="400" height="300" fill="#ffffff"/>' +
  '<rect id="a" x="40" y="40" width="60" height="60" fill="#dc2626"/>' +
  '<circle id="b" cx="130" cy="70" r="20" fill="#2563eb"/>';

const RED = [220, 38, 38];
const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];
const near = (px, rgb) => px.every((v, i) => Math.abs(v - rgb[i]) < 6);

// Rasterise the export and read pixels at doc points.
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
    return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, pts);

async function answer(page, value, button = 'ok') {
  await expect(page.locator('#sc-ask')).toBeVisible();
  if (value != null) await page.fill('#sc-ask .sc-ask-input', value);
  await page.click(`#sc-ask [data-ask="${button}"]`);
  await expect(page.locator('#sc-ask')).toBeHidden();
}

const tiles = (page) => page.locator('#sc-libsyms .sc-sym-tile');
const tile = (page, name) => page.locator(`#sc-libsyms .sc-sym-tile[aria-label="${name}"]`);
const uses = (page) => page.locator('#sc-doc use');
const symbols = (page) => page.locator('#sc-defs > symbol');
const stored = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), LIB_KEY);
const builtinCount = (page) => page.evaluate(() => window.SC_SYMBOLS.length);

async function openLibrary(page) {
  await page.click('[data-tab="symbols"]');
  await page.click('[data-symview="lib"]');
  await expect(page.locator('#sc-libsyms')).toBeVisible();
}

async function setFillHex(page, hex) {
  await page.evaluate((hex) => {
    const inp = document.querySelector('#sc-fill-hex');
    inp.value = hex;
    inp.dispatchEvent(new Event('change'));
  }, hex);
}

// The centre of the last instance's painted box.
const lastUseBox = (page) =>
  page.evaluate(() =>
    window.svgcraft.paintBox([[...document.querySelectorAll('#sc-doc use')].at(-1)]),
  );

async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
}

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 400, 300);
});

test.describe('the built-in set', () => {
  test('loads about eighty credited icons across categories', async ({ page }) => {
    const n = await builtinCount(page);
    expect(n).toBeGreaterThanOrEqual(75);
    expect(n).toBeLessThanOrEqual(90);
    await openLibrary(page);
    await expect(tiles(page)).toHaveCount(n);
    const cats = await page.locator('#sc-libsym-cat option').allTextContents();
    expect(cats).toEqual([
      'All',
      'Arrows',
      'Shapes',
      'Interface',
      'Communication',
      'Weather',
      'People',
      'Objects',
      'Nature',
      'Charts',
      'Faces',
      'Places',
    ]);
    const all = await page.evaluate(() => window.SC_SYMBOLS);
    for (const x of all) {
      expect(x.credit).toBe('Font Awesome Free 6.7.2 — CC BY 4.0');
      expect(x.svg).toMatch(/^(<path d="[^"]+"\/>)+$/); // no colour of its own
      expect(x.w).toBeGreaterThan(0);
      expect(x.h).toBe(512);
    }
    // The drawing's own symbols are still the default view.
    await page.click('[data-symview="doc"]');
    await expect(page.locator('#sc-symlib')).toBeVisible();
    await expect(page.locator('#sc-libsyms')).toBeHidden();
  });

  test('search and category filter', async ({ page }) => {
    await openLibrary(page);
    await page.fill('#sc-libsym-q', 'cloud');
    await expect(tiles(page)).toHaveCount(2);
    await expect(tile(page, 'Cloud rain')).toBeVisible();
    // Typing in the search box doesn't switch tools (P is the Pen tool).
    const tool = await page.evaluate(() => window.svgcraft.state.tool);
    await page.fill('#sc-libsym-q', '');
    await page.locator('#sc-libsym-q').pressSequentially('pen');
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe(tool);
    await expect(tiles(page)).toHaveCount(1);
    await page.fill('#sc-libsym-q', '');
    await page.selectOption('#sc-libsym-cat', 'Weather');
    await expect(tiles(page)).toHaveCount(6);
    // Search matches categories as well as names.
    await page.selectOption('#sc-libsym-cat', '');
    await page.fill('#sc-libsym-q', 'weather');
    await expect(tiles(page)).toHaveCount(6);
    await page.selectOption('#sc-libsym-cat', 'Weather');
    await page.fill('#sc-libsym-q', 'sun');
    await expect(tiles(page)).toHaveCount(1);
    await page.fill('#sc-libsym-q', 'zzz');
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.locator('#sc-libsyms .sc-sym-empty')).toHaveText('No library symbols match.');
  });
});

test.describe('placing', () => {
  test('places an instance in the fill colour, 64 px tall, credited; the Color panel recolours it', async ({
    page,
  }) => {
    await select(page);
    await setFillHex(page, '#dc2626');
    await openLibrary(page);
    await tile(page, 'Circle').click();
    await page.click('[data-lib="symbols"] [data-lib-act="place"]');
    await expect(uses(page)).toHaveCount(1);
    await expect(symbols(page)).toHaveCount(1);
    const info = await page.evaluate(() => {
      const s = document.querySelector('#sc-defs > symbol');
      const u = document.querySelector('#sc-doc use');
      return {
        name: s.getAttribute('data-name'),
        credit: s.getAttribute('data-credit'),
        overflow: s.getAttribute('overflow'),
        pathFill: s.querySelector('path').getAttribute('fill'),
        href: u.getAttribute('href'),
        id: s.id,
        fill: u.getAttribute('fill'),
        sel: window.svgcraft.state.sel[0] === u,
      };
    });
    expect(info).toMatchObject({
      name: 'Circle',
      credit: 'Font Awesome Free 6.7.2 — CC BY 4.0',
      overflow: 'visible',
      pathFill: null,
      fill: '#dc2626',
      sel: true,
    });
    expect(info.href).toBe(`#${info.id}`);
    // The instance shows up in the drawing's own Symbols view too.
    await page.click('[data-symview="doc"]');
    await expect(page.locator('#sc-symlib .sc-sym-tile')).toHaveCount(1);

    const box = await lastUseBox(page);
    expect(box.w).toBeCloseTo(64, 0);
    expect(box.h).toBeCloseTo(64, 0);
    const c = [Math.round(box.x + box.w / 2), Math.round(box.y + box.h / 2)];
    const out = [Math.round(box.x - 6), Math.round(box.y + box.h / 2)];
    let px = await pixels(page, [c, out]);
    expect(near(px[0], RED)).toBe(true);
    expect(near(px[1], WHITE)).toBe(true);

    // Recolour from the Color panel, with the instance selected.
    await setFillHex(page, '#2563eb');
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('fill')),
    ).toBe('#2563eb');
    px = await pixels(page, [c]);
    expect(near(px[0], BLUE)).toBe(true);

    // The credit survives saving and reopening.
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    expect(svg).toContain('data-credit="Font Awesome Free 6.7.2 — CC BY 4.0"');
    await page.evaluate((svg) => window.svgcraft.openSvg(svg, 'again.svg'), svg);
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs > symbol').getAttribute('data-credit'),
      ),
    ).toBe('Font Awesome Free 6.7.2 — CC BY 4.0');
  });

  test('placing the same icon again reuses its symbol; undo takes a placement back', async ({
    page,
  }) => {
    await openLibrary(page);
    await tile(page, 'Star').dblclick();
    await tile(page, 'Star').dblclick();
    await expect(uses(page)).toHaveCount(2);
    await expect(symbols(page)).toHaveCount(1);
    // Renaming the drawing's copy doesn't stop it being the same artwork.
    await page.evaluate(() =>
      document.querySelector('#sc-defs > symbol').setAttribute('data-name', 'My star'),
    );
    await tile(page, 'Star').dblclick();
    await expect(symbols(page)).toHaveCount(1);
    await tile(page, 'Heart').dblclick();
    await expect(symbols(page)).toHaveCount(2);
    await expect(uses(page)).toHaveCount(4);
    await page.keyboard.press('Control+z');
    await expect(uses(page)).toHaveCount(3);
    await expect(symbols(page)).toHaveCount(1);
  });

  test('drag a library tile onto the canvas to drop it there', async ({ page }) => {
    await openLibrary(page);
    const at = await toScreen(page, 300, 200);
    await tile(page, 'Bolt').dragTo(page.locator('#sc-stage'), {
      targetPosition: await page.evaluate(
        ([x, y]) => {
          const r = document.getElementById('sc-stage').getBoundingClientRect();
          return { x: x - r.left, y: y - r.top };
        },
        [at.x, at.y],
      ),
    });
    await expect(uses(page)).toHaveCount(1);
    const box = await lastUseBox(page);
    expect(Math.abs(box.x + box.w / 2 - 300)).toBeLessThan(3);
    expect(Math.abs(box.y + box.h / 2 - 200)).toBeLessThan(3);
    expect(
      await page.evaluate(() => document.querySelector('#sc-defs > symbol').dataset.name),
    ).toBe('Bolt');
  });
});

test.describe('Save to Library', () => {
  test('a drawing’s symbol joins the library, survives a reload and places anywhere', async ({
    page,
  }) => {
    await select(page, 'a', 'b');
    await menu(page, 'Object', 'makeSymbol');
    await answer(page, 'Badge');
    await page.click('[data-tab="symbols"]');
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="save"]');
    await answer(page, 'Red badge');
    await expect(page.locator('#sc-libsyms')).toBeVisible(); // switched to the library
    const n = await builtinCount(page);
    await expect(tiles(page)).toHaveCount(n + 1);
    const saved = (await stored(page)).symbols.find((x) => x.name === 'Red badge');
    expect(saved).toMatchObject({ category: 'Saved', w: 110, h: 60, size: 60 });
    expect(saved.svg).toContain('#dc2626');

    await reload(page);
    await load(page, '<rect width="400" height="300" fill="#ffffff"/>', 400, 300);
    await openLibrary(page);
    await expect(tiles(page)).toHaveCount(n + 1);
    await page.selectOption('#sc-libsym-cat', 'Saved');
    await expect(tiles(page)).toHaveCount(1);
    await tile(page, 'Red badge').dblclick();
    await expect(uses(page)).toHaveCount(1);
    const box = await lastUseBox(page);
    expect(box.w).toBeCloseTo(110, 0);
    expect(box.h).toBeCloseTo(60, 0);
    // Its own colours: the square on the left, the circle on the right.
    const px = await pixels(page, [
      [Math.round(box.x + 30), Math.round(box.y + 30)],
      [Math.round(box.x + 90), Math.round(box.y + 30)],
    ]);
    expect(near(px[0], RED)).toBe(true);
    expect(near(px[1], BLUE)).toBe(true);
  });

  test('the library’s + saves the selected instance’s symbol; nothing chosen says so', async ({
    page,
  }) => {
    await openLibrary(page);
    await page.click('[data-lib="symbols"] [data-lib-act="add"]');
    await expect(page.locator('#sc-alert-text')).toContainText('Click a symbol in This drawing');
    await tile(page, 'Circle').dblclick();
    await page.click('[data-lib="symbols"] [data-lib-act="add"]');
    await answer(page, null);
    const saved = (await stored(page)).symbols.at(-1);
    // Saved as placed (64 px tall), credit and all.
    expect(saved).toMatchObject({
      name: 'Circle',
      category: 'Saved',
      credit: 'Font Awesome Free 6.7.2 — CC BY 4.0',
    });
    expect(saved.h).toBeGreaterThanOrEqual(64);
    expect(saved.h).toBeLessThanOrEqual(65);
    expect(saved.size).toBe(saved.h);
  });
});

test.describe('managing the library', () => {
  test('rename, delete, Alt-click delete and reset', async ({ page }) => {
    const n = await builtinCount(page);
    await openLibrary(page);
    await tile(page, 'Gift').locator('.sc-sym-name').dblclick();
    await answer(page, 'Present');
    await expect(tile(page, 'Present')).toHaveCount(1);
    await expect(tile(page, 'Gift')).toHaveCount(0);
    expect((await stored(page)).symbols.some((x) => x.name === 'Present')).toBe(true);

    await tile(page, 'Present').click();
    await page.click('[data-lib="symbols"] [data-lib-act="delete"]');
    await expect(tiles(page)).toHaveCount(n - 1);
    await tile(page, 'Tree').click({ modifiers: ['Alt'] });
    await expect(tiles(page)).toHaveCount(n - 2);
    await page.click('[data-lib="symbols"] [data-lib-act="rename"]');
    await expect(page.locator('#sc-alert-text')).toContainText('Click a symbol first');

    await reload(page);
    await openLibrary(page);
    await expect(tiles(page)).toHaveCount(n - 2);
    await page.click('[data-lib="symbols"] [data-lib-act="reset"]');
    await answer(page, null);
    await expect(tiles(page)).toHaveCount(n);
    await expect(tile(page, 'Gift')).toHaveCount(1);
    // Reset leaves the other libraries alone.
    expect((await stored(page)).swatches.length).toBeGreaterThan(0);
  });

  test('export includes the symbols; import adds new ones, sanitised, and skips duplicates', async ({
    page,
  }) => {
    await openLibrary(page);
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-lib="symbols"] [data-lib-act="export"]'),
    ]);
    const json = JSON.parse(readZip(fs.readFileSync(await dl.path()))['svgcraft-library.json']);
    const n = await builtinCount(page);
    expect(json.symbols).toHaveLength(n);
    expect(json.symbols[0]).not.toHaveProperty('id');
    expect(json.symbols[0]).toMatchObject({ category: 'Arrows', credit: expect.any(String) });
    expect(json.patterns.length).toBeGreaterThan(0);

    const lib = {
      symbols: [
        json.symbols[0], // already there
        {
          name: 'Evil',
          category: 'Bad\u0007stuff',
          w: 20,
          h: 20,
          svg:
            '<script>window.pwned=1</script><circle cx="10" cy="10" r="8" onload="window.pwned=2"/>' +
            '<style>body{display:none}</style><a href="javascript:alert(1)"><rect width="4" height="4"/></a>' +
            '<image href="data:text/html,%3Cscript%3Eparent.pwned=3%3C/script%3E" width="5" height="5"/>',
        },
        { name: 'No size', svg: '<rect width="2" height="2"/>' },
        { name: 'Bad svg', w: 10, h: 10, svg: 42 },
        'junk',
      ],
    };
    await page.setInputFiles('#sc-lib-file', {
      name: 'lib.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(lib)),
    });
    await expect(page.locator('#sc-msg')).toHaveText('Imported 1 symbol.');
    await expect(tiles(page)).toHaveCount(n + 1);
    const evil = (await stored(page)).symbols.find((x) => x.name === 'Evil');
    expect(evil.svg).not.toMatch(/script|onload|javascript|<style|data:text/i);
    expect(evil.category).toBe('Bad stuff');

    await select(page);
    await setFillHex(page, '#dc2626');
    await tile(page, 'Evil').dblclick();
    await expect(uses(page)).toHaveCount(1);
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    await expect(page.locator('#sc-stage')).toBeVisible();
    const box = await lastUseBox(page);
    const px = await pixels(page, [[Math.round(box.x + box.w / 2), Math.round(box.y + box.h / 2)]]);
    expect(near(px[0], RED)).toBe(true);
  });

  test('an old stored library without symbols loads, and gets the built-in set', async ({
    page,
  }) => {
    await page.evaluate((k) => {
      localStorage.setItem(
        k,
        JSON.stringify({
          swatches: [{ id: 'abc', name: 'Mine', c: '#123456', a: 1 }],
          gradients: [],
          patterns: [],
        }),
      );
    }, LIB_KEY);
    await reload(page);
    await expect(page.locator('#sc-palette .sc-tile:not(.none)')).toHaveCount(1);
    await openLibrary(page);
    await expect(tiles(page)).toHaveCount(await builtinCount(page));

    // A library whose symbols were all deleted stays empty.
    await page.evaluate((k) => {
      const lib = JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify({ ...lib, symbols: [] }));
    }, LIB_KEY);
    await reload(page);
    await openLibrary(page);
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.locator('#sc-libsyms .sc-sym-empty')).toContainText('The library is empty');
  });
});
