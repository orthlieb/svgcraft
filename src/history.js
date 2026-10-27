// SVGCraft — Undo / redo history and autosave.
'use strict';

// ---------------------------------------------------------------------
// History + autosave
// ---------------------------------------------------------------------
const hist = [];
let hIdx = -1;
let saveTimer = 0;
// What the next step is called in the History panel: set by whatever
// starts it (a command, a tool's drag, a panel control) and used up by
// commit().
let stepLabel = '';
const noteStep = (label) => (stepLabel = label);

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
  hist.push({ ...snapshot(), label: stepLabel || 'Edit' });
  stepLabel = '';
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

// The History panel, as in Photoshop: every step since the drawing was
// opened (the last 150); click one to go back to it. Steps after the
// current one are dimmed until a new change replaces them.
function goToStep(i) {
  if (i === hIdx || !hist[i]) return;
  tools[state.tool].cancel?.();
  hIdx = i;
  restoreInIso(hist[i]);
}
function renderHistory() {
  const list = $('#sc-history');
  list.replaceChildren(
    ...hist.map((s, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = i === 0 ? 'Open' : s.label || 'Edit';
      b.className = i === hIdx ? 'on' : i > hIdx ? 'after' : '';
      if (i === hIdx) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', () => goToStep(i));
      li.append(b);
      return li;
    }),
  );
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function afterChange() {
  rasterJob = null;
  $('#sc-undo').disabled = hIdx <= 0;
  $('#sc-redo').disabled = hIdx >= hist.length - 1;
  state.sel = state.sel.filter((el) => doc.contains(el));
  drawSelection();
  renderLayers();
  renderSymbols();
  renderHistory();
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

// Naming the steps. Each new click or key starts afresh (dialogs keep the
// name of the command that opened them), then the command, tool or control
// it reaches names it.
const STEP_NAMES = {
  clipMake: 'Create Clipping Mask',
  clipRelease: 'Release Clipping Mask',
  duplicate: 'Duplicate Layer',
  delete: 'Delete',
};
function stepName(action) {
  if (STEP_NAMES[action]) return STEP_NAMES[action];
  const b = document.querySelector(`[data-action="${action}"]`);
  const text = b?.querySelector('span')?.textContent || b?.getAttribute('aria-label');
  return (text || action).replace(/…$/, '').trim();
}
const inDialog = (t) => t.closest?.('dialog, .sc-dialog');
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!inDialog(e.target)) stepLabel = '';
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (!inDialog(e.target) && !e.target.matches?.('input, textarea, [contenteditable]'))
      stepLabel = '';
  },
  true,
);
// The panels' and options bar's own controls: named by their label.
const controlName = (el) =>
  (
    el.getAttribute('aria-label') ||
    el.dataset.tip ||
    el.closest('label')?.textContent ||
    el.textContent ||
    ''
  )
    .split(' — ')[0]
    .replace(/\s+/g, ' ')
    .trim();
function noteControl(e) {
  const el = e.target.closest?.('input, select, button');
  if (!el || el.closest('[data-action], [role="tab"], dialog') || inDialog(el)) return;
  if (!el.closest('#sc-panel, #sc-options')) return;
  const name = controlName(el);
  if (name) noteStep(name.charAt(0).toUpperCase() + name.slice(1));
}
for (const type of ['change', 'input', 'click']) document.addEventListener(type, noteControl, true);
