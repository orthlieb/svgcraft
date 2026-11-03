// Render the app's icons from favicon.svg: icon-192.png, icon-512.png and
// favicon-32.png (the rounded tile as it is), and icon-maskable-512.png and
// apple-touch-icon.png (full-bleed and opaque: Android's masks and iOS shape
// the corners themselves). The octopus comes in from the tile's edge, so the
// full-bleed ones show it unclipped, at the same size, without the tile's
// teal border (the platform's mask would cut it).
// Run: node scripts/gen-pwa-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const svg = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8');
const inner = svg
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect width="64" height="64" rx="12"[^>]*\/>/, '')
  .replace(/<clipPath id="tile">[\s\S]*?<\/clipPath>/, '')
  .replace(/ clip-path="url\(#tile\)"/, '')
  .replace(/<rect id="edge"[^>]*\/>/, '');
const TILE = '#0e7c7b';
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${TILE}"/>${inner}</svg>`;
const maskable = fullBleed;
const touch = fullBleed;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, src, size] of [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', touch, 180],
  ['favicon-32.png', svg, 32],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`,
  );
  await page.screenshot({ path: path.join(root, file), omitBackground: true });
  console.log(`wrote ${file}`);
}
await browser.close();
