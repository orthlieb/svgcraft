// SVGCraft — Icon work: pixel grid, Snap to Pixel, keylines, Icon Preview, New Icon.
'use strict';

// ---- icon mode: pixel grid, snap to pixel, keylines, icon preview ----------------
// The pixel grid shows from 600% up, as in Illustrator. It's drawn only
// where the artboard is on screen, with hairlines whatever the zoom.
const PIXEL_GRID_ZOOM = 6;
function drawPixelGrid() {
  const path = $('#sc-pixgrid');
  if (!state.pixelGrid || state.zoom < PIXEL_GRID_ZOOM) return path.setAttribute('d', '');
  const r = stage.getBoundingClientRect();
  const x0 = Math.max(0, Math.floor(-state.panX / state.zoom));
  const y0 = Math.max(0, Math.floor(-state.panY / state.zoom));
  const x1 = Math.min(Math.floor(state.w), Math.ceil((r.width - state.panX) / state.zoom));
  const y1 = Math.min(Math.floor(state.h), Math.ceil((r.height - state.panY) / state.zoom));
  let d = '';
  if (x1 > x0 && y1 > y0) {
    for (let x = x0; x <= x1; x++) d += `M${x} ${y0}V${y1}`;
    for (let y = y0; y <= y1; y++) d += `M${x0} ${y}H${x1}`;
  }
  path.setAttribute('d', d);
}

// Snap to Pixel puts points and edges on whole pixels, or on half pixels
// when a centred stroke of odd whole width would otherwise straddle them,
// so the stroke's own edges land on whole pixels.
const DRAW_TOOLS = new Set(['rect', 'ellipse', 'line', 'pen', 'pencil']);
const oddCentred = (on, w, align) => on && align === 'center' && Number.isInteger(w) && w % 2 === 1;
function pixelOffset(el) {
  if (!el)
    return DRAW_TOOLS.has(state.tool) &&
      oddCentred(state.strokeOn, +state.strokeWidth, state.strokeAlign)
      ? 0.5
      : 0;
  const cs = getComputedStyle(el);
  return oddCentred(
    cs.stroke !== 'none',
    parseFloat(cs.strokeWidth),
    el.getAttribute('data-stroke-align') || 'center',
  )
    ? 0.5
    : 0;
}
const toPixel = (v, o) => Math.round(v - o) + o;

