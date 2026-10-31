// SVGCraft — Layer locks and layer effects (Layer Style).
'use strict';

// ---- layer locks -------------------------------------------------------------
// Photoshop's Lock Position and Lock All, kept as data-sc-lock on the layer
// ("position" | "all"). A lock on a group covers everything in it. Locked
// layers can still be selected; Lock Position refuses moves and transforms,
// Lock All refuses every change.
function lockOf(el) {
  let pos = false;
  for (let n = el; n && n !== doc; n = n.parentNode) {
    const v = n.getAttribute?.('data-sc-lock');
    if (v === 'all') return 'all';
    if (v === 'position') pos = true;
  }
  return pos ? 'position' : null;
}
// True (and says why) when any of els, or anything inside them, is locked
// against `what`: 'move' (position or all) or 'edit' (all).
function refuseLocked(els, what = 'move') {
  for (const el of els) {
    const inner = el.querySelector?.(what === 'move' ? '[data-sc-lock]' : '[data-sc-lock="all"]');
    const l = lockOf(el) || (inner && (what === 'move' ? 'position' : 'all'));
    if (l === 'all' || (what === 'move' && l === 'position')) {
      const name = layerName(inner && !lockOf(el) ? inner : el);
      // Text layers' names come quoted already.
      warn(
        `${name.startsWith('“') ? name : `“${name}”`} is locked: Layer → Unlock, or click its lock in Layers, to change it.`,
      );
      return true;
    }
  }
  return false;
}
function setLock(els, value) {
  for (const el of els)
    if (value) el.setAttribute('data-sc-lock', value);
    else el.removeAttribute('data-sc-lock');
  commit();
  renderLayers();
}

// ---- layer effects (Photoshop's Layer Style) -----------------------------------
// data-sc-fx holds the effects as JSON; syncEffects() builds a matching
// <filter> (sc-fx-N, in defs) for each layer and keeps it in step with the
// layer's size and transform. Distances, sizes and the light angle are in
// document pixels, as Photoshop measures them, so a rotated or scaled layer
// still casts its shadow down and to the right.
const FX_DEFAULTS = {
  ds: { on: false, c: '#000000', o: 35, a: 120, d: 5, sp: 0, s: 5 },
  is: { on: false, c: '#000000', o: 35, a: 120, d: 5, sp: 0, s: 5 },
  og: { on: false, c: '#ffffbe', o: 35, sp: 0, s: 5 },
  ig: { on: false, c: '#ffffbe', o: 35, sp: 0, s: 5 },
  co: { on: false, c: '#ff0000', o: 100 },
  bl: { on: false, r: 4 },
};
const FX_LIMITS = {
  o: [0, 100],
  a: [-180, 180],
  d: [0, 500],
  sp: [0, 100],
  s: [0, 250],
  r: [0, 100],
};
function readFx(el) {
  let raw = {};
  try {
    raw = JSON.parse(el.getAttribute('data-sc-fx') || '{}') || {};
  } catch {
    /* unreadable: no effects */
  }
  const fx = {};
  for (const [k, def] of Object.entries(FX_DEFAULTS)) {
    const r = raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
    fx[k] = { ...def };
    if (k in raw) fx[k].on = r.on !== false;
    for (const p of Object.keys(def)) {
      if (p === 'on') continue;
      if (p === 'c') {
        if (typeof r.c === 'string' && /^#[0-9a-f]{6}$/i.test(r.c)) fx[k].c = r.c.toLowerCase();
      } else if (r[p] != null && isFinite(+r[p])) fx[k][p] = clamp(+r[p], ...FX_LIMITS[p]);
    }
  }
  return fx;
}
const fxOn = (fx) => Object.values(fx).some((e) => e.on);
// Only the effects that are on are written.
function writeFx(el, fx) {
  const out = {};
  for (const [k, e] of Object.entries(fx))
    if (e.on) out[k] = Object.fromEntries(Object.entries(e).filter(([p]) => p !== 'on'));
  if (Object.keys(out).length) el.setAttribute('data-sc-fx', JSON.stringify(out));
  else el.removeAttribute('data-sc-fx');
}

// The filter for fx on el: its region (in el's own units) and primitives.
function fxFilter(el, fx) {
  const M = fullM(el);
  const sc = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1;
  const inv = M.inverse();
  const L = (v) => v / sc;
  const local = (dx, dy) => [inv.a * dx + inv.c * dy, inv.b * dx + inv.d * dy];
  const parts = [];
  let base = 'SourceGraphic';
  let A = 'SourceAlpha';
  if (fx.bl.on && fx.bl.r > 0) {
    parts.push(
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${f(L(fx.bl.r))}" result="bl"/>`,
      '<feColorMatrix in="bl" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="blA"/>',
    );
    base = 'bl';
    A = 'blA';
  }
  const flood = (k, e) =>
    `<feFlood flood-color="${e.c}" flood-opacity="${f(e.o / 100)}" result="${k}C"/>`;
  // Outer: shadow / glow spread out from the shape (dilate, blur, offset).
  const outer = (k, e, dx = 0, dy = 0) => {
    const sp = e.sp / 100;
    let src = A;
    if (sp > 0 && e.s > 0) {
      parts.push(
        `<feMorphology in="${A}" operator="dilate" radius="${f(L(e.s * sp))}" result="${k}M"/>`,
      );
      src = `${k}M`;
    }
    parts.push(
      `<feGaussianBlur in="${src}" stdDeviation="${f(L((e.s * (1 - sp)) / 2))}" result="${k}B"/>`,
    );
    let shape = `${k}B`;
    if (dx || dy) {
      const [lx, ly] = local(dx, dy);
      parts.push(`<feOffset in="${k}B" dx="${f(lx)}" dy="${f(ly)}" result="${k}O"/>`);
      shape = `${k}O`;
    }
    parts.push(flood(k, e), `<feComposite in="${k}C" in2="${shape}" operator="in" result="${k}"/>`);
  };
  // Inner: the shape minus a blurred (and shifted) copy of itself.
  const inner = (k, e, dx = 0, dy = 0) => {
    parts.push(
      `<feGaussianBlur in="${A}" stdDeviation="${f(L((e.s * (1 - e.sp / 100)) / 2))}" result="${k}B"/>`,
    );
    let shape = `${k}B`;
    if (dx || dy) {
      const [lx, ly] = local(dx, dy);
      parts.push(`<feOffset in="${k}B" dx="${f(lx)}" dy="${f(ly)}" result="${k}O"/>`);
      shape = `${k}O`;
    }
    parts.push(
      `<feComposite in="${A}" in2="${shape}" operator="out" result="${k}M"/>`,
      flood(k, e),
      `<feComposite in="${k}C" in2="${k}M" operator="in" result="${k}"/>`,
    );
  };
  // Photoshop's angle is where the light comes from; shadows fall away from it.
  const away = (e) => {
    const t = (e.a * Math.PI) / 180;
    return [-Math.cos(t) * e.d, Math.sin(t) * e.d];
  };
  const merge = [];
  if (fx.ds.on) {
    outer('ds', fx.ds, ...away(fx.ds));
    merge.push('ds');
  }
  if (fx.og.on) {
    outer('og', fx.og);
    merge.push('og');
  }
  merge.push(base);
  if (fx.co.on) {
    parts.push(flood('co', fx.co), `<feComposite in="coC" in2="${A}" operator="in" result="co"/>`);
    merge.push('co');
  }
  if (fx.ig.on) {
    inner('ig', fx.ig);
    merge.push('ig');
  }
  if (fx.is.on) {
    // Light from the top-left: the copy moves down and right, leaving the
    // shadow along the inside top and left edges, as in Photoshop.
    inner('is', fx.is, ...away(fx.is));
    merge.push('is');
  }
  parts.push(`<feMerge>${merge.map((r) => `<feMergeNode in="${r}"/>`).join('')}</feMerge>`);
  // Region: the layer's box plus room for everything that spills out.
  let reach = 2;
  if (fx.ds.on) reach = Math.max(reach, fx.ds.d + fx.ds.s * 2);
  if (fx.og.on) reach = Math.max(reach, fx.og.s * 2);
  if (fx.bl.on) reach += fx.bl.r * 3;
  let b;
  try {
    b = el.getBBox();
  } catch {
    b = { x: 0, y: 0, width: 0, height: 0 };
  }
  const cs = getComputedStyle(el);
  const sw = cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) || 0 : 0;
  // The reach is in document pixels; in local units it's larger along any
  // axis the layer is squashed in.
  const m = (Math.hypot(inv.a, inv.b) + Math.hypot(inv.c, inv.d)) * reach + sw;
  return {
    attrs: {
      filterUnits: 'userSpaceOnUse',
      x: f(b.x - m),
      y: f(b.y - m),
      width: f(b.width + 2 * m),
      height: f(b.height + 2 * m),
      'color-interpolation-filters': 'sRGB',
    },
    html: parts.join(''),
  };
}

