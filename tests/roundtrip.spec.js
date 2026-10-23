import fs from 'node:fs';
import { test, expect } from './fixtures.js';

// Everything SVGCraft lets you set travels inside the saved SVG (as data-*
// attributes, CSS and real SVG defs), so Save as SVG → Open, or → Import into
// another drawing, gives back the same editable drawing.

const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" data-sc-guides="x:100 y:50">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient>
  </defs>
  <g id="g" data-name="My group" opacity="0.8" style="mix-blend-mode: multiply;" data-sc-lock="position">
    <rect id="r" x="10" y="10" width="100" height="60" rx="8" ry="8" fill="#2563eb" stroke="#000" stroke-width="8"
      data-stroke-align="inside" data-dash="4 2 1 2" stroke-dasharray="16 8 4 8"
      data-sc-fx='{"ds":{"c":"#000000","o":50,"a":120,"d":6,"sp":0,"s":4},"og":{"c":"#ffffbe","o":35,"sp":0,"s":5}}'/>
    <circle id="c" cx="200" cy="100" r="40" fill="url(#lg)" display="none" data-name="Hidden dot" data-sc-lock="all"/>
  </g>
  <g id="iso" style="isolation: isolate;"><rect x="300" y="200" width="20" height="20" fill="#0f0"/></g>
  <path id="p" data-rect="0 0 50 50" data-radii="0 10 20 0" d="M0 0h50v50H0z" fill="#0f0"/>
  <text id="t" x="40" y="250" font-family="Georgia" font-size="24" data-deco="underline"><tspan data-line="" x="40" y="250">Hello <tspan data-run="" font-weight="700" fill="#ff0000">bold</tspan></tspan></text>
</svg>`;

// Each layer's attributes, with references to defs reduced to "url(…)" (ids
// may be renamed) and the defs they point at checked to exist.
const snapshot = (page) =>
  page.evaluate(() => {
    const REF = /url\(\s*["']?#([^"')]+)["']?\s*\)/;
    const layers = [...document.querySelectorAll('#sc-doc *')].map((el) => {
      const attrs = {};
      for (const a of el.attributes) {
        if (a.name === 'id') continue;
        const m = REF.exec(a.value);
        attrs[a.name] = m
          ? document.getElementById(m[1])
            ? 'url(…)'
            : `missing #${m[1]}`
          : a.value;
      }
      return [
        el.localName,
        attrs,
        el.childNodes.length && !el.children.length ? el.textContent : '',
      ];
    });
    const s = window.svgcraft.state;
    return {
      layers,
      guides: s.guides.map((g) => `${g.axis}:${g.pos}`),
      size: [s.w, s.h],
    };
  });

async function setUp(page) {
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'all.svg'), DRAWING);
  // A pattern fill, applied the way a user would.
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = [document.getElementById('p')];
    s.readStyle(s.state.sel[0]);
  });
  await page.click('[data-tab="patterns"]');
  await page.click('#sc-patlib .sc-tile:nth-child(3)');
  // Let the effect / stroke-align defs sync.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
}

async function saveFile(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  return fs.readFileSync(await dl.path(), 'utf8');
}

test('Save as SVG → Open gives back the same layers, settings and defs', async ({ page }) => {
  await setUp(page);
  const before = await snapshot(page);
  // Sanity: the drawing really uses every feature under test.
  const flat = JSON.stringify(before);
  for (const k of [
    'data-sc-fx',
    'data-sc-lock',
    'mix-blend-mode',
    'isolation',
    'data-stroke-align',
    'data-dash',
    'data-radii',
    'data-name',
    'data-run',
    'data-deco',
    'display',
    'url(…)',
  ])
    expect(flat).toContain(k);
  expect(flat).not.toContain('missing #');

  const file = await saveFile(page);
  await page.setInputFiles('#sc-file', {
    name: 'again.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(file),
  });
  await expect(page.locator('#sc-doc-title')).toHaveText(/^again\.svg/);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  expect(await snapshot(page)).toEqual(before);
});

test('Import into another drawing keeps the same settings', async ({ page }) => {
  await setUp(page);
  const before = await snapshot(page);
  const file = await saveFile(page);
  await page.click('#sc-doctabs .sc-doctab-new');
  await page.click('[data-nd-btn="ok"]');
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'all.svg'), file);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  const after = await snapshot(page);
  // Placed as one group (named after the file) holding the same layers.
  const [tag, attrs] = after.layers[0];
  expect(tag).toBe('g');
  expect(attrs['data-name']).toBe('all.svg');
  // Placing may shift top-level layers into view, so transforms aside.
  const noTransform = ([t, a, txt]) => [
    t,
    Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'transform')),
    txt,
  ];
  const inner = after.layers.slice(1).map(noTransform);
  const orig = before.layers.map(noTransform);
  expect(inner).toEqual(orig);
});

test('a damaged rounded-rectangle record is ignored, not drawn as NaN', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="p" data-rect="1" data-radii="0 10 20 0" d="M0 0h50v50H0z"/></svg>',
      'damaged.svg',
    ),
  );
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('select');
    s.state.sel = [document.getElementById('p')];
    s.commit();
  });
  await expect(page.locator('#sc-selection [data-corner-h]')).toHaveCount(0);
});
