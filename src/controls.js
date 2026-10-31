// SVGCraft — Grid, snap, theme and the remaining controls (commands and
// the menu bar are in actions.js, the panels in panels.js).
'use strict';

// Grid / snap / theme -----------------------------------------------------
function setGridOn(on) {
  state.grid = on;
  $('#sc-grid').checked = on;
  $('[data-action="toggleGrid"]').setAttribute('aria-checked', on);
  setGrid();
}
function setSnapOn(on) {
  state.snap = on;
  $('#sc-snap').checked = on;
  $('[data-action="toggleSnap"]').setAttribute('aria-checked', on);
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : darkQuery.matches;
};
function setTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  store(THEME_KEY, mode === 'system' ? null : mode);
  syncTheme();
}
function syncTheme() {
  const mode = document.documentElement.dataset.theme || 'system';
  for (const b of document.querySelectorAll('[data-theme-opt]'))
    b.setAttribute('aria-checked', b.dataset.themeOpt === mode);
  const btn = $('#sc-theme-btn');
  btn.firstElementChild.innerHTML = icon(isDark() ? 'sun' : 'moon');
  btn.dataset.tip = isDark() ? 'Switch to light' : 'Switch to dark';
  drawRulers();
}
darkQuery.addEventListener('change', syncTheme);

// Dropping on the empty part of the Layers list sends layers to the back.
const layerList = $('#sc-layers');
layerList.addEventListener('dragover', (e) => {
  if (!dragEls || e.target !== layerList) return;
  e.preventDefault();
  clearDropMarks();
  layerList.classList.add('drop-end');
});
layerList.addEventListener('dragleave', (e) => {
  if (e.target === layerList) layerList.classList.remove('drop-end');
});
layerList.addEventListener('drop', (e) => {
  if (!dragEls || e.target !== layerList) return;
  e.preventDefault();
  moveLayers(dragEls, null, 'end');
});

for (const b of document.querySelectorAll('[data-autosel]')) {
  b.addEventListener('click', () => {
    state.autoSelect = b.dataset.autosel;
    for (const x of document.querySelectorAll('[data-autosel]'))
      x.setAttribute('aria-checked', x === b);
  });
  b.setAttribute('aria-checked', b.dataset.autosel === state.autoSelect);
}

// Remaining controls ------------------------------------------------------
const zoomInput = $('#sc-zoom-input');
zoomInput.addEventListener('change', () => {
  const v = parseFloat(zoomInput.value);
  if (v > 0) zoomAt(v / 100);
  else updateTitle();
});
zoomInput.addEventListener('keydown', (e) => {
  // Swallow the key: focus may move to the canvas text editor while it's handled.
  if (e.key === 'Enter') {
    e.preventDefault();
    zoomInput.blur();
  }
});
for (const id of ['#sc-w', '#sc-h']) {
  $(id).addEventListener('change', () => {
    setSize(fromUnits($('#sc-w').value), fromUnits($('#sc-h').value));
    commit();
  });
}
$('#sc-grid').addEventListener('change', (e) => setGridOn(e.target.checked));
$('#sc-snap').addEventListener('change', (e) => setSnapOn(e.target.checked));
$('#sc-pixgrid-on').addEventListener('change', () => toggleView('pixelGrid'));
$('#sc-snappix-on').addEventListener('change', () => toggleView('snapPixel'));
$('#sc-grid-size').addEventListener('change', (e) => {
  state.gridSize = clamp(fromUnits(e.target.value) || 20, 2, 500);
  syncUnits();
  setGrid();
});
$('#sc-panel-toggle').addEventListener('click', (e) => {
  const open = $('#sc-panel').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});
for (const b of document.querySelectorAll('[data-tool]'))
  b.addEventListener('click', () => setTool(b.dataset.tool));
