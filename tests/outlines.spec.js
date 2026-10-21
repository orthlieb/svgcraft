// Type → Create Outlines: text layers become paths drawn from the real font
// files (opentype.js), placed where the browser laid out each character.
// Fonts come from the Fontsource CDN, which the tests serve from
// tests/fonts/ (Lato, SIL OFL 1.1, from @fontsource/lato 5.3.0).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, load, select, menu } from './fixtures.js';

const FONTS = path.resolve(import.meta.dirname, 'fonts');
const LATO = {
  400: fs.readFileSync(path.join(FONTS, 'lato-latin-400-normal.woff')),
  700: fs.readFileSync(path.join(FONTS, 'lato-latin-700-normal.woff')),
};
const dataUrl = (buf) => `data:font/woff;base64,${buf.toString('base64')}`;
// The same files as on-screen web fonts, under any family name.
const faceCss = (family) =>
  [400, 700]
    .map(
      (w) =>
        `@font-face{font-family:'${family}';font-weight:${w};src:url(${dataUrl(LATO[w])}) format('woff')}`,
    )
    .join('');

// Serve Fontsource latin files for the given ids from the Lato files (or
// fail every request), recording the URLs asked for.
async function serveFonts(page, { ids = ['lato'], fail = false } = {}) {
  const hits = [];
  await page.route(/cdn\.jsdelivr\.net\/fontsource\//, (route) => {
    const url = route.request().url();
    hits.push(url.replace(/^.*\/fonts\//, ''));
    const m = /fonts\/([^@]+)@latest\/latin-(\d+)-normal\.woff$/.exec(url);
    if (fail || !m || !ids.includes(m[1]) || !LATO[m[2]]) return route.abort();
    return route.fulfill({
      status: 200,
      body: LATO[m[2]],
      headers: { 'content-type': 'font/woff', 'access-control-allow-origin': '*' },
    });
  });
  return hits;
}

async function useFace(page, family = 'Lato') {
  await page.addStyleTag({ content: faceCss(family) });
  await page.evaluate((fam) => document.fonts.load(`48px '${fam}'`), family);
  await page.evaluate((fam) => document.fonts.load(`bold 48px '${fam}'`), family);
}

const msg = (page) => page.locator('#sc-msg');
const docHtml = (page) => page.evaluate(() => document.getElementById('sc-doc').innerHTML);

// Rasterise the saved SVG (with the font embedded, so text draws in it) and
// return its opaque-pixel mask.
const mask = (page, family = 'Lato') =>
  page.evaluate(async (css) => {
    const img = new Image();
    img.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(window.svgcraft.serialize({ fontCss: css }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 800, 400);
    const d = ctx.getImageData(0, 0, 800, 400).data;
    const out = [];
    for (let i = 3; i < d.length; i += 4) out.push(d[i] > 127 ? 1 : 0);
    return out.join('');
  }, faceCss(family));

function iou(a, b) {
  let both = 0;
  let any = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '1' && b[i] === '1') both++;
    if (a[i] === '1' || b[i] === '1') any++;
  }
  return any ? both / any : 0;
}

const line = (x, y, inner) => `<tspan x="${x}" y="${y}" data-line="">${inner}</tspan>`;
const text = (id, x, y, inner, attrs = '') =>
  `<text id="${id}" x="${x}" y="${y}" font-family="'Lato', sans-serif" font-size="48" xml:space="preserve" ${attrs}>${line(x, y, inner)}</text>`;

const paths = (page, sel) =>
  page.$$eval(`${sel} > path`, (ps) =>
    ps.map((p) => ({
      fill: p.getAttribute('fill'),
      opacity: p.getAttribute('fill-opacity'),
      len: p.getAttribute('d').length,
    })),
  );

