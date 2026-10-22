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

// Drag between two document points.
async function dragDoc(page, from, to) {
  const at = (p) =>
    page.evaluate(([x, y]) => {
      const q = new DOMPoint(x, y).matrixTransform(
        document.getElementById('sc-doc').getScreenCTM(),
      );
      return { x: q.x, y: q.y };
    }, p);
  const a = await at(from);
  const b = await at(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
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
await page.click('.sc-menu-btn:text-is("Object")');
await page.click('.sc-menu-list:not([hidden]) [data-action="layerStyle"]');
await page.click('#sc-fx [data-fx-page="ds"] button');
await shot(page, 'layer-style');
await page.keyboard.press('Escape');

// 3. The gradient editor and the Gradient tool, on the radial backdrop.
await clickDoc(page, 70, 90);
await page.keyboard.press('g');
// Lay it again from the centre out, so its handles show on the canvas.
await dragDoc(page, [400, 235], [740, 470]);
await page.click('[data-tab="color"]');
await shot(page, 'gradients');

// 4. Editing points on the palette board, with one point picked.
await clickDoc(page, 460, 230, 'node');
await clickDoc(page, 587.5, 223.5, 'node');
await shot(page, 'points');

// 5. The Symbols library.
await clickDoc(page, 400, 200);
await page.click('[data-tab="symbols"]');
await page.click('[data-symview="lib"]');
await shot(page, 'symbols');

// 6. The SVG source viewer.
await page.keyboard.press('Control+u');
await shot(page, 'source');
await page.close();

// 7. The light theme.
page = await editor('light');
await clickDoc(page, 400, 200);
await shot(page, 'light');

await browser.close();
