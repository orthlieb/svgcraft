// SVGCraft — Image → Adjustments (Black & White…, Threshold…, Desaturate)
// and Image → Mode → Grayscale, rewriting the colours themselves.
'use strict';

// As in Photoshop these change the pixels, here the paint: every colour in
// the selected layers (or the whole drawing, with nothing selected) is
// rewritten in the file — fills, strokes, gradient stops, patterns,
// symbols and markers they use, Layer Style colours, and embedded images
// pixel by pixel — so any app opening the SVG sees the result. Gradients,
// patterns and symbols shared with layers outside the selection get a copy
// of their own first, so only the selection changes.

const ADJ_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];
const ADJ_REF_ATTRS = [
  'fill',
  'stroke',
  'filter',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'href',
  'xlink:href',
  'style',
];

// Any CSS colour → [r, g, b, a] (0–255, alpha 0–1); null for none,
// currentColor, url(…) and the like, which are left alone.
const adjCtx = document.createElement('canvas').getContext('2d');
function parseColor(v) {
  v = String(v || '').trim();
  if (!v || /url\(|^(none|transparent|currentcolor|inherit|initial|unset|context-\w+)$/i.test(v))
    return null;
  adjCtx.fillStyle = '#000001';
  adjCtx.fillStyle = v;
  const out = adjCtx.fillStyle;
  if (out === '#000001' && !/^#000001$/i.test(v)) return null; // not a colour
  if (out[0] === '#') return [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16)).concat(1);
  const n = out.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
}
const adjHex = (n) =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
const formatColor = ([r, g, b, a]) =>
  a >= 1
    ? `#${adjHex(r)}${adjHex(g)}${adjHex(b)}`
    : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${f(a)})`;

// The conversions: r, g, b (0–255) → a grey level.
const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const BW_DEFAULTS = { r: 40, y: 60, g: 40, c: 60, b: 20, m: 80 };
const ADJUST = {
  // Photoshop's Desaturate: the HSL lightness.
  desaturate: () => (r, g, b) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2,
  // Mode → Grayscale: the brightness the eye sees.
  grayscale: () => lumaOf,
  // Black & White: the darkest channel, plus each hue's share of the rest,
  // weighted by its slider (Photoshop's model).
  bw: (w) => (r, g, b) => {
    const ch = [
      ['r', r],
      ['g', g],
      ['b', b],
    ].sort((p, q) => q[1] - p[1]);
    const [[k1, max], [k2, mid], [, min]] = ch;
    const mix = { rg: 'y', gr: 'y', gb: 'c', bg: 'c', rb: 'm', br: 'm' }[k1 + k2];
    return min + (mid - min) * (w[mix] / 100) + (max - mid) * (w[k1] / 100);
  },
  // Threshold: black below the level, white from it up.
  threshold: (t) => (r, g, b) => (lumaOf(r, g, b) >= t ? 255 : 0),
};
const greyMap = (fn) => (c) => {
  const v = clamp(fn(c[0], c[1], c[2]), 0, 255);
  return [v, v, v, c[3]];
};

// ---- what changes ---------------------------------------------------------------
const adjRefs = (el) => {
  const ids = [];
  for (const a of ADJ_REF_ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    if (a.endsWith('href')) v.startsWith('#') && ids.push(v.slice(1));
    else for (const m of v.matchAll(/url\(\s*["']?#([^"')]+)["']?\s*\)/g)) ids.push(m[1]);
  }
  return ids;
};
const allIn = (root) => [root, ...root.querySelectorAll('*')];
// The elements to recolour: the layers and their insides, and the paint
// servers, symbols and markers they use (copied first where layers outside
// share them).
function adjustTargets() {
  const sel = normalizeSel(state.sel);
  if (!sel.length)
    return [...allIn(doc), ...defs.querySelectorAll('*')].filter(
      (el) => !el.closest?.('[data-sc-lock="all"]'),
    );
  const inScope = new Set(sel.flatMap(allIn));
  // Everything the selection reaches through url(#…) and href="#…".
  const used = new Set();
  const walk = (els) => {
    for (const el of els)
      for (const id of adjRefs(el)) {
        const t = document.getElementById(id);
        if (!t || inScope.has(t) || used.has(t)) continue;
        used.add(t);
        walk(allIn(t));
      }
  };
  walk(inScope);
  const usedSet = new Set([...used].flatMap(allIn));
  // Shared with something outside: a copy for the selection.
  const others = [...doc.querySelectorAll('*'), ...defs.querySelectorAll('*')].filter(
    (el) => !inScope.has(el) && !usedSet.has(el),
  );
  const outsideIds = new Set(others.flatMap(adjRefs));
  const renamed = new Map();
  for (const t of used) {
    if (!outsideIds.has(t.id)) continue;
    const copy = t.cloneNode(true);
    for (const n of allIn(copy)) {
      if (!n.id) continue;
      const id = newDefId(n.id.replace(/-\d+$/, ''));
      renamed.set(n.id, id);
      n.id = id;
    }
    t.after(copy);
    usedSet.delete(t);
    for (const n of allIn(t)) usedSet.delete(n);
    for (const n of allIn(copy)) usedSet.add(n);
  }
  // (Layers locked against all edits stay as they are.)
  const targets = [...inScope, ...usedSet].filter((el) => !el.closest?.('[data-sc-lock="all"]'));
  // The selection (and what it uses) now points at the copies.
  if (renamed.size)
    for (const el of targets)
      for (const a of ADJ_REF_ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const nv = v.replace(/#([^"')\s;]+)/g, (m, id) =>
          renamed.has(id) ? `#${renamed.get(id)}` : m,
        );
        if (nv !== v) el.setAttribute(a, nv);
      }
  return targets;
}

