// SVGCraft — Rulers, guides and smart guides (snapping).
'use strict';

// ---------------------------------------------------------------------
// Rulers, guides and smart guides (Photoshop-style)
//
// Guides are { axis: 'x' | 'y', pos } in document units: an 'x' guide is
// vertical (drawn at x = pos). They're part of history and are saved in
// the file as data-sc-guides on the root <svg>, which renders nothing.
// Snapping weighs, per axis: guides, smart targets (the artboard's and
// other objects' edges and centres) and the grid; a guide or smart match
// within 6 screen px beats the grid. Ctrl/⌘ held while dragging skips it.
// ---------------------------------------------------------------------
const guideLayer = $('#sc-guidelines');
const smartLayer = $('#sc-smart');
const SNAP_PX = 6;
let snapCache = null;
let snapOff = false;

const guidesAttr = () => state.guides.map((g) => `${g.axis}:${f(g.pos)}`).join(' ');
const parseGuides = (s) =>
  String(s || '')
    .split(/\s+/)
    .map((t) => /^([xy]):(-?[\d.]+)$/.exec(t))
    .filter(Boolean)
    .map((m) => ({ axis: m[1], pos: parseFloat(m[2]) }));

function renderGuides() {
  drawKeylines();
  guideLayer.replaceChildren();
  guideLayer.toggleAttribute('data-locked', state.guidesLocked);
  if (!state.guidesOn) return;
  const far = 1e6;
  state.guides.forEach((g, i) => {
    const geo =
      g.axis === 'x'
        ? { x1: g.pos, y1: -far, x2: g.pos, y2: far }
        : { x1: -far, y1: g.pos, x2: far, y2: g.pos };
    mk('line', { ...geo, class: 'sc-guide' }, guideLayer);
    mk('line', { ...geo, class: `sc-guide-hit ${g.axis}`, 'data-guide': i }, guideLayer);
  });
}

// ---- snap targets ---------------------------------------------------------------
function buildSnapTargets() {
  const xs = [];
  const ys = [];
  if (state.guidesOn && state.snapGuides)
    for (const g of state.guides)
      (g.axis === 'x' ? xs : ys).push({ v: g.pos, axis: g.axis, kind: 'guide' });
  if (state.smart) {
    const board = { x: 0, y: 0, w: state.w, h: state.h };
    for (const v of [0, state.w / 2, state.w]) xs.push({ v, axis: 'x', kind: 'board', box: board });
    for (const v of [0, state.h / 2, state.h]) ys.push({ v, axis: 'y', kind: 'board', box: board });
    for (const el of items()) {
      if (el.getAttribute('display') === 'none') continue;
      if (state.sel.some((s) => el === s || el.contains(s))) continue;
      if (tools.node.el && el.contains(tools.node.el)) continue;
      const b = bboxDoc(el);
      if (!b) continue;
      for (const v of [b.x, b.x + b.w / 2, b.x + b.w])
        xs.push({ v, axis: 'x', kind: 'obj', box: b });
      for (const v of [b.y, b.y + b.h / 2, b.y + b.h])
        ys.push({ v, axis: 'y', kind: 'obj', box: b });
    }
  }
  snapCache = { xs, ys };
  return snapCache;
}

// The closest target to any of the probe values, within tolerance.
function closest(list, probes, tol) {
  let best = null;
  for (const from of probes)
    for (const t of list) {
      const d = Math.abs(t.v - from);
      if (d <= tol && (!best || d < best.d)) best = { ...t, d, from };
    }
  return best;
}

// Magenta lines through what lined up, spanning both boxes.
function showSmart(hits, mb) {
  smartLayer.replaceChildren();
  for (const h of hits) {
    if (!h) continue;
    const vert = h.axis === 'x';
    const o = h.box || mb;
    const a = vert ? Math.min(mb.y, o.y) : Math.min(mb.x, o.x);
    const b = vert ? Math.max(mb.y + mb.h, o.y + o.h) : Math.max(mb.x + mb.w, o.x + o.w);
    const geo = vert ? { x1: h.v, y1: a, x2: h.v, y2: b } : { x1: a, y1: h.v, x2: b, y2: h.v };
    mk('line', { ...geo, class: `sc-smart ${h.kind}` }, smartLayer);
  }
}
const clearSmart = () => smartLayer.replaceChildren();

// Snap a point (pen points, shape corners, handles, text, points).
function snapPt(p) {
  if (snapOff) {
    clearSmart();
    return p;
  }
  const tol = SNAP_PX / state.zoom;
  const c = snapCache || buildSnapTargets();
  const hx = closest(c.xs, [p.x], tol);
  const hy = closest(c.ys, [p.y], tol);
  const g = state.gridSize;
  const o = state.snapPixel ? pixelOffset(state.tool === 'node' ? tools.node.el : null) : 0;
  const free = (v) => (state.snap ? Math.round(v / g) * g : state.snapPixel ? toPixel(v, o) : v);
  const x = hx ? hx.v : free(p.x);
  const y = hy ? hy.v : free(p.y);
  showSmart([hx, hy], { x, y, w: 0, h: 0 });
  return { x, y };
}

