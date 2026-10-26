// SVGCraft — The Layer Style dialog.
'use strict';

// ---- Layer Style dialog ---------------------------------------------------------
// Photoshop's: effects listed down the left (tick to turn on, click to edit),
// their settings on the right, live preview; OK keeps, Cancel restores.
const fxDlg = $('#sc-fx');
let fxSess = null;
const FX_PAGES = ['ds', 'is', 'og', 'ig', 'co', 'bl'];

function openLayerStyle(page) {
  const els = normalizeSel(state.sel);
  if (!els.length) return say('Select a layer to give it a layer style.');
  if (refuseLocked(els, 'edit')) return;
  fxSess = {
    els,
    orig: els.map((el) => ({
      el,
      fx: el.getAttribute('data-sc-fx'),
      style: el.getAttribute('style'),
      opacity: el.getAttribute('opacity'),
    })),
    fx: readFx(els[0]),
    blend: blendOf(els[0]),
    opacity: Math.round((parseFloat(getComputedStyle(els[0]).opacity) || 0) * 100),
  };
  showPassThrough(fxDlg.querySelector('[data-fx="blend"]'), els[0]);
  const first = FX_PAGES.find((k) => fxSess.fx[k].on);
  showFxPage(page || first || 'ds');
  showDialog(fxDlg, () => closeLayerStyle(false));
  // Focus lands on OK, the button the user is about to press.
  setTimeout(() => fxDlg.querySelector('[data-fxd="ok"]').focus(), 0);
}

function showFxPage(page) {
  fxSess.page = page;
  for (const it of fxDlg.querySelectorAll('[data-fx-page]'))
    it.classList.toggle('sel', it.dataset.fxPage === page);
  for (const pane of fxDlg.querySelectorAll('[data-fx-pane]'))
    pane.hidden = pane.dataset.fxPane !== page;
  renderFxFields();
}

function renderFxFields() {
  const sess = fxSess;
  for (const cb of fxDlg.querySelectorAll('[data-fx-on]')) cb.checked = sess.fx[cb.dataset.fxOn].on;
  for (const inp of fxDlg.querySelectorAll('[data-fx], [data-fx-range]')) {
    const key = inp.dataset.fx || inp.dataset.fxRange;
    const v =
      key === 'blend'
        ? sess.blend
        : key === 'opacity'
          ? sess.opacity
          : sess.fx[key.split('.')[0]][key.split('.')[1]];
    if (document.activeElement !== inp) inp.value = v;
  }
}

// Push the session to the layers (or put them back while Preview is off).
function fxPreview() {
  const live = $('#sc-fx-preview').checked;
  for (const o of fxSess.orig) {
    if (live) {
      writeFx(o.el, fxSess.fx);
      setBlend(o.el, fxSess.blend);
      setPaintAttr(o.el, 'opacity', f(fxSess.opacity / 100), 1);
    } else fxRestore(o);
  }
}
function fxRestore(o) {
  for (const [a, v] of [
    ['data-sc-fx', o.fx],
    ['style', o.style],
    ['opacity', o.opacity],
  ])
    if (v == null) o.el.removeAttribute(a);
    else o.el.setAttribute(a, v);
}

function closeLayerStyle(ok) {
  if (!fxSess) return;
  if (ok) {
    $('#sc-fx-preview').checked = true;
    fxPreview();
    commit();
    readStyle(fxSess.els[0]);
  } else for (const o of fxSess.orig) fxRestore(o);
  fxSess = null;
  hideDialog(fxDlg);
  renderLayers();
}

function wireLayerStyle() {
  const sel = fxDlg.querySelector('[data-fx="blend"]');
  sel.append(...[...$('#sc-blend').options].map((o) => o.cloneNode(true)));
  for (const it of fxDlg.querySelectorAll('[data-fx-page]')) {
    // Clicking an effect's name turns it on and shows its settings.
    const btn = it.matches('button') ? it : it.querySelector('button');
    btn.addEventListener('click', () => {
      const k = it.dataset.fxPage;
      if (k !== 'blend') fxSess.fx[k].on = true;
      showFxPage(k);
      fxPreview();
    });
  }
  for (const cb of fxDlg.querySelectorAll('[data-fx-on]'))
    cb.addEventListener('change', () => {
      fxSess.fx[cb.dataset.fxOn].on = cb.checked;
      showFxPage(cb.dataset.fxOn);
      fxPreview();
    });
  for (const inp of fxDlg.querySelectorAll('[data-fx], [data-fx-range]'))
    inp.addEventListener('input', () => {
      const key = inp.dataset.fx || inp.dataset.fxRange;
      if (key === 'blend') fxSess.blend = inp.value;
      else if (key === 'opacity') fxSess.opacity = clamp(+inp.value || 0, 0, 100);
      else {
        const [k, p] = key.split('.');
        const v = p === 'c' ? inp.value : +inp.value;
        if (p !== 'c' && !isFinite(v)) return;
        fxSess.fx[k][p] = p === 'c' ? v : clamp(v, ...FX_LIMITS[p]);
        fxSess.fx[k].on = true;
      }
      renderFxFields();
      fxPreview();
    });
  $('#sc-fx-preview').addEventListener('change', fxPreview);
  fxDlg.querySelector('[data-fxd="ok"]').addEventListener('click', () => closeLayerStyle(true));
  fxDlg
    .querySelector('[data-fxd="cancel"]')
    .addEventListener('click', () => closeLayerStyle(false));
  fxDlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeLayerStyle(false);
    else if (e.key === 'Enter' && !e.target.matches('select, button')) {
      e.preventDefault();
      closeLayerStyle(true);
    }
  });

  // Layers panel: blend mode and the lock buttons.
  $('#sc-blend').addEventListener('change', (e) => {
    const els = normalizeSel(state.sel);
    if (!els.length) {
      syncLayerHead();
      return say('Select the layers to blend.');
    }
    if (refuseLocked(els, 'edit')) return syncLayerHead();
    for (const el of els) setBlend(el, e.target.value);
    commit();
  });
  for (const b of document.querySelectorAll('[data-lock]'))
    b.addEventListener('click', () => {
      const els = normalizeSel(state.sel);
      if (!els.length) return say('Select the layers to lock.');
      const on = b.getAttribute('aria-pressed') !== 'true';
      setLock(els, on ? b.dataset.lock : null);
    });
}

