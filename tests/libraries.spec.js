import fs from 'node:fs';
import { readZip } from './zip.js';
import { test, expect, load, select, menu } from './fixtures.js';

// Swatches, Gradients and Patterns panels, the pattern paint, Define Pattern,
// and the library kept in localStorage (export / import / reset).

const LIB_KEY = 'svgcraft.library.v1';
const TWO_RECTS =
  '<rect id="a" x="20" y="20" width="100" height="80" fill="#2563eb" stroke="#000" stroke-width="2"/>' +
  '<rect id="b" x="160" y="20" width="100" height="80" fill="#16a34a"/>';

const tab = (page, t) => page.click(`[data-tab="${t}"]`);
const tiles = (page, id) => page.locator(`#${id} .sc-tile:not(.none)`);
const attr = (page, id, a) =>
  page.evaluate(([id, a]) => document.getElementById(id).getAttribute(a), [id, a]);
const stored = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), LIB_KEY);

// The <pattern> / gradient behind an element's paint.
const paintDef = (page, id, a = 'fill') =>
  page.evaluate(
    ([id, a]) => {
      const m = /#([^)]+)\)/.exec(document.getElementById(id).getAttribute(a) || '');
      const d = m && document.getElementById(m[1]);
      return (
        d && {
          tag: d.localName,
          color: d.getAttribute('color'),
          tf: d.getAttribute('patternTransform'),
          html: d.innerHTML,
          stops: [...d.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')),
        }
      );
    },
    [id, a],
  );

// Answer the name / confirm prompt.
async function answer(page, name) {
  await expect(page.locator('#sc-ask')).toBeVisible();
  if (name != null) await page.fill('#sc-ask .sc-ask-input', name);
  await page.click('#sc-ask [data-ask="ok"]');
  await expect(page.locator('#sc-ask')).toBeHidden();
}

// Rasterise the export and count pixels in a box by a classifier.
const countPixels = (page, box, kinds) =>
  page.evaluate(
    async ([box, kinds]) => {
      const img = new Image();
      img.src =
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 200;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(...box).data;
      const fns = Object.fromEntries(
        Object.entries(kinds).map(([k, src]) => [k, new Function('r', 'g', 'b', 'a', src)]),
      );
      const out = Object.fromEntries(Object.keys(kinds).map((k) => [k, 0]));
      for (let i = 0; i < d.length; i += 4)
        for (const k in fns) if (fns[k](d[i], d[i + 1], d[i + 2], d[i + 3])) out[k]++;
      return out;
    },
    [box, kinds],
  );

test.describe('library defaults and persistence', () => {
  test('starts with the built-in swatches, gradients and patterns', async ({ page }) => {
    await expect(tiles(page, 'sc-palette')).toHaveCount(17);
    await expect(tiles(page, 'sc-gradlib')).toHaveCount(7);
    await expect(tiles(page, 'sc-patlib')).toHaveCount(9);
  });

  test('corrupt storage falls back to the built-ins', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, '{broken'), LIB_KEY);
    await page.reload();
    await page.waitForFunction(() => !!window.svgcraft);
    await expect(tiles(page, 'sc-gradlib')).toHaveCount(7);
  });
});