// Keylines (Material's icon grid): a circle, a square and portrait and
// landscape rectangles, centred in the live area, with its diagonals and
// centre lines. The live area is inside the margin guides nearest each
// edge (within a quarter of the artboard), so moving a guide moves them.
function liveArea() {
  const m = Math.round(Math.min(state.w, state.h) / 12);
  const span = (axis, size) => {
    const ps = state.guides.filter((g) => g.axis === axis).map((g) => g.pos);
    const lo = ps.filter((p) => p > 0 && p <= size / 4);
    const hi = ps.filter((p) => p < size && p >= (size * 3) / 4);
    return [lo.length ? Math.max(...lo) : m, hi.length ? Math.min(...hi) : size - m];
  };
  const [x0, x1] = span('x', state.w);
  const [y0, y1] = span('y', state.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function drawKeylines() {
  const g = $('#sc-keylines');
  g.replaceChildren();
  if (!state.keylines) return;
  const a = liveArea();
  if (a.w <= 0 || a.h <= 0) return;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const L = Math.min(a.w, a.h);
  const box = (w, h) =>
    mk(
      'rect',
      {
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
        rx: L / 10,
        class: 'sc-keyline',
      },
      g,
    );
  mk('circle', { cx, cy, r: L / 2, class: 'sc-keyline' }, g);
  box(L * 0.9, L * 0.9);
  box(L * 0.8, L);
  box(L, L * 0.8);
  const line = (x1, y1, x2, y2) => mk('line', { x1, y1, x2, y2, class: 'sc-keyline' }, g);
  line(a.x, a.y, a.x + a.w, a.y + a.h);
  line(a.x + a.w, a.y, a.x, a.y + a.h);
  line(cx, a.y, cx, a.y + a.h);
  line(a.x, cy, a.x + a.w, cy);
}

// Window → Icon Preview: the drawing at icon sizes on a light, dark or
// checkerboard background (or all three). Each is an <img> of the exported
// SVG at that many CSS pixels, so the browser draws it the way a page would.
// The background starts on the app's theme; a choice is remembered.
const ICON_SIZES = [16, 24, 32, 48, 64, 128];
const ICON_BGS = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['checker', 'Transparent'],
];
const iconPrev = { open: false, url: null, timer: 0 };
const ipWin = $('#sc-iconprev');
function buildIconPreview() {
  const body = $('#sc-ip-body');
  if (body.firstChild) return;
  for (const [bg, label] of ICON_BGS) {
    const row = document.createElement('div');
    row.className = `sc-ip-row sc-ip-${bg}`;
    row.dataset.bg = bg;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    for (const size of ICON_SIZES) {
      const b = document.createElement('button');
      b.className = 'sc-ip-tile';
      b.dataset.size = size;
      b.dataset.tip = `${size} × ${size} px on ${label.toLowerCase()}: show the canvas at this size`;
      b.setAttribute('aria-label', `${size} px on ${label.toLowerCase()}`);
      const box = document.createElement('span');
      box.className = 'sc-ip-box';
      box.style.width = box.style.height = `${size}px`;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      box.append(img);
      const cap = document.createElement('span');
      cap.className = 'sc-ip-cap';
      cap.textContent = size;
      b.append(box, cap);
      b.addEventListener('click', () => showAtSize(size));
      row.append(b);
    }
    body.append(row);
  }
}
const IP_BG_KEY = 'svgcraft.iconPreviewBg';
function iconPreviewBg() {
  const v = stored(IP_BG_KEY);
  if (v === 'all' || ICON_BGS.some(([k]) => k === v)) return v;
  return isDark() ? 'dark' : 'light';
}
function setIconPreviewBg(bg, save = true) {
  if (save) store(IP_BG_KEY, bg);
  for (const b of ipWin.querySelectorAll('[data-ip-bg]'))
    b.setAttribute('aria-checked', b.dataset.ipBg === bg);
  for (const row of ipWin.querySelectorAll('.sc-ip-row'))
    row.hidden = bg !== 'all' && row.dataset.bg !== bg;
}
for (const b of ipWin.querySelectorAll('[data-ip-bg]'))
  b.addEventListener('click', () => setIconPreviewBg(b.dataset.ipBg));

// Masks: how platforms crop an app icon. iOS's continuous-corner square is
// close to a 22.37% radius; the squircle is a superellipse (n = 4); Google
// Play rounds by a fifth. Adaptive crop shows the middle 72 of 108 dp, the
// part an Android launcher shows (and masks).
const squircle = (() => {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    pts.push(
      `${f(50 + 50 * Math.sign(c) * Math.abs(c) ** 0.5)} ${f(50 + 50 * Math.sign(sn) * Math.abs(sn) ** 0.5)}`,
    );
  }
  return `<path d="M${pts.join('L')}Z"/>`;
})();
const IP_MASKS = {
  none: '',
  ios: '<rect width="100" height="100" rx="22.37"/>',
  circle: '<circle cx="50" cy="50" r="50"/>',
  squircle,
  rounded: '<rect width="100" height="100" rx="20"/>',
};
const maskUrl = (shape) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="${NS}" viewBox="0 0 100 100" preserveAspectRatio="none">${shape}</svg>`,
  )}")`;
const IP_MASK_KEY = 'svgcraft.iconPreviewMask';
function iconPreviewMask() {
  const [m, crop] = String(stored(IP_MASK_KEY, '')).split(' ');
  if (m in IP_MASKS) return [m, crop === 'crop'];
  return ['none', false];
}
function setIconPreviewMask(mask, crop, save = true) {
  if (save) store(IP_MASK_KEY, `${mask}${crop ? ' crop' : ''}`);
  for (const b of ipWin.querySelectorAll('[data-ip-mask]'))
    b.setAttribute('aria-checked', b.dataset.ipMask === mask);
  $('#sc-ip-crop').checked = crop;
  ipWin.classList.toggle('sc-ip-cropped', crop);
  ipWin.style.setProperty('--ip-mask', IP_MASKS[mask] ? maskUrl(IP_MASKS[mask]) : 'none');
  if (save) renderIconPreview();
}
for (const b of ipWin.querySelectorAll('[data-ip-mask]'))
  b.addEventListener('click', () => setIconPreviewMask(b.dataset.ipMask, $('#sc-ip-crop').checked));
