// SVGCraft — Commands: what each menu item and button runs, when it can
// run, and the menu bar.
'use strict';

// Actions: every menu item and button with data-action="name" -------------
const actions = {
  ...cmds,
  definePattern,
  layerViaCopy,
  layerViaCut,
  groupByColour: () => groupByColour(),
  mergeDown: () => mergeDown(),
  mergeVisible: () => mergeVisible(),
  peekLayers: () => peekLayers(),
  previewBg: () => previewBg(),
  shareDoc: () => shareDoc(),
  phoneSource: () => toggleSource(),
  adjBlackWhite: () => openBlackWhite(),
  adjThreshold: () => openThreshold(),
  adjDesaturate: () => adjustNow('desaturate', 'Desaturate'),
  modeGrayscale: () => adjustNow('grayscale', 'Grayscale'),
  phoneInfo: () => phoneInfo(),
  makeSymbol,
  editSymbol,
  breakSymbolLink,
  symbolDone: () => exitIso(),
  new: () => openNewDoc(),
  newFromText: () => newFromText(),
  newIcon: openNewIcon,
  togglePixelGrid: () => toggleView('pixelGrid'),
  toggleSnapPixel: () => toggleView('snapPixel'),
  toggleKeylines: () => toggleView('keylines'),
  toggleIconPreview,
  closeDoc: () => closeDoc(curDoc),
  open: () => openPicker('open'),
  place: () => openPicker('place'),
  exportSvg,
  save: () => saveDoc(),
  saveAs: () => saveDocAs(),
  exportCleanSvg: openCleanSvg,
  exportPng1: () => exportPng(1),
  exportPng2: () => exportPng(2),
  exportPng4: () => exportPng(4),
  exportAppIcons: openAppIcons,
  copySvg,
  cut: () => copySelection(true),
  copy: () => copySelection(false),
  paste: () => pasteClipboard(),
  fileInfo: openFileInfo,
  toggleSource,
  toggleLibraries,
  undo,
  redo,
  deselect: () => setSel([]),
  swapPaint,
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

// When each action can run: menu items and buttons for any other are
// greyed out (as in Photoshop) whenever its rule says no. Actions with no
// rule are always available; the commands still check and explain.
const selN = () => normalizeSel(state.sel).length;
const anySel = () => state.sel.length > 0;
const someSel = (test) => () => normalizeSel(state.sel).some(test);
const actionRules = {
  // Play needs something animated (and Stop stays on while it plays).
  toggleAnimations: () => animPlay.playing || !!doc.querySelector('[data-sc-anim]'),
  undo: () => !$('#sc-undo').disabled,
  redo: () => !$('#sc-redo').disabled,
  deselect: anySel,
  delete: anySel,
  cut: anySel,
  // The adjustments need something to change.
  adjBlackWhite: () => items().length > 0,
  adjThreshold: () => items().length > 0,
  adjDesaturate: () => items().length > 0,
  modeGrayscale: () => items().length > 0,
  copy: anySel,
  duplicate: anySel,
  layerViaCopy: () => anySel() || !!pickedPart(),
  groupByColour: () => items().length > 0,
  mergeDown: () => !!mergeTargets(),
  mergeVisible: () => visibleLayers().length >= 2,
  layerViaCut: () => !!pickedPart() || liftable().length > 0,
  cropToSelection: anySel,
  imageTrace: () => !!traceImage().el,
  cropToDrawing: () => items().length > 0,
  selectAll: () => items().length > 0,
  front: anySel,
  back: anySel,
  forward: anySel,
  backward: anySel,
  ungroup: () => state.sel.some((el) => el.localName === 'g'),
  flipH: anySel,
  flipV: anySel,
  ...Object.fromEntries(
    ['Left', 'HCenter', 'Right', 'Top', 'VCenter', 'Bottom'].map((k) => ['align' + k, anySel]),
  ),
  distributeH: () => state.sel.length >= 3,
  distributeV: () => state.sel.length >= 3,
  ...Object.fromEntries(
    ['Unite', 'Subtract', 'Intersect', 'Exclude'].map((k) => ['combine' + k, () => selN() >= 2]),
  ),
  clipMake: () => selN() >= 2,
  clipRelease: () => state.sel.some((el) => el.closest?.('[data-sc-clip]')),
  lockPosition: anySel,
  lockAll: anySel,
  unlockLayers: anySel,
  layerStyle: anySel,
  clearLayerStyle: someSel((el) => el.hasAttribute('data-sc-fx')),
  copyLayerStyle: () => state.sel.length === 1,
  pasteLayerStyle: () => !!copiedStyle && anySel(),
  makeSymbol: anySel,
  definePattern: anySel,
  breakSymbolLink: someSel(symbolOf),
  editSymbol: () => !iso && (state.sel.some(symbolOf) || !!panelSymbol()),
  symbolDone: () => !!iso,
  textOnPath() {
    const sel = normalizeSel(state.sel);
    return (
      sel.length === 2 &&
      sel.some((el) => el.localName === 'text') &&
      sel.some((el) => TP_SHAPES.has(el.localName))
    );
  },
  releaseTextOnPath: someSel(isTP),
  convertTextKind: () => selectedTexts().some((el) => !isTP(el)),
  createOutlines: someSel((el) => el.localName === 'text' || !!el.querySelector?.('text')),
  reversePath: () => shapesIn(state.sel, REVERSIBLE).length > 0,
  fillRuleNonzero: () => shapesIn(state.sel, RULE_SHAPES).length > 0,
  fillRuleEvenodd: () => shapesIn(state.sel, RULE_SHAPES).length > 0,
  freeTransform: anySel,
  tfScale: anySel,
  tfRotate: anySel,
  tfSkew: anySel,
  tfCommit: () => !!state.tf,
  tfCancel: () => !!state.tf,
  rot180: anySel,
  rot90cw: anySel,
  rot90ccw: anySel,
  again: () => !!lastT && anySel(),
  againCopy: () => !!lastT && anySel(),
  clearGuides: () => state.guides.length > 0,
};
// Run an action (or `run`) only when its rule allows it: a shortcut for a
// greyed-out item does nothing, as in Photoshop.
// With nothing open, only these work.
const NO_DOC_ACTIONS = new Set([
  'new',
  'newFromText',
  'newIcon',
  'open',
  'paste',
  'about',
  'aboutFeatures',
  'aboutShortcuts',
  'help',
  'checkUpdates',
  'themeSystem',
  'themeDark',
  'themeLight',
  'toggleTheme',
  'togglePanels',
  'toggleDock',
  'installApp',
  'resetWorkspace',
]);
const actionAllowed = (name) =>
  curDoc ? !actionRules[name] || actionRules[name]() : NO_DOC_ACTIONS.has(name);
function ifAllowed(name, run = actions[name]) {
  if (!actionAllowed(name)) return;
  noteStep(stepName(name));
  run();
}
function syncActions() {
  for (const b of document.querySelectorAll('button[data-action]')) {
    // Ruled actions, and with nothing open every action (marked, so they
    // come back when a drawing opens).
    if (actionRules[b.dataset.action] || !curDoc || b.dataset.noDoc)
      b.disabled = !actionAllowed(b.dataset.action);
    if (curDoc) delete b.dataset.noDoc;
    else b.dataset.noDoc = '1';
  }
  // Ctrl+E is Merge Down, Merge Layers or Merge Group, as in Photoshop.
  for (const b of document.querySelectorAll('[data-action="mergeDown"] span'))
    b.textContent = curDoc ? mergeLabel() : 'Merge Down';
}

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-action]');
  if (!a || a.disabled || !actionAllowed(a.dataset.action)) return;
  closeMenus();
  noteStep(stepName(a.dataset.action));
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
// Home / End, and a letter: the next item whose name starts with it, as
// menus do. True when the key was one of those.
function menuJump(e, items) {
  if (!items.length) return false;
  const at = items.indexOf(document.activeElement);
  let to = -1;
  if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = items.length - 1;
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ch = e.key.toLowerCase();
    const name = (b) =>
      (b.querySelector(':scope > span')?.textContent || b.textContent).trim().toLowerCase();
    for (let i = 1; i <= items.length && to < 0; i++) {
      const j = (at + i + items.length) % items.length;
      if (name(items[j]).startsWith(ch)) to = j;
    }
  } else return false;
  items[to]?.focus();
  return true;
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
  if (focusFirst) list.querySelector('button:not(:disabled)')?.focus();
}
for (const sm of document.querySelectorAll('.sc-submenu')) {
  const btn = sm.querySelector('.sc-sub-btn');
  btn.addEventListener('pointerenter', () => openSub(sm));
  btn.addEventListener('click', () => openSub(sm, true));
  const list = sm.querySelector('.sc-sub-list');
  list.addEventListener('keydown', (e) => {
    // Up and down (and Home, End, a letter) within the submenu.
    const items = [...list.querySelectorAll(':scope > button:not(:disabled):not([hidden])')];
    const at = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step || menuJump(e, items)) {
      e.preventDefault();
      e.stopPropagation();
      if (step && items.length) items[(at + step + items.length) % items.length].focus();
      return;
    }
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
  syncActions();
  if (typeof syncWindowMenu === 'function') syncWindowMenu();
  const btn = m.querySelector('.sc-menu-btn');
  const list = m.querySelector('.sc-menu-list');
  list.hidden = false;
  const r = btn.getBoundingClientRect();
  list.style.left = `${Math.max(4, Math.min(r.left, innerWidth - list.offsetWidth - 4))}px`;
  list.style.top = `${r.bottom + 2}px`;
  btn.setAttribute('aria-expanded', 'true');
  openMenu = m;
  if (focusFirst) list.querySelector('button:not(:disabled)')?.focus();
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
    const items = [
      ...list.querySelectorAll(
        ':scope > button:not(:disabled):not([hidden]), :scope > .sc-submenu > .sc-sub-btn',
      ),
    ];
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
    if (!keys[e.key] && !menuJump(e, items)) return;
    e.preventDefault();
    e.stopPropagation();
    keys[e.key]?.();
  });
});
// The menu bar's titles: left and right move along it, as in a menu bar.
menus.forEach((m, mi) =>
  m.querySelector('.sc-menu-btn').addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d || openMenu) return;
    e.preventDefault();
    menus[(mi + d + menus.length) % menus.length].querySelector('.sc-menu-btn').focus();
  }),
);
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenus();
});
window.addEventListener('blur', closeMenus);
