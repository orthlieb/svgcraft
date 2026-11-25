// SVGCraft — File → New from PDF…: preview a PDF's pages, pick one, and
// open it as a new drawing: shapes with editable text, shapes with the text
// as outlines, or a picture of the page. pdf.js (vendor/pdf.min.js, loaded
// the first time) reads the PDF; its SVG renderer draws the page as shapes.
// What that renderer can't do is skipped and named in a warning.
'use strict';

const PDF_SCALE = 96 / 72; // PDF points → CSS pixels: the page at its real size.
const PDF_THUMBS = 200; // pages previewed
async function pdfLib() {
  await loadModule('vendor/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return lib;
}

const pdfDlg = $('#sc-pdfnew');
const pdfPages = $('#sc-pdf-pages');
const pdfState = { pdf: null, name: '', page: 1, gen: 0 };

// File → New from PDF…: pick a PDF, then its pages.
function newFromPdf() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', () => input.files[0] && openPdfFile(input.files[0]));
  input.click();
}
async function openPdfFile(file) {
  let lib;
  try {
    lib = await pdfLib();
  } catch {
    return warn('The PDF reader couldn’t be loaded. Check the connection and try again.');
  }
  let pdf;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await lib.getDocument({
      data,
      fontExtraProperties: true,
      isOffscreenCanvasSupported: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    return warn(
      /password/i.test(e?.name || e?.message)
        ? `${file.name} is protected with a password, which SVGCraft can’t open.`
        : `${file.name} couldn’t be read as a PDF.`,
    );
  }
  pdfState.pdf?.destroy();
  pdfState.pdf = pdf;
  pdfState.name = file.name.replace(/\.pdf$/i, '');
  pdfState.page = 1;
  const gen = ++pdfState.gen;
  $('#sc-pdf-file').textContent =
    `${file.name}: ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}` +
    (pdf.numPages > PDF_THUMBS ? ` (the first ${PDF_THUMBS} shown)` : '');
  pdfPages.replaceChildren();
  const n = Math.min(pdf.numPages, PDF_THUMBS);
  for (let i = 1; i <= n; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sc-pdf-page';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', i === 1);
    b.dataset.page = i;
    b.setAttribute('aria-label', `Page ${i}`);
    b.innerHTML = `<canvas width="1" height="1"></canvas><span>${i}</span>`;
    b.addEventListener('click', () => pickPdfPage(i));
    b.addEventListener('dblclick', () => importPdfPage());
    pdfPages.append(b);
  }
  syncPdfNote();
  showDialog(pdfDlg, closePdfDialog);
  setTimeout(() => $('#sc-pdf-open').focus(), 0);
  // The previews, one after another, while the dialog is open.
  for (let i = 1; i <= n && gen === pdfState.gen && pdfDlg.open; i++) {
    try {
      const page = await pdf.getPage(i);
      const v0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(140 / v0.width, 180 / v0.height) * 2 });
      const c = pdfPages.querySelector(`[data-page="${i}"] canvas`);
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    } catch {
      /* a page that won't draw keeps its blank preview */
    }
  }
}
function pickPdfPage(i) {
  pdfState.page = i;
  for (const b of pdfPages.children) b.setAttribute('aria-selected', +b.dataset.page === i);
}
function closePdfDialog() {
  hideDialog(pdfDlg);
  pdfState.gen++;
}
// Arrow keys move through the pages, Enter opens the one picked.
pdfPages.addEventListener('keydown', (e) => {
  const cols = Math.max(
    1,
    Math.round(pdfPages.clientWidth / (pdfPages.firstElementChild?.offsetWidth || 1)),
  );
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (!step) return;
  e.preventDefault();
  const n = pdfPages.children.length;
  const i = clamp(pdfState.page + step, 1, n);
  pickPdfPage(i);
  pdfPages.children[i - 1].focus();
});
$('#sc-pdf-cancel').addEventListener('click', closePdfDialog);
$('#sc-pdf-open').addEventListener('click', () => importPdfPage());
for (const r of pdfDlg.querySelectorAll('input[name="sc-pdf-as"]'))
  r.addEventListener('change', syncPdfNote);