// Recolour the targets with `map` ([r,g,b,a] → [r,g,b,a]); resolves once
// embedded images are done too. `gen` lets a newer preview cancel it.
async function recolour(targets, map, gen = () => true) {
  const conv = (v) => {
    const c = parseColor(v);
    return c ? formatColor(map(c)) : null;
  };
  for (const el of targets) {
    for (const a of ADJ_ATTRS) {
      const nv = conv(el.getAttribute(a));
      if (nv) el.setAttribute(a, nv);
    }
    const st = el.getAttribute('style');
    if (st) {
      const nst = st.replace(
        /((?:^|;)\s*(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*:\s*)([^;!]+)/gi,
        (m, k, v) => k + (conv(v) ?? v),
      );
      if (nst !== st) el.setAttribute('style', nst);
    }
    // Layer Style's colours.
    const fx = el.getAttribute('data-sc-fx');
    if (fx)
      try {
        const o = JSON.parse(fx);
        for (const e of Object.values(o)) if (e && typeof e.c === 'string') e.c = conv(e.c) ?? e.c;
        el.setAttribute('data-sc-fx', JSON.stringify(o));
      } catch {
        /* not ours */
      }
  }
  // Embedded images, pixel by pixel; linked ones can't be read and stay.
  let linked = 0;
  for (const im of targets.filter((el) => el.localName === 'image')) {
    const href = im.getAttribute('href') || im.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) {
      linked++;
      continue;
    }
    const url = await recolourImage(href, map);
    if (!gen()) return linked;
    if (url) {
      im.setAttribute('href', url);
      im.removeAttribute('xlink:href');
    }
  }
  return linked;
}
function recolourImage(src, map) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const [r, g, b] = map([p[i], p[i + 1], p[i + 2], 1]);
        p[i] = r;
        p[i + 1] = g;
        p[i + 2] = b;
      }
      x.putImageData(d, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const adjWhat = () => (normalizeSel(state.sel).length ? 'the selected layers' : 'the drawing');
// Desaturate and Grayscale: at once, one undo step.
async function adjustNow(kind, name) {
  if (refuseLocked(state.sel, 'edit')) return;
  const what = adjWhat();
  const linked = await recolour(adjustTargets(), greyMap(ADJUST[kind]()));
  commit();
  say(
    `${name}: ${what}${linked ? ` (linked images can’t be changed: ${linked} left as they were)` : ''}.`,
  );
}

// ---- Black & White… and Threshold…: a dialog with a live preview -----------------
// Each change puts the drawing back as it was and recolours afresh, so the
// preview is exact; Cancel puts it back, OK makes it one undo step.
const adjDlg = { el: null, base: null, paths: [], gen: 0, map: null };
function adjResetDoc() {
  doc.innerHTML = adjDlg.base.d;
  defs.innerHTML = adjDlg.base.f;
  state.sel = adjDlg.paths.map(fromTreePath).filter(Boolean);
}
function adjPreview() {
  const g = ++adjDlg.gen;
  adjResetDoc();
  if (adjDlg.el.querySelector('[data-adj-preview]').checked) {
    const done = recolour(adjustTargets(), adjDlg.map(), () => g === adjDlg.gen);
    syncEffects();
    done.then(() => {
      if (g !== adjDlg.gen) return;
      syncEffects();
      renderLayers();
    });
  } else syncEffects();
  drawSelection();
  // The Layers panel's previews follow (only the changed ones redraw).
  renderLayers();
}
function openAdjust(dlg, map) {
  if (refuseLocked(state.sel, 'edit')) return;
  exitIso();
  closeMenus();
  adjDlg.el = dlg;
  adjDlg.map = map;
  adjDlg.paths = normalizeSel(state.sel).map(treePath);
  adjDlg.base = snapshot();
  dlg.querySelector('[data-adj-what]').textContent = `Changes ${adjWhat()}.`;
  dlg.querySelector('[data-adj-preview]').checked = true;
  showDialog(dlg, () => closeAdjust(false));
  adjPreview();
  setTimeout(() => dlg.querySelector('.sc-primary-btn').focus(), 0);
}
async function closeAdjust(ok) {
  const dlg = adjDlg.el;
  if (!dlg?.open) return;
  hideDialog(dlg);
  const g = ++adjDlg.gen;
  adjResetDoc();
  if (!ok) {
    restore(adjDlg.base, true);
    state.sel = adjDlg.paths.map(fromTreePath).filter(Boolean);
    drawSelection();
    return;
  }
  const what = adjWhat();
  const linked = await recolour(adjustTargets(), adjDlg.map(), () => g === adjDlg.gen);
  commit();
  say(
    `${dlg.dataset.name}: ${what}${linked ? ` (${linked} linked image${linked > 1 ? 's' : ''} left as they were)` : ''}.`,
  );
}
for (const dlg of document.querySelectorAll('.sc-adjust')) {
  dlg.querySelector('[data-adj-btn="ok"]').addEventListener('click', () => closeAdjust(true));
  dlg.querySelector('[data-adj-btn="cancel"]').addEventListener('click', () => closeAdjust(false));
  dlg.querySelector('[data-adj-preview]').addEventListener('change', adjPreview);
  // A slider and its number move together; either previews.
  for (const row of dlg.querySelectorAll('[data-adj]')) {
    const [range, num] = row.querySelectorAll('input');
    const sync = (from, to) =>
      from.addEventListener('input', () => {
        to.value = from.value;
        adjSchedule();
      });
    sync(range, num);
    sync(num, range);
  }
}
let adjFrame = 0;
const adjSchedule = () => {
  cancelAnimationFrame(adjFrame);
  adjFrame = requestAnimationFrame(adjPreview);
};

// Black & White…: Photoshop's six hue sliders, its defaults.
const bwDlg = $('#sc-bw');
const bwWeights = () =>
  Object.fromEntries(
    [...bwDlg.querySelectorAll('[data-adj]')].map((r) => [
      r.dataset.adj,
      +r.querySelector('input').value || 0,
    ]),
  );
function setBw(w) {
  for (const r of bwDlg.querySelectorAll('[data-adj]'))
    for (const i of r.querySelectorAll('input')) i.value = w[r.dataset.adj];
}
$('#sc-bw [data-adj-btn="default"]').addEventListener('click', () => {
  setBw(BW_DEFAULTS);
  adjPreview();
});
function openBlackWhite() {
  setBw(BW_DEFAULTS);
  openAdjust(bwDlg, () => greyMap(ADJUST.bw(bwWeights())));
}
// Threshold…: one level, 1–255.
const thDlg = $('#sc-threshold');
function openThreshold() {
  for (const i of thDlg.querySelectorAll('[data-adj] input')) i.value = 128;
  openAdjust(thDlg, () =>
    greyMap(ADJUST.threshold(+thDlg.querySelector('[data-adj] input').value || 128)),
  );
}
