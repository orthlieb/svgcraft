// SVGCraft — Start-up, and window.svgcraft for tests and the console.
'use strict';

// Boot ----------------------------------------------------------------
hydrateIcons();
try {
  Object.assign(state, JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'));
} catch {
  /* no saved view settings */
}
$('#sc-stage-wrap').classList.toggle('no-rulers', !state.rulers);
syncViewMenu();
syncTheme();
wireStyle();
wireGradEditor();
wirePatEditor();
wireLibraries();
wireSymbols();
wireLayerStyle();
wireSource();
wireScrubbers();
bindNumber('#sc-smooth', 'smoothing');
bindNumber('#sc-eraser-size', 'eraserSize');
syncTypeUI();
syncStyleUI();
setGrid();
setTool('select');
// Phones preview, tablets and up edit. Below tablet size the editor
// becomes a viewer (see .sc-preview in style.css): open, tabs, pan and
// pinch-zoom, fit.
const previewQuery = matchMedia('(max-width: 767px), (max-height: 500px) and (pointer: coarse)');
function syncPreview() {
  const on = previewQuery.matches;
  if (on === previewMode) return;
  previewMode = on;
  document.documentElement.classList.toggle('sc-preview', on);
  if (on) {
    if (state.tf) endTransform(true);
    state.sel = [];
  }
  setTool(on ? 'hand' : 'select');
  requestAnimationFrame(() => fit());
}
previewQuery.addEventListener('change', syncPreview);
syncPreview();

// Start on a blank Untitled-1 at once; the drawings kept in this browser
// replace it as soon as they're read back.
newDoc();
const ready = loadDocs();

// Exposed for the smoke test and for poking at from the console.
window.svgcraft = {
  ready,
  paintBox,
  docs,
  state,
  serialize,
  openSvg,
  placeSvg,
  setTool,
  undo,
  redo,
  cmds,
  commit,
  readStyle,
  parsePathD,
  nodesD,
  shapeNodes,
  tools,
  makeSymbol,
  placeSymbol,
  editSymbol: (el) => (el ? enterIso(el) : editSymbol()),
  exitIso,
  breakSymbolLink,
  renameSymbol: (id) => renameSymbol(symById(id)),
  deleteSymbol: (id) => deleteSymbol(symById(id)),
  get iso() {
    return iso && { symbol: iso.sym.id, instance: iso.inst };
  },
};
