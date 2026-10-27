// Help screenshots for the README's Icons, Symbols, File Info, Shortcuts,
// SVG source and What the saved SVG keeps sections
// (see scripts/gen-help-screens.mjs).

// A 24 px Material-style icon: an outlined bell.
const BELL =
  '<path data-name="Bell" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" ' +
  'd="M12 4a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6z"/>' +
  '<circle data-name="Clapper" cx="12" cy="19.5" r="1.5" fill="#2563eb"/>';

// A launcher-style app icon: a background layer and a white glyph.
const APP =
  '<rect data-name="Background" width="512" height="512" fill="#7c3aed"/>' +
  '<g data-name="Glyph" fill="#fff"><circle cx="256" cy="200" r="80"/>' +
  '<rect x="136" y="300" width="240" height="70" rx="35"/></g>';

// Three stars made into a symbol, with three instances.
const STAR = 'M50 5l13 30 32 3-24 21 7 32-28-16-28 16 7-32L5 38l32-3z';
const STARS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560">
  <defs><symbol id="sc-sym-1" data-name="Star" overflow="visible">
    <path d="${STAR}" fill="#f59e0b" stroke="#92400e" stroke-width="4"/>
    <circle cx="50" cy="52" r="10" fill="#fff7ed"/></symbol>
  <symbol id="sc-sym-2" data-name="Badge" overflow="visible">
    <circle cx="40" cy="40" r="36" fill="#2563eb"/><path d="M22 40l12 12 24-24" fill="none" stroke="#fff" stroke-width="8"/></symbol></defs>
  <rect data-name="Backdrop" width="800" height="560" fill="#f8fafc"/>
  <use data-name="Star" href="#sc-sym-1" transform="translate(140 180) scale(1.6)"/>
  <use data-name="Star" href="#sc-sym-1" transform="translate(300 380) scale(1.2) rotate(15 50 50)"/>
  <use data-name="Star" href="#sc-sym-1" transform="translate(580 160)"/>
  <use data-name="Badge" href="#sc-sym-2" transform="translate(560 360) scale(1.4)"/>