function syncPdfNote() {
  const as = pdfDlg.querySelector('input[name="sc-pdf-as"]:checked').value;
  $('#sc-pdf-note').textContent = {
    text: 'Shapes you can edit, and text you can retype. Text shows in the font named in the PDF if it’s on this device, else a similar one.',
    outlines:
      'Shapes you can edit, with the text as shapes too, drawn from the PDF’s own fonts: it looks as it did, but can’t be retyped.',
    picture:
      'One image of the whole page, exactly as it looks. Nothing in it can be edited as shapes.',
  }[as];
}

// The page as a new drawing.
async function importPdfPage() {
  const pdf = pdfState.pdf;
  if (!pdf) return;
  const as = pdfDlg.querySelector('input[name="sc-pdf-as"]:checked').value;
  const n = pdfState.page;
  const name = `${pdfState.name}${pdf.numPages > 1 ? ` p${n}` : ''}`;
  closePdfDialog();
  say(`Reading page ${n}…`);
  let out;
  try {
    const page = await pdf.getPage(n);
    out = as === 'picture' ? await pdfPicture(page) : await pdfShapes(page, as === 'outlines');
  } catch (e) {
    return warn(
      `Page ${n} couldn’t be turned into shapes (${e?.message || e}). Try New from PDF again with “A picture of the page”.`,
    );
  }
  const vb = out.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  newDoc({ name, w: vb ? Math.round(+vb[1]) : 800, h: vb ? Math.round(+vb[2]) : 600 });
  openSvg(out.svg, `${name}.svg`);
  fit();
  if (out.lost.length)
    warn(
      `Page ${n} opened, but some of it may not have come across: ${out.lost.join('; ')}. For an exact copy, open it as a picture of the page.`,
    );
  else say(`Page ${n} of ${pdfState.name}.pdf opened as a new drawing.`);
}

