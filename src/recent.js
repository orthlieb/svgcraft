// SVGCraft — File → Open Recent: the last files opened or saved, newest first.
'use strict';

// Kept in this browser's IndexedDB with the open drawings. Where the
// browser hands over the file itself (Chromium: File → Open, a drop, Save
// As…, the installed app opening an .svg), the entry is that file, and
// reopening it reads what's there now; elsewhere it's a copy of the file
// as it was opened (up to RECENT_COPY_MAX), as no browser lets a page open a
// file by its path. Choosing a file that's already open switches to its tab.
const RECENT_MAX = 10;
const RECENT_COPY_MAX = 5e6;
let recentList = []; // { name, handle?, file? }
// One change at a time, each on the list the one before left.
let recentQueue = idb
  .get('recent')
  .then((list) => {
    recentList = Array.isArray(list) ? list.filter((e) => e?.name) : [];
  })
  .catch(() => {})
  .then(renderRecent);
const changeRecent = (fn) =>
  (recentQueue = recentQueue
    .then(async () => {
      recentList = (await fn(recentList)).slice(0, RECENT_MAX);
      renderRecent();
      await idb.set('recent', recentList);
    })
    .catch(() => {}));

// Is entry e the file h (a handle) or `name` (a copy)?
async function isRecent(e, name, h) {
  if (h) return !!e.handle && (await e.handle.isSameEntry(h).catch(() => false));
  return !e.handle && e.name === name;
}

// Note a file opened (file: what was read; handle: the file itself, if the
// browser gave it) or saved (handle only).
function noteRecent(file, handle) {
  const h = isFileHandle(handle) ? handle : null;
  if (!h && !(file && file.size <= RECENT_COPY_MAX)) return;
  const entry = h ? { name: h.name, handle: h } : { name: file.name, file };
  changeRecent(async (list) => {
    const keep = [];
    for (const e of list) if (!(await isRecent(e, entry.name, h))) keep.push(e);
    return [entry, ...keep];
  });
}

async function openRecent(i) {
  const e = recentList[i];
  if (!e) return;
  if (!e.handle) return importFile(e.file, 'open');
  // Already open: its tab.
  for (const d of docs)
    if (d.handle && (await d.handle.isSameEntry(e.handle).catch(() => false))) return switchDoc(d);
  try {
    const ok =
      (await e.handle.queryPermission({ mode: 'read' })) === 'granted' ||
      (await e.handle.requestPermission({ mode: 'read' })) === 'granted';
    if (!ok) return warn(`SVGCraft wasn’t allowed to open ${e.name}.`);
    importFile(await e.handle.getFile(), 'open', e.handle);
  } catch (err) {
    if (err.name !== 'NotFoundError') return warn(`Couldn’t open ${e.name}: ${err.message}`);
    warn(`${e.name} isn’t where it was any more: it’s gone from Open Recent.`);
    changeRecent((list) => list.filter((x) => x !== e));
  }
}

function clearRecent() {
  changeRecent(() => []);
}

function renderRecent() {
  const list = $('#sc-recent-list');
  if (!list) return;
  const item = (text, attrs = {}) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    const s = document.createElement('span');
    s.textContent = text;
    b.append(document.createElement('i'), s);
    return b;
  };
  list.replaceChildren(
    ...(recentList.length
      ? [
          ...recentList.map((e, i) => item(e.name, { 'data-recent': i })),
          document.createElement('hr'),
          item('Clear Recent File List', { 'data-recent-clear': '' }),
        ]
      : [item('No recent files', { disabled: '' })]),
  );
}

$('#sc-recent-list')?.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  closeMenus();
  if (b.hasAttribute('data-recent-clear')) clearRecent();
  else openRecent(+b.dataset.recent);
});
