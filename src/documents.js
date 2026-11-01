// SVGCraft — Documents: one tab per open drawing, kept in this browser.
'use strict';

// ---------------------------------------------------------------------
// Documents: one tab per open drawing, kept in this browser
// ---------------------------------------------------------------------
// Each tab has its own drawing, undo history and view. All open drawings
// are saved in IndexedDB as they change and come back on reload. A tab's
// name gets a * while its drawing differs from the version last opened or
// saved (File → Save / Export SVG). Undo back to that version and the *
// goes away again.
const docs = []; // { id, name, svg, saved, hist, hIdx, view }
let curDoc = null;
let docsLoaded = false;
const dirty = (d) => d.svg !== d.saved;

const idb = (() => {
  let dbp = null;
  const open = () =>
    (dbp ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('svgcraft', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (k) => run('readonly', (st) => st.get(k)),
    set: (k, v) => run('readwrite', (st) => st.put(v, k)),
  };
})();

let saveWarned = false;
function docsData() {
  return {
    active: curDoc?.id,
    docs: docs.map((d) => ({
      id: d.id,
      name: d.name,
      svg: d.svg,
      // The last-saved version is only stored while it differs.
      saved: dirty(d) ? d.saved : null,
      view: d === curDoc ? currentView() : d.view,
      handle: d.handle || null,
    })),
  };
}
function saveDocs() {
  if (!docsLoaded) return;
  idb.set('docs', docsData()).catch(() => {
    if (saveWarned) return;
    saveWarned = true;
    warn('Couldn’t keep a copy in this browser: its storage is full or blocked.');
  });
}

// Saving waits for a pause in the changes (see afterChange). Switching
// away from the page saves at once. Closing or reloading it does too, and
// as IndexedDB may not finish writing before the page goes, the tabs are
// also written to localStorage there, which is immediate; loadDocs takes
// that copy first. (A drawing too big for localStorage relies on IndexedDB.)
const PENDING_KEY = 'svgcraft.docs.pending';
function saveNow() {
  clearTimeout(saveTimer);
  saveDocs();
}
addEventListener('pagehide', () => {
  if (!docsLoaded) return;
  clearTimeout(saveTimer);
  const data = docsData();
  idb.set('docs', data).catch(() => {});
  // (A file handle can only be kept in IndexedDB.)
  store(PENDING_KEY, { ...data, docs: data.docs.map((d) => ({ ...d, handle: null })) });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

function renderTabs() {
  const bar = $('#sc-doctabs');
  if (!bar) return;
  bar.replaceChildren(
    ...docs.map((d) => {
      const t = document.createElement('div');
      t.className = 'sc-doctab';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', d === curDoc);
      t.dataset.doc = d.id;
      const label = document.createElement('span');
      label.className = 'sc-doctab-name';
      if (d === curDoc) label.id = 'sc-doc-title';
      else label.textContent = `${d.name}.svg${dirty(d) ? '*' : ''}`;
      // File Info's title, when there is one, names the tab's drawing.
      const title = docTitle(d);
      if (title) t.dataset.tip = `${title} · ${d.name}.svg`;
      const x = document.createElement('button');
      x.className = 'sc-doctab-x';
      x.innerHTML = icon('xmark');
      x.setAttribute('aria-label', `Close ${d.name}.svg`);
      x.dataset.tip = 'Close';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDoc(d);
      });
      t.append(label, x);
      t.addEventListener('click', () => switchDoc(d));
      // Middle-click closes, as in browsers.
      t.addEventListener('auxclick', (e) => e.button === 1 && closeDoc(d));
      return t;
    }),
  );
  const add = document.createElement('button');
  add.className = 'sc-doctab-new';
  add.innerHTML = icon('plus');
  add.setAttribute('aria-label', 'New document');
  add.dataset.tip = 'New document';
  add.addEventListener('click', () => openNewDoc());
  bar.append(add);
  syncNoDoc();
  updateTitle();
}

// A tab's File Info title (read once from its saved drawing).
function docTitle(d) {
  if (d === curDoc) return state.meta.title || '';
  if (d.title == null) {
    try {
      const root = new DOMParser().parseFromString(d.svg, 'image/svg+xml').documentElement;
      d.title = root.localName === 'svg' ? readMeta(root).title || '' : '';
    } catch {
      d.title = '';
    }
  }
  return d.title;
}

// The view to keep with a drawing: where it was, or that it was fitted.
const currentView = () =>
  isFitted() ? { fitted: true } : { zoom: state.zoom, panX: state.panX, panY: state.panY };
// Park the current tab's drawing, history and view.
function stashDoc() {
  if (!curDoc) return;
  tools[state.tool].leave?.();
  exitIso();
  setScope(null);
  curDoc.name = state.fileName;
  curDoc.svg = serialize();
  curDoc.hist = hist.slice();
  curDoc.hIdx = hIdx;
  curDoc.view = currentView();
}

// Bring a document onto the canvas: its live history if it has one,
// otherwise its saved drawing.
function showDoc(d) {
  if (typeof clearPeeks === 'function') clearPeeks();
  curDoc = d;
  state.fileName = d.name;
  state.sel = [];
  hist.length = 0;
  if (d.hist?.length) {
    hist.push(...d.hist);
    hIdx = d.hIdx;
    restore(hist[hIdx]);
    loadDocFonts();
  } else {
    // Reopening can tidy the markup a little; that isn't a change.
    const wasClean = !dirty(d);
    hIdx = -1;
    openSvg(d.svg, d.name, { keepSaved: true });
    hist.splice(0, hist.length - 1);
    hIdx = 0;
    if (wasClean) d.saved = d.svg = serialize();
  }
  // Fitted when it was put away: fitted again, to the window as it is now.
  if (d.view && !d.view.fitted) {
    Object.assign(state, d.view);
    applyView();
  } else fit();
  afterChange();
}

function switchDoc(d) {
  if (d === curDoc) return;
  // An edit in SVG Source is this tab's: it goes.
  if (srcEdit.on) endSrcEdit();
  stashDoc();
  showDoc(d);
}

function nextUntitled() {
  let n = 1;
  while (docs.some((d) => d.name === `Untitled-${n}`)) n++;
  return `Untitled-${n}`;
}

// A pristine untitled tab gets reused by Open instead of piling up.
const pristine = (d) => d && /^Untitled-\d+$/.test(d.name) && !dirty(d) && !items().length;

function addDoc(name) {
  stashDoc();
  const d = { id: Math.random().toString(36).slice(2, 10), name, svg: '', saved: '' };
  docs.splice(curDoc ? docs.indexOf(curDoc) + 1 : docs.length, 0, d);
  curDoc = d;
  state.fileName = name;
  hist.length = 0;
  hIdx = -1;
  // Out of the blank workspace now, before the drawing goes in: hidden, its
  // layers would measure nothing (an opened file's animations need sizes).
  syncNoDoc();
  return d;
}

// A new tab (File → New… and New Icon… set it up). A background colour
// is a full-size "Background" layer at the bottom, locked in place.
function newDoc({
  w = 800,
  h = 600,
  name = nextUntitled(),
  guides = [],
  units = 'px',
  background = null,
} = {}) {
  const d = addDoc(name);
  tools[state.tool].leave?.();
  dropIso();
  doc.replaceChildren();
  defs.replaceChildren();
  state.sel = [];
  state.guides = guides;
  state.meta = {};
  state.units = units;
  setSize(w, h);
  if (background)
    mk(
      'rect',
      {
        width: f(state.w),
        height: f(state.h),
        fill: background,
        'data-name': 'Background',
        'data-sc-lock': 'position',
      },
      doc,
    );
  renderGuides();
  fit();
  commit();
  d.saved = d.svg;
  renderTabs();
}

// File → Open (and dropping a file on an empty canvas): a tab of its own,
// keeping the file to save back to when the browser gives it (save.js).
function openDoc(text, name, handle) {
  if (!pristine(curDoc)) addDoc(name.replace(/\.svg$/i, ''));
  curDoc.handle = isFileHandle(handle) ? handle : null;
  openSvg(text, name);
  hist.splice(0, hist.length - 1);
  hIdx = 0;
  afterChange();
}

// A drawing with unsaved changes asks first: Save (the
// default) saves it and then closes it, unless the save didn't happen;
// Don't Save drops the changes; Cancel keeps it open.
async function closeDoc(d) {
  if (dirty(d)) {
    if (d !== curDoc) switchDoc(d);
    const r = await ask(`Save changes to ${d.name}.svg before closing?`, {
      text: 'Your changes will be lost if you don’t save them.',
      ok: 'Save',
      alt: 'Don’t Save',
    });
    if (!r) return;
    if (r !== 'alt') {
      if (d !== curDoc) switchDoc(d);
      await saveDoc();
      if (dirty(d)) return;
    }
  }
  const i = docs.indexOf(d);
  if (i < 0) return;
  docs.splice(i, 1);
  if (d !== curDoc) {
    renderTabs();
    saveDocs();
    return;
  }
  curDoc = null;
  if (docs.length) showDoc(docs[Math.min(i, docs.length - 1)]);
  else showNoDoc();
}

// Every tab closed: a blank workspace until File → New or Open (or a file
// dropped on it). The drawing underneath is emptied and nothing edits it:
// the panels, toolbar and options bar go inert and the commands grey out.
function showNoDoc() {
  tools[state.tool].leave?.();
  dropIso();
  curDoc = null;
  doc.replaceChildren();
  defs.replaceChildren();
  state.sel = [];
  state.guides = [];
  state.meta = {};
  hist.length = 0;
  hIdx = -1;
  renderGuides();
  afterChange();
  saveDocs();
}
function syncNoDoc() {
  const none = !curDoc;
  document.body.classList.toggle('sc-no-doc', none);
  for (const el of document.querySelectorAll(
    '#sc-panel > .sc-pgroup, .sc-dock-strip, .sc-options, .sc-tools, #sc-split',
  ))
    el.inert = none;
  $('#sc-nodoc').hidden = !none;
}

// Save marks the drawing as saved: the * goes until it changes again.
function markSaved() {
  if (!curDoc) return;
  curDoc.svg = curDoc.saved = serialize();
  renderTabs();
  saveDocs();
}

// Bring back the drawings open last time (or the single drawing an older
// version autosaved).
async function loadDocs() {
  let data = null;
  let kept = null;
  try {
    kept = await idb.get('docs');
  } catch {
    /* IndexedDB blocked: tabs just won't survive a reload */
  }
  // Written as the page closed: newer than anything in IndexedDB, but
  // without the files to save back to, which only IndexedDB keeps.
  const pending = stored(PENDING_KEY);
  store(PENDING_KEY, null);
  if (Array.isArray(pending?.docs)) {
    const handles = new Map((kept?.docs || []).map((d) => [d?.id, d?.handle]));
    for (const d of pending.docs) d.handle = handles.get(d.id) || null;
    data = pending;
    idb.set('docs', pending).catch(() => {});
  } else data = kept;
  let list = Array.isArray(data?.docs) ? data.docs.filter((d) => typeof d?.svg === 'string') : [];
  if (!list.length) {
    const old = stored(STORE_KEY);
    if (typeof old?.svg === 'string')
      list = [{ id: 'restored', name: old.name || 'drawing', svg: old.svg, saved: null }];
  }
  if (!list.length && Array.isArray(data?.docs) && curDoc && !dirty(curDoc) && !items().length) {
    // Closed everything last time: blank again.
    docs.length = 0;
    docsLoaded = true;
    showNoDoc();
    return;
  }
  if (list.length) {
    const fresh = curDoc && !dirty(curDoc) && !items().length;
    const restored = list.map((d) => ({
      id: String(d.id),
      name: String(d.name || 'Untitled'),
      svg: d.svg,
      saved: d.saved ?? d.svg,
      view: d.view,
      handle: isFileHandle(d.handle) ? d.handle : null,
    }));
    // Anything done before the stored drawings arrived stays as a tab too.
    if (fresh) docs.length = 0;
    else stashDoc();
    docs.push(...restored);
    try {
      showDoc(restored.find((d) => d.id === data?.active) || restored[0]);
    } catch {
      warn('A drawing saved in this browser couldn’t be reopened.');
    }
  }
  store(STORE_KEY, null);
  docsLoaded = true;
  renderTabs();
  saveDocs();
}
