// SVGCraft — The dock column: Icon Preview and SVG Source as split panes
// beside the canvas.
'use strict';

// A window that docks sits in the column to the right of the canvas
// instead of floating; its title-bar button floats it again and docks it
// back. The column's width is set by dragging the divider at its left (or
// with the arrow keys), and with both windows docked they stack, Icon
// Preview above SVG Source, with a divider between them. Each window's
// choice, the width and the split are remembered. Docking needs room, so
// below 1024 px wide windows float.
const DOCK_W_KEY = 'svgcraft.dockWidth';
const DOCK_SPLIT_KEY = 'svgcraft.dockSplit';
const dockCol = $('#sc-dock');
const dockSplitter = $('#sc-dock-splitter');
const dockDivider = $('#sc-dock-divider');
const dockRoomQuery = matchMedia('(min-width: 1024px)');
const dockables = [];

const dockWidth = (w) => Math.round(clamp(w, 200, Math.max(220, $('#sc-split').clientWidth * 0.6)));
const isDocked = (win) => 'docked' in win.dataset;

// Show the column, its dividers and the stacked windows' heights to match
// what's docked and open now; the canvas takes what's left.
function syncDock() {
  const shown = dockables.filter((d) => isDocked(d.win) && !d.win.hidden);
  dockCol.hidden = dockSplitter.hidden = !shown.length;
  dockDivider.hidden = shown.length < 2;
  if (shown.length) {
    const w = dockWidth(stored(DOCK_W_KEY) || stored('svgcraft.iconPreviewDock.width') || 380);
    dockCol.style.width = `${w}px`;
    dockSplitter.setAttribute('aria-valuenow', w);
  }
  // The upper window's share of the height, when two are stacked.
  const split = clamp(+stored(DOCK_SPLIT_KEY) || 0.4, 0.15, 0.85);
  for (const d of dockables)
    d.win.style.flex = shown.length === 2 && d === shown[0] ? `0 0 ${split * 100}%` : '';
  applyView();
}

function setDocked(d, docked, save = true) {
  if (save) store(d.key, docked ? 'dock' : 'float');
  const label = docked ? 'Float' : 'Dock beside the canvas';
  d.btn.setAttribute('aria-label', label);
  d.btn.dataset.tip = label;
  const name = docked ? 'up-right-from-square' : 'table-columns';
  d.btn.innerHTML = `<i data-icon="${name}">${icon(name)}</i>`;
  if (docked) {
    d.win.dataset.docked = '';
    // Kept in their order: Icon Preview, the divider, SVG Source.
    if (d.order === 0) dockCol.prepend(d.win);
    else dockCol.append(d.win);
    d.win.style.left = d.win.style.top = d.win.style.width = d.win.style.height = '';
  } else {
    delete d.win.dataset.docked;
    document.body.append(d.win);
    d.win.style.width = d.win.style.height = '';
    d.win.style.left = `${Math.max(8, innerWidth - d.win.offsetWidth - 320 - d.order * 40)}px`;
    d.win.style.top = `${96 + d.order * 40}px`;
    if (!d.win.hidden) winClamp(d.win);
  }
  syncDock();
}

// Where a window goes as it opens: docked unless it was floated (or
// there's no room to dock).
function dockOnOpen(d) {
  const want = stored(d.key) !== 'float' && dockRoomQuery.matches;
  if (want !== isDocked(d.win) || (!want && !d.win.style.left)) setDocked(d, want, false);
  else syncDock();
  if (!want) winClamp(d.win);
}

function makeDockable(win, { key, btn, order }) {
  const d = { win, key, btn, order };
  dockables.push(d);
  btn.addEventListener('click', () => {
    setDocked(d, !isDocked(win));
    btn.focus();
  });
  return d;
}

// The column's width: drag the divider at its left, or arrow keys.
function setDockColWidth(w) {
  w = dockWidth(w);
  dockCol.style.width = `${w}px`;
  store(DOCK_W_KEY, w);
  dockSplitter.setAttribute('aria-valuenow', w);
  applyView();
}
function dragDivider(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const begin = onMove(null);
    const move = (ev) => onMove(begin, ev.clientX - start.x, ev.clientY - start.y);
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
dragDivider(dockSplitter, (w0, dx) => {
  if (w0 === null) return dockCol.offsetWidth;
  setDockColWidth(w0 - dx);
});
dockSplitter.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 50 : 10;
  const d = { ArrowLeft: step, ArrowRight: -step }[e.key];
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  setDockColWidth(dockCol.offsetWidth + d);
});

// Between two stacked windows: drag, or the up and down arrow keys.
function setDockSplit(r) {
  store(DOCK_SPLIT_KEY, +clamp(r, 0.15, 0.85).toFixed(3));
  dockDivider.setAttribute('aria-valuenow', Math.round(clamp(r, 0.15, 0.85) * 100));
  syncDock();
}
dragDivider(dockDivider, (r0, dx, dy) => {
  if (r0 === null) return clamp(+stored(DOCK_SPLIT_KEY) || 0.4, 0.15, 0.85);
  setDockSplit(r0 + dy / dockCol.clientHeight);
});
dockDivider.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  const d = { ArrowUp: -step, ArrowDown: step }[e.key];
  if (!d) return;
  e.preventDefault();
  e.stopPropagation();
  setDockSplit(clamp(+stored(DOCK_SPLIT_KEY) || 0.4, 0.15, 0.85) + d);
});
// Too narrow to dock any more: what's docked floats (it docks again when
// it's next opened with room).
dockRoomQuery.addEventListener('change', () => {
  if (!dockRoomQuery.matches)
    for (const d of dockables) if (isDocked(d.win)) setDocked(d, false, false);
});
