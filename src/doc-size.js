// SVGCraft — Image → Image Size… and Canvas Size…
'use strict';

// Image Size scales the artboard and everything on it (guides too), as one
// undo step. It's SVG, so nothing is resampled: each top-level layer gets
// the scale on top of its transform, so strokes, text, patterns and
// gradients scale with the shapes. Layer effects are measured in document
// pixels, so "Scale effects" (on by default, Photoshop's Scale Styles)
// multiplies their distances and sizes too; animation distances always
// follow the art.
const isDlg = $('#sc-imagesize');
const isField = (k) => isDlg.querySelector(`[data-is="${k}"]`);
const FX_SIZES = { ds: ['d', 's'], is: ['d', 's'], og: ['s'], ig: ['s'], bl: ['r'] };

function scaleDocument(sx, sy, effects) {
  exitIso();
  const T = new DOMMatrix().scale(sx, sy);
  for (const el of doc.children) if (el instanceof SVGGraphicsElement) transformDoc(el, T);
  const k = Math.sqrt(sx * sy);
  if (effects)
    for (const el of doc.querySelectorAll('[data-sc-fx]')) {
      const fx = readFx(el);
      for (const [key, props] of Object.entries(FX_SIZES))
        for (const p of props) fx[key][p] = clamp(f(fx[key][p] * k), ...FX_LIMITS[p]);
      writeFx(el, fx);
    }
  for (const el of doc.querySelectorAll('[data-sc-anim]')) {
    const list = readAnims(el);
    for (const a of list) if ('dist' in a) a.dist = f(a.dist * k);
    writeAnims(el, list);
  }
  for (const g of state.guides) g.pos = f(g.pos * (g.axis === 'x' ? sx : sy));
  setSize(state.w * sx, state.h * sy);
  renderGuides();
  fit();
  commit();
}

// The fields show pixels or percent; `ratio` keeps proportions when linked.
const imgSize = { w: 0, h: 0, unit: 'px' };
const isPx = (v, of) => (imgSize.unit === 'pct' ? (v / 100) * of : v);
const isShow = (px, of) => f(imgSize.unit === 'pct' ? (px / of) * 100 : px);
function openImageSize() {
  exitIso();
  imgSize.w = state.w;
  imgSize.h = state.h;
  imgSize.unit = 'px';
  isField('unit').value = 'px';
  isField('w').value = f(state.w);
  isField('h').value = f(state.h);
  isField('was').textContent = `Now ${f(state.w)} × ${f(state.h)} px.`;
  showDialog(isDlg, () => closeImageSize(false));
  setTimeout(() => isField('w').select(), 0);
}
function closeImageSize(ok) {
  if (ok) {
    const w = isPx(+isField('w').value, state.w);
    const h = isPx(+isField('h').value, state.h);
    if (!(w > 0 && h > 0)) return say('Enter a width and height above zero.');
    const nw = clamp(f(w), 1, 20000);
    const nh = clamp(f(h), 1, 20000);
    hideDialog(isDlg);
    if (nw === state.w && nh === state.h) return;
    const was = `${f(state.w)} × ${f(state.h)}`;
    scaleDocument(nw / state.w, nh / state.h, isField('fx').checked);
    say(`Image size: ${was} → ${f(nw)} × ${f(nh)} px.`);
  } else hideDialog(isDlg);
}
for (const k of ['w', 'h'])
  isField(k).addEventListener('input', () => {
    if (!isField('lock').checked) return;
    const other = k === 'w' ? 'h' : 'w';
    const v = +isField(k).value;
    if (!(v > 0)) return;
    // Same proportion: in percent it's the same number.
    const px = isPx(v, state[k]);
    isField(other).value = isShow((px / state[k]) * state[other], state[other]);
  });
isField('unit').addEventListener('change', () => {
  const w = isPx(+isField('w').value, state.w);
  const h = isPx(+isField('h').value, state.h);
  imgSize.unit = isField('unit').value;
  isField('w').value = isShow(w, state.w);
  isField('h').value = isShow(h, state.h);
});