// Help menu: the About page opens in its own tab, so the drawings stay put.
function openAbout(hash) {
  window.open('about.html' + hash, 'svgcraft-about', 'noopener');
}

// Take a group apart where it is, its transform, opacity and inherited
// attributes passed down to what was in it; its layers, or null when it
// carries a clip / mask / filter it can't hand down.
function dissolveGroup(g) {
  if (['clip-path', 'mask', 'filter'].some((a) => g.hasAttribute(a) || g.style?.[a])) return null;
  const out = [];
  const Mg = getM(g);
  const gOpacity = parseFloat(g.getAttribute('opacity') ?? 1);
  const inherit = [...g.attributes].filter(
    (a) => !['transform', 'opacity', 'id', 'class', 'style'].includes(a.name),
  );
  for (const c of [...g.childNodes]) {
    if (c.nodeType !== 1) continue;
    if (!NON_GRAPHIC.has(c.localName)) {
      setM(c, Mg.multiply(getM(c)));
      for (const a of inherit) if (!c.hasAttribute(a.name)) c.setAttribute(a.name, a.value);
      if (gOpacity < 1)
        c.setAttribute('opacity', f(gOpacity * parseFloat(c.getAttribute('opacity') ?? 1)));
      out.push(c);
    }
    g.before(c);
  }
  g.remove();
  return out;
}