// A picture of the page: one image, at twice the page's size for sharpness.
async function pdfPicture(page) {
  const vp = page.getViewport({ scale: PDF_SCALE * 2 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const w = +(vp.width / 2).toFixed(2);
  const h = +(vp.height / 2).toFixed(2);
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
      `<image data-name="Page" width="${w}" height="${h}" href="${c.toDataURL('image/png')}"/></svg>`,
    lost: [],
  };
}

// The page as shapes, through pdf.js's SVG renderer (no longer developed
// upstream, so each drawing operation is guarded: one it can't do is
// skipped and noted, rather than losing the page).
async function pdfShapes(page, outlines) {
  const lib = window.pdfjsLib;
  const notes = new Set();
  const note = (m) => notes.add(m);
  // pdf.js reports what it skips as warnings: listen while it draws.
  const ow = console.warn;
  const ol = console.log;
  const hear = (...a) => {
    const m = a.join(' ');
    if (/BM\b/.test(m)) note('blend modes (Multiply, Screen and the like)');
    else if (/SMask|beginGroup|endGroup/.test(m)) note('soft masks and transparency groups');
    else if (/shading/i.test(m)) note('some gradients');
    else if (/Unimplemented operator (\w+)/.test(m)) note('some drawing operations');
  };
  console.warn = hear;
  console.log = hear;
  let svgEl;
  try {
    const vp = page.getViewport({ scale: PDF_SCALE });
    const ops = await page.getOperatorList();
    const gfx = new lib.SVGGraphics(page.commonObjs, page.objs, true);
    gfx.embedFonts = false;
    for (const op of [...Object.keys(lib.OPS), '_makeShadingPattern']) {
      const fn = gfx[op];
      if (typeof fn !== 'function') continue;
      gfx[op] = (...args) => {
        try {
          return fn.apply(gfx, args);
        } catch {
          if (op === '_makeShadingPattern') {
            note('some gradients (left out)');
            return 'none';
          }
          note(/image/i.test(op) ? 'some images' : 'some drawing operations');
          return undefined;
        }
      };
    }
    svgEl = await gfx.getSVG(ops, vp);
  } finally {
    console.warn = ow;
    console.log = ol;
  }
  // Text: real letters (pdf.js writes its own codes for each glyph), or the
  // glyphs' outlines from the PDF's fonts.
  const fontOf = (id) => {
    try {
      return page.commonObjs.get(id);
    } catch {
      return null;
    }
  };
  if (outlines) await loadModule('vendor/opentype.min.js');
  const parsed = new Map();
  for (const ts of [...svgEl.querySelectorAll('tspan')]) {
    const font = fontOf(ts.getAttribute('font-family'));
    if (!font) continue;
    if (outlines && textOutline(ts, font, parsed)) continue;
    if (outlines) note('text in some fonts stayed text');
    if (font.isType3Font) note('text drawn with Type 3 fonts');
    realText(ts, font);
  }
  for (const t of [...svgEl.querySelectorAll('text')]) if (!t.querySelector('tspan')) t.remove();
  const annots = await page.getAnnotations().catch(() => []);
  if (annots.length) note('links, form fields and notes on the page');
  return { svg: new XMLSerializer().serializeToString(svgEl), lost: [...notes] };
}

// A tspan's glyph codes back to the letters they stand for, in the font
// the PDF names (its subset tag dropped), falling back to one like it.
function realText(ts, font) {
  const back = new Map();
  for (const [code, ch] of Object.entries(font.toFontChar || {})) back.set(ch, +code);
  const uni = font.toUnicode?._map || [];
  const size = parseFloat(ts.getAttribute('font-size')) || 12;
  const xs = (ts.getAttribute('x') || '').split(/\s+/).filter(Boolean).map(Number);
  const chars = [];
  const at = [];
  [...ts.textContent].forEach((c, i) => {
    const code = back.has(c.codePointAt(0)) ? back.get(c.codePointAt(0)) : c.codePointAt(0);
    // A PDF draws no glyph for a space, just a gap: put the space back
    // where the gap after a letter is wider than an eighth of the size
    // (a word space is about a quarter; kerning far less).
    const prev = i > 0 && xs.length > i ? xs[i - 1] : null;
    const adv = (font.widths?.[chars.code ?? -1] ?? 500) * (size / 1000);
    if (prev != null && xs[i] - (prev + adv) > size * 0.125) {
      chars.push(' ');
      at.push(+(prev + adv).toFixed(2));
    }
    chars.code = code;
    chars.push(uni[code] ?? String.fromCodePoint(code));
    if (xs.length > i) at.push(xs[i]);
  });
  ts.textContent = chars.join('');
  if (at.length === chars.length) ts.setAttribute('x', at.join(' '));
  const raw = (font.name || '').replace(/^[A-Z]{6}\+/, '');
  const [fam, style = ''] = raw.split(/[-,]/);
  const family = fam.replace(/(MT|PS|Std)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const generic = font.isMonospace ? 'monospace' : font.isSerifFont ? 'serif' : 'sans-serif';
  ts.setAttribute('font-family', family ? `'${family}', ${generic}` : generic);
  if (/bold|black|heavy|semibold/i.test(style)) ts.setAttribute('font-weight', 'bold');
  if (/italic|oblique/i.test(style)) ts.setAttribute('font-style', 'italic');
}

// A tspan as a path of its glyphs, drawn from the PDF's own font with
// opentype.js; false when the font can't be read.
function textOutline(ts, font, parsed) {
  if (!font.data || font.isType3Font) return false;
  let ot = parsed.get(font);
  if (ot === undefined) {
    try {
      const d = font.data;
      ot = window.opentype.parse(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    } catch {
      ot = null;
    }
    parsed.set(font, ot);
  }
  if (!ot) return false;
  const size = parseFloat(ts.getAttribute('font-size')) || 12;
  const xs = (ts.getAttribute('x') || '0').split(/\s+/).map(Number);
  const y = parseFloat(ts.getAttribute('y')) || 0;
  let d = '';
  [...ts.textContent].forEach((ch, i) => {
    const g = ot.charToGlyph(ch);
    d += g.getPath(xs[i] ?? xs.at(-1), y, size).toPathData(2);
  });
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d || 'M0 0');
  p.setAttribute('fill', ts.getAttribute('fill') || '#000');
  const text = ts.parentNode;
  if (text.getAttribute('transform')) p.setAttribute('transform', text.getAttribute('transform'));
  text.before(p);
  ts.remove();
  return true;
}