</svg>`;

// Pick the Symbols tab, with room to show it in full (as if its splitter
// had been dragged down).
async function symbolsTab(h, height = '330px') {
  await h.tab('symbols');
  await h.page.evaluate(
    (height) =>
      document
        .querySelector('[data-tab="symbols"]')
        .closest('.sc-pgroup')
        .style.setProperty('--h', height),
    height,
  );
}

// Drop the symbol stars in and pick the Symbols tab.
async function stars(h, height) {
  await h.open(STARS, 'stars.svg');
  await symbolsTab(h, height);
}

const panelGroup = (h, tab) => h.page.locator(`.sc-pgroup:has([data-tab="${tab}"])`);

// The docked SVG Source pane and the part of the canvas next to it.
async function sourceShot(h) {
  const b = await h.page.locator('#sc-source').boundingBox();
  await h.shot(null, { clip: { x: 0, y: b.y, width: b.x + b.width, height: 520 } });
}

export default [
  {
    id: 'file-new-icon',
    async shoot(h) {
      await h.menu('File', 'newIcon');
      await h.page.waitForSelector('#sc-newicon[open]');
      await h.page.selectOption('#sc-ni-template', 'adaptive');
      await h.page.waitForSelector('#sc-ni-note:not([hidden])');
      await h.shot('#sc-newicon', { pad: 0 });
    },
  },
  {
    id: 'view-icon-keylines',
    async shoot(h) {
      await h.open(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${BELL}</svg>`,
        'icon-24.svg',
      );
      await h.page.evaluate(() => {
        const s = window.svgcraft.state;
        s.guides = [2, 22, 12].flatMap((pos) => [
          { axis: 'x', pos },
          { axis: 'y', pos },
        ]);
        s.guidesOn = true;
      });
      await h.menu('View', 'toggleKeylines');
      await h.page.evaluate(() => {
        // eslint-disable-next-line no-undef -- the editor's own global
        fit();
      });
      await h.redraw();
      await h.page.waitForSelector('#sc-keylines circle', { state: 'attached' });
      await h.shot('#sc-doc', { pad: 30 });
    },
  },
  {
    id: 'window-icon-preview',
    async shoot(h) {
      await h.open(APP, 'app.svg', 512, 512);
      await h.menu('Window', 'toggleIconPreview');
      await h.page.waitForSelector('#sc-iconprev:not([hidden]) .sc-ip-tile img[src]', {
        state: 'attached',
      });
      await h.page.click('[data-ip-bg="light"]');
      await h.page.click('[data-ip-mask="squircle"]');
      await h.page.waitForTimeout(300);
      await h.shot('#sc-iconprev', { pad: 0 });
    },
  },
  {
    id: 'file-export-app-icons',
    async shoot(h) {
      await h.open(APP, 'app.svg', 512, 512);
      await h.menu('File', 'exportAppIcons');
      await h.page.waitForSelector('#sc-appicons[open]');
      await h.shot('#sc-appicons', { pad: 0 });
    },
  },
  {
    id: 'make-a-symbol',
    async shoot(h) {
      await h.select('Red paint', 'Yellow paint', 'Green paint');
      await h.menu('Object', 'makeSymbol');
      await h.page.waitForSelector('#sc-ask[open]');
      await h.shot('#sc-ask', { pad: 0 });
    },
  },
  {
    id: 'place-a-symbol',
    async shoot(h) {
      await stars(h);
      await h.page.locator('#sc-symlib > *').first().click();
      await h.page.click('[data-sym-act="place"]');
      await h.redraw();
      // The Symbols panel and the canvas beside it.
      const g = await panelGroup(h, 'symbols').boundingBox();
      await h.shot(null, { clip: { x: 360, y: g.y, width: 1280 - 360, height: g.height } });
    },
  },
  {
    id: 'symbol-instances',
    async shoot(h) {
      await stars(h, '90px');
      await h.page.evaluate(() =>
        document
          .querySelector('[data-tab="props"]')
          .closest('.sc-pgroup')
          .style.setProperty('--h', '90px'),
      );
      await h.page.evaluate(() => {
        const s = window.svgcraft;
        s.state.sel = [document.querySelectorAll('#sc-doc use')[3]];
        s.syncActions();
      });
      await h.redraw();
      // The canvas's right half and the Layers panel.
      const l = await h.page.locator('.sc-pgroup.sc-grow').boundingBox();
      await h.shot(null, {
        clip: { x: 520, y: l.y - 160, width: 1280 - 520, height: l.height + 160 },
      });
    },
  },
  {
    id: 'edit-symbol',
    async shoot(h) {
      await stars(h);
      const u = h.page.locator('#sc-doc use').first();
      await u.dblclick();
      await h.page.waitForSelector('#sc-iso:not([hidden])');
      await h.shot('#sc-stage', { pad: 0 });
    },
  },
  {
    id: 'the-symbols-library',
    async shoot(h) {
      await symbolsTab(h, '400px');
      await h.page.click('[data-symview="lib"]');
      await h.page.waitForSelector('#sc-libsyms > *');
      await h.page.selectOption('#sc-libsym-cat', { label: 'Weather' }).catch(() => {});
      await h.page.waitForTimeout(150);
      await h.page.locator('#sc-libsyms > *').first().click();
      await h.shot(panelGroup(h, 'symbols'), { pad: 0 });
    },
  },
  {
    id: 'describe-the-drawing',
    async shoot(h) {
      await h.menu('File', 'fileInfo');
      await h.page.waitForSelector('#sc-fileinfo[open]');
      const f = (k) => h.page.locator(`#sc-fileinfo [data-meta="${k}"]`);
      await f('title').fill('Palette');
      await f('creator').fill('Sam Rivera');
      await f('description').fill('Seven paint blobs and a brush, for the SVGCraft demo.');
      await f('keywords').fill('palette, paint, colour');
      await f('marked').selectOption('true');
      await f('rights').fill('© 2026 Sam Rivera');
      await f('license').selectOption('cc-by');
      await f('source').fill('https://example.com/palette');
      await f('language').fill('en');
      await h.shot('#sc-fileinfo', { pad: 0 });
    },
  },
  {
    id: 'shortcuts',
    async shoot(h) {
      await h.select('Brush');
      await h.menu('Edit');
      const list = h.page.locator('.sc-menu-list:not([hidden])').first();
      await list.waitFor();
      await h.shot(list, { pad: 6 });
    },
  },
  {
    id: 'window-svg-source',
    async shoot(h) {
      await h.open(STARS, 'stars.svg');
      await h.menu('Window', 'toggleSource');
      await h.page.waitForSelector('#sc-source:not([hidden]) #sc-src-code');
      await h.select('Badge');
      await h.page.waitForTimeout(300);
      await sourceShot(h);
    },
  },
  {
    id: 'what-the-saved-svg-keeps',
    async shoot(h) {
      await h.open(
        '<rect data-name="Card" x="80" y="60" width="440" height="260" rx="24" fill="#2563eb"/>' +
          '<text data-name="Label" x="300" y="210" font-size="64" text-anchor="middle" fill="#fff">Hello</text>',
        'card.svg',
        600,
        380,
      );
      await h.page.evaluate(() => {
        const doc = document.getElementById('sc-doc');
        const card = doc.querySelector('[data-name="Card"]');
        // eslint-disable-next-line no-undef -- the editor's own global
        writeFx(card, { ds: { on: true, c: '#000000', o: 50, a: 120, d: 6, sp: 0, s: 8 } });
        card.setAttribute('data-sc-lock', 'position');
        // eslint-disable-next-line no-undef -- the editor's own global
        syncEffects();
        window.svgcraft.commit();
      });
      await h.redraw();
      await h.menu('Window', 'toggleSource');
      await h.page.waitForSelector('#sc-source:not([hidden]) #sc-src-code');
      await h.select('Card');
      await h.page.waitForTimeout(300);
      await sourceShot(h);
    },
  },
];