test.describe('swatches', () => {
  test('click applies to the active paint, Shift-click to the other', async ({ page }) => {
    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await tab(page, 'swatches');
    const s4 = await tiles(page, 'sc-palette').nth(4).getAttribute('aria-label');
    await tiles(page, 'sc-palette').nth(4).click();
    expect(await attr(page, 'a', 'fill')).toBe(s4);
    const s5 = await tiles(page, 'sc-palette').nth(5).getAttribute('aria-label');
    await tiles(page, 'sc-palette')
      .nth(5)
      .click({ modifiers: ['Shift'] });
    expect(await attr(page, 'a', 'stroke')).toBe(s5);
  });

  test('add, apply with alpha, rename, persist, delete and reset', async ({ page }) => {
    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await tab(page, 'swatches');
    await page.evaluate(() =>
      Object.assign(window.svgcraft.state, { active: 'fill', fill: '#123456', fillA: 0.5 }),
    );
    await page.click('[data-lib="swatches"] [data-lib-act="add"]');
    await answer(page, 'Navy half');
    expect((await stored(page)).swatches.at(-1)).toMatchObject({
      name: 'Navy half',
      c: '#123456',
      a: 0.5,
    });

    await select(page, 'b');
    await tiles(page, 'sc-palette').last().click();
    expect(await attr(page, 'b', 'fill')).toBe('#123456');
    expect(await attr(page, 'b', 'fill-opacity')).toBe('0.5');

    await tiles(page, 'sc-palette').last().dblclick();
    await answer(page, 'Deep navy');
    await expect(tiles(page, 'sc-palette').last()).toHaveAttribute('aria-label', 'Deep navy');

    await page.reload();
    await page.waitForFunction(() => !!window.svgcraft);
    await tab(page, 'swatches');
    await expect(tiles(page, 'sc-palette').last()).toHaveAttribute('aria-label', 'Deep navy');

    await tiles(page, 'sc-palette')
      .last()
      .click({ modifiers: ['Alt'] });
    await expect(tiles(page, 'sc-palette')).toHaveCount(17);
    await tiles(page, 'sc-palette').first().click();
    await page.click('[data-lib="swatches"] [data-lib-act="delete"]');
    await expect(tiles(page, 'sc-palette')).toHaveCount(16);

    await page.click('[data-lib="swatches"] [data-lib-act="reset"]');
    await expect(page.locator('#sc-ask .sc-ask-input')).toBeHidden();
    await answer(page, null);
    await expect(tiles(page, 'sc-palette')).toHaveCount(17);
  });
});

test.describe('gradients', () => {
  test('apply from the panel and save new ones', async ({ page }) => {
    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await tab(page, 'gradients');
    await tiles(page, 'sc-gradlib').nth(2).click();
    expect(await paintDef(page, 'a')).toMatchObject({
      tag: 'linearGradient',
      stops: ['#facc15', '#f97316', '#db2777', '#7c3aed'],
    });

    await page.evaluate(() => (window.svgcraft.state.fillGrad.stops[0].c = '#00ff00'));
    await page.click('#sc-grad-save');
    await answer(page, 'My grad');
    expect((await stored(page)).gradients.at(-1)).toMatchObject({ name: 'My grad' });
    expect((await stored(page)).gradients.at(-1).stops[0].c).toBe('#00ff00');
    await expect(page.locator('#sc-grad-preset option', { hasText: 'My grad' })).toHaveCount(1);

    await select(page, 'b');
    await tiles(page, 'sc-gradlib').last().click();
    expect((await paintDef(page, 'b')).stops[0]).toBe('#00ff00');

    await tab(page, 'color');
    await page.click('[data-kind-for="fill"] [data-kind="solid"]');
    await tab(page, 'gradients');
    await page.click('[data-lib="gradients"] [data-lib-act="add"]');
    await expect(page.locator('#sc-msg')).toContainText('gradient first');
  });

  test('built-in presets keep their names as values', async ({ page }) => {
    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await tab(page, 'color');
    await page.click('[data-kind-for="fill"] [data-kind="linear"]');
    await page.selectOption('#sc-grad-preset', 'ocean');
    expect((await paintDef(page, 'a')).stops).toEqual(['#67e8f9', '#0ea5e9', '#1e3a8a']);
  });
});