test.describe('Create Outlines', () => {
  test('a text layer becomes paths that cover the same pixels', async ({ page }) => {
    const hits = await serveFonts(page);
    await useFace(page);
    await load(
      page,
      '<rect id="a" x="0" y="0" width="10" height="10"/>' +
        text('t', 40, 120, 'Hello, Outlines AV', 'letter-spacing="2" fill="#1d4ed8"') +
        '<rect id="b" x="700" y="0" width="10" height="10"/>',
      400,
      200,
    );
    const before = await mask(page);
    await select(page, 't');
    await menu(page, 'Type', 'createOutlines');
    await expect(msg(page)).toHaveText('Created outlines.');
    expect(hits).toEqual(['lato@latest/latin-400-normal.woff']);

    const g = await page.evaluate(() => {
      const g = document.querySelector('#sc-doc > g');
      return {
        id: g.id,
        name: g.dataset.name,
        index: [...g.parentNode.children].indexOf(g),
        texts: document.querySelectorAll('#sc-doc text').length,
        selected: window.svgcraft.state.sel[0] === g,
      };
    });
    expect(g).toEqual({
      id: 't',
      name: 'Hello, Outlines AV (outlines)',
      index: 1,
      texts: 0,
      selected: true,
    });
    const ps = await paths(page, '#sc-doc > g');
    expect(ps).toHaveLength(1);
    expect(ps[0].fill).toBe('#1d4ed8');
    const after = await mask(page);
    expect(iou(before, after)).toBeGreaterThan(0.9);
  });

  test('styled runs give one path per style, in their own colours', async ({ page }) => {
    const hits = await serveFonts(page);
    await useFace(page);
    await load(
      page,
      text(
        't',
        30,
        100,
        'Plain <tspan data-run="" font-weight="700">Bold</tspan> ' +
          '<tspan data-run="" fill="#dc2626" fill-opacity="0.5">Red</tspan> end',
      ) + text('u', 30, 170, 'Second <tspan data-run="" font-size="30">small</tspan>'),
      400,
      200,
    );
    const before = await mask(page);
    await select(page, 't', 'u');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText('Created outlines for 2 text layers.');
    expect([...new Set(hits)].sort()).toEqual([
      'lato@latest/latin-400-normal.woff',
      'lato@latest/latin-700-normal.woff',
    ]);
    const [p1, p2] = await Promise.all([
      paths(page, '#sc-doc > g:nth-child(1)'),
      paths(page, '#sc-doc > g:nth-child(2)'),
    ]);
    expect(p1.map((p) => [p.fill, p.opacity])).toEqual([
      ['#000000', null],
      ['#000000', null],
      ['#dc2626', '0.5'],
    ]);
    expect(p2).toHaveLength(2);
    expect(iou(before, await mask(page))).toBeGreaterThan(0.9);
  });

  test('underline and strikethrough become bars in the decorated paint', async ({ page }) => {
    await serveFonts(page);
    await useFace(page);
    await load(
      page,
      text('t', 30, 100, 'Underlined text', 'text-decoration="underline" data-deco="underline"') +
        text(
          'u',
          30,
          170,
          'Some <tspan data-run="" text-decoration="line-through" fill="#16a34a">struck</tspan> words',
        ),
      400,
      200,
    );
    const before = await mask(page);
    await select(page, 't', 'u');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText('Created outlines for 2 text layers.');
    const fills = await page.$$eval('#sc-doc path', (ps) => ps.map((p) => p.getAttribute('fill')));
    expect(fills).toEqual(['#000000', '#000000', '#16a34a']);
    expect(iou(before, await mask(page))).toBeGreaterThan(0.9);
  });

  test('keeps transform, effects, blend, opacity, lock and hidden state', async ({ page }) => {
    await serveFonts(page);
    await useFace(page);
    const fx = JSON.stringify({ ds: { on: true, d: 6, s: 4, a: 120, o: 60, c: '#000000' } });
    await load(
      page,
      '<rect id="bg" width="400" height="200" fill="#ffffff"/>' +
        text(
          't',
          40,
          100,
          'Turned',
          `transform="rotate(10 100 100)" opacity="0.5" data-sc-lock="position" style="mix-blend-mode:multiply;text-transform:uppercase" data-name="Title" data-sc-fx='${fx}'`,
        ) +
        text('h', 40, 170, 'Hidden', 'display="none"') +
        '<rect id="top" x="300" y="10" width="20" height="20"/>',
      400,
      200,
    );
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const before = await mask(page);
    await select(page, 't', 'h');
    await menu(page, 'Type', 'createOutlines');
    await expect(msg(page)).toHaveText('Created outlines for 2 text layers.');
    const out = await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc > g')].map((g) => ({
        index: [...g.parentNode.children].indexOf(g),
        name: g.dataset.name,
        transform: g.getAttribute('transform'),
        opacity: g.getAttribute('opacity'),
        lock: g.dataset.scLock || null,
        blend: g.style.mixBlendMode || null,
        tt: g.style.textTransform || null,
        fx: g.hasAttribute('data-sc-fx'),
        filter: /^url\(#sc-fx-\d+\)$/.test(g.getAttribute('filter') || ''),
        display: g.getAttribute('display'),
        paths: g.querySelectorAll('path').length,
      })),
    );
    expect(out).toEqual([
      {
        index: 1,
        name: 'Title (outlines)',
        transform: 'rotate(10 100 100)',
        opacity: '0.5',
        lock: 'position',
        blend: 'multiply',
        tt: null,
        fx: true,
        filter: true,
        display: null,
        paths: 1,
      },
      {
        index: 2,
        name: 'Hidden (outlines)',
        transform: null,
        opacity: null,
        lock: null,
        blend: null,
        tt: null,
        fx: false,
        filter: false,
        display: 'none',
        paths: 1,
      },
    ]);
    // All Caps came out as capitals, and the effect still draws.
    expect(iou(before, await mask(page))).toBeGreaterThan(0.9);
  });

  test('one undo step brings the text back', async ({ page }) => {
    await serveFonts(page);
    await useFace(page);
    await load(page, text('t', 40, 100, 'Undo me') + text('u', 40, 160, 'And me'), 400, 200);
    const original = await docHtml(page);
    await select(page, 't', 'u');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText('Created outlines for 2 text layers.');
    expect(await page.locator('#sc-doc text').count()).toBe(0);
    await page.evaluate(() => window.svgcraft.undo());
    expect(await docHtml(page)).toBe(original);
    await page.evaluate(() => window.svgcraft.redo());
    expect(await page.locator('#sc-doc > g path').count()).toBe(2);
  });

  test('when the font can’t be downloaded the text is left alone', async ({ page }) => {
    const hits = await serveFonts(page, { fail: true });
    await load(page, text('t', 40, 100, 'Offline'), 400, 200);
    const original = await docHtml(page);
    await select(page, 't');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText(
      'Couldn’t create outlines. Couldn’t outline “Offline”: the font Lato couldn’t be downloaded, so it’s unchanged.',
    );
    expect(hits).toEqual(['lato@latest/latin-400-normal.woff']);
    expect(await docHtml(page)).toBe(original);
    // Nothing was recorded, so undo has nothing of this to take back.
    const hist = await page.evaluate(() => {
      window.svgcraft.undo();
      return document.querySelectorAll('#sc-doc text').length;
    });
    expect(hist).toBe(0);
  });

  test('system fonts use a metric-compatible stand-in, and say so', async ({ page }) => {
    const hits = await serveFonts(page, { ids: ['arimo'] });
    await load(
      page,
      text('t', 40, 100, 'Arial text').replace(
        `'Lato', sans-serif`,
        'Arial, Helvetica, sans-serif',
      ),
      400,
      200,
    );
    await select(page, 't');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toContainText('Created outlines. Used Arimo for Arial');
    expect(hits).toEqual(['arimo@latest/latin-400-normal.woff']);
    expect(await page.locator('#sc-doc > g > path').count()).toBe(1);
  });

  test('installed fonts are read through Local Font Access when allowed', async ({ page }) => {
    const hits = await serveFonts(page);
    await useFace(page, 'My Font');
    const b64 = LATO[400].toString('base64');
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const real = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) =>
        d.name === 'local-fonts' ? Promise.resolve({ state: 'granted' }) : real(d);
      window.queryLocalFonts = async () => [
        {
          family: 'My Font',
          fullName: 'My Font Regular',
          postscriptName: 'MyFont-Regular',
          style: 'Regular',
          blob: async () => new Blob([bytes]),
        },
      ];
    }, b64);
    await load(
      page,
      text('t', 40, 100, 'Installed').replace(`'Lato', sans-serif`, `'My Font', sans-serif`),
      400,
      200,
    );
    const before = await mask(page, 'My Font');
    await select(page, 't');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText('Created outlines.');
    expect(hits).toEqual([]);
    expect(iou(before, await mask(page, 'My Font'))).toBeGreaterThan(0.9);
  });

  test('a fully locked text layer is refused', async ({ page }) => {
    await serveFonts(page);
    await load(page, text('t', 40, 100, 'Locked', 'data-sc-lock="all"'), 400, 200);
    const original = await docHtml(page);
    await select(page, 't');
    await page.keyboard.press('Control+Shift+O');
    await expect(msg(page)).toHaveText('“Locked” is locked.');
    expect(await docHtml(page)).toBe(original);
  });

  test('needs a text layer', async ({ page }) => {
    await load(page, '<rect id="r" width="10" height="10"/>', 400, 200);
    await select(page, 'r');
    await menu(page, 'Type', 'createOutlines');
    await expect(msg(page)).toHaveText('Select one or more text layers to create outlines.');
  });
});