const cmds = {
  textOnPath: () => textOnPath(),
  releaseTextOnPath: () => releaseTextOnPath(),
  layerStyle: () => openLayerStyle(),
  clearLayerStyle() {
    const els = normalizeSel(state.sel);
    if (!els.length || refuseLocked(els, 'edit')) return;
    for (const el of els) el.removeAttribute('data-sc-fx');
    commit();
  },
  clipMake: () => makeClip(),
  clipRelease: () => releaseClip(),
  lockPosition: () => state.sel.length && setLock(normalizeSel(state.sel), 'position'),
  lockAll: () => state.sel.length && setLock(normalizeSel(state.sel), 'all'),
  unlockLayers: () => state.sel.length && setLock(normalizeSel(state.sel), null),
  delete() {
    if (!state.sel.length || refuseLocked(state.sel, 'edit')) return;
    state.sel.forEach((el) => el.remove());
    state.sel = [];
    commit();
  },
  // Duplicate Layer offsets the copies by `d` px so they show; Layer via
  // Copy puts them in place (d = 0).
  duplicate(d = 10) {
    if (!state.sel.length) return;
    const ids = new Map();
    const clones = inDocOrder(state.sel).map((el) => {
      const c = el.cloneNode(true);
      for (const n of [c, ...c.querySelectorAll('[id]')]) {
        if (n.id) ids.set(n.id, n);
        n.removeAttribute('id');
      }
      el.after(c);
      if (d) transformDoc(c, new DOMMatrix().translate(d, d));
      return c;
    });
    // Text on a path duplicated with its path follows the new path.
    for (const c of clones)
      for (const t of [c, ...c.querySelectorAll('text')]) {
        const p = ids.get(t.getAttribute?.('data-sc-textpath'));
        if (!p) continue;
        if (!p.id) {
          let n = 1;
          while (document.getElementById(`textpath-${n}`)) n++;
          p.id = `textpath-${n}`;
        }
        t.setAttribute('data-sc-textpath', p.id);
      }
    state.sel = clones;
    commit();
    readStyle(clones[0]);
  },
  selectAll() {
    setSel(items().filter((el) => el.getAttribute('display') !== 'none'));
  },
  // Select → Inverse: every visible layer that isn't selected, at the depth
  // the selection is at (top-level layers, or individual shapes when any
  // selected layer sits inside a group).
  invertSelection() {
    const sel = state.sel;
    const pool = sel.some((el) => el.parentNode !== doc) ? leafLayers() : items();
    setSel(
      pool.filter(
        (el) => isShown(el) && !sel.some((s) => s === el || s.contains(el) || el.contains(s)),
      ),
    );
  },
  cropToSelection() {
    if (!state.sel.length) return say('Select something to crop to.');
    cropTo(paintBox(state.sel), 'the selection');
  },
  cropToDrawing() {
    cropTo(paintBox(items()), 'the drawing');
  },
  front() {
    inDocOrder(state.sel).forEach((el) => el.parentNode.append(el));
    commit();
  },
  back() {
    inDocOrder(state.sel)
      .reverse()
      .forEach((el) => el.parentNode.prepend(el));
    commit();
  },
  forward() {
    for (const el of inDocOrder(state.sel).reverse()) {
      let n = el.nextElementSibling;
      while (n && !selectable(n)) n = n.nextElementSibling;
      if (n && !state.sel.includes(n)) n.after(el);
    }
    commit();
  },
  backward() {
    for (const el of inDocOrder(state.sel)) {
      let n = el.previousElementSibling;
      while (n && !selectable(n)) n = n.previousElementSibling;
      if (n && !state.sel.includes(n)) n.before(el);
    }
    commit();
  },
  // Wrap the selected layers in a new group where the frontmost one was
  // (Photoshop's Ctrl+G); with nothing selected, add an empty group on top.
  group() {
    const els = normalizeSel(state.sel);
    const g = mk('g', { 'data-name': nextGroupName() });
    if (!els.length) doc.append(g);
    else {
      els.at(-1).after(g);
      for (const el of els) reparent(el, g);
    }
    state.sel = [g];
    commit();
  },
  ungroup() {
    if (refuseLocked(state.sel, 'edit')) return;
    const out = [];
    let blocked = 0;
    for (const g of inDocOrder(state.sel)) {
      const kids = g.localName === 'g' ? dissolveGroup(g) : [g];
      if (kids) out.push(...kids);
      else {
        blocked++;
        out.push(g);
      }
    }
    if (blocked) say(`${blocked} group(s) carry a clip / mask / filter and were left grouped.`);
    state.sel = out;
    commit();
  },
  flipH() {
    transformSel((b) =>
      new DOMMatrix()
        .translate(b.x + b.w / 2, 0)
        .scale(-1, 1)
        .translate(-(b.x + b.w / 2), 0),
    );
  },
  flipV() {
    transformSel((b) =>
      new DOMMatrix()
        .translate(0, b.y + b.h / 2)
        .scale(1, -1)
        .translate(0, -(b.y + b.h / 2)),
    );
  },
  alignLeft: () => alignSel('left'),
  alignHCenter: () => alignSel('hcenter'),
  alignRight: () => alignSel('right'),
  alignTop: () => alignSel('top'),
  alignVCenter: () => alignSel('vcenter'),
  alignBottom: () => alignSel('bottom'),
  distributeH: () => distributeSel('x'),
  distributeV: () => distributeSel('y'),
};

// Line the selection up on an edge or centre of its own bounding box, or
// of the artboard when only one object is selected (Photoshop's rule).
function alignSel(how) {
  if (!state.sel.length) return say('Select the objects to align first.');
  if (refuseLocked(state.sel)) return;
  const ref = state.sel.length === 1 ? { x: 0, y: 0, w: state.w, h: state.h } : selBox();
  if (!ref) return;
  for (const el of state.sel) {
    const b = bboxDoc(el);
    if (!b) continue;
    const dx = {
      left: ref.x - b.x,
      hcenter: ref.x + ref.w / 2 - (b.x + b.w / 2),
      right: ref.x + ref.w - (b.x + b.w),
    }[how];
    const dy = {
      top: ref.y - b.y,
      vcenter: ref.y + ref.h / 2 - (b.y + b.h / 2),
      bottom: ref.y + ref.h - (b.y + b.h),
    }[how];
    transformDoc(el, new DOMMatrix().translate(dx || 0, dy || 0));
  }
  commit();
}

// Equal gaps between neighbours along one axis; the outermost two stay put.
function distributeSel(axis) {
  const list = state.sel.map((el) => ({ el, b: bboxDoc(el) })).filter((i) => i.b);
  if (list.length < 3) return say('Select three or more objects to distribute.');
  if (refuseLocked(state.sel)) return;
  const size = axis === 'x' ? 'w' : 'h';
  list.sort((a, b) => a.b[axis] + a.b[size] / 2 - (b.b[axis] + b.b[size] / 2));
  const first = list[0].b;
  const end = Math.max(...list.map((i) => i.b[axis] + i.b[size]));
  const gap = (end - first[axis] - list.reduce((n, i) => n + i.b[size], 0)) / (list.length - 1);
  let at = first[axis];
  for (const { el, b } of list) {
    const d = at - b[axis];
    const T = axis === 'x' ? new DOMMatrix().translate(d, 0) : new DOMMatrix().translate(0, d);
    transformDoc(el, T);
    at += b[size] + gap;
  }
  commit();
}

function nudge(dx, dy) {
  if (!state.sel.length || refuseLocked(state.sel)) return;
  const T = new DOMMatrix().translate(dx, dy);
  for (const el of state.sel) transformDoc(el, T);
  commit();
}
