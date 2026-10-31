// Help screenshots for the README's Layers, Tooltips, Combine Shapes,
// Clipping masks and Create Outlines sections (see
// scripts/gen-help-screens.mjs).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LAYERS = '#sc-panel > .sc-pgroup:last-child';

// Fold every panel group above Layers, so the Layers panel gets the room.
async function foldPanels(h) {
  const bs = h.page.locator('#sc-panel > .sc-pgroup:not(:last-child) .sc-pcollapse');
  for (let i = 0; i < (await bs.count()); i++) await bs.nth(i).click();
  await h.page.mouse.move(0, 0);
}

// A layer's row in the Layers panel.
const row = (h, name) =>
  h.page.locator('#sc-layers li', { has: h.page.getByText(name, { exact: true }) });

// Save a shot without moving the mouse first (h.shot does, which would end
// a hover or a drag), cropped to the box round the targets.
async function still(h, targets, { pad = 10, name } = {}) {
  await h.page.waitForTimeout(300);
  const vp = h.page.viewportSize();
  const boxes = [];
  for (const t of [targets].flat()) {
    const b = await (typeof t === 'string' ? h.page.locator(t).first() : t).boundingBox();
    if (!b) throw new Error(`${t} isn't showing`);
    boxes.push(b);
  }
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  const file = path.join(ROOT, 'docs/help', `${name}.png`);
  await h.page.screenshot({ path: file, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  console.log(`wrote docs/help/${name}.png`);
}

// Create Outlines reads Fontsource's font files; serve its Lato from the
// tests' copy (the CDN may be unreachable) and show the text in it too.
const LATO = (w) => fs.readFileSync(path.join(ROOT, `tests/fonts/lato-latin-${w}-normal.woff`));
async function useLato(h) {
  await h.page.route(/cdn\.jsdelivr\.net\/fontsource\//, (route) => {
    const m = /fonts\/lato@latest\/latin-(400|700)-normal\.woff$/.exec(route.request().url());
    if (!m) return route.abort();
    return route.fulfill({
      status: 200,
      body: LATO(m[1]),
      headers: { 'content-type': 'font/woff', 'access-control-allow-origin': '*' },
    });
  });
  const css = [400, 700]
    .map(
      (w) =>
        `@font-face{font-family:'Lato';font-weight:${w};src:url(data:font/woff;base64,${LATO(w).toString('base64')}) format('woff')}`,
    )
    .join('');
  await h.page.addStyleTag({ content: css });
  await h.page.evaluate(() =>
    Promise.all([document.fonts.load("48px 'Lato'"), document.fonts.load("bold 48px 'Lato'")]),
  );
}

// A drawing to clip: colour stripes under a bold word, the word on top.
const CLIP_ART = `
  <rect data-name="Sky" width="800" height="360" fill="#0f172a"/>
  <g data-name="Stripes">
    <rect data-name="Red" x="60" y="60" width="680" height="60" fill="#ef4444"/>
    <rect data-name="Orange" x="60" y="120" width="680" height="60" fill="#f97316"/>
    <rect data-name="Yellow" x="60" y="180" width="680" height="60" fill="#eab308"/>
    <rect data-name="Green" x="60" y="240" width="680" height="60" fill="#22c55e"/>
  </g>
  <circle data-name="Sun" cx="560" cy="150" r="90" fill="#a855f7"/>
  <ellipse data-name="Window" cx="400" cy="180" rx="300" ry="110" fill="#ffffff"/>`;
async function clipArt(h) {
  await h.open(CLIP_ART, 'clip.svg', 800, 360);
  await h.select('Stripes', 'Sun', 'Window');
  await h.page.evaluate(() => window.svgcraft.actions.clipMake());
  await h.redraw();
}

const SMALL = { width: 1100, height: 720 };

export default [
  {
    id: 'layer-rows-and-folders',
    async shoot(h) {
      await foldPanels(h);
      await h.select('Red paint');
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'select-layers',
    viewport: SMALL,
    async shoot(h) {
      await foldPanels(h);
      await h.select('Red paint', 'Yellow paint', 'Green paint', 'Purple paint');
      await h.shot(['#sc-doc', LAYERS], { pad: 0 });
    },
  },
  {
    id: 'group-and-ungroup',
    async shoot(h) {
      await foldPanels(h);
      await h.select('Red paint', 'Yellow paint');
      await h.page.evaluate(() => window.svgcraft.actions.group());
      await h.redraw();
      await row(h, 'Group 1').waitFor();
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'reorder-copy-and-delete',
    async shoot(h) {
      await foldPanels(h);
      await h.select('Purple paint');
      // Part-way through dragging Purple paint above Green paint.
      await h.page.evaluate(() => {
        const rows = [...document.querySelectorAll('#sc-layers li')];
        const find = (n) => rows.find((r) => r.querySelector('.sc-layer-name')?.textContent === n);
        const from = find('Purple paint');
        const to = find('Green paint');
        const dt = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const r = to.getBoundingClientRect();
        to.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX: r.x + 40,
            clientY: r.y + 3,
          }),
        );
      });
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'show-hide-and-lock',
    async shoot(h) {
      await foldPanels(h);
      await row(h, 'Brush').locator('.sc-eye').first().click();
      await h.select('Title');
      await h.page.click('[data-lock="all"]');
      await row(h, 'Title').locator('.sc-row-lock').waitFor();
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'right-click-a-layer',
    async shoot(h) {
      await foldPanels(h);
      await row(h, 'Title').click({ button: 'right' });
      await h.page.locator('#sc-ctx').waitFor();
      await still(h, [LAYERS, '#sc-ctx'], { pad: 4, name: 'right-click-a-layer' });
    },
  },
  {
    id: 'rename-a-layer',
    async shoot(h) {
      await foldPanels(h);
      await h.select('Title');
      // What double-clicking the name does (a real double-click's first
      // click redraws the rows under the pointer).
      await h.page.evaluate(() => {
        const li = [...document.querySelectorAll('#sc-layers li')].find(
          (r) => r.layerEl?.getAttribute('data-name') === 'Title',
        );
        // eslint-disable-next-line no-undef -- the editor's own global
        renameLayer(li.layerEl, li.querySelector('.sc-layer-name'));
      });
      const input = h.page.locator('.sc-layer-input');
      await input.waitFor();
      await input.fill('Logo text');
      await still(h, LAYERS, { pad: 0, name: 'rename-a-layer' });
    },
  },
  {
    id: 'blend-mode-and-opacity',
    async shoot(h) {
      await foldPanels(h);
      await h.select('Purple paint');
      await h.page.selectOption('#sc-blend', 'multiply');
      const op = h.page.locator('.sc-layers-head [data-bind="opacity"]');
      await op.fill('70');
      await op.press('Enter');
      await h.redraw();
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'merge-layers',
    async shoot(h) {
      await h.select('Red paint', 'Yellow paint');
      await h.menu('Layer', 'mergeDown', { click: false });
      await still(h, '.sc-menu-list:not([hidden])', { pad: 4, name: 'merge-layers' });
    },
  },
  {
    id: 'group-by-colour',
    async shoot(h) {
      await foldPanels(h);
      await h.open(
        `<rect data-name="Sky" width="600" height="400" fill="#bae6fd"/>
        <g data-name="Imported">
          <circle data-name="path 1" cx="120" cy="120" r="50" fill="#ef4444"/>
          <rect data-name="path 2" x="220" y="80" width="90" height="90" fill="#2563eb"/>
          <circle data-name="path 3" cx="420" cy="120" r="50" fill="#ef4444"/>
          <rect data-name="path 4" x="80" y="240" width="90" height="90" fill="#2563eb"/>
          <circle data-name="path 5" cx="300" cy="290" r="50" fill="#ef4444"/>
          <rect data-name="path 6" x="420" y="240" width="90" height="90" fill="#16a34a"/>
        </g>`,
        'imported.svg',
        600,
        400,
      );
      await h.menu('Layer', 'groupByColour');
      await h.page.locator('#sc-ask').waitFor();
      await h.page.locator('#sc-ask .sc-primary-btn').click();
      await h.page.locator('#sc-ask').waitFor({ state: 'hidden' });
      await h.redraw();
      await h.shot(LAYERS, { pad: 0 });
    },
  },
  {
    id: 'layer-via-copy-cut',
    async shoot(h) {
      await h.select('Red paint');
      await h.menu('Layer', 'layerViaCopy', { click: false });
      await still(
        h,
        [0, 1].map((i) => h.page.locator('.sc-menu-list:not([hidden])').nth(i)),
        { pad: 4, name: 'layer-via-copy-cut' },
      );
    },
  },
  {
    id: 'layer-style-fx',
    async shoot(h) {
      await h.select('Title');
      await h.menu('Layer', 'layerStyle');
      await h.page.locator('#sc-fx').waitFor();
      await h.page.click('#sc-fx [data-fx-page="ds"] button');
      await h.shot('#sc-fx', { pad: 0 });
    },
  },
  {
    id: 'tooltips',
    async shoot(h) {
      await h.page.hover('[data-tool="pen"]');
      await h.page.locator('.sc-tip:not([hidden])').waitFor();
      await still(h, ['[data-tool="pen"]', '.sc-tip'], { pad: 40, name: 'tooltips' });
    },
  },
  {
    id: 'combine-selected-shapes',
    viewport: SMALL,
    async shoot(h) {
      await h.open(
        `<rect data-name="Square" x="140" y="90" width="220" height="220" rx="16" fill="#2563eb"/>
        <circle data-name="Circle" cx="380" cy="200" r="120" fill="#f97316"/>`,
        'shapes.svg',
        600,
        400,
      );
      await h.select('Square', 'Circle');
      await h.page.hover('#sc-options [data-action="combineUnite"]');
      await h.page.locator('.sc-tip:not([hidden])').waitFor();
      await still(
        h,
        [
          '#sc-options .sc-opt-tool',
          '#sc-options [data-action="combineExclude"]',
          '#sc-stage-wrap',
        ],
        {
          pad: 6,
          name: 'combine-selected-shapes',
        },
      );
    },
  },
  {
    id: 'make-a-clipping-mask',
    viewport: SMALL,
    async shoot(h) {
      await foldPanels(h);
      await clipArt(h);
      await h.shot(['#sc-doc', LAYERS], { pad: 0 });
    },
  },
  {
    id: 'edit-the-clip',
    viewport: SMALL,
    async shoot(h) {
      await foldPanels(h);
      await clipArt(h);
      // Select the clipping path and nudge it 100 px left.
      await h.select('Window');
      for (let i = 0; i < 10; i++) await h.page.keyboard.press('Shift+ArrowLeft');
      await h.redraw();
      await h.shot(['#sc-doc', LAYERS], { pad: 0 });
    },
  },
  {
    id: 'release-a-clipping-mask',
    async shoot(h) {
      await clipArt(h);
      await h.menu('Layer', 'clipRelease', { click: false });
      await still(
        h,
        [0, 1].map((i) => h.page.locator('.sc-menu-list:not([hidden])').nth(i)),
        {
          pad: 4,
          name: 'release-a-clipping-mask',
        },
      );
    },
  },
  {
    id: 'turn-text-into-outlines',
    viewport: SMALL,
    async shoot(h) {
      await foldPanels(h);
      await useLato(h);
      await h.open(
        `<rect data-name="Card" width="600" height="300" fill="#fef3c7"/>
        <text data-name="Hello" x="300" y="170" text-anchor="middle" font-family="Lato" font-size="72" fill="#1e293b">Hello, <tspan font-weight="700" fill="#dc2626">world</tspan></text>`,
        'outlines.svg',
        600,
        300,
      );
      await h.select('Hello');
      await h.menu('Type', 'createOutlines');
      await row(h, 'Hello (outlines)').waitFor();
      await h.shot(['#sc-doc', LAYERS, '#sc-msg'], { pad: 0 });
    },
  },
  {
    id: 'fonts-for-outlines',
    async shoot(h) {
      await h.select('Title');
      await h.tab('character');
      await h.page.click('#sc-panel [data-fontpick]');
      await h.page.locator('#sc-fontpop').waitFor();
      await h.shot('#sc-fontpop', { pad: 0 });
    },
  },
];