for (const b of document.querySelectorAll('[data-node-cmd]')) {
  b.addEventListener('click', () => {
    const n = tools.node;
    const c = b.dataset.nodeCmd;
    if (c === 'delete') n.removePicked();
    else if (c === 'close') n.toggleClosed();
    else n.setKind(c);
  });
}
for (const b of document.querySelectorAll('[data-eraser]')) {
  b.addEventListener('click', () => {
    state.eraserMode = b.dataset.eraser;
    for (const x of document.querySelectorAll('[data-eraser]'))
      x.setAttribute('aria-checked', x === b);
  });
}
// Edit Points picks points with a rectangle, an ellipse or a lasso, chosen
// from its toolbar flyout like the Shape tools (remembered). Shift+A steps
// through them.
const MARQUEE_KEY = 'svgcraft.pointMarquee';
// arrow picks one point at a time (Shift adds), as Direct Selection does.
const MARQUEES = {
  arrow: 'Point Select',
  rect: 'Rectangle Select',
  oval: 'Ellipse Select',
  lasso: 'Lasso Select',
};
const nodeBtn = $('#sc-node-btn');
const nodeFlyout = toolFlyout(nodeBtn, $('#sc-node-menu'));
function setMarquee(shape, save) {
  state.marquee = MARQUEES[shape] ? shape : 'rect';
  for (const b of document.querySelectorAll('[data-marquee]'))
    b.setAttribute('aria-checked', b.dataset.marquee === state.marquee);
  nodeBtn.dataset.tip = `Edit points · ${MARQUEES[state.marquee]}`;
  if (save) store(MARQUEE_KEY, state.marquee === 'rect' ? null : state.marquee);
  syncCursor();
}
for (const b of document.querySelectorAll('[data-marquee]'))
  b.addEventListener('click', () => {
    nodeFlyout.close();
    setMarquee(b.dataset.marquee, true);
    setTool('node');
  });
function marqueeKey(next) {
  const all = Object.keys(MARQUEES);
  if (next && state.tool === 'node')
    setMarquee(all[(all.indexOf(state.marquee) + 1) % all.length], true);
  setTool('node');
}
setMarquee(stored(MARQUEE_KEY));
for (const el of document.querySelectorAll('[data-tf]')) {
  el.addEventListener('input', () =>
    applyTransformField(el.dataset.tf, parseFloat(el.value), false),
  );
  el.addEventListener('change', () => {
    applyTransformField(el.dataset.tf, parseFloat(el.value), true);
    drawSelection();
  });
  el.addEventListener('keydown', (e) => {
    // Swallow the key: focus may move to the canvas text editor while it's handled.
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });
}
$('#sc-tf-link').addEventListener('click', (e) => {
  const b = e.currentTarget;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on);
  b.firstElementChild.innerHTML = icon(on ? 'link' : 'link-slash');
});
for (const b of document.querySelectorAll('[data-stroke-cap]'))
  b.addEventListener('click', () => {
    state.cap = b.dataset.strokeCap;
    styleChanged('cap', true);
  });
for (const b of document.querySelectorAll('button[data-stroke-align]'))
  b.addEventListener('click', () => {
    state.strokeAlign = b.dataset.strokeAlign;
    styleChanged('align', true);
  });
for (const b of document.querySelectorAll('[data-stroke-join]'))
  b.addEventListener('click', () => {
    state.join = b.dataset.strokeJoin;
    styleChanged('join', true);
  });
for (const sel of document.querySelectorAll('select[data-stroke-dash]'))
  sel.addEventListener('change', () => {
    state.dash = sel.value;
    styleChanged('dash', true);
    // Custom's dash / gap fields sit under Stroke in the Color panel.
    if (state.dash === 'custom') showTab('props');
  });
