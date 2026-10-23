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

async function exportPng(scale = 2) {
  const g = usedGoogleFonts();
  if (g.length) say('Embedding fonts…');
  const fontCss = await embeddedFontCss(g);
  if (g.length && !fontCss)
    say('Could not fetch the fonts (offline?) — the PNG uses fallback fonts.');
  const url = URL.createObjectURL(
    new Blob([serialize({ fontCss, animate: false })], { type: 'image/svg+xml' }),
  );
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(state.w * scale);
    c.height = Math.round(state.h * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    try {
      c.toBlob(
        (b) => (b ? download(b, `${state.fileName}.png`) : say('PNG export failed')),
        'image/png',
      );
    } catch {
      say('PNG export blocked — the drawing references an external image.');
    }
  };
  img.onerror = () => say('PNG export failed');
  img.src = url;
}

async function copySvg() {
  const text = serialize({ selection: state.sel.length > 0, fontCss: fontImport() });
  try {
    await navigator.clipboard.writeText(text);
    say(state.sel.length ? 'Copied the selection as SVG' : 'Copied the drawing as SVG');
  } catch {
    say('Clipboard unavailable');
  }
}