// Snap a moving box: any of its edges or centre lines to the targets;
// otherwise its top-left to the grid.
function snapBox(box, dx, dy) {
  if (snapOff) {
    clearSmart();
    return { dx, dy };
  }
  const tol = SNAP_PX / state.zoom;
  const c = snapCache || buildSnapTargets();
  const hx = closest(c.xs, [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx], tol);
  const hy = closest(c.ys, [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy], tol);
  const g = state.gridSize;
  const o = state.snapPixel && state.sel.length === 1 ? pixelOffset(state.sel[0]) : 0;
  if (hx) dx += hx.v - hx.from;
  else if (state.snap) dx = Math.round((box.x + dx) / g) * g - box.x;
  else if (state.snapPixel) dx = toPixel(box.x + dx, o) - box.x;
  if (hy) dy += hy.v - hy.from;
  else if (state.snap) dy = Math.round((box.y + dy) / g) * g - box.y;
  else if (state.snapPixel) dy = toPixel(box.y + dy, o) - box.y;
  showSmart([hx, hy], { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
  return { dx, dy };
}

// ---- rulers --------------------------------------------------------------------------
const rulerH = $('#sc-ruler-h');
const rulerV = $('#sc-ruler-v');
let rulerMark = null;
let rulerFrame = 0;

// Major tick spacing: the smallest 1/2/5 × 10ⁿ at least 60px apart.
// The ruler's labelled step in document units, at z screen px per unit.
function rulerStep(z) {
  for (let e = -2; e < 7; e++)
    for (const m of [1, 2, 5]) {
      const s = m * 10 ** e;
      if (s * z >= 60) return s;
    }
  return 1e7;
}

function drawRuler(cv, horiz) {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  ctx.fillStyle = cs.getPropertyValue('--shell').trim();
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ctx.fillStyle = cs.getPropertyValue('--text-dim').trim();
  ctx.lineWidth = 1;
  ctx.font = '9px system-ui, sans-serif';
  const len = horiz ? w : h;
  const thick = horiz ? h : w;
  const pan = horiz ? state.panX : state.panY;
  // Ticks and labels in the document's units.
  const z = state.zoom * uPx();
  const step = rulerStep(z);
  const minor = step * z >= 100 ? step / 10 : step / 5;
  const start = Math.floor(-pan / z / minor) * minor;
  ctx.beginPath();
  for (let v = start; v * z + pan <= len; v += minor) {
    const s = Math.round(v * z + pan) + 0.5;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const half = !major && Math.abs((2 * v) / step - Math.round((2 * v) / step)) < 1e-6;
    const tl = major ? thick : half ? thick * 0.45 : thick * 0.25;
    if (horiz) {
      ctx.moveTo(s, h);
      ctx.lineTo(s, h - tl);
    } else {
      ctx.moveTo(w, s);
      ctx.lineTo(w - tl, s);
    }
    if (major) {
      const label = String(+v.toFixed(2));
      if (horiz) ctx.fillText(label, s + 3, 9);
      else {
        ctx.save();
        ctx.translate(9, s + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  // Cursor marker.
  if (rulerMark) {
    const s = Math.round((horiz ? rulerMark.x : rulerMark.y) * state.zoom + pan) + 0.5;
    ctx.strokeStyle = cs.getPropertyValue('--accent').trim();
    ctx.beginPath();
    if (horiz) {
      ctx.moveTo(s, 0);
      ctx.lineTo(s, h);
    } else {
      ctx.moveTo(0, s);
      ctx.lineTo(w, s);
    }
    ctx.stroke();
  }
  // Edge line against the canvas.
  ctx.strokeStyle = cs.getPropertyValue('--line').trim();
  ctx.beginPath();
  if (horiz) {
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
  } else {
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
  }
  ctx.stroke();
}
function drawRulers() {
  cancelAnimationFrame(rulerFrame);
  rulerFrame = requestAnimationFrame(() => {
    if (!state.rulers) return;
    drawRuler(rulerH, true);
    drawRuler(rulerV, false);
  });
}
function setRulers(on) {
  state.rulers = on;
  $('#sc-stage-wrap').classList.toggle('no-rulers', !on);
  applyView();
  drawRulers();
}

// ---- dragging guides (out of the rulers, or with the Move tool) --------------------
// Dropping a guide back on a ruler, or outside the canvas, deletes it.
function dragGuide(e, i, captureEl) {
  const g = state.guides[i];
  captureEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const p = toDoc(ev);
    let v = g.axis === 'x' ? p.x : p.y;
    v = ev.shiftKey
      ? Math.round(v / 10) * 10
      : state.snap
        ? Math.round(v / state.gridSize) * state.gridSize
        : Math.round(v);
    g.pos = v;
    rulerMark = p;
    renderGuides();
    drawRulers();
    $('#sc-pos').textContent = `${g.axis === 'x' ? 'X' : 'Y'}: ${showLen(v)}`;
  };
  const up = (ev) => {
    captureEl.removeEventListener('pointermove', move);
    captureEl.removeEventListener('pointerup', up);
    captureEl.removeEventListener('pointercancel', up);
    const r = stage.getBoundingClientRect();
    const inside =
      ev.clientX >= r.left &&
      ev.clientX <= r.right &&
      ev.clientY >= r.top &&
      ev.clientY <= r.bottom;
    if (!inside) state.guides.splice(state.guides.indexOf(g), 1);
    renderGuides();
    commit();
  };
  captureEl.addEventListener('pointermove', move);
  captureEl.addEventListener('pointerup', up);
  captureEl.addEventListener('pointercancel', up);
  move(e);
}
for (const [cv, axis] of [
  [rulerH, 'y'],
  [rulerV, 'x'],
]) {
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!state.guidesOn) setGuidesOn(true);
    state.guides.push({ axis, pos: 0 });
    dragGuide(e, state.guides.length - 1, cv);
  });
}

// ---- view toggles --------------------------------------------------------------------
const VIEW_KEY = 'svgcraft.view';
function saveView() {
  store(VIEW_KEY, {
    rulers: state.rulers,
    guidesOn: state.guidesOn,
    guidesLocked: state.guidesLocked,
    snapGuides: state.snapGuides,
    smart: state.smart,
    pixelGrid: state.pixelGrid,
    snapPixel: state.snapPixel,
    keylines: state.keylines,
  });
}
function syncViewMenu() {
  const on = {
    toggleRulers: state.rulers,
    toggleGuides: state.guidesOn,
    toggleLockGuides: state.guidesLocked,
    toggleSnapGuides: state.snapGuides,
    toggleSmart: state.smart,
    togglePixelGrid: state.pixelGrid,
    toggleSnapPixel: state.snapPixel,
    toggleKeylines: state.keylines,
  };
  for (const [a, v] of Object.entries(on))
    $(`[data-action="${a}"]`).setAttribute('aria-checked', v);
  // The Document section's checkboxes mirror the pixel options.
  $('#sc-pixgrid-on').checked = state.pixelGrid;
  $('#sc-snappix-on').checked = state.snapPixel;
}
function setGuidesOn(on) {
  state.guidesOn = on;
  renderGuides();
  syncViewMenu();
  saveView();
}
function toggleView(key) {
  state[key] = !state[key];
  if (key === 'rulers') setRulers(state.rulers);
  renderGuides();
  drawPixelGrid();
  syncViewMenu();
  saveView();
}

// New Guide…: a small dialog with orientation and position.
const ngDialog = $('#sc-newguide');
function openNewGuide() {
  showDialog(ngDialog, () => closeNewGuide(false));
  const inp = ngDialog.querySelector('input[type="number"]');
  inp.value = 0;
  setTimeout(() => {
    inp.focus();
    inp.select();
  }, 0);
}
function closeNewGuide(ok) {
  if (ok) {
    const axis = ngDialog.querySelector('input[name="sc-ng-axis"]:checked').value;
    const pos = fromUnits(parseFloat(ngDialog.querySelector('input[type="number"]').value));
    if (isFinite(pos)) {
      state.guides.push({ axis, pos });
      if (!state.guidesOn) state.guidesOn = true;
      renderGuides();
      syncViewMenu();
      commit();
      say(
        `Added a ${axis === 'y' ? 'horizontal' : 'vertical'} guide at ${inUnits(pos)} ${state.units}.`,
      );
    }
  }
  hideDialog(ngDialog);
}
ngDialog.addEventListener('keydown', (e) => {
  e.stopPropagation();
  // Enter on a button is that button's (the browser clicks it).
  if (e.key === 'Enter' && !e.target.closest('button')) {
    e.preventDefault();
    closeNewGuide(true);
  } else if (e.key === 'Escape') closeNewGuide(false);
});
ngDialog.querySelector('[data-ng="ok"]').addEventListener('click', () => closeNewGuide(true));
ngDialog.querySelector('[data-ng="cancel"]').addEventListener('click', () => closeNewGuide(false));

function constrain45(a, p) {
  const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  const d = dist(a, p);
  return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
}

function toDoc(e) {
  const m = view.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