for (const inp of $('#sc-dash-custom').querySelectorAll('input'))
  inp.addEventListener('change', () => {
    const vals = [...$('#sc-dash-custom').querySelectorAll('input')].map((x) =>
      x.value === '' ? null : Math.max(0, +x.value || 0),
    );
    // Blank fields end the pattern.
    const end = vals.indexOf(null);
    const pat = end < 0 ? vals : vals.slice(0, end);
    if (!pat.some((n) => n > 0)) return syncStyleUI();
    state.dashPat = pat.length % 2 ? [...pat, pat.length === 1 ? pat[0] : 0] : pat;
    state.dash = 'custom';
    styleChanged('dash', true);
  });

// Corner radius: one field for all corners (options bar), four in Properties.
function radiiChanged(patch, final) {
  const el = cornerTarget();
  if (!el) return;
  const r = state.radiusLinked
    ? Object.fromEntries(CORNERS.map((k) => [k, Object.values(patch)[0]]))
    : { ...getRadii(el), ...patch };
  setRadii(el, r);
  if (final) commit();
  else drawSelection();
}
const allField = $('[data-corner-all]');
allField.addEventListener('input', () => {
  const v = Math.max(0, parseFloat(allField.value) || 0);
  state.radius = v;
  const el = cornerTarget();
  if (el) {
    setRadii(el, { tl: v, tr: v, br: v, bl: v });
    drawSelection();
  }
});
allField.addEventListener('change', () => cornerTarget() && commit());
for (const inp of document.querySelectorAll('[data-corner]')) {
  const k = inp.dataset.corner;
  inp.addEventListener('input', () =>
    radiiChanged({ [k]: Math.max(0, parseFloat(inp.value) || 0) }, false),
  );
  inp.addEventListener('change', () =>
    radiiChanged({ [k]: Math.max(0, parseFloat(inp.value) || 0) }, true),
  );
}
for (const b of document.querySelectorAll('[data-fill-rule]'))
  b.addEventListener('click', () => setFillRule(b.dataset.fillRule));
$('#sc-corner-link').addEventListener('click', () => {
  state.radiusLinked = !state.radiusLinked;
  syncCornerUI();
});

for (const b of document.querySelectorAll('[data-eyedrop]')) {
  b.addEventListener('click', () => {
    state.eyedropMode = b.dataset.eyedrop;
    for (const x of document.querySelectorAll('[data-eyedrop]'))
      x.setAttribute('aria-checked', x === b);
    tools.eyedropper.leave();
  });
  b.setAttribute('aria-checked', b.dataset.eyedrop === state.eyedropMode);
}
function syncZoomOpts() {
  for (const b of document.querySelectorAll('[data-zoomdir]'))
    b.setAttribute('aria-checked', (b.dataset.zoomdir === 'out') === state.zoomOut);
  $('#sc-scrubby').checked = state.scrubby;
  if (state.tool === 'zoom') stage.style.cursor = tools.zoom.cursor;
}
for (const b of document.querySelectorAll('[data-zoomdir]'))
  b.addEventListener('click', () => {
    state.zoomOut = b.dataset.zoomdir === 'out';
    syncZoomOpts();
  });
$('#sc-scrubby').addEventListener('change', (e) => {
  state.scrubby = e.target.checked;
  syncZoomOpts();
});
// Double-clicking the Zoom tool goes to 100%.
$('[data-tool="zoom"]').addEventListener('dblclick', () => zoomAt(1));
// Shift and Alt change the pointer: the Zoom tool's in / out, the
// selection badges (src/cursors.js).
for (const type of ['keydown', 'keyup'])
  window.addEventListener(type, (e) => {
    const k = { Shift: 'shift', Alt: 'alt' }[e.key];
    if (!k || keysDown[k] === (type === 'keydown')) return;
    keysDown[k] = type === 'keydown';
    syncCursor();
  });
window.addEventListener('blur', () => {
  keysDown.shift = keysDown.alt = false;
  syncCursor();
});
syncZoomOpts();
document.querySelector('[data-eraser="object"]').setAttribute('aria-checked', 'true');
document.querySelector('[data-eraser="cut"]').setAttribute('aria-checked', 'false');

window.addEventListener('resize', () => {
  closeMenus();
  applyView();
});
