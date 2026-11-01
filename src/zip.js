// SVGCraft — Reading and writing zip files.
'use strict';

// ---- zip: stored (uncompressed) entries out; stored or deflated in ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipBlob(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = typeof text === 'string' ? enc.encode(text) : text;
    const fname = enc.encode(name);
    const crc = crc32(data);
    // The fields local and central headers share, from "version needed" on.
    const common = (v, p) => {
      v.setUint16(p, 20, true);
      v.setUint16(p + 2, 0x0800, true); // UTF-8 names
      v.setUint16(p + 4, 0, true); // stored
      v.setUint16(p + 6, time, true);
      v.setUint16(p + 8, date, true);
      v.setUint32(p + 10, crc, true);
      v.setUint32(p + 14, data.length, true);
      v.setUint32(p + 18, data.length, true);
      v.setUint16(p + 22, fname.length, true);
    };
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    common(local, 4);
    parts.push(local.buffer, fname, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    common(cen, 6);
    cen.setUint32(42, offset, true);
    central.push(cen.buffer, fname);
    offset += 30 + fname.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
// [name, bytes] for each file in a zip. Unsupported or oversized entries
// are skipped.
async function unzip(buf) {
  const v = new DataView(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  const out = [];
  let total = 0;
  let p = v.getUint32(e + 16, true);
  for (let i = 0, n = Math.min(v.getUint16(e + 10, true), 2000); i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const skip = nlen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    const at = v.getUint32(p + 42, true);
    p += 46 + skip;
    if (name.endsWith('/') || /(^|\/)__MACOSX\//.test(name) || (total += usize) > 64e6) continue;
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const raw = new Uint8Array(buf, start, csize);
    if (method === 0) out.push([name, raw]);
    else if (method === 8)
      out.push([
        name,
        new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
          ).arrayBuffer(),
        ),
      ]);
  }
  return out;
}

// Export: one zip with the SVGCraft library (everything, for importing
// here) and each kind in formats other apps read.
function exportLibrary() {
  const strip = (xs) =>
    xs.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id')));
  const data = {
    app: 'svgcraft',
    kind: 'library',
    version: 1,
    swatches: strip(lib.swatches),
    gradients: strip(lib.gradients),
    patterns: strip(lib.patterns),
    symbols: strip(lib.symbols),
  };
  const files = [['svgcraft-library.json', JSON.stringify(data, null, 2) + '\n']];
  const readme = [
    'SVGCraft library export',
    '',
    'svgcraft-library.json  Everything, for SVGCraft (Import this zip or this file).',
  ];
  if (lib.swatches.length) {
    files.push(['swatches.gpl', gplText(lib.swatches)]);
    files.push([
      'swatches.css',
      cssVars('swatches', lib.swatches, 'swatch', (x) => libCss(x.c, x.a)),
    ]);
    readme.push(
      'swatches.gpl           Palette for GIMP, Inkscape and Krita.',
      'swatches.css           Swatches as CSS custom properties.',
    );
  }
  if (lib.gradients.length) {
    files.push([
      'gradients.svg',
      sampleSheet('SVGCraft gradients', lib.gradients, 'gradient', {
        w: 160,
        h: 100,
        defs: gradDefMarkup,
        cell: (x, cx, cy, id) =>
          `<rect x="${cx}" y="${cy}" width="160" height="100" rx="6" fill="url(#${id})"/>`,
      }),
    ]);
    files.push(['gradients.css', cssVars('gradients', lib.gradients, 'gradient', cssGradient)]);
    readme.push(
      'gradients.svg          SVG gradients (Inkscape, Illustrator, browsers), with samples.',
      'gradients.css          Gradients as CSS custom properties.',
    );
  }
  if (lib.patterns.length) {
    files.push([
      'patterns.svg',
      sampleSheet('SVGCraft patterns', lib.patterns, 'pattern', {
        w: 120,
        h: 120,
        // The tiles draw in currentColor; the <pattern>'s colour sets it.
        defs: (p, id) =>
          `<pattern id="${id}" data-name="${xmlEsc(p.name)}" patternUnits="userSpaceOnUse" ` +
          `width="${f(p.w)}" height="${f(p.h)}" color="#1f2937">${p.svg}</pattern>`,
        cell: (x, cx, cy, id) =>
          `<rect x="${cx}" y="${cy}" width="120" height="120" fill="url(#${id})" stroke="#cccccc"/>`,
      }),
    ]);
    readme.push('patterns.svg           SVG patterns, with samples. They draw in currentColor.');
  }
  if (lib.symbols.length) {
    files.push(['symbols.svg', spriteSvg(lib.symbols)]);
    readme.push(
      'symbols.svg            SVG sprite: <use href="symbols.svg#id"/> draws one.',
      '                       Built-in icons: Font Awesome Free 6.7.2, CC BY 4.0.',
    );
  }
  files.push(['README.txt', readme.join('\n') + '\n']);
  download(zipBlob(files), 'svgcraft-library.zip');
  say('Exported the library as svgcraft-library.zip.');
}

// A library-shaped object from a file: an SVGCraft zip or JSON library, a
// GIMP palette or gradient, or any SVG. Throws if it's none of those.
async function readLibraryFile(name, buf) {
  const head = new TextDecoder().decode(buf.slice(0, 512)).replace(/^\uFEFF/, '');
  const text = () => new TextDecoder().decode(buf);
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) return readZipLibrary(buf);
  if (/^\s*GIMP Palette/.test(head)) return { swatches: readGpl(text()) };
  if (/^\s*GIMP Gradient/.test(head)) return { gradients: readGgr(text()) };
  if (/^\s*</.test(head)) {
    const r = readSvgLibrary(text(), name);
    if (!r) throw new Error('not SVG');
    return r;
  }
  return JSON.parse(text());
}
// A zip's svgcraft-library.json holds everything; without one, the
// palettes, gradients and SVGs in it are read and added together.
async function readZipLibrary(buf) {
  const entries = await unzip(buf);
  const bytes = (b) => b.slice().buffer;
  const main = entries.find(([n]) => /(^|\/)svgcraft-library\.json$/i.test(n));
  if (main) return JSON.parse(new TextDecoder().decode(main[1]));
  const all = { swatches: [], gradients: [], patterns: [], symbols: [] };
  let found = false;
  for (const [n, b] of entries) {
    if (!/\.(json|gpl|ggr|svg)$/i.test(n)) continue;
    try {
      const r = await readLibraryFile(n.split('/').pop(), bytes(b));
      for (const k of Object.keys(all)) if (Array.isArray(r?.[k])) all[k].push(...r[k]);
      found = true;
    } catch {
      /* not one of ours: skip it */
    }
  }
  if (!found) throw new Error('nothing to import');
  return all;
}

function wireLibraries() {
  for (const bar of document.querySelectorAll('[data-lib]'))
    for (const b of bar.querySelectorAll('[data-lib-act]'))
      b.addEventListener('click', () => {
        const kind = bar.dataset.lib;
        ({
          add: () => addLibItem(kind),
          rename: () => renameLibItem(kind),
          recolour: () => editSwatchColour(),
          global: () => toggleGlobalSwatch(),
          delete: () => removeLibItem(kind),
          export: exportLibrary,
          import: () => $('#sc-lib-file').click(),
          reset: () => resetLib(kind),
          place: () => placeLibSymbol(),
        })[b.dataset.libAct]();
      });
  $('#sc-lib-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importLibrary(e.target.files[0]);
    e.target.value = '';
  });
  renderLibraries();
}