test.describe('pattern paint', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await tab(page, 'patterns');
    await tiles(page, 'sc-patlib').nth(2).click(); // Dots
  });

  test('applies a pattern inked with the paint colour', async ({ page }) => {
    expect(await paintDef(page, 'a')).toMatchObject({ tag: 'pattern', color: '#2563eb' });
    expect((await paintDef(page, 'a')).html).toContain('<circle');
    await expect(page.locator('[data-kind-for="fill"] [data-kind="pattern"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('#sc-pat')).toBeVisible();
  });

  test('colour re-inks it; scale and angle transform it; it renders', async ({ page }) => {
    await tab(page, 'color');
    await page.fill('#sc-fill-hex', '#ff0000');
    await page.press('#sc-fill-hex', 'Enter');
    expect(await paintDef(page, 'a')).toMatchObject({ tag: 'pattern', color: '#ff0000' });
    await page.fill('#sc-pat-scale', '200');
    await page.press('#sc-pat-scale', 'Tab');
    await page.fill('#sc-pat-angle', '45');
    await page.press('#sc-pat-angle', 'Tab');
    expect((await paintDef(page, 'a')).tf).toBe('translate(20 20) rotate(45) scale(2)');
    const px = await countPixels(page, [20, 20, 100, 80], {
      red: 'return a > 10 && r > 200 && g < 60',
      clear: 'return a < 10',
    });
    expect(px.red).toBeGreaterThan(300);
    expect(px.clear).toBeGreaterThan(3000);
  });

  test('reads back on reselect; the picker swaps it keeping scale', async ({ page }) => {
    await page.fill('#sc-pat-scale', '200');
    await page.press('#sc-pat-scale', 'Tab');
    await select(page, 'b');
    await select(page, 'a');
    expect(await page.evaluate(() => window.svgcraft.state.fillPat)).toMatchObject({
      name: 'Dots',
      scale: 2,
    });
    await page.selectOption('#sc-pat-pick', 'stripes');
    const d = await paintDef(page, 'a');
    expect(d.html).toContain('<rect');
    expect(d.tf).toContain('scale(2)');
  });

  test('a duplicate gets its own pattern once edited; undo works', async ({ page }) => {
    await page.keyboard.press('Control+d');
    await page.evaluate(() => {
      window.svgcraft.state.fill = '#0000ff';
      document.querySelector('#sc-fill-hex').dispatchEvent(new Event('change'));
    });
    const fills = await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc rect')].map((r) => r.getAttribute('fill')),
    );
    expect(new Set(fills).size).toBe(3);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#sc-doc rect')).toHaveCount(2);
    expect(await attr(page, 'a', 'fill')).toMatch(/^url\(#sc-pat-/);
  });

  test('swap, solid, export and the gradient tool all hand it over cleanly', async ({ page }) => {
    await page.keyboard.press('x');
    expect(await attr(page, 'a', 'stroke')).toMatch(/^url\(#sc-pat-/);
    expect(await attr(page, 'a', 'fill')).not.toMatch(/url/);
    await page.keyboard.press('x');
    await tab(page, 'color');
    await page.click('[data-kind-for="fill"] [data-kind="solid"]');
    expect(await attr(page, 'a', 'fill')).not.toMatch(/url/);
    await expect(page.locator('#sc-defs pattern')).toHaveCount(0);

    await tab(page, 'patterns');
    await tiles(page, 'sc-patlib').nth(4).click(); // Checks
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    await page.evaluate((svg) => window.svgcraft.openSvg(svg, 're.svg'), svg);
    await select(page, 'a');
    expect(await page.evaluate(() => window.svgcraft.state.fillPat?.name)).toBe('Checks');

    await page.evaluate(() => window.svgcraft.setTool('gradient'));
    const [x1, y1, x2, y2] = await page.evaluate(() => {
      const m = document.getElementById('sc-doc').getScreenCTM();
      const a = new DOMPoint(30, 60).matrixTransform(m);
      const b = new DOMPoint(110, 60).matrixTransform(m);
      return [a.x, a.y, b.x, b.y];
    });
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 4 });
    await page.mouse.up();
    expect((await paintDef(page, 'a')).tag).toBe('linearGradient');
  });
});

test.describe('Define Pattern', () => {
  test('turns the selection, gradients included, into a working tile', async ({ page }) => {
    await load(
      page,
      '<circle id="c" cx="50" cy="50" r="10" fill="#f00"/>' +
        '<rect id="r" x="100" y="40" width="20" height="20" fill="#00f" transform="rotate(45 110 50)"/>' +
        '<rect id="t" x="20" y="100" width="200" height="80" fill="#eee"/>',
      300,
      200,
    );
    await select(page, 'c');
    await tab(page, 'gradients');
    await tiles(page, 'sc-gradlib').nth(2).click();
    await select(page, 'c', 'r');
    await menu(page, 'Edit', 'definePattern');
    await answer(page, 'Mine');
    const mine = (await stored(page)).patterns.at(-1);
    expect(mine.name).toBe('Mine');
    expect(mine.w).toBeGreaterThan(70);
    expect(mine.h).toBeGreaterThanOrEqual(20);
    expect(mine.svg).toMatch(/<defs><linearGradient id="p[a-z0-9]+-sc-grad-\d+"/);
    expect(mine.svg).toMatch(/url\(#p[a-z0-9]+-sc-grad-\d+\)/);
    expect(mine.svg).not.toContain('data-sc-grad');
    await expect(page.locator('[data-tab="patterns"]')).toHaveAttribute('aria-selected', 'true');

    await select(page, 't');
    await tiles(page, 'sc-patlib').last().click();
    await page.evaluate(() => window.svgcraft.commit());
    await expect(page.locator('#sc-defs pattern linearGradient')).toHaveCount(1);
    const px = await countPixels(page, [20, 100, 200, 80], {
      blue: 'return b > 200 && r < 60',
      colour: 'return a > 200 && !(r > 230 && g > 230 && b > 230)',
    });
    expect(px.blue).toBeGreaterThan(200);
    expect(px.colour).toBeGreaterThan(1500);
  });

  test('needs a selection, and Esc cancels it', async ({ page }) => {
    await page.evaluate(() => (window.svgcraft.state.sel = []));
    await page.click('[data-tab="patterns"]');
    await page.click('[data-lib="patterns"] [data-lib-act="add"]');
    await expect(page.locator('#sc-msg')).toContainText('Select the artwork');
    await load(page, '<rect id="a" x="20" y="20" width="10" height="10" fill="#f00"/>', 300, 200);
    await select(page, 'a');
    await menu(page, 'Edit', 'definePattern');
    await expect(page.locator('#sc-ask')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sc-ask')).toBeHidden();
    await expect(tiles(page, 'sc-patlib')).toHaveCount(9);
  });
});

test.describe('export / import library', () => {
  test('exports everything in a zip, without ids', async ({ page }) => {
    await page.click('[data-tab="patterns"]');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-lib="patterns"] [data-lib-act="export"]'),
    ]);
    expect(dl.suggestedFilename()).toBe('svgcraft-library.zip');
    const json = JSON.parse(readZip(fs.readFileSync(await dl.path()))['svgcraft-library.json']);
    expect(json).toMatchObject({ app: 'svgcraft', kind: 'library', version: 1 });
    expect(json.patterns).toHaveLength(9);
    expect(json.swatches[0]).not.toHaveProperty('id');
  });

  test('imports new items, skips duplicates and junk, and sanitises tiles', async ({ page }) => {
    const first = await page.evaluate(() =>
      document.querySelector('#sc-palette .sc-tile:not(.none)').getAttribute('aria-label'),
    );
    const lib = {
      swatches: [{ name: 'dup', c: first, a: 1 }, { name: 'New one', c: '#abcdef' }, { c: 'red' }],
      gradients: [{ name: 'bad', stops: [{ o: 0, c: '#000' }] }],
      patterns: [
        {
          name: 'Evil',
          w: 10,
          h: 10,
          svg:
            '<script>window.pwned=1</script><circle r="3" onload="window.pwned=2" fill="currentColor"/>' +
            '<style>body{display:none}</style><a href="javascript:alert(1)"><rect width="2" height="2"/></a>',
        },
      ],
    };
    await page.setInputFiles('#sc-lib-file', {
      name: 'lib.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(lib)),
    });
    await expect(page.locator('#sc-msg')).toHaveText('Imported 1 swatch, 1 pattern.');
    await expect(tiles(page, 'sc-palette')).toHaveCount(18);
    const evil = (await stored(page)).patterns.find((p) => p.name === 'Evil');
    expect(evil.svg).not.toMatch(/script|onload|javascript|<style/i);

    await load(page, TWO_RECTS, 300, 200);
    await select(page, 'a');
    await page.click('[data-tab="patterns"]');
    await tiles(page, 'sc-patlib').last().click();
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    await expect(page.locator('#sc-stage')).toBeVisible();

    await page.setInputFiles('#sc-lib-file', {
      name: 'x.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not json'),
    });
    await expect(page.locator('#sc-msg')).toContainText('isn’t a library');
  });
});
