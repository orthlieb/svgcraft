// SVGCraft — The phone preview's extras: layers to show and hide while
// looking, the backdrop, the drawing's info, sharing, and double-tap /
// swipe gestures. (▶ Play is the usual toggleAnimations.) None of them
// changes the drawing.
'use strict';

// ---- Layers: show and hide in the preview, never saved ---------------------
// A layer shown or hidden here carries data-sc-peek="show" / "hide", which
// style.css applies over the file's own display and serialize() leaves
// out. Switching tab or leaving the preview drops them.
const peekDlg = $('#sc-peek');
function peekShown(el) {
  const p = el.getAttribute('data-sc-peek');
  return p ? p === 'show' : el.getAttribute('display') !== 'none';
}
// The layers the list shows: each level's, and inside groups.
const peekable = (parent) =>
  [...parent.children]
    .filter(selectable)
    .flatMap((el) => [el, ...(el.localName === 'g' ? peekable(el) : [])]);
function setPeek(el, show) {
  // Back to how the file has it: no mark needed.
  if (show === (el.getAttribute('display') !== 'none')) el.removeAttribute('data-sc-peek');
  else el.setAttribute('data-sc-peek', show ? 'show' : 'hide');
}
// The list is rebuilt after every tap, at the same scroll position (a jump
// back to the top put the next tap on a different layer). A layer inside a
// hidden group is dimmed: it can't show until the group does.
function renderPeek() {
  const ul = $('#sc-peek-list');
  const scroll = ul.scrollTop;
  ul.replaceChildren();
  // Previews are always on the checkerboard, as in the Layers panel, whatever
  // the canvas's Background.
  const walk = (parent, depth, under) => {
    for (const el of [...parent.children].filter(selectable).reverse()) {
      const li = document.createElement('li');
      li.style.paddingLeft = `${8 + depth * 16}px`;
      const b = document.createElement('button');
      b.className = 'sc-peek-eye';
      const shown = peekShown(el);
      b.innerHTML = icon(shown ? 'eye' : 'eye-slash');
      b.setAttribute('aria-pressed', shown);
      b.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${layerName(el)}`);
      b.addEventListener('click', () => {
        setPeek(el, !peekShown(el));
        renderPeek();
      });
      // A preview of the layer, as in the Layers panel, drawn whether or not
      // it's hidden here (it fills in just after the list appears).
      const thumb = pendingThumb(el);
      const name = document.createElement('span');
      name.textContent = layerName(el);
      li.classList.toggle('off', !shown);
      li.classList.toggle('under', under);
      li.append(b, thumb, name);
      ul.append(li);
      if (el.localName === 'g') walk(el, depth + 1, under || !shown);
    }
  };
  walk(doc, 0, false);
  ul.scrollTop = scroll;
  fillThumbs(ul);
  if (!ul.children.length) {
    const li = document.createElement('li');
    li.className = 'sc-hint';
    li.textContent = 'This drawing has no layers.';
    ul.append(li);
  }
}
function peekLayers() {
  if (!curDoc) return;
  renderPeek();
  showDialog(peekDlg);
}
function clearPeeks() {
  for (const el of doc.querySelectorAll('[data-sc-peek]')) el.removeAttribute('data-sc-peek');
}
// Show all (including what the file hides) or hide all, every level.
for (const [what, show] of [
  ['all', true],
  ['none', false],
])
  peekDlg.querySelector(`[data-peek="${what}"]`).addEventListener('click', () => {
    for (const el of peekable(doc)) setPeek(el, show);
    renderPeek();
  });
peekDlg.querySelector('[data-peek="close"]').addEventListener('click', () => hideDialog(peekDlg));

// ---- the backdrop behind the artwork: checkerboard, white or black ---------
const PREVIEW_BG_KEY = 'svgcraft.previewBg';
const PREVIEW_BGS = ['checker', 'white', 'black'];
// The button shows the backdrop it's on: a checkered circle, a white one
// ringed in black, or a black one ringed in white.
const PREVIEW_BG_ICON = {
  checker:
    '<defs><pattern id="sc-bg-chk" width="4" height="4" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="4" fill="#fff"/><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="#9a9a9a"/>' +
    '</pattern></defs><circle cx="8" cy="8" r="6.5" fill="url(#sc-bg-chk)" stroke="#9a9a9a"/>',
  white: '<circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#000" stroke-width="1.5"/>',
  black: '<circle cx="8" cy="8" r="6.5" fill="#000" stroke="#fff" stroke-width="1.5"/>',
};
const PREVIEW_BG_NAME = { checker: 'checkerboard', white: 'white', black: 'black' };
function setPreviewBg(bg) {
  if (!PREVIEW_BGS.includes(bg)) bg = 'checker';
  $('#sc-stage-wrap').dataset.bg = bg;
  store(PREVIEW_BG_KEY, bg === 'checker' ? null : bg);
  const b = $('[data-action="previewBg"]');
  b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${PREVIEW_BG_ICON[bg]}</svg>`;
  b.setAttribute('aria-label', `Background: ${PREVIEW_BG_NAME[bg]}`);
  b.dataset.tip = `Background: ${PREVIEW_BG_NAME[bg]} (tap for the next)`;
}
function previewBg() {
  const now = $('#sc-stage-wrap').dataset.bg || 'checker';
  const next = PREVIEW_BGS[(PREVIEW_BGS.indexOf(now) + 1) % PREVIEW_BGS.length];
  setPreviewBg(next);
  say(`Background: ${PREVIEW_BG_NAME[next]}.`);
}
setPreviewBg(stored(PREVIEW_BG_KEY, 'checker'));

// ---- Info: the drawing's details and its metadata (File Info's), to read ----
const infoSheet = $('#sc-pinfo');
const COPYRIGHT = { true: 'Copyrighted', false: 'Public domain' };
function phoneInfo() {
  const m = state.meta || {};
  const svg = serialize({ fontCss: fontImport() });
  const all = [...doc.querySelectorAll('*')].filter(selectable);
  const anims = doc.querySelectorAll('[data-sc-anim]').length;
  const lic = m.license === 'arr' ? 'arr' : licenceKey(m.license);
  const licName = lic ? $(`#sc-fileinfo option[value="${lic}"]`)?.textContent : m.license || '';
  const sections = [
    [
      'Drawing',
      [
        ['File', `${state.fileName}.svg`],
        ['Size', kb(new Blob([svg]).size)],
        ['Dimensions', `${inUnits(state.w)} × ${inUnits(state.h)} ${state.units}`],
        ['Layers', `${items().length} (${all.length} in all)`],
        ['Animations', anims ? String(anims) : ''],
        ['Fonts', docFamilies().join(', ')],
      ],
    ],
    [
      'Metadata',
      [
        ['Title', m.title],
        ['Author', m.creator],
        ['Description', m.description],
        ['Keywords', (m.keywords || []).join(', ')],
        ['Date', m.date],
        ['Copyright', COPYRIGHT[m.marked] || ''],
        ['Rights', m.rights],
        ['Licence', licName, lic === 'arr' ? '' : LICENCES[lic]?.url || m.license],
        ['Source', m.source, m.source],
        ['Language', m.language],
      ],
    ],
  ];
  const body = $('#sc-pinfo-body');
  body.replaceChildren();
  for (const [head, rows] of sections) {
    const h = document.createElement('span');
    h.className = 'sc-subhead';
    h.textContent = head;
    const dl = document.createElement('dl');
    for (const [k, v, href] of rows) {
      if (!v) continue;
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      if (href && /^https?:\/\//.test(href)) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = v;
        dd.append(a);
      } else dd.textContent = v;
      dl.append(dt, dd);
    }
    if (!dl.children.length) {
      const p = document.createElement('p');
      p.className = 'sc-hint';
      p.textContent =
        'None in this file. File Info on a bigger screen adds a title, author and licence.';
      body.append(h, p);
    } else body.append(h, dl);
  }
  showDialog(infoSheet, () => hideDialog(infoSheet));
}
$('#sc-pinfo-close').addEventListener('click', () => hideDialog(infoSheet));
$('#sc-pinfo-about').addEventListener('click', () => {
  hideDialog(infoSheet);
  actions.about();
});

// ---- Share: the phone's share sheet, with the SVG and a PNG of it -----------
async function shareDoc() {
  if (!curDoc) return;
  const name = state.fileName;
  const svg = new File([serialize({ fontCss: fontImport() })], `${name}.svg`, {
    type: 'image/svg+xml',
  });
  if (!navigator.canShare?.({ files: [svg] })) {
    download(svg, `${name}.svg`);
    return say('This browser can’t share files, so the SVG was downloaded instead.');
  }
  // Messages and photo apps take a PNG where they won't take an SVG.
  const png = await pngBlob(2);
  const pngFile = png && new File([png], `${name}.png`, { type: 'image/png' });
  const files = pngFile && navigator.canShare({ files: [svg, pngFile] }) ? [svg, pngFile] : [svg];
  try {
    await navigator.share({ files, title: state.meta.title || `${name}.svg` });
  } catch (err) {
    if (err.name !== 'AbortError') say(`Couldn’t share: ${err.message}`);
  }
}

// ---- gestures --------------------------------------------------------------
// Double-tap the canvas: zoom in on that spot (to 100%, or twice the fit
// when the drawing is small), and double-tap again to fit.
const fitZoom = () => {
  const r = stage.getBoundingClientRect();
  const pad = Math.min(48, r.width * 0.06);
  return clamp(Math.min((r.width - pad * 2) / state.w, (r.height - pad * 2) / state.h), 0.02, 64);
};
let lastTap = null;
stage.addEventListener('pointerup', (e) => {
  if (!previewMode || !curDoc) return;
  const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  const prev = lastTap;
  lastTap = now;
  if (!prev || now.t - prev.t > 350 || Math.hypot(now.x - prev.x, now.y - prev.y) > 30) return;
  lastTap = null;
  const fz = fitZoom();
  if (Math.abs(state.zoom - fz) > fz * 0.01) return fit();
  const r = stage.getBoundingClientRect();
  zoomAt(fz < 1 ? 1 : fz * 2, e.clientX - r.left, e.clientY - r.top);
});
// A pan or pinch in between isn't a tap.
stage.addEventListener('pointermove', (e) => {
  if (lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > 30) lastTap = null;
});

// Swipe along the tab bar: the next or previous drawing. While the tabs
// fit, sideways touches are ours (touch-action: pan-y), not the browser's
// scrolling; once they overflow, the bar scrolls as usual and swiping is off.
const tabBar = $('#sc-doctabs');
function syncSwipe() {
  tabBar.style.touchAction = previewMode && tabBar.scrollWidth <= tabBar.clientWidth ? 'pan-y' : '';
}
new ResizeObserver(syncSwipe).observe(tabBar);
new MutationObserver(syncSwipe).observe(tabBar, { childList: true });
let swipe = null;
tabBar.addEventListener('pointerdown', (e) => {
  swipe = previewMode ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
});
tabBar.addEventListener('pointercancel', () => (swipe = null));
tabBar.addEventListener('pointerup', (e) => {
  const s = swipe;
  swipe = null;
  if (!s || docs.length < 2 || tabBar.scrollWidth > tabBar.clientWidth) return;
  const dx = e.clientX - s.x;
  if (Math.abs(dx) < 60 || Math.abs(e.clientY - s.y) > 40 || e.timeStamp - s.t > 600) return;
  const i = docs.indexOf(curDoc) + (dx < 0 ? 1 : -1);
  if (i < 0 || i >= docs.length) return;
  switchDoc(docs[i]);
  // The click that ends the swipe isn't a tap on a tab.
  const swallow = new AbortController();
  tabBar.addEventListener(
    'click',
    (c) => {
      c.stopPropagation();
      c.preventDefault();
    },
    { capture: true, once: true, signal: swallow.signal },
  );
  setTimeout(() => swallow.abort(), 400);
});
