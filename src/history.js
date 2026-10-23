// SVGCraft — Undo / redo history and autosave.
'use strict';

// ---------------------------------------------------------------------
// History + autosave
// ---------------------------------------------------------------------
const hist = [];
let hIdx = -1;
let saveTimer = 0;

// While a symbol is being edited (see enterIso) the history still records
// the real drawing: the edits written back into the <symbol>, and the
// layers set aside behind it.
function snapshot() {
  isoWrite();
  return {
    d: docHtml(),
    f: defs.innerHTML,
    w: state.w,
    h: state.h,
    u: state.units,
    g: guidesAttr(),
    m: metaJson(),
  };
}

function commit() {
  // A preview's SMIL never goes into the history.
  stopAnimations();
  syncTextPaths();
  syncStrokeAlign();
  syncEffects();
  syncClips();
  pruneGradients();
  hist.splice(hIdx + 1);
  hist.push(snapshot());
  if (hist.length > 150) hist.shift();
  hIdx = hist.length - 1;
  afterChange();
}

function restore(s, keepSel = false) {
  dropIso();
  doc.innerHTML = s.d;
  defs.innerHTML = s.f;
  state.units = s.u || 'px';
  setSize(s.w, s.h);
  state.guides = parseGuides(s.g);
  state.meta = JSON.parse(s.m || '{}');
  renderGuides();
  if (!keepSel) state.sel = [];
  tools[state.tool].restored?.();
  afterChange();
}

// Undo and redo while editing a symbol stay in the editing, on the same
// instance, as long as it's still there.
function restoreInIso(s) {
  const was = iso && { path: iso.path, id: iso.sym.id };
  restore(s);
  if (!was) return;
  const inst = fromTreePath(was.path);
  if (symbolOf(inst)?.id === was.id) enterIso(inst, true);
}

function undo() {
  tools[state.tool].cancel?.();
  if (hIdx > 0) restoreInIso(hist[--hIdx]);
}

function redo() {
  if (hIdx < hist.length - 1) restoreInIso(hist[++hIdx]);
}

function afterChange() {
  rasterJob = null;
  $('#sc-undo').disabled = hIdx <= 0;
  $('#sc-redo').disabled = hIdx >= hist.length - 1;
  state.sel = state.sel.filter((el) => doc.contains(el));
  drawSelection();
  renderLayers();
  renderSymbols();
  updateTitle();
  tools[state.tool].redraw?.();
  if (curDoc) {
    curDoc.name = state.fileName;
    curDoc.svg = serialize();
    curDoc.title = state.meta.title || '';
  }
  renderTabs();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDocs, 400);
  srcSchedule();
  scheduleIconPreview();
}
