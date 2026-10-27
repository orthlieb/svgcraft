// Takes the help's screenshots (docs/help/*.png), one at the top of each
// help topic, by driving the editor with Playwright, so they can be redone
// whenever the UI changes.
//
//   node scripts/gen-help-screens.mjs                  every shot
//   node scripts/gen-help-screens.mjs image-trace crop  just these topics
//
// The shots are listed in scripts/help-screens/*.mjs, one file per part of
// the README. Each file's default export is a list of
//   { id, viewport?, theme?, async shoot(h) }
// where id is the help topic's anchor (and the PNG's name), and shoot()
// sets the editor up through the helpers below and calls h.shot().
// Every shot starts on a fresh page with about/demo.svg (the palette) open.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/help');
const DEMO = fs.readFileSync(path.join(ROOT, 'about/demo.svg'), 'utf8');
const DIR = path.join(ROOT, 'scripts/help-screens');

const shots = [];
for (const f of fs.readdirSync(DIR).sort())
  if (f.endsWith('.mjs'))
    for (const s of (await import(pathToFileURL(path.join(DIR, f)).href)).default)
      shots.push({ ...s, file: f });
const ids = shots.map((s) => s.id);
const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
if (dupe) throw new Error(`two shots are called ${dupe}`);
const want = process.argv.slice(2);
for (const w of want) if (!ids.includes(w)) throw new Error(`no shot called ${w}`);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// The helpers a shot gets.
function helpers(page, id) {
  const h = {
    page,
    DEMO,
    // Replace the drawing: a whole SVG file, or a body for a w × h viewBox.
    async open(svg, name = 'drawing.svg', w = 800, h2 = 600) {
      if (!/^\s*<svg/.test(svg))
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h2}">${svg}</svg>`;
      await page.evaluate(([t, n]) => window.svgcraft.openSvg(t, n), [svg, name]);
      await page.waitForTimeout(150);
    },
    // A document point → page pixels.
    at: (x, y) =>
      page.evaluate(
        ([x, y]) => {
          const q = new DOMPoint(x, y).matrixTransform(
            document.getElementById('sc-doc').getScreenCTM(),
          );
          return { x: q.x, y: q.y };
        },
        [x, y],
      ),
    // Click a document point with a tool (the Move tool by default).
    async clickDoc(x, y, tool = 'select', opts = {}) {
      if (tool) await page.evaluate((t) => window.svgcraft.setTool(t), tool);
      const p = await h.at(x, y);
      await page.mouse.click(p.x, p.y, opts);
    },
    // Drag between document points, with the current tool or the one given.
    async dragDoc(from, to, tool) {
      if (tool) await page.evaluate((t) => window.svgcraft.setTool(t), tool);
      const a = await h.at(...from);
      const b = await h.at(...to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
    },
    // Select layers by their data-name (or a CSS selector in the drawing).
    async select(...names) {
      await page.evaluate((names) => {
        const s = window.svgcraft;
        const doc = document.getElementById('sc-doc');
        s.setTool('select');
        s.state.sel = names.map(
          (n) => doc.querySelector(`[data-name="${n}"]`) || doc.querySelector(n),
        );
        if (s.state.sel.some((e) => !e)) throw new Error(`no layer ${names}`);
        s.readStyle(s.state.sel[0]);
        s.syncActions();
      }, names);
      await h.redraw();
    },
    // Refresh the UI after changing state directly.
    redraw: () =>
      page.evaluate(() => {
        // eslint-disable-next-line no-undef -- the editor's own global
        afterChange();
      }),
    // Open a menu and click an item (opening its submenu first if need be),
    // or just open the menu (and submenu) to show it, with click: false.
    async menu(label, act, { click = true } = {}) {
      await page.click(`.sc-menu-btn:text-is("${label}")`);
      if (!act) return;
      const item = page.locator(`.sc-menu-list:not([hidden]) [data-action="${act}"]`).first();
      const sub = await item.evaluate((el) => {
        const l = el.closest('.sc-sub-list');
        return l ? [...l.parentElement.children].indexOf(l) >= 0 : false;
      });
      if (sub)
        await item.locator('xpath=ancestor::div[contains(@class,"sc-submenu")][1]/button').hover();
      if (click) await item.click();
      else await item.hover();
    },
    // Show a panel tab (color, swatches, gradients, patterns, props,
    // character, paragraph, symbols, animation, history, layers…).
    tab: (name) => page.click(`[data-tab="${name}"]`),
    // A test bitmap placed in the drawing (and selected): a flat logo.
    async placeImage() {
      await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 300;
        c.height = 200;
        const x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, 300, 200);
        x.fillStyle = '#dc2626';
        x.beginPath();
        x.arc(80, 100, 60, 0, 7);
        x.fill();
        x.fillStyle = '#2563eb';
        x.fillRect(150, 40, 110, 80);
        x.strokeStyle = '#111111';
        x.lineWidth = 10;
        x.beginPath();
        x.moveTo(140, 180);
        x.lineTo(290, 140);
        x.stroke();
        x.strokeStyle = '#16a34a';
        x.lineWidth = 12;
        x.beginPath();
        x.arc(200, 80, 25, 0, 7);
        x.stroke();
        // eslint-disable-next-line no-undef -- the editor's own global
        placeImage(c.toDataURL());
      });
      await page.waitForTimeout(200);
    },
    // Save the screenshot: the whole window, or the box round one or more
    // elements (selectors or locators) with some room around it. name
    // defaults to the topic's id; a second shot in a topic passes its own.
    async shot(targets, { pad = 10, name = id, clip } = {}) {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350);
      const vp = page.viewportSize();
      if (!clip && targets) {
        const boxes = [];
        for (const t of [targets].flat()) {
          const loc = typeof t === 'string' ? page.locator(t).first() : t;
          const b = await loc.boundingBox();
          if (!b) throw new Error(`${id}: ${t} isn't showing`);
          boxes.push(b);
        }
        const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
        const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
        const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
        const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
        clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      }
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file, clip });
      console.log(`wrote docs/help/${name}.png`);
    },
  };
  return h;
}

let failed = 0;
for (const s of shots) {
  if (want.length && !want.includes(s.id)) continue;
  const page = await browser.newPage({
    viewport: s.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: s.theme || 'dark',
    hasTouch: !!s.touch,
    isMobile: !!s.touch,
  });
  // Web fonts aren't needed and may be unreachable.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'palette.svg'), DEMO);
  try {
    await s.shoot(helpers(page, s.id));
  } catch (e) {
    failed++;
    console.error(`${s.id} (${s.file}): ${e.message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
if (failed) {
  console.error(`${failed} shot(s) failed`);
  process.exit(1);
}