// Canvas Size changes the artboard without scaling anything. The anchor
// says which part stays put: centre (the default) grows or trims every
// side equally; a corner or edge keeps that side fixed. Content and
// guides shift by whole pixels, and the view follows so nothing jumps.
// Anything left outside the artboard is kept, just not exported.
const cvDlg = $('#sc-canvassize');
const cvField = (k) => cvDlg.querySelector(`[data-cv="${k}"]`);
const canvasSize = { ax: 0.5, ay: 0.5 };
function resizeCanvas(nw, nh, ax, ay) {
  exitIso();
  const dx = Math.round((nw - state.w) * ax);
  const dy = Math.round((nh - state.h) * ay);
  if (dx || dy) {
    const T = new DOMMatrix().translate(dx, dy);
    for (const el of doc.children) if (el instanceof SVGGraphicsElement) transformDoc(el, T);
    for (const g of state.guides) g.pos = f(g.pos + (g.axis === 'x' ? dx : dy));
  }
  setSize(nw, nh);
  state.panX -= dx * state.zoom;
  state.panY -= dy * state.zoom;
  renderGuides();
  applyView();
  commit();
}
function syncAnchor() {
  for (const b of cvDlg.querySelectorAll('[data-cv-anchor]')) {
    const [x, y] = b.dataset.cvAnchor.split(',').map(Number);
    b.setAttribute('aria-checked', x === canvasSize.ax && y === canvasSize.ay);
  }
}
function openCanvasSize() {
  exitIso();
  canvasSize.ax = canvasSize.ay = 0.5;
  cvField('rel').checked = false;
  cvField('w').value = f(state.w);
  cvField('h').value = f(state.h);
  cvField('was').textContent = `Now ${f(state.w)} × ${f(state.h)} px.`;
  syncAnchor();
  showDialog(cvDlg, () => closeCanvasSize(false));
  setTimeout(() => cvField('w').select(), 0);
}
function closeCanvasSize(ok) {
  if (ok) {
    const rel = cvField('rel').checked;
    const nw = Math.round((rel ? state.w : 0) + (+cvField('w').value || 0));
    const nh = Math.round((rel ? state.h : 0) + (+cvField('h').value || 0));
    if (!(nw >= 1 && nh >= 1 && nw <= 20000 && nh <= 20000))
      return say('The canvas must be 1 to 20,000 px each way.');
    hideDialog(cvDlg);
    if (nw === state.w && nh === state.h) return;
    const was = `${f(state.w)} × ${f(state.h)}`;
    resizeCanvas(nw, nh, canvasSize.ax, canvasSize.ay);
    say(`Canvas size: ${was} → ${nw} × ${nh} px.`);
  } else hideDialog(cvDlg);
}
// Relative: the fields say how much to add (or, negative, trim).
cvField('rel').addEventListener('change', () => {
  const rel = cvField('rel').checked;
  for (const k of ['w', 'h'])
    cvField(k).value = f((+cvField(k).value || 0) + (rel ? -state[k] : state[k]));
});
for (const b of cvDlg.querySelectorAll('[data-cv-anchor]'))
  b.addEventListener('click', () => {
    [canvasSize.ax, canvasSize.ay] = b.dataset.cvAnchor.split(',').map(Number);
    syncAnchor();
  });

for (const [dlg, close, btn] of [
  [isDlg, closeImageSize, 'data-is-btn'],
  [cvDlg, closeCanvasSize, 'data-cv-btn'],
]) {
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest(`[${btn}="cancel"], [data-cv-anchor], select`)) {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Escape') close(false);
  });
  dlg.querySelector(`[${btn}="ok"]`).addEventListener('click', () => close(true));
  dlg.querySelector(`[${btn}="cancel"]`).addEventListener('click', () => close(false));
}
