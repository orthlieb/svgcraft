// Help screenshots for the README's Workspace section: the phone preview,
// installing, and the editor's layout (see scripts/gen-help-screens.mjs).
import path from 'node:path';

const PHONE = { viewport: { width: 390, height: 844 }, touch: true };
const ROOT = path.resolve(import.meta.dirname, '../..');
// The demo's backdrop is a gradient, which makes a big PNG of a whole
// window: a flat one keeps it small.
const flatBackdrop = (h) =>
  h.page.evaluate(() =>
    document.querySelector('#sc-doc [data-name="Backdrop"]').setAttribute('fill', '#123d63'),
  );

export default [
  {
    id: 'on-a-phone',
    ...PHONE,
    async shoot(h) {
      await h.page.waitForSelector('.sc-menubar-end [data-action="peekLayers"]');
      await h.shot();
    },
  },
  {
    id: 'on-a-phone-layers',
    ...PHONE,
    async shoot(h) {
      await h.page.click('.sc-menubar-end [data-action="peekLayers"]');
      await h.page.waitForSelector('#sc-peek-list .sc-thumb');
      // Hide one layer, as you would while looking.
      await h.page.locator('#sc-peek-list li:has-text("Title") .sc-peek-eye').click();
      await h.page.waitForTimeout(300);
      await h.shot('#sc-peek', { pad: 0 });
    },
  },
  {
    id: 'on-a-tablet',
    viewport: { width: 820, height: 1180 },
    touch: true,
    async shoot(h) {
      await flatBackdrop(h);
      await h.page.click('#sc-panel-toggle');
      await h.page.waitForTimeout(400);
      // The lower half: the panels slid in, and the toolbar along the bottom.
      await h.shot(null, { clip: { x: 0, y: 560, width: 820, height: 620 } });
    },
  },
  {
    id: 'offline-and-as-an-app',
    async shoot(h) {
      // The item shows once the browser offers to install (it doesn't in the
      // test browser), so show it as it appears then.
      await h.page.evaluate(() => {
        document.querySelector('[data-action="installApp"]').hidden = false;
      });
      await h.menu('File', 'installApp', { click: false });
      await h.shot(['.sc-menu-list:not([hidden])', '.sc-menu-btn:text-is("File")'], { pad: 6 });
    },
  },
  {
    id: 'offline-and-as-an-app-update',
    async shoot(h) {
      await h.select('Red paint');
      await h.page.evaluate(() => (document.getElementById('sc-update').hidden = false));
      const bar = h.page.locator('#sc-update');
      const box = await bar.boundingBox();
      // The bar with the canvas and status bar round it.
      await h.shot(null, {
        clip: { x: box.x - 120, y: box.y - 90, width: box.width + 240, height: 160 },
      });
    },
  },
  {
    id: 'the-editor-window',
    async shoot(h) {
      await flatBackdrop(h);
      await h.select('Red paint');
      await h.shot();
    },
  },
  {
    id: 'the-menu-bar',
    async shoot(h) {
      await h.select('Red paint');
      await h.menu('Layer', 'clipMake', { click: false });
      await h.shot(
        [
          '.sc-menu-list:not([hidden])',
          '.sc-submenu:has([data-action="clipMake"]) .sc-sub-list',
          '.sc-menu-btn:text-is("Layer")',
        ],
        { pad: 6 },
      );
    },
  },
  {
    id: 'right-click-menus',
    async shoot(h) {
      // Right-click the red paint, where it lies on the palette, and point
      // at Layers Here.
      const p = await h.page.evaluate(() => {
        const r = document.querySelector('#sc-doc [data-name="Red paint"]').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await h.page.evaluate(() => window.svgcraft.setTool('select'));
      await h.page.mouse.click(p.x, p.y, { button: 'right' });
      await h.page.locator('#sc-ctx .sc-sub-btn:has(> span:text-is("Layers Here"))').hover();
      await h.page.locator('#sc-ctx .sc-sub-list:not([hidden])').waitFor();
      const boxes = [];
      for (const t of ['#sc-ctx', '#sc-ctx .sc-sub-list:not([hidden])'])
        boxes.push(await h.page.locator(t).boundingBox());
      const x0 = Math.min(p.x, ...boxes.map((b) => b.x)) - 60;
      const y0 = Math.min(p.y, ...boxes.map((b) => b.y)) - 40;
      const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + 8;
      const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + 8;
      await h.shot(null, { clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    },
  },
  {
    id: 'the-options-bar',
    async shoot(h) {
      await h.select('Red paint');
      const bar = h.page.locator('#sc-options');
      await bar.waitFor();
      const b = await bar.boundingBox();
      await h.shot(null, { clip: { x: b.x, y: b.y, width: 760, height: b.height } });
    },
  },
  {
    id: 'the-toolbar',
    async shoot(h) {
      const b = await h.page.locator('.sc-tools').boundingBox();
      await h.shot(null, { clip: { x: b.x, y: b.y, width: b.width + 4, height: 460 } });
    },
  },
  {
    id: 'docked-panels',
    async shoot(h) {
      await h.select('Red paint');
      await h.shot('#sc-panel', { pad: 0 });
    },
  },
  {
    id: 'docked-panels-icons',
    async shoot(h) {
      await h.page.evaluate(() => window.svgcraft.actions.toggleDock());
      await h.page.waitForSelector('.sc-dock-strip button');
      await h.page.locator('.sc-dock-strip button').first().click();
      await h.page.waitForTimeout(300);
      const vp = h.page.viewportSize();
      await h.shot(null, { clip: { x: vp.width - 340, y: 60, width: 340, height: 520 } });
    },
  },
  {
    id: 'window-menu',
    async shoot(h) {
      await h.menu('Window', 'resetWorkspace', { click: false });
      await h.shot(['.sc-menu-list:not([hidden])', '.sc-menu-btn:text-is("Window")'], { pad: 6 });
    },
  },
  {
    id: 'split-view',
    async shoot(h) {
      await flatBackdrop(h);
      await h.page.evaluate(() => {
        window.svgcraft.actions.toggleIconPreview();
        window.svgcraft.actions.toggleSource();
      });
      await h.page.waitForSelector('#sc-dock:not([hidden]) #sc-source');
      await h.shot('.sc-workspace', { pad: 0 });
    },
  },
  {
    id: 'rulers-guides-and-smart-guides',
    async shoot(h) {
      const { page } = h;
      await h.open(
        '<rect data-name="Blue" x="100" y="80" width="200" height="120" fill="#2563eb"/>' +
          '<circle data-name="Green" cx="650" cy="450" r="50" fill="#16a34a"/>' +
          '<rect data-name="Red" x="420" y="260" width="160" height="160" fill="#dc2626"/>',
        'guides.svg',
        800,
        560,
      );
      await page.evaluate(() => {
        const s = window.svgcraft.state;
        s.smart = true;
        s.guidesOn = true;
        s.guides = [
          { axis: 'x', pos: 100 },
          { axis: 'y', pos: 330 },
        ];
        // eslint-disable-next-line no-undef -- the editor's own global
        renderGuides();
      });
      await h.redraw();
      // Drag the red square until its top meets the blue's and its centre
      // the green's, and hold it there for the shot (h.shot moves the mouse,
      // which would end the drag).
      await page.evaluate(() => window.svgcraft.setTool('select'));
      const a = await h.at(500, 340);
      const b = await h.at(653, 163);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await page.waitForSelector('#sc-smart line', { state: 'attached' });
      await page.waitForTimeout(200);
      const wrap = await page.locator('#sc-stage-wrap').boundingBox();
      const name = 'rulers-guides-and-smart-guides';
      await page.screenshot({
        path: path.join(ROOT, `docs/help/${name}.png`),
        clip: { x: wrap.x, y: wrap.y, width: wrap.width, height: 580 },
      });
      console.log(`wrote docs/help/${name}.png`);
      await page.mouse.up();
    },
  },
  {
    id: 'svgcraft-help',
    async shoot(h) {
      await h.menu('Help', 'help', { click: false });
      await h.shot(['.sc-menu-list:not([hidden])', '.sc-menu-btn:text-is("Help")'], { pad: 6 });
    },
  },
  {
    id: 'theme',
    theme: 'light',
    async shoot(h) {
      await h.menu('View', 'themeLight', { click: false });
      await h.shot(['.sc-menu-list:not([hidden])', '.sc-menu-btn:text-is("View")'], { pad: 6 });
    },
  },
];
