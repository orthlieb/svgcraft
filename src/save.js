// SVGCraft — File → Save and Save As…, back to the file a drawing came from.
'use strict';

// In Chromium browsers a drawing opened from a file (File → Open, a drop,
// or the installed app opening an .svg) keeps a handle to it, and Save
// writes straight back there; the browser asks once a session before it
// lets the page change the file. Save As… picks a new file and saves there
// from then on. The handle is kept with the drawing in this browser, so
// after a reload Save still goes to the same file. Other browsers can't
// write to files: Save downloads the SVG, as Export does.
const canSaveFiles = 'showSaveFilePicker' in window;
const SVG_TYPES = [{ description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } }];
const OPEN_TYPES = [
  {
    description: 'SVG or image',
    accept: {
      'image/svg+xml': ['.svg'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
    },
  },
];
const isFileHandle = (h) => !!h && typeof h.createWritable === 'function';

// Write the drawing to `h`, asking for permission if need be; false if the
// browser (or the user) says no.
async function writeToFile(h) {
  const text = serialize({ fontCss: fontImport() });
  const ok =
    (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ||
    (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  if (!ok) return false;
  const w = await h.createWritable();
  await w.write(new Blob([text], { type: 'image/svg+xml' }));
  await w.close();
  return true;
}
// After a save: the tab takes the file's name and loses its *.
function savedTo(d, h) {
  d.handle = h;
  noteRecent(null, h);
  if (d !== curDoc) return;
  state.fileName = d.name = h.name.replace(/\.svg$/i, '');
  markSaved();
  updateTitle();
  say(`Saved ${h.name}`);
}

async function saveDoc() {
  if (!curDoc) return;
  if (!canSaveFiles) return exportSvg();
  const d = curDoc;
  const h = d.handle;
  if (!isFileHandle(h)) return saveDocAs();
  try {
    if (await writeToFile(h)) savedTo(d, h);
    else warn(`SVGCraft wasn’t allowed to change ${h.name}. Save As… saves it somewhere else.`);
  } catch (err) {
    if (err.name !== 'NotFoundError') return warn(`Couldn’t save ${h.name}: ${err.message}`);
    // Moved or deleted since it was opened: somewhere new.
    d.handle = null;
    say(`${h.name} isn’t where it was: choose where to save it.`);
    saveDocAs();
  }
}

async function saveDocAs() {
  if (!curDoc) return;
  if (!canSaveFiles) return exportSvg();
  const d = curDoc;
  let h;
  try {
    h = await showSaveFilePicker({
      suggestedName: `${state.fileName}.svg`,
      types: SVG_TYPES,
      ...(isFileHandle(d.handle) && { startIn: d.handle }),
    });
  } catch (err) {
    if (err.name !== 'AbortError') warn(`Couldn’t save: ${err.message}`);
    return;
  }
  try {
    if (await writeToFile(h)) savedTo(d, h);
    else warn(`SVGCraft wasn’t allowed to write ${h.name}.`);
  } catch (err) {
    warn(`Couldn’t save ${h.name}: ${err.message}`);
  }
}

// File → Open through the browser's file picker, which hands back a file
// Save can write to (the plain file input can't).
async function openWithHandle() {
  let h;
  try {
    [h] = await showOpenFilePicker({ types: OPEN_TYPES });
  } catch (err) {
    if (err.name !== 'AbortError') warn(`Couldn’t open: ${err.message}`);
    return;
  }
  importFile(await h.getFile(), 'open', h);
}

// The menu says what Save does here.
if (!canSaveFiles) {
  const save = $('.sc-menu-list [data-action="save"] span');
  if (save) save.textContent = 'Download SVG';
  $('.sc-menu-list [data-action="saveAs"]')?.setAttribute('hidden', '');
}
