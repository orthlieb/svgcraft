// Takes the screenshots on the About page (about/*.png) by driving the
// editor with Playwright, so they can be redone when the UI changes.
//
//   node scripts/gen-about-screens.mjs
//
// It opens about/demo.svg and shows a different part of the editor in each
// shot. The editor is static files, so it's loaded straight from disk.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'about');
const demo = fs.readFileSync(path.join(out, 'demo.svg'), 'utf8');

const browser = await chromium.launch();

async function editor(theme = 'dark') {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  // Web fonts aren't needed and may be unreachable.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForFunction(() => !!window.svgcraft);
  await page.evaluate(() => window.svgcraft.ready);
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'palette.svg'), demo);
  return page;
}

// Click a document point with a tool, as a user would.
async function clickDoc(page, x, y, tool = 'select') {
  await page.evaluate((t) => window.svgcraft.setTool(t), tool);
  const p = await page.evaluate(
    ([x, y]) => {
      const m = document.getElementById('sc-doc').getScreenCTM();
      const q = new DOMPoint(x, y).matrixTransform(m);
      return { x: q.x, y: q.y };
    },
    [x, y],
  );
  await page.mouse.click(p.x, p.y);
}

async function shot(page, name) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`wrote about/${name}.png`);
}

// 1. The workspace, with the palette selected.
let page = await editor();
await clickDoc(page, 400, 200);
await shot(page, 'workspace');

// 2. Layer Style on the palette's drop shadow.
await page.click('.sc-menu-btn:text-is("Layer")');
await page.click('.sc-menu-list:not([hidden]) [data-action="layerStyle"]');
await page.click('#sc-fx [data-fx-page="ds"] button');
await shot(page, 'layer-style');
await page.keyboard.press('Escape');

// 3. The gradient editor and its handles on the canvas, on the radial backdrop.
await clickDoc(page, 70, 90);
await page.click('[data-tab="props"]');
await shot(page, 'gradients');

// 4. Editing points on the palette board, with one point picked.
await clickDoc(page, 460, 230, 'node');
await clickDoc(page, 587.5, 223.5, 'node');
await shot(page, 'points');

// 5. The Symbols library.
await clickDoc(page, 400, 200);
await page.evaluate(() => window.openLibraries('symbols'));
await page.click('[data-symview="lib"]');
await shot(page, 'symbols');
await page.evaluate(() => window.closeLibraries());

// 6. The SVG source viewer.
await page.keyboard.press('Control+u');
await shot(page, 'source');
await page.close();

// 7. Animation: the palette pops in, its paints pulse in turn, the brush
// dabs, the title glows and the frame's dashes march. The saved drawing,
// cleaned, is the About page's demo (about/animated.svg); the shot shows
// the brush's settings in Properties → Animate.
page = await editor();
await page.evaluate(() => {
  const by = (n) => document.querySelector(`#sc-doc [data-name="${n}"]`);
  const set = (n, list) => by(n).setAttribute('data-sc-anim', JSON.stringify(list));
  set('Palette', [{ p: 'popIn', dur: 0.7 }]);
  ['Red', 'Yellow', 'Green', 'Blue', 'Purple'].forEach((c, i) =>
    set(`${c} paint`, [{ p: 'pulse', dur: 1.5, delay: 0.7 + i * 0.15, scale: 118 }]),
  );
  set('Brush', [{ p: 'float', dur: 0.9, dist: 14 }]);
  set('Title', [{ p: 'colourCycle', dur: 2.5, to: '#9fd8ff' }]);
  set('Frame', [{ p: 'dashMarch', dur: 1.2 }]);
  window.svgcraft.commit();
});
const animated = await page.evaluate(() =>
  // eslint-disable-next-line no-undef -- the editor's own globals
  cleanSvgText(window.svgcraft.serialize(), { ...CLEAN_DEFAULTS, responsive: false }),
);
fs.writeFileSync(path.join(out, 'animated.svg'), animated);
console.log(`wrote about/animated.svg (${animated.length} bytes)`);
await clickDoc(page, 613, 338);
await page.click('[data-tab="animation"]');
await shot(page, 'animate');
await page.close();

// 8. The light theme.
page = await editor('light');
await clickDoc(page, 400, 200);
await shot(page, 'light');

await browser.close();
