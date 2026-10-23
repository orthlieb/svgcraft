// SVGCraft — Grid, snap, theme and the remaining controls.
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
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage blocked — the choice lasts for this visit only */
  }
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

// Actions: every menu item and button with data-action="name" -------------
const actions = {
  ...cmds,
  definePattern,
  makeSymbol,
  editSymbol,
  breakSymbolLink,
  symbolDone: () => exitIso(),
  new: () => openNewDoc(),
  newIcon: openNewIcon,
  togglePixelGrid: () => toggleView('pixelGrid'),
  toggleSnapPixel: () => toggleView('snapPixel'),
  toggleKeylines: () => toggleView('keylines'),
  toggleIconPreview,
  closeDoc: () => closeDoc(curDoc),
  open: () => openPicker('open'),
  place: () => openPicker('place'),
  exportSvg,
  exportCleanSvg: openCleanSvg,
  exportPng1: () => exportPng(1),
  exportPng2: () => exportPng(2),
  exportPng4: () => exportPng(4),
  exportAppIcons: openAppIcons,
  copySvg,
  fileInfo: openFileInfo,
  toggleSource,
  undo,
  redo,
  deselect: () => setSel([]),
  swapPaint,
  paintNone() {
    state[state.active + 'On'] = false;
    styleChanged(state.active, true);
  },
  zoomIn: () => zoomAt(state.zoom * 1.25),
  zoomOut: () => zoomAt(state.zoom / 1.25),
  fit,
  fillScreen,
  zoom100: () => zoomAt(1),
  toggleGrid: () => setGridOn(!state.grid),
  toggleSnap: () => setSnapOn(!state.snap),
  themeSystem: () => setTheme('system'),
  themeDark: () => setTheme('dark'),
  themeLight: () => setTheme('light'),
  about: () => openAbout(''),
  aboutFeatures: () => openAbout('#features'),
  aboutShortcuts: () => openAbout('#shortcuts'),
  toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
  showCharacter: showCharacterPanel,
  showParagraph: showParagraphPanel,
  convertTextKind,
  combineUnite: () => combineShapes('unite'),
  reversePath: reversePaths,
  toggleAnimations: () => toggleAnimations(),
  imageSize: openImageSize,
  imageTrace: openTrace,
  togglePanels: () => togglePanels(false),
  defaultPaint,
  canvasSize: openCanvasSize,
  fillRuleNonzero: () => setFillRule('nonzero'),
  fillRuleEvenodd: () => setFillRule('evenodd'),
  combineSubtract: () => combineShapes('subtract'),
  combineIntersect: () => combineShapes('intersect'),
  combineExclude: () => combineShapes('exclude'),
  createOutlines,
  toggleRulers: () => toggleView('rulers'),
  toggleGuides: () => toggleView('guidesOn'),
  toggleLockGuides: () => toggleView('guidesLocked'),
  toggleSnapGuides: () => toggleView('snapGuides'),
  toggleSmart: () => toggleView('smart'),
  newGuide: openNewGuide,
  clearGuides() {
    if (!state.guides.length) return;
    state.guides = [];
    renderGuides();
    commit();
  },
  freeTransform: () => beginTransform('free'),
  tfScale: () => beginTransform('scale'),
  tfRotate: () => beginTransform('rotate'),
  tfSkew: () => beginTransform('skew'),
  tfCommit: () => endTransform(true),
  tfCancel: () => endTransform(false),
  rot180: () => rotateSel(180),
  rot90cw: () => rotateSel(90),
  rot90ccw: () => rotateSel(-90),
  again: () => transformAgain(false),
  againCopy: () => transformAgain(true),
  // The browser's own eyedropper (Chromium) reaches anywhere on screen.
  async pickFromScreen() {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      const k = state.active;
      state[k] = hex(sRGBHex);
      state[k + 'On'] = true;
      styleChanged(k, true);
    } catch {
      /* cancelled with Esc */
    }
  },
};
$('#sc-screen-pick').hidden = !('EyeDropper' in window);
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-action]');
  if (!a || a.disabled) return;
  closeMenus();
  actions[a.dataset.action]?.();
});

