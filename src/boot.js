// SVGCraft — Start-up, and window.svgcraft for tests and the console.
'use strict';

// Boot ----------------------------------------------------------------
hydrateIcons();
const savedView = stored(VIEW_KEY, {});
if (savedView && typeof savedView === 'object') Object.assign(state, savedView);
$('#sc-stage-wrap').classList.toggle('no-rulers', !state.rulers);
syncViewMenu();
syncTheme();
wireStyle();
wireGradEditor();
wirePatEditor();
wireLibraries();
wireSymbols();
wireLayerStyle();
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
  } else {
    // Back to editing: what the preview hid comes back.
    clearPeeks();
    stopAnimations();
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
  actions,
  syncActions,
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

// As an app ------------------------------------------------------------
// Served over the web (not opened from disk), a service worker keeps the
// files so SVGCraft works offline, and the browser can install it (see
// sw.js and manifest.webmanifest). File → Install SVGCraft… shows when the
// browser offers it; installed, .svg files can be opened with SVGCraft.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol))
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* no offline copy this time */
  });
let installPrompt = null;
const installItem = $('[data-action="installApp"]');
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installItem.hidden = false;
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  installItem.hidden = true;
  say('SVGCraft is installed: open it from your apps, even offline.');
});
actions.installApp = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installItem.hidden = true;
};
if ('launchQueue' in window)
  window.launchQueue.setConsumer(async ({ files }) => {
    await ready;
    for (const h of files || []) importFile(await h.getFile(), 'open', h);
  });
