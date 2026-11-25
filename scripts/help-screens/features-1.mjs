// Help screenshots for the README's Features section, Import to Export
// Clean SVG (see scripts/gen-help-screens.mjs).
import os from 'node:os';
import path from 'node:path';

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

// Two pages to print to a PDF for New from PDF.
const PDF_PAGES =
  '<style>@page{size:600px 420px;margin:0}body{margin:0}div{width:600px;height:420px;page-break-after:always}</style>' +
  '<div><svg xmlns="http://www.w3.org/2000/svg" width="600" height="420"><rect width="600" height="420" fill="#123d63"/>' +
  '<circle cx="430" cy="210" r="120" fill="#8fd3ff"/><text x="40" y="120" font-family="Georgia" font-size="54" fill="#f3e0de">Ocean</text>' +
  '<text x="40" y="180" font-family="Georgia" font-size="54" fill="#f3e0de">Notes</text></svg></div>' +
  '<div><svg xmlns="http://www.w3.org/2000/svg" width="600" height="420"><rect x="30" y="30" width="240" height="160" rx="16" fill="#2563eb"/>' +
  '<circle cx="420" cy="140" r="90" fill="#f59e0b" stroke="#111" stroke-width="5"/><text x="40" y="300" font-family="Georgia" font-size="44" fill="#0f2b39">Page two</text>' +
  '<path d="M40 360 C160 300 320 420 560 350" fill="none" stroke="#16a34a" stroke-width="8"/></svg></div>';

export default [
  {
    id: 'import',
    async shoot(h) {
      await h.menu('File', 'place', { click: false });
      await menuShot(h, 'place');
    },
  },
  {
    id: 'new-from-pdf',
    async shoot(h) {
      // A two-page PDF, printed here: a card, and a page of shapes and text.
      const maker = await h.page.context().browser().newPage();
      await maker.setContent(PDF_PAGES);
      const file = path.join(os.tmpdir(), 'brochure.pdf');
      await maker.pdf({ path: file, width: '600px', height: '420px', printBackground: true });
      await maker.close();
      const [chooser] = await Promise.all([
        h.page.waitForEvent('filechooser'),
        h.menu('File', 'newFromPdf'),
      ]);
      await chooser.setFiles(file);
      await h.page.locator('#sc-pdfnew').waitFor();
      await h.page.waitForFunction(() =>
        [...document.querySelectorAll('#sc-pdf-pages canvas')].every((c) => c.width > 1),
      );
      await h.page.click('.sc-pdf-page[data-page="2"]');
      await h.shot('#sc-pdfnew', { pad: 0 });
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
      await h.page.locator('#sc-docprops').scrollIntoViewIfNeeded();
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
      await h.select('Bream');
      await h.menu('Object', 'cropToSelection', { click: false });
      await menuShot(h, 'cropToSelection');
    },
  },
  {
    id: 'select-menu',
    async shoot(h) {
      await h.select('Bubble 1');
      await h.menu('Select', 'invertSelection', { click: false });
      await menuShot(h, 'invertSelection');
    },
  },
  {
    id: 'history-panel',
    async shoot(h) {
      await h.select('Bream');
      await h.menu('Object', 'flipH');
      await h.page.keyboard.press('ArrowRight');
      await h.select('Bubble 1');
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
    id: 'print',
    async shoot(h) {
      await h.page.evaluate(() => {
        window.svgcraft.state.boards.push({ name: 'Icon', x: 860, y: 0, w: 256, h: 256 });
      });
      await h.page.evaluate(() => window.svgcraft.actions.print());
      await h.page.locator('#sc-print-dlg').waitFor();
      await h.shot('#sc-print-dlg', { pad: 0 });
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