$('#sc-ip-crop').addEventListener('change', (e) =>
  setIconPreviewMask(iconPreviewMask()[0], e.target.checked),
);
function renderIconPreview() {
  if (!iconPrev.open) return;
  buildIconPreview();
  setIconPreviewBg(iconPreviewBg(), false);
  setIconPreviewMask(...iconPreviewMask(), false);
  const old = iconPrev.url;
  iconPrev.url = URL.createObjectURL(new Blob([serialize()], { type: 'image/svg+xml' }));
  const big = Math.max(state.w, state.h) / ($('#sc-ip-crop').checked ? 1.5 : 1);
  for (const img of ipWin.querySelectorAll('.sc-ip-box img')) {
    const size = +img.closest('.sc-ip-tile').dataset.size;
    img.width = Math.max(1, Math.round((size * state.w) / big));
    img.height = Math.max(1, Math.round((size * state.h) / big));
    img.src = iconPrev.url;
  }
  if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
}
function scheduleIconPreview() {
  if (!iconPrev.open) return;
  clearTimeout(iconPrev.timer);
  iconPrev.timer = setTimeout(renderIconPreview, 120);
}
// The canvas with the artboard's longer side at `size` screen pixels.
function showAtSize(size) {
  const r = stage.getBoundingClientRect();
  state.zoom = clamp(size / Math.max(state.w, state.h), 0.02, 64);
  state.panX = (r.width - state.w * state.zoom) / 2;
  state.panY = (r.height - state.h * state.zoom) / 2;
  applyView();
}
// Docked (the default), the preview is a split pane beside the canvas
// (src/dock.js); floating, a window of its own.
const ipDock = makeDockable(ipWin, {
  key: 'svgcraft.iconPreviewDock',
  btn: $('#sc-ip-dock'),
  order: 0,
});
function openIconPreview() {
  iconPrev.open = true;
  ipWin.hidden = false;
  dockOnOpen(ipDock);
  $('[data-action="toggleIconPreview"]').setAttribute('aria-checked', 'true');
  renderIconPreview();
}
function closeIconPreview() {
  if (!iconPrev.open) return;
  iconPrev.open = false;
  clearTimeout(iconPrev.timer);
  ipWin.hidden = true;
  syncDock();
  $('[data-action="toggleIconPreview"]').setAttribute('aria-checked', 'false');
  if (ipWin.contains(document.activeElement)) document.activeElement.blur();
}
const toggleIconPreview = () => (iconPrev.open ? closeIconPreview() : openIconPreview());
dragWindow(ipWin, $('#sc-ip-titlebar'));
$('#sc-ip-close').addEventListener('click', closeIconPreview);
ipWin.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeIconPreview();
});

