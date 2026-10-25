// SVGCraft — File → New…: Photoshop's New Document dialog.
'use strict';

// Categories of presets down the left, the document's details on the
// right: name, width and height in any units, orientation and background.
// Recent holds the last few sizes made; the dialog remembers the last
// settings. Icon templates have their own dialog (File → New Icon…).
const ND_KEY = 'svgcraft.newDoc';
const ND_PRESETS = {
  web: [
    ['Default', 800, 600, 'px'],
    ['Web (large)', 1920, 1080, 'px'],
    ['Web (medium)', 1366, 768, 'px'],
    ['Web (small)', 1280, 800, 'px'],
    ['Minimum', 1024, 768, 'px'],
    ['Leaderboard ad', 728, 90, 'px'],
    ['Medium rectangle ad', 300, 250, 'px'],
  ],
  social: [
    ['Instagram post', 1080, 1080, 'px'],
    ['Instagram portrait', 1080, 1350, 'px'],
    ['Story / Reel', 1080, 1920, 'px'],
    ['X post', 1600, 900, 'px'],
    ['Link preview (Open Graph)', 1200, 630, 'px'],
    ['YouTube thumbnail', 1280, 720, 'px'],
    ['LinkedIn banner', 1584, 396, 'px'],
  ],
  mobile: [
    ['iPhone 16', 393, 852, 'px'],
    ['iPhone 16 Pro Max', 440, 956, 'px'],
    ['iPhone SE', 375, 667, 'px'],
    ['Android', 360, 800, 'px'],
    ['iPad', 820, 1180, 'px'],
    ['iPad Pro 13″', 1032, 1376, 'px'],
    ['Apple Watch', 198, 242, 'px'],
  ],
  print: [
    ...Object.values(PAGE_PRESETS)
      .filter(([, , , u]) => u !== 'px')
      .map(([name, a, b, u]) => [name, a, b, u]),
    ['A2', 420, 594, 'mm'],
    ['Postcard', 4, 6, 'in'],
    ['Poster', 18, 24, 'in'],
  ],
};
const ND_CATS = {
  recent: 'Recent',
  web: 'Web',
  social: 'Social',
  mobile: 'Mobile',
  print: 'Print',
};
const ND_BACKGROUNDS = {
  none: 'Transparent',
  '#ffffff': 'White',
  '#000000': 'Black',
  custom: 'Custom',
};

function ndLoad() {
  const v = stored(ND_KEY, {});
  return v && typeof v === 'object' ? v : {};
}
function ndSave(v) {
  store(ND_KEY, v);
}

const ndDlg = $('#sc-newdoc');
const ndField = (k) => ndDlg.querySelector(`[data-nd="${k}"]`);
// The size being set up, in pixels, and the units shown.
const nd = { w: 800, h: 600, units: 'px', cat: 'web', pick: null };
for (const [k, [name]] of Object.entries(UNITS))
  ndField('units').append(
    Object.assign(document.createElement('option'), { value: k, textContent: name }),
  );
for (const [k, label] of Object.entries(ND_BACKGROUNDS))
  ndField('bg').append(
    Object.assign(document.createElement('option'), { value: k, textContent: label }),
  );
for (const [k, label] of Object.entries(ND_CATS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'tab');
  b.dataset.ndCat = k;
  b.textContent = label;
  b.addEventListener('click', () => {
    nd.cat = k;
    ndRender();
  });
  $('#sc-nd-cats').append(b);
}

const ndLen = (px, u) => f(px / UNITS[u][1]);
const ndSize = ([, a, b, u]) => `${a} × ${b} ${u}`;
function ndPresets() {
  if (nd.cat !== 'recent') return ND_PRESETS[nd.cat];
  return (ndLoad().recent || [])
    .filter((r) => Array.isArray(r) && r.length === 4 && UNITS[r[2]])
    .map(([w, h, u, name]) => [name || 'Recent', ndLen(w, u), ndLen(h, u), u]);
}
function ndRender() {
  for (const b of ndDlg.querySelectorAll('[data-nd-cat]'))
    b.setAttribute('aria-selected', b.dataset.ndCat === nd.cat);
  const list = $('#sc-nd-presets');
  const items = ndPresets();
  list.replaceChildren(
    ...items.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-nd-preset';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', nd.pick === p);
      const n = document.createElement('b');
      n.textContent = p[0];
      const s = document.createElement('span');
      s.textContent = ndSize(p);
      b.append(n, s);
      b.addEventListener('click', () => ndPick(p));
      b.addEventListener('dblclick', () => closeNewDoc(true));
      return b;
    }),
  );
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'sc-hint';
    p.textContent = 'Documents you make show up here.';
    list.append(p);
  }
}
// A preset: its size and units go into the details.
function ndPick(p) {
  const [, a, b, u] = p;
  nd.pick = p;
  nd.units = u;
  nd.w = a * UNITS[u][1];
  nd.h = b * UNITS[u][1];
  ndShow();
  ndRender();
}
function ndShow() {
  ndField('units').value = nd.units;
  ndField('w').value = ndLen(nd.w, nd.units);
  ndField('h').value = ndLen(nd.h, nd.units);
  for (const el of ndDlg.querySelectorAll('[data-nd-unit]')) el.textContent = nd.units;
  for (const b of ndDlg.querySelectorAll('[data-nd-orient]'))
    b.setAttribute('aria-checked', (b.dataset.ndOrient === 'landscape') === nd.w > nd.h);
  ndField('colour').hidden = ndField('bg').value !== 'custom';
}

