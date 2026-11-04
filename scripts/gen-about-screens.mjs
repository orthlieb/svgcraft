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
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'octopus.svg'), demo);
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

// 1. The workspace, with the octopus selected.
let page = await editor();
await clickDoc(page, 700, 130);
await shot(page, 'workspace');

// 2. Effects: the octopus's soft blue outer glow.
await page.click('.sc-menu-btn:text-is("Effect")');
await page.click('.sc-menu-list:not([hidden]) [data-action="layerStyle"]');
await page.click('#sc-fx [data-fx-page="og"] button');
await shot(page, 'layer-style');
await page.keyboard.press('Escape');

// 3. The gradient editor and its handles on the canvas, on the radial sea
// (made SVGCraft's own, so it has handles: Radial again keeps its stops).
await clickDoc(page, 330, 40);
await page.click('[data-kind-for="fill"] [data-kind="radial"]');
await page.click('[data-tab="props"]');
await shot(page, 'gradients');

// 4. Editing points on the left strand of kelp, its tip picked.
// (Picked by name: the strand is thin, and a click beside it misses.)
await page.evaluate(() => {
  const s = window.svgcraft;
  s.setTool('select');
  s.state.sel = [document.querySelector('#sc-doc [data-name="Kelp 1"]')];
  s.setTool('node');
});
await clickDoc(page, 55, 370, 'node');
await shot(page, 'points');

// 5. The Symbols library.
await clickDoc(page, 700, 130);
await page.evaluate(() => window.openLibraries('symbols'));
await page.click('[data-symview="lib"]');
await shot(page, 'symbols');
await page.evaluate(() => window.closeLibraries());

// 6. The SVG source viewer.
await page.keyboard.press('Control+u');
await shot(page, 'source');
await page.close();

// 7. Animation: the octopus drifts and glows, the bream and the tuna swim
// to and fro (a repeated chain: along a path, half a Flip, back, half a
// Flip), the ink puffs, the kelp sways, the bubbles bob, the light rays
// breathe, the title shines and the frame's dashes march. The saved
// drawing, cleaned, is the About page's demo (about/animated.svg); the shot
// shows the bream's chain in Properties → Animate.
page = await editor();
await page.evaluate(() => {
  const doc = document.getElementById('sc-doc');
  const by = (n) => doc.querySelector(`[data-name="${n}"]`);
  const set = (n, list) => by(n).setAttribute('data-sc-anim', JSON.stringify(list));
  const centre = (el) => {
    const b = el.getBoundingClientRect();
    const m = doc.getScreenCTM().inverse();
    const q = new DOMPoint(b.left + b.width / 2, b.top + b.height / 2).matrixTransform(m);
    return [q.x, q.y];
  };
  // The paths things move along, starting at their centres (hidden when
  // saved).
  const route = (id, name, d) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    Object.entries({ id, 'data-name': name, d, fill: 'none', stroke: '#ffffff' }).forEach(
      ([k, v]) => r.setAttribute(k, v),
    );
    r.setAttribute('stroke-opacity', '0.4');
    doc.append(r);
  };
  const [ox, oy] = centre(by('Octopus'));
  route('octopus-drift', 'Octopus drift', `M${ox} ${oy} q-30 -14 -60 -6`);
  const [bx, bY] = centre(by('Bream'));
  route('bream-route', 'Bream route', `M${bx} ${bY} c50 -26 100 26 160 0`);
  const [tx, tY] = centre(by('Tuna'));
  route('tuna-route', 'Tuna route', `M${tx} ${tY} c50 18 100 -18 170 4`);
  const drift = { p: 'followPath', dur: 5, rep: 0, dir: 'alternate', ease: 'inout' };
  set('Octopus', [
    { ...drift, path: 'octopus-drift', orient: false, hide: true },
    { p: 'glowPulse', dur: 3.5, rep: 0, dir: 'alternate', ease: 'inout', size: 22, to: '#9fdcff' },
  ]);
  const swim = (path, dur, extra = {}) => {
    const go = { p: 'followPath', dur, rep: 1, ease: 'inout', path, orient: false, hide: true };
    const turn = { p: 'flip', dur: 0.6, rep: 1, ease: 'inout', axis: 'vertical', half: true };
    return [
      { ...go, loop: true, ...extra },
      { ...turn, after: true },
      { ...go, dir: 'reverse', after: true },
      { ...turn, after: true },
    ];
  };
  set('Bream', swim('bream-route', 7));
  set('Tuna', swim('tuna-route', 4.5, { delay: 1 }));
  set('Ink puff', [
    { p: 'pulse', dur: 4, rep: 0, ease: 'inout', scale: 170 },
    { p: 'breathe', dur: 4, rep: 0, ease: 'inout' },
  ]);
  [
    [3.2, 6],
    [2.6, 8],
    [2.9, 9],
    [3.6, 6],
    [2.7, 8],
  ].forEach(([dur, angle], i) =>
    set(`Kelp ${i + 1}`, [
      { p: 'swing', dur, rep: 0, ease: 'inout', angle, pivot: 'bottom', delay: i * 0.3 },
    ]),
  );
  for (let i = 1; i <= 5; i++)
    set(`Bubble ${i}`, [
      { p: 'float', dur: 1.6 + i * 0.25, rep: 0, dir: 'alternate', ease: 'inout', dist: 8 },
    ]);
  set('Light rays', [{ p: 'breathe', dur: 6, rep: 0, ease: 'inout' }]);
  set('Title', [{ p: 'shine', dur: 2.4, rep: 0, ease: 'inout' }]);
  set('Frame', [{ p: 'dashMarch', dur: 1.2, rep: 0, ease: 'linear' }]);
  window.svgcraft.commit();
});
const animated = await page.evaluate(() =>
  // eslint-disable-next-line no-undef -- the editor's own globals
  cleanSvgText(window.svgcraft.serialize(), { ...CLEAN_DEFAULTS, responsive: false }),
);
fs.writeFileSync(path.join(out, 'animated.svg'), animated);
console.log(`wrote about/animated.svg (${animated.length} bytes)`);
await clickDoc(page, 180, 374);
await page.click('[data-tab="animation"]');
await shot(page, 'animate');
await page.close();

// 8. The light theme.
page = await editor('light');
await clickDoc(page, 700, 130);
await shot(page, 'light');

await browser.close();
