// SVGCraft — Export: SVG, PNG and Copy as SVG.
'use strict';

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------
// Google families used by text in the drawing.
function usedGoogleFonts() {
  const names = new Set(docFamilies());
  return FONTS.filter((ft) => ft.src === 'google' && names.has(ft.name));
}

// @font-face rules with the font files inlined, for PNG export: an SVG
// drawn as an image may not load anything from the network.
const embedCache = new Map();
async function embeddedFontCss(fonts) {
  let out = '';
  for (const ft of fonts) {
    if (!embedCache.has(ft.name)) {
      embedCache.set(
        ft.name,
        (async () => {
          let css = await (await fetch(googleUrl([ft]))).text();
          for (const url of new Set(css.match(/https:[^)'"]+/g) || [])) {
            const buf = await (await fetch(url)).arrayBuffer();
            let bin = '';
            const bytes = new Uint8Array(buf);
            for (let k = 0; k < bytes.length; k += 0x8000)
              bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
            css = css.split(url).join(`data:font/woff2;base64,${btoa(bin)}`);
          }
          return css;
        })().catch(() => {
          embedCache.delete(ft.name);
          return '';
        }),
      );
    }
    out += await embedCache.get(ft.name);
  }
  return out;
}

// The drawing as a PNG blob at `scale`, or null (having said why).
async function pngBlob(scale = 2) {
  const g = usedGoogleFonts();
  if (g.length) say('Embedding fonts…');
  const fontCss = await embeddedFontCss(g);
  if (g.length && !fontCss)
    warn('Couldn’t fetch the fonts (are you offline?), so the PNG uses fallback fonts.');
  const url = URL.createObjectURL(
    new Blob([serialize({ fontCss, animate: false })], { type: 'image/svg+xml' }),
  );
  const img = new Image();
  const loaded = await new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  URL.revokeObjectURL(url);
  if (!loaded) {
    warn('Couldn’t export the PNG: the browser couldn’t draw the drawing as an image.');
    return null;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(state.w * scale);
  c.height = Math.round(state.h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  try {
    const b = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!b) warn('Couldn’t export the PNG: the image is too big for this browser.');
    return b;
  } catch {
    warn('Couldn’t export the PNG: the drawing links an image from another site.');
    return null;
  }
}
async function exportPng(scale = 2) {
  const b = await pngBlob(scale);
  if (!b) return;
  download(b, `${state.fileName}.png`);
  say(`Downloaded ${state.fileName}.png.`);
}

async function copySvg() {
  const text = serialize({ selection: state.sel.length > 0, fontCss: fontImport() });
  try {
    await navigator.clipboard.writeText(text);
    say(state.sel.length ? 'Copied the selection as SVG.' : 'Copied the drawing as SVG.');
  } catch {
    warn('Couldn’t reach the clipboard: press Ctrl+C instead.');
  }
}