const fxRef = (el) => /^url\(#(sc-fx-\d+)\)$/.exec(el.getAttribute('filter') || '')?.[1];
function syncEffects() {
  const owned = new Set();
  for (const el of doc.querySelectorAll('[data-sc-fx]')) {
    const fx = readFx(el);
    if (!fxOn(fx)) continue;
    let id = fxRef(el);
    let host = id && defs.querySelector(`:scope > #${id}`);
    if (!host || owned.has(id)) {
      let n = 1;
      while (document.getElementById(`sc-fx-${n}`) || owned.has(`sc-fx-${n}`)) n++;
      id = `sc-fx-${n}`;
      host = mk('filter', { id, 'data-sc-fx': '' }, defs);
      el.setAttribute('filter', `url(#${id})`);
    }
    owned.add(id);
    const { attrs, html } = fxFilter(el, fx);
    for (const [k, v] of Object.entries(attrs))
      if (host.getAttribute(k) !== v) host.setAttribute(k, v);
    if (host.innerHTML !== html) host.innerHTML = html;
  }
  for (const el of doc.querySelectorAll('[filter]')) {
    const id = fxRef(el);
    if (id && !owned.has(id)) el.removeAttribute('filter');
  }
  const kept = keptIds();
  for (const host of defs.querySelectorAll(':scope > filter[data-sc-fx]'))
    if (!owned.has(host.id) && !kept.has(host.id)) host.remove();
}
let fxQueued = false;
new MutationObserver(() => {
  if (fxQueued) return;
  fxQueued = true;
  queueMicrotask(() => {
    fxQueued = false;
    syncEffects();
  });
}).observe(doc, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [...SA_GEOM, 'data-sc-fx', 'transform', 'stroke-width', 'font-size', 'x', 'y'],
});