// File → New Icon…: a square artboard with its margins (and, optionally,
// centre lines) as ordinary guides. Templates follow the platforms' icon
// guidelines: `extra` adds more guides, inset that far from every edge,
// and `mask` / `crop` set up the icon preview the way the platform shows it.
const ICON_TEMPLATES = {
  material: {
    size: 24,
    margin: 2,
    note: 'Material Design system icon: a 20 px live area inside 2 px of padding, with keylines.',
  },
  favicon: {
    size: 32,
    margin: 1,
    note: 'Browser tab icon. Keep it bold: browsers also show it at 16 px.',
  },
  adaptive: {
    mask: 'circle',
    crop: true,
    size: 432,
    margin: 84,
    extra: [72],
    note:
      'Android adaptive launcher icon, 108 dp at 4×. Launchers show the middle 72 dp ' +
      '(guides 72 px in) and mask it to their own shape; keep the logo inside the 66 dp ' +
      'safe zone (guides 84 px in).',
  },
  play: {
    mask: 'rounded',
    size: 512,
    margin: 0,
    note: 'Google Play store icon: full bleed and square. Google Play rounds the corners itself.',
  },
  ios: {
    mask: 'ios',
    size: 1024,
    margin: 0,
    note:
      'iOS app icon: full bleed, square and opaque. iOS rounds the corners itself, so ' +
      'don’t draw them.',
  },
  macos: {
    size: 1024,
    margin: 100,
    note:
      'macOS app icon: an 824 px rounded body (corner radius about 185 px) inside the ' +
      'margin guides, leaving room for its shadow.',
  },
};
const niDlg = $('#sc-newicon');
const niSize = $('#sc-ni-size');
const niMarginEl = $('#sc-ni-margin');
const niTemplate = $('#sc-ni-template');
const niAutoMargin = (s) => Math.max(1, Math.round(s / 12));
let niMarginSet = false;
function setNewIconSize(s, fromTemplate = false) {
  niSize.value = s;
  if (!fromTemplate) {
    niTemplate.value = '';
    $('#sc-ni-note').hidden = true;
    if (!niMarginSet) niMarginEl.value = niAutoMargin(s);
  }
}
function setNewIconTemplate(key) {
  const t = ICON_TEMPLATES[key];
  const note = $('#sc-ni-note');
  if (!t) {
    note.hidden = true;
    return;
  }
  setNewIconSize(t.size, true);
  niMarginEl.value = t.margin;
  niMarginSet = true;
  note.textContent = t.note;
  note.hidden = false;
}
function openNewIcon() {
  niMarginSet = false;
  if (niTemplate.value) setNewIconTemplate(niTemplate.value);
  else setNewIconSize(+niSize.value || 24);
  showDialog(niDlg, () => closeNewIcon(false));
  setTimeout(() => niDlg.querySelector('[data-ni="ok"]').focus(), 0);
}
function closeNewIcon(ok) {
  hideDialog(niDlg);
  if (!ok) return;
  const s = clamp(Math.round(+niSize.value) || 24, 8, 2048);
  const raw = Math.round(+niMarginEl.value);
  const m = clamp(isFinite(raw) ? raw : niAutoMargin(s), 0, Math.ceil(s / 2) - 1);
  const guides = [];
  const inset = [m, ...(ICON_TEMPLATES[niTemplate.value]?.extra || [])].filter(
    (v) => v > 0 && v < s / 2,
  );
  for (const axis of ['x', 'y'])
    for (const v of inset) guides.push({ axis, pos: v }, { axis, pos: s - v });
  if ($('#sc-ni-centre').checked) for (const axis of ['x', 'y']) guides.push({ axis, pos: s / 2 });
  let name = `icon-${s}`;
  for (let n = 2; docs.some((d) => d.name === name); n++) name = `icon-${s}-${n}`;
  state.guidesOn = true;
  syncViewMenu();
  saveView();
  // An untouched Untitled tab gives way to the icon, as with Open.
  const spare = pristine(curDoc) ? curDoc : null;
  newDoc({ w: s, h: s, name, guides });
  if (spare) {
    docs.splice(docs.indexOf(spare), 1);
    renderTabs();
    saveDocs();
  }
  drawPixelGrid();
  if ($('#sc-ni-preview').checked) {
    // A template shows the icon as its platform will mask it.
    const t = ICON_TEMPLATES[niTemplate.value];
    if (t) setIconPreviewMask(t.mask || 'none', !!t.crop);
    openIconPreview();
    fit(); // around the pane, if it docked
  }
  say(`New ${s} × ${s} icon${m > 0 ? `, ${m} px margins as guides` : ''}.`);
}
niSize.addEventListener('input', () => setNewIconSize(+niSize.value));
niMarginEl.addEventListener('input', () => (niMarginSet = true));
niTemplate.addEventListener('change', () => {
  niMarginSet = false;
  setNewIconTemplate(niTemplate.value);
});
niDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('button, select')) {
    e.preventDefault();
    closeNewIcon(true);
  } else if (e.key === 'Escape') closeNewIcon(false);
});
niDlg.querySelector('[data-ni="ok"]').addEventListener('click', () => closeNewIcon(true));
niDlg.querySelector('[data-ni="cancel"]').addEventListener('click', () => closeNewIcon(false));
