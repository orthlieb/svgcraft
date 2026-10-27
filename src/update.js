// SVGCraft — Updates. A copy of SVGCraft that's open, installed or not,
// asks the server now and then whether there's a newer version (the
// server's src/version.js against the APP_VERSION it's running) and, when
// there is and the internet is there, offers to update: reloading fetches
// the new files, and the open drawings are kept in this browser.
'use strict';

// Only a copy served over the web can update; one opened from disk is
// whatever is on the disk.
const canUpdate = /^https?:$/.test(location.protocol);
const UPDATE_EVERY = 60 * 60 * 1000;
let updateChecked = 0;
let updateDismissed = '';

// The server's version, or null when it can't be reached.
async function serverVersion() {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch('src/version.js', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(/APP_VERSION = '([0-9a-f]+)'/)?.[1] || null;
  } catch {
    return null;
  }
}

// Looks for a newer version. Asked for (Help → Check for Updates…), it
// says what it found either way; otherwise it's quiet unless there's one,
// and doesn't offer again one that was put off with Later.
async function checkForUpdate(asked = false) {
  if (!canUpdate) {
    if (asked) warn('This copy of SVGCraft was opened from a file, so it can’t update itself.');
    return;
  }
  updateChecked = Date.now();
  const v = await serverVersion();
  if (!v) {
    if (asked) warn('Couldn’t check for updates: SVGCraft can’t reach the internet.');
    return;
  }
  if (v === APP_VERSION) {
    if (asked) say(`SVGCraft is up to date (version ${APP_VERSION}).`);
    return;
  }
  if (asked || v !== updateDismissed) {
    const bar = $('#sc-update');
    bar.dataset.version = v;
    bar.hidden = false;
  }
}

$('#sc-update-now').addEventListener('click', () => {
  saveNow();
  location.reload();
});
$('#sc-update-later').addEventListener('click', () => {
  const bar = $('#sc-update');
  updateDismissed = bar.dataset.version;
  bar.hidden = true;
});
actions.checkUpdates = () => checkForUpdate(true);

if (canUpdate) {
  ready.then(() => checkForUpdate());
  addEventListener('online', () => checkForUpdate());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - updateChecked > UPDATE_EVERY / 4)
      checkForUpdate();
  });
  setInterval(() => checkForUpdate(), UPDATE_EVERY);
}
