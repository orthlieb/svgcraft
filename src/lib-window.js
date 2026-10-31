// SVGCraft — Window → Libraries: making and managing swatches, gradients,
// patterns and symbols.
'use strict';

// Using them happens where you work: the Color panel's Fill and Stroke
// pick from them, the Custom Shape tool draws a symbol, and tiles drag
// onto the canvas. Their pickers' Custom… opens this window on the right
// tab. It docks in a column of its own by the panels (its title-bar
// button floats it, and docks it back), and remembers its tab, whether
// it's docked, the column's width, and where it floats.
const libWin = $('#sc-libraries');
const LIB_TABS = ['swatches', 'gradients', 'patterns', 'symbols'];
const LIB_TAB_KEY = 'svgcraft.librariesTab';
const LIB_DOCK_KEY = 'svgcraft.librariesDock'; // 'float' when floated
const LIB_W_KEY = 'svgcraft.librariesWidth';
const libCol = $('#sc-libdock');
const libSplitter = $('#sc-libdock-splitter');
const libDockBtn = $('#sc-lib-dock');
let libReturnFocus = null;

function showLibTab(name) {
  if (!LIB_TABS.includes(name)) return;
  libWin.querySelector(`[data-tab="${name}"]`).click();
}
// Each tab click (the panel-tab wiring in src/panels.js does the
// switching) is remembered.
for (const t of libWin.querySelectorAll('[data-tab]'))
  t.addEventListener('click', () => store(LIB_TAB_KEY, t.dataset.tab));

function openLibraries(tab) {
  showLibTab(tab || stored(LIB_TAB_KEY) || 'swatches');
  if (libWin.hidden) {
    libReturnFocus = document.activeElement;
    libWin.hidden = false;
    // In its column, unless it was floated (or there's no room).
    const dock = stored(LIB_DOCK_KEY) !== 'float' && dockRoomQuery.matches;
    if (dock !== libDocked()) setLibDocked(dock, false);
    else syncLibCol();
    if (!dock) {
      // First time floating: beside the panels, at the top.
      if (!libWin.style.left) {
        libWin.style.left = `${Math.max(8, innerWidth - libWin.offsetWidth - 320)}px`;
        libWin.style.top = '96px';
      }
      winClamp(libWin);
    }
  }
  $('[data-action="toggleLibraries"]').setAttribute('aria-checked', 'true');
  libWin.querySelector('[data-tab][aria-selected="true"]').focus();
}
function closeLibraries() {
  if (libWin.hidden) return;
  libWin.hidden = true;
  syncLibCol();
  $('[data-action="toggleLibraries"]').setAttribute('aria-checked', 'false');
  if (libWin.contains(document.activeElement)) {
    const back = libReturnFocus;
    if (back?.isConnected && !libWin.contains(back) && !back.closest('.sc-menus')) back.focus();
    else document.activeElement.blur();
  }
}
const toggleLibraries = () => (libWin.hidden ? openLibraries() : closeLibraries());