function openNewDoc() {
  const last = ndLoad();
  nd.units = UNITS[last.units] ? last.units : 'px';
  nd.w = clamp(+last.w || 800, 1, 20000);
  nd.h = clamp(+last.h || 600, 1, 20000);
  nd.cat = last.recent?.length ? 'recent' : 'web';
  nd.pick = null;
  ndField('name').value = nextUntitled();
  ndField('bg').value = ND_BACKGROUNDS[last.bg] ? last.bg : 'none';
  ndField('colour').value = /^#[0-9a-f]{6}$/i.test(last.colour || '') ? last.colour : '#ffffff';
  ndShow();
  ndRender();
  showDialog(ndDlg, () => closeNewDoc(false));
  setTimeout(() => ndField('name').select(), 0);
}
function closeNewDoc(ok) {
  if (!ok) return hideDialog(ndDlg);
  const u = nd.units;
  const w = +ndField('w').value * UNITS[u][1];
  const h = +ndField('h').value * UNITS[u][1];
  if (!(w >= 1 && h >= 1 && w <= 20000 && h <= 20000))
    return say('The document must be 1 to 20,000 px each way.');
  hideDialog(ndDlg);
  const bg = ndField('bg').value;
  const colour = ndField('colour').value;
  const name =
    ndField('name')
      .value.trim()
      .replace(/\.svg$/i, '')
      .slice(0, 120) || nextUntitled();
  // Recent: newest first, no repeats, five at most.
  const last = ndLoad();
  const size = [f(w), f(h), u, nd.pick?.[0] || ''];
  const same = (r) => r[0] === size[0] && r[1] === size[1] && r[2] === size[2];
  const recent = [size, ...(last.recent || []).filter((r) => Array.isArray(r) && !same(r))].slice(
    0,
    5,
  );
  ndSave({ w, h, units: u, bg, colour, recent });
  newDoc({
    w,
    h,
    name,
    units: u,
    background: bg === 'custom' ? colour : bg === 'none' ? null : bg,
  });
}

ndField('units').addEventListener('change', () => {
  nd.units = ndField('units').value;
  ndShow();
});
for (const k of ['w', 'h'])
  ndField(k).addEventListener('input', () => {
    const v = +ndField(k).value;
    if (v > 0) nd[k] = v * UNITS[nd.units][1];
    nd.pick = null;
    for (const b of ndDlg.querySelectorAll('[data-nd-orient]'))
      b.setAttribute('aria-checked', (b.dataset.ndOrient === 'landscape') === nd.w > nd.h);
    for (const b of ndDlg.querySelectorAll('.sc-nd-preset')) b.setAttribute('aria-selected', false);
  });
for (const b of ndDlg.querySelectorAll('[data-nd-orient]'))
  b.addEventListener('click', () => {
    if ((b.dataset.ndOrient === 'landscape') === nd.w > nd.h || nd.w === nd.h) return;
    [nd.w, nd.h] = [nd.h, nd.w];
    ndShow();
  });
ndField('bg').addEventListener('change', ndShow);
ndDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('[data-nd-btn="cancel"], select, [data-nd-cat]')) {
    e.preventDefault();
    closeNewDoc(true);
  } else if (e.key === 'Escape') closeNewDoc(false);
});
ndDlg.querySelector('[data-nd-btn="ok"]').addEventListener('click', () => closeNewDoc(true));
ndDlg.querySelector('[data-nd-btn="cancel"]').addEventListener('click', () => closeNewDoc(false));
ndDlg.querySelector('[data-nd-btn="icon"]').addEventListener('click', () => {
  hideDialog(ndDlg);
  openNewIcon();
});
