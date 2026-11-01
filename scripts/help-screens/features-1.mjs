// Help screenshots for the README's Features section, Import to Export
// Clean SVG (see scripts/gen-help-screens.mjs).

// An open menu (and its open submenus), for a shot of the menu itself.
const openMenus = '.sc-menu-list:not([hidden])';
// The item stays highlighted by keyboard focus, as the shot moves the mouse
// away.
const menuShot = async (h, act) => {
  if (act) {
    await h.page.keyboard.press('Shift');
    await h.page.locator(`${openMenus} [data-action="${act}"]`).first().focus();
  }
  const lists = await h.page.locator(openMenus).all();
  await h.shot(lists, { pad: 6 });
};

export default [
  {
    id: 'import',
    async shoot(h) {
      await h.menu('File', 'place', { click: false });
      await menuShot(h, 'place');
    },
  },
  {
    id: 'units-and-page-size',
    async shoot(h) {
      await h.page.evaluate(() => {
        window.svgcraft.state.sel = [];
        window.svgcraft.syncActions();
      });
      await h.redraw();
      await h.tab('props');
      await h.page.selectOption('#sc-page', { label: 'A4' });
      await h.page.locator('#sc-units').waitFor();
      await h.shot(['.sc-docunits', '#sc-grid-size', '.sc-subhead:text-is("Document")'], {
        pad: 10,
      });
    },
  },
  {
    id: 'image-trace',
    async shoot(h) {
      await h.open('', 'logo.svg', 600, 400);
      await h.placeImage();
      await h.menu('Object', 'imageTrace');
      await h.page.waitForSelector('[data-tr="status"]:text-matches("colour")');
      await h.shot('#sc-trace', { pad: 0 });
    },
  },
  {
    id: 'scale-document',
    async shoot(h) {
      await h.menu('File', 'imageSize');
      await h.page.locator('#sc-imagesize').waitFor();
      await h.page.fill('[data-is="w"]', '1200');
      await h.page.dispatchEvent('[data-is="w"]', 'input');
      await h.shot('#sc-imagesize', { pad: 0 });
    },
  },
  {
    id: 'document-setup',
    async shoot(h) {
      await h.menu('File', 'canvasSize');
      await h.page.locator('#sc-canvassize').waitFor();
      await h.page.click('[data-cv-anchor="0.5,0.5"]');
      await h.shot('#sc-canvassize', { pad: 0 });
    },
  },
  {
    id: 'artboards',
    async shoot(h) {
      await h.open(
        `<circle cx="64" cy="64" r="48" fill="#2563eb"/>
        <rect x="180" y="16" width="96" height="96" rx="20" fill="#f97316"/>
        <path d="M360 110 L400 20 L440 110Z" fill="#16a34a"/>`,
        'icons.svg',
        128,
        128,
      );
      await h.page.evaluate(() => {
        /* eslint-disable no-undef -- the editor's own globals */
        const s = window.svgcraft.state;
        s.boards.push(
          { name: 'Square', x: 164, y: 0, w: 128, h: 128 },
          { name: 'Triangle', x: 336, y: 0, w: 128, h: 128 },
        );
        s.boardName = 'Circle';
        window.svgcraft.setTool('artboard');
        fit();
        boardSel = 2;
        renderBoards();
        syncBoardOpts();
        /* eslint-enable no-undef */
      });
      await h.page.mouse.move(5, 5);
      await h.shot(['#sc-options', '#sc-stage-wrap'], { pad: 0 });
    },
  },
  {
    id: 'grayscale-and-black-white',
    async shoot(h) {
      await h.menu('Edit', 'adjBlackWhite');
      await h.page.locator('#sc-bw').waitFor();
      await h.page.waitForTimeout(300);
      // The dialog beside the drawing it's previewing in grey.
      await h.shot(['#sc-bw', '#sc-doc'], { pad: 0 });
    },
  },
  {
    id: 'crop',
    async shoot(h) {
      await h.select('Brush');
      await h.menu('Object', 'cropToSelection', { click: false });
      await menuShot(h, 'cropToSelection');
    },
  },
  {
    id: 'select-menu',
    async shoot(h) {
      await h.select('Red paint');
      await h.menu('Select', 'invertSelection', { click: false });
      await menuShot(h, 'invertSelection');
    },
  },
  {
    id: 'history-panel',
    async shoot(h) {
      await h.select('Brush');
      await h.menu('Object', 'flipH');
      await h.page.keyboard.press('ArrowRight');
      await h.select('Red paint');
      await h.menu('Edit', 'adjDesaturate');
      await h.tab('history');
      const list = h.page.locator('#sc-history');
      await list.locator('li').nth(3).waitFor();
      // Go back a step: the one after it dims.
      await list.locator('li').nth(-2).click();
      await h.shot(h.page.locator('.sc-pgroup', { has: list }), { pad: 0 });
    },
  },
  {
    id: 'documents',
    async shoot(h) {
      await h.menu('File', 'new');
      await h.page.locator('#sc-newdoc').waitFor();
      await h.page.click('#sc-nd-cats >> text=Print');
      await h.page.locator('#sc-nd-presets [role="option"]').first().click();
      await h.shot('#sc-newdoc', { pad: 0 });
    },
  },
  {
    id: 'open-close-and-switch-tabs',
    async shoot(h) {
      await h.page.evaluate(() => {
        // eslint-disable-next-line no-undef -- the editor's own global
        newDoc({ name: 'Poster', w: 600, h: 800 });
      });
      await h.page.evaluate(() => {
        // eslint-disable-next-line no-undef -- the editor's own global
        newDoc({ name: 'Logo', w: 400, h: 400 });
      });
      await h.page.waitForTimeout(150);
      // An unsaved change, so the tab shows its *.
      await h.dragDoc([100, 100], [300, 280], 'rect');
      await h.redraw();
      await h.page.locator('#sc-doctabs [role="tab"]').nth(2).waitFor();
      await h.shot(await h.page.locator('#sc-doctabs > *').all(), { pad: 4 });
    },
  },
  {
    id: 'open-recent',
    async shoot(h) {
      await h.page.evaluate(() => {
        for (const name of ['badge.svg', 'map-pins.svg', 'poster.svg', 'logo.svg'])
          // eslint-disable-next-line no-undef -- the editor's own global
          noteRecent(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], name));
      });
      await h.page.waitForTimeout(150);
      await h.menu('File', 'open', { click: false });
      await h.page.hover('.sc-sub-btn:has-text("Open Recent")');
      await h.page.keyboard.press('Shift');
      await h.page.locator('#sc-recent-list button').first().focus();
      await menuShot(h);
    },
  },
  {
    id: 'save-and-save-as',
    async shoot(h) {
      await h.menu('File', 'save', { click: false });
      await menuShot(h, 'save');
    },
  },
  {
    id: 'export',
    async shoot(h) {
      await h.menu('File', 'exportPng2', { click: false });
      await menuShot(h, 'exportPng2');
    },
  },
  {
    id: 'export-clean-svg',
    async shoot(h) {
      await h.menu('File', 'exportCleanSvg');
      await h.page.locator('#sc-cleansvg').waitFor();
      await h.shot('#sc-cleansvg', { pad: 0 });
    },
  },
];