$('#sc-lib-close').addEventListener('click', closeLibraries);
libWin.addEventListener('keydown', (e) => {
  // Esc closes it, unless a field or popup inside wants it.
  if (e.key !== 'Escape' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  closeLibraries();
});
dragWindow(libWin, $('#sc-lib-titlebar'));

// ---- the Libraries column ------------------------------------------------------
const libDocked = () => 'docked' in libWin.dataset;
const libColWidth = (w) =>
  Math.round(clamp(w, 200, Math.max(220, Math.min(560, $('#sc-split').clientWidth * 0.45))));
// The column shows while Libraries is open and docked; the canvas takes
// what's left.
function syncLibCol() {
  const shown = libDocked() && !libWin.hidden;
  libCol.hidden = libSplitter.hidden = !shown;
  if (shown) {
    const w = libColWidth(stored(LIB_W_KEY) || 280);
    libCol.style.width = `${w}px`;
    libSplitter.setAttribute('aria-valuenow', w);
  }
  applyView();
}
function setLibDocked(docked, save = true) {
  if (save) store(LIB_DOCK_KEY, docked ? 'dock' : 'float');
  const label = docked ? 'Float' : 'Dock by the panels';
  libDockBtn.setAttribute('aria-label', label);
  libDockBtn.dataset.tip = label;
  const name = docked ? 'up-right-from-square' : 'table-columns';
  libDockBtn.innerHTML = `<i data-icon="${name}">${icon(name)}</i>`;
  if (docked) {
    libWin.dataset.docked = '';
    libCol.append(libWin);
    libWin.style.left = libWin.style.top = libWin.style.width = libWin.style.height = '';
  } else {
    delete libWin.dataset.docked;
    document.body.append(libWin);
    libWin.style.width = libWin.style.height = '';
    libWin.style.left = `${Math.max(8, innerWidth - libWin.offsetWidth - 320)}px`;
    libWin.style.top = '96px';
    if (!libWin.hidden) winClamp(libWin);
  }
  syncLibCol();
}
libDockBtn.addEventListener('click', () => {
  setLibDocked(!libDocked());
  libDockBtn.focus();
});
function setLibColWidth(w) {
  w = libColWidth(w);
  libCol.style.width = `${w}px`;
  store(LIB_W_KEY, w);
  libSplitter.setAttribute('aria-valuenow', w);
  applyView();
}
dragDivider(libSplitter, (w0, dx) => {
  if (w0 === null) return libCol.offsetWidth;
  setLibColWidth(w0 - dx);
});
libSplitter.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 50 : 10;
  const d = { ArrowLeft: step, ArrowRight: -step }[e.key];
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  setLibColWidth(libCol.offsetWidth + d);
});
// Too narrow to dock: it floats (and docks again when next opened with room).
dockRoomQuery.addEventListener('change', () => {
  if (!dockRoomQuery.matches && libDocked()) setLibDocked(false, false);
});
// Reset Workspace: docked again, at the standard width.
function resetLibraries() {
  store(LIB_DOCK_KEY, null);
  store(LIB_W_KEY, null);
  if (dockRoomQuery.matches) setLibDocked(true, false);
}

// Fill and Stroke's swatches: the library's colours, and Custom… to make
// and manage them.
for (const k of ['fill', 'stroke'])
  libPickers[k] = libPicker($(`#sc-${k}-swatch`), {
    label: `${k === 'fill' ? 'Fill' : 'Stroke'} swatches`,
    compact: true,
    items: () => lib.swatches,
    current: () =>
      state[k + 'On'] && !state[k + 'Grad'] && !state[k + 'Pat']
        ? lib.swatches.find((x) => x.c === state[k] && x.a === state[k + 'A'])
        : null,
    thumb: libSwatchThumb,
    pick: (x) => {
      state.active = k;
      applySwatch(x.c, x.a);
    },
    manage: () => openLibraries('swatches'),
    manageTip: 'Make and manage swatches in the Libraries window',
  });

// The library bars' buttons are greyed out when there's nothing for them
// to act on: no tile picked (rename, delete, place), no selection (define a
// pattern, make a symbol), no gradient in use (save it), no symbol.
function syncLibBars() {
  const picked = (kind) => !!libItem(kind, libSel[kind]);
  const set = (b, on) => b && (b.disabled = !on);
  for (const bar of document.querySelectorAll('[data-lib]')) {
    const kind = bar.dataset.lib;
    const b = (act) => bar.querySelector(`[data-lib-act="${act}"]`);
    for (const act of ['rename', 'delete', 'place']) set(b(act), picked(kind));
    if (kind === 'patterns') set(b('add'), state.sel.length > 0);
    if (kind === 'gradients') set(b('add'), !!activeGrad());
    if (kind === 'symbols') set(b('add'), !!panelSymbol());
  }
  const sym = panelSymbol();
  const inst = state.sel.some(symbolOf);
  const s = (act) => $(`[data-sym-act="${act}"]`);
  set(s('make'), state.sel.length > 0 && !iso);
  set(s('edit'), !iso && (!!sym || inst));
  set(s('break'), inst);
  for (const act of ['place', 'rename', 'delete', 'save']) set(s(act), !!sym);
}
