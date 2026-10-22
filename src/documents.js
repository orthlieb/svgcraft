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
function saveDocs() {
  if (!docsLoaded) return;
  const data = {
    active: curDoc?.id,
    docs: docs.map((d) => ({
      id: d.id,
      name: d.name,
      svg: d.svg,
      // The last-saved version is only stored while it differs.
      saved: dirty(d) ? d.saved : null,
      view: d === curDoc ? { zoom: state.zoom, panX: state.panX, panY: state.panY } : d.view,
    })),
  };
  idb.set('docs', data).catch(() => {
    if (saveWarned) return;
    saveWarned = true;
    say('Couldn’t keep a copy in this browser: its storage is full or blocked.');
  });
}

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
  add.dataset.tip = 'New document · File → New';
  add.addEventListener('click', () => newDoc());
  bar.append(add);
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

// Park the current tab's drawing, history and view.
function stashDoc() {
  if (!curDoc) return;
  tools[state.tool].leave?.();
  exitIso();
  curDoc.name = state.fileName;
  curDoc.svg = serialize();
  curDoc.hist = hist.slice();
  curDoc.hIdx = hIdx;
  curDoc.view = { zoom: state.zoom, panX: state.panX, panY: state.panY };
}

// Bring a document onto the canvas: its live history if it has one,
// otherwise its saved drawing.
function showDoc(d) {
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
  if (d.view) {
    Object.assign(state, d.view);
    applyView();
  } else fit();
  afterChange();
}

function switchDoc(d) {
  if (d === curDoc) return;
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
  return d;
}

// File → New, and New Icon with its size, name and margin guides.
function newDoc({ w = 800, h = 600, name = nextUntitled(), guides = [] } = {}) {
  const d = addDoc(name);
  tools[state.tool].leave?.();
  dropIso();
  doc.replaceChildren();
  defs.replaceChildren();
  state.sel = [];
  state.guides = guides;
  state.meta = {};
  setSize(w, h);
  renderGuides();
  fit();
  commit();
  d.saved = d.svg;
  renderTabs();
}

// File → Open (and dropping a file on an empty canvas): a tab of its own.
function openDoc(text, name) {
  if (!pristine(curDoc)) addDoc(name.replace(/\.svg$/i, ''));
  openSvg(text, name);
  hist.splice(0, hist.length - 1);
  hIdx = 0;
  afterChange();
}

async function closeDoc(d) {
  if (dirty(d)) {
    const ok = await ask(`Close ${d.name}.svg?`, {
      text: 'It has changes you haven’t saved. Close it anyway?',
      ok: 'Close',
    });
    if (!ok) return;
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
  else newDoc();
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
  try {
    data = await idb.get('docs');
  } catch {
    /* IndexedDB blocked: tabs just won't survive a reload */
  }
  let list = Array.isArray(data?.docs) ? data.docs.filter((d) => typeof d?.svg === 'string') : [];
  if (!list.length) {
    try {
      const old = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (old?.svg)
        list = [{ id: 'restored', name: old.name || 'drawing', svg: old.svg, saved: null }];
    } catch {
      /* nothing from the old autosave */
    }
  }
  if (list.length) {
    const fresh = curDoc && !dirty(curDoc) && !items().length;
    const restored = list.map((d) => ({
      id: String(d.id),
      name: String(d.name || 'Untitled'),
      svg: d.svg,
      saved: d.saved ?? d.svg,
      view: d.view,
    }));
    // Anything done before the stored drawings arrived stays as a tab too.
    if (fresh) docs.length = 0;
    else stashDoc();
    docs.push(...restored);
    try {
      showDoc(restored.find((d) => d.id === data?.active) || restored[0]);
    } catch {
      say('A drawing saved in this browser couldn’t be reopened.');
    }
  }
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* fine */
  }
  docsLoaded = true;
  renderTabs();
  saveDocs();
}