// Menu bar: click to open, hover to switch while one is open, arrows to move.
let openMenu = null;
function closeSubs() {
  for (const sm of document.querySelectorAll('.sc-submenu')) {
    sm.querySelector('.sc-sub-list').hidden = true;
    sm.querySelector('.sc-sub-btn').setAttribute('aria-expanded', 'false');
  }
}
function openSub(sm, focusFirst) {
  closeSubs();
  const btn = sm.querySelector('.sc-sub-btn');
  const list = sm.querySelector('.sc-sub-list');
  list.hidden = false;
  const r = btn.getBoundingClientRect();
  const right = r.right + list.offsetWidth + 4 > innerWidth;
  list.style.left = `${Math.max(4, right ? r.left - list.offsetWidth : r.right)}px`;
  list.style.top = `${Math.max(4, Math.min(r.top - 4, innerHeight - list.offsetHeight - 4))}px`;
  btn.setAttribute('aria-expanded', 'true');
  if (focusFirst) list.querySelector('button').focus();
}
for (const sm of document.querySelectorAll('.sc-submenu')) {
  const btn = sm.querySelector('.sc-sub-btn');
  btn.addEventListener('pointerenter', () => openSub(sm));
  btn.addEventListener('click', () => openSub(sm, true));
  sm.querySelector('.sc-sub-list').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeSubs();
    btn.focus();
  });
}
// Hovering any other item of a menu folds an open submenu away.
for (const b of document.querySelectorAll('.sc-menu > .sc-menu-list > button'))
  b.addEventListener('pointerenter', closeSubs);

function closeMenus() {
  closeSubs();
  if (!openMenu) return;
  openMenu.querySelector('.sc-menu-btn').setAttribute('aria-expanded', 'false');
  openMenu.querySelector('.sc-menu-list').hidden = true;
  openMenu = null;
}
function showMenu(m, focusFirst) {
  closeMenus();
  const btn = m.querySelector('.sc-menu-btn');
  const list = m.querySelector('.sc-menu-list');
  list.hidden = false;
  const r = btn.getBoundingClientRect();
  list.style.left = `${Math.max(4, Math.min(r.left, innerWidth - list.offsetWidth - 4))}px`;
  list.style.top = `${r.bottom + 2}px`;
  btn.setAttribute('aria-expanded', 'true');
  openMenu = m;
  if (focusFirst) list.querySelector('button').focus();
}
const menus = [...document.querySelectorAll('.sc-menu')];
menus.forEach((m, mi) => {
  const btn = m.querySelector('.sc-menu-btn');
  const list = m.querySelector('.sc-menu-list');
  btn.addEventListener('click', (e) =>
    openMenu === m ? closeMenus() : showMenu(m, e.detail === 0),
  );
  btn.addEventListener('pointerenter', () => openMenu && openMenu !== m && showMenu(m));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      showMenu(m, true);
    }
  });
  list.addEventListener('keydown', (e) => {
    if (e.target.closest('.sc-sub-list')) return;
    const items = [...list.querySelectorAll(':scope > button, :scope > .sc-submenu > .sc-sub-btn')];
    const at = items.indexOf(document.activeElement);
    const go = (d) => items[(at + d + items.length) % items.length].focus();
    const hop = (d) => showMenu(menus[(mi + d + menus.length) % menus.length], true);
    const keys = {
      ArrowDown: () => go(1),
      ArrowUp: () => go(-1),
      ArrowRight: () =>
        document.activeElement.classList.contains('sc-sub-btn')
          ? openSub(document.activeElement.parentElement, true)
          : hop(1),
      ArrowLeft: () => hop(-1),
      Escape: () => {
        closeMenus();
        btn.focus();
      },
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    keys[e.key]();
  });
});
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenus();
});
window.addEventListener('blur', closeMenus);

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

// Panel tabs (Color | Swatches).
for (const group of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...group.querySelectorAll('[data-tab]')];
  for (const t of tabs) {
    t.addEventListener('click', () => {
      for (const x of tabs) {
        x.setAttribute('aria-selected', x === t);
        group.querySelector(`[data-pane="${x.dataset.tab}"]`).hidden = x !== t;
      }
    });
  }
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
    // Custom's dash / gap fields live in the Properties panel.
    if (state.dash === 'custom') $('[data-tab="props"]').click();
  });
for (const inp of $('#sc-dash-custom').querySelectorAll('input'))
  inp.addEventListener('change', () => {
    const vals = [...$('#sc-dash-custom').querySelectorAll('input')].map((x) =>
      x.value === '' ? null : Math.max(0, +x.value || 0),
    );
    // Blank fields end the pattern, as in Photoshop.
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
// Double-clicking the Zoom tool goes to 100%, as in Photoshop.
$('[data-tool="zoom"]').addEventListener('dblclick', () => zoomAt(1));
// Holding Alt flips the Zoom tool's cursor between in and out.
for (const type of ['keydown', 'keyup'])
  window.addEventListener(type, (e) => {
    if (e.key !== 'Alt' || altDown === (type === 'keydown')) return;
    altDown = type === 'keydown';
    if (state.tool === 'zoom' && !gesture?.pan) stage.style.cursor = tools.zoom.cursor;
  });
window.addEventListener('blur', () => {
  altDown = false;
  if (state.tool === 'zoom') stage.style.cursor = tools.zoom.cursor;
});
syncZoomOpts();
document.querySelector('[data-eraser="object"]').setAttribute('aria-checked', 'true');
document.querySelector('[data-eraser="cut"]').setAttribute('aria-checked', 'false');

window.addEventListener('resize', () => {
  closeMenus();
  applyView();
});
