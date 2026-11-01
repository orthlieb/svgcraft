// SVGCraft — Animations that wrap an object (Wipe in, Iris in, Blur in,
// Glow pulse, Shine), and writing every animation into a saved copy.
'use strict';

// ---- Effects round a layer (Wipe in, Iris in, Blur in, Glow pulse, Shine) ----------
// These need a clip, filter or mask from <defs>, on a group wrapped round the
// layer (Shine also puts its highlight in that group). Save and ▶ Play make
// them, all marked data-sc-gen, so reopening the file takes them off again.
let genSeq = 0;
function genId() {
  let id;
  do id = `sc-gen-${++genSeq}`;
  while (document.getElementById(id));
  return id;
}
const genEl = (tag, attrs = {}, kids = []) => {
  const n = mk(tag, { ...attrs, 'data-sc-gen': '' });
  n.append(...kids);
  return n;
};
// What wraps the layer for animation a: { defs, attrs (for the wrapping
// group), overlay? (Shine's highlight), under? (drawn below the layer:
// Ripple's rings), use? (a <use> to point at the layer) }.
function wrapParts(el, a, preview, start) {
  const m = fullM(el);
  const k = Math.hypot(m.a, m.b) || 1;
  const nodes = (channels) => chanNodes(a, channels, preview, start, []);
  const anim = (name, values) => ({ tag: 'animate', attrs: { attributeName: name }, values });
  // An entrance waiting for its delay starts as it will begin.
  const waitAs = (name, value) => {
    if (!((start > 0 || a._base) && ANIM_PRESETS[a.p].enter)) return [];
    const n = mk('set', { attributeName: name, to: value, begin: preview ? 'indefinite' : '0s' });
    n.dataset.scBegin = 0;
    return [n];
  };
  // The layer's box, in the space it sits in.
  const box = () => {
    const b = el.getBBox();
    const own = getM(el);
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(own));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };
  // A box over the layer filled with paint (a gradient or pattern), masked
  // by the layer itself, so it only colours the layer.
  const masked = (paint) => {
    const use = genEl('use');
    const mask = genEl('mask', { id: genId(), 'mask-type': 'alpha' }, [use]);
    const b = box();
    const overlay = genEl('rect', {
      x: f(b.x),
      y: f(b.y),
      width: f(b.width),
      height: f(b.height),
      fill: `url(#${paint.id})`,
      mask: `url(#${mask.id})`,
      'pointer-events': 'none',
    });
    return { defs: [paint, mask], attrs: {}, overlay, use };
  };
  // A paint's transform slid d along, after the transform it has.
  const slide = (name, d) => ({
    tag: 'animateTransform',
    attrs: { attributeName: name, type: 'translate', additive: 'sum' },
    values: ['0 0', `${f(d)} 0`],
  });
  switch (a.p) {
    case 'wipeIn': {
      // A clip box (in the layer's bounding-box units, a little larger, for
      // strokes) growing from one side.
      const grow = {
        left: { width: ['0', '1.2'] },
        right: { x: ['1.1', '-0.1'], width: ['0', '1.2'] },
        top: { height: ['0', '1.2'] },
        bottom: { y: ['1.1', '-0.1'], height: ['0', '1.2'] },
      }[a.from];
      const rect = genEl('rect', { x: '-0.1', y: '-0.1', width: '1.2', height: '1.2' });
      rect.append(
        ...waitAs('width' in grow ? 'width' : 'height', '0'),
        ...nodes(Object.entries(grow).map(([n, v]) => anim(n, v))),
      );
      const clip = genEl('clipPath', { id: genId(), clipPathUnits: 'objectBoundingBox' }, [rect]);
      return { defs: [clip], attrs: { 'clip-path': `url(#${clip.id})` } };
    }
    case 'irisIn': {
      const c = genEl('circle', { cx: '0.5', cy: '0.5', r: '0.75' });
      c.append(...waitAs('r', '0'), ...nodes([anim('r', ['0', '0.75'])]));
      const clip = genEl('clipPath', { id: genId(), clipPathUnits: 'objectBoundingBox' }, [c]);
      return { defs: [clip], attrs: { 'clip-path': `url(#${clip.id})` } };
    }
    case 'blurIn': {
      const sd = f(a.size / k);
      const blur = genEl('feGaussianBlur', { stdDeviation: '0' });
      blur.append(...waitAs('stdDeviation', sd), ...nodes([anim('stdDeviation', [sd, '0'])]));
      const filter = genEl(
        'filter',
        { id: genId(), x: '-50%', y: '-50%', width: '200%', height: '200%' },
        [blur],
      );
      return { defs: [filter], attrs: { filter: `url(#${filter.id})` } };
    }
    case 'glowPulse': {
      // A blur of its outline, in the glow colour, under the layer; only the
      // colour's opacity moves.
      const flood = genEl('feFlood', {
        'flood-color': a.to,
        'flood-opacity': '0',
        result: 'colour',
      });
      flood.append(...nodes([anim('flood-opacity', ['0', '1'])]));
      const filter = genEl(
        'filter',
        { id: genId(), x: '-50%', y: '-50%', width: '200%', height: '200%' },
        [
          genEl('feGaussianBlur', {
            in: 'SourceAlpha',
            stdDeviation: f(a.size / k),
            result: 'soft',
          }),
          flood,
          genEl('feComposite', { in: 'colour', in2: 'soft', operator: 'in', result: 'glow' }),
          genEl('feMerge', {}, [
            genEl('feMergeNode', { in: 'glow' }),
            genEl('feMergeNode', { in: 'SourceGraphic' }),
          ]),
        ],
      );
      return { defs: [filter], attrs: { filter: `url(#${filter.id})` } };
    }
    case 'shine': {
      // A soft white band, off to the left at rest, swept across a box over
      // the layer; masked by the layer itself, so it only lights the layer.
      const grad = genEl(
        'linearGradient',
        {
          id: genId(),
          x1: '0',
          y1: '0',
          x2: '1',
          y2: '0.35',
          gradientTransform: 'translate(-1 0)',
        },
        [
          genEl('stop', { offset: '0.3', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
          genEl('stop', { offset: '0.5', 'stop-color': '#ffffff', 'stop-opacity': '0.65' }),
          genEl('stop', { offset: '0.7', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
        ],
      );
      grad.append(
        ...nodes([
          {
            tag: 'animateTransform',
            attrs: { attributeName: 'gradientTransform', type: 'translate' },
            values: ['-1 0', '1 0'],
          },
        ]),
      );
      return masked(grad);
    }
    case 'ripple': {
      // Two rings round its centre, half a run apart, each growing from the
      // layer's size and fading; under the layer, unseen at rest.
      const b = box();
      const r0 = Math.max(b.width, b.height) / 2;
      const r1 = (r0 * a.scale) / 100;
      const half = (a.dur * (a.dir === 'alternate' ? 2 : 1) + (a.pause || 0)) / 2;
      const ring = (t) => {
        const c = genEl('circle', {
          cx: f(b.x + b.width / 2),
          cy: f(b.y + b.height / 2),
          r: f(r0),
          fill: 'none',
          stroke: a.to,
          'stroke-width': f(a.size),
          opacity: '0',
        });
        c.append(
          ...chanNodes(
            a,
            [anim('r', [f(r0), f(r1)]), anim('opacity', ['1', '0'])],
            preview,
            start + t,
            [],
          ),
        );
        return c;
      };
      const under = genEl('g', { 'pointer-events': 'none' }, [ring(0), ring(half)]);
      return { defs: [], attrs: {}, under };
    }
    case 'gradientFlow': {
      // Its colour, the second and back, repeating; slid one band along.
      const b = box();
      const L = Math.max(b.width, b.height) || 1;
      const from = hex(getComputedStyle(el).fill || '') || '#000000';
      const grad = genEl(
        'linearGradient',
        {
          id: genId(),
          gradientUnits: 'userSpaceOnUse',
          x1: '0',
          y1: '0',
          x2: f(L),
          y2: '0',
          spreadMethod: 'repeat',
          gradientTransform: `translate(${f(b.x)} ${f(b.y)}) rotate(${f(a.angle)})`,
        },
        [
          genEl('stop', { offset: '0', 'stop-color': from }),
          genEl('stop', { offset: '0.5', 'stop-color': a.to }),
          genEl('stop', { offset: '1', 'stop-color': from }),
        ],
      );
      grad.append(...nodes([slide('gradientTransform', L)]));
      return masked(grad);
    }
    case 'patternScroll': {
      // Stripes, a stripe and a gap to a tile, slid one tile along.
      const w = Math.max(a.size, 0.5);
      const pat = genEl(
        'pattern',
        {
          id: genId(),
          patternUnits: 'userSpaceOnUse',
          width: f(2 * w),
          height: f(2 * w),
          patternTransform: `rotate(${f(a.angle)})`,
        },
        [genEl('rect', { width: f(w), height: f(2 * w), fill: a.to })],
      );
      pat.append(...nodes([slide('patternTransform', 2 * w)]));
      return masked(pat);
    }
  }
  return null;
}
// Wrap host (layer el itself, or its copy being saved) for animation a: the
// parts' defs go to addDef, a group goes round host. { top, nodes, undo }:
// the group, the SMIL in it all, and how to take it off again (the preview).
function wrapLayer(el, host, a, preview, start, addDef) {
  const parts = wrapParts(el, a, preview, start);
  if (!parts) return null;
  const g = genEl('g', parts.attrs);
  if (host.parentNode) host.before(g);
  g.append(host);
  if (parts.overlay) g.append(parts.overlay);
  if (parts.under) g.prepend(parts.under);
  let madeId = false;
  if (parts.use) {
    if (!host.id) {
      host.id = genId();
      host.setAttribute('data-sc-gen-id', '');
      madeId = true;
    }
    parts.use.setAttribute('href', `#${host.id}`);
  }
  for (const d of parts.defs) addDef(d);
  const nodes = [...parts.defs, parts.under]
    .filter(Boolean)
    .flatMap((d) =>
      [...d.querySelectorAll('*')].filter((n) => ANIM_KEY_TAGS.includes(n.localName)),
    );
  return {
    top: g,
    nodes,
    undo: () => {
      if (g.parentNode) g.replaceWith(host);
      for (const d of parts.defs) d.remove();
      if (madeId) {
        host.removeAttribute('id');
        host.removeAttribute('data-sc-gen-id');
      }
    },
  };
}

// Where `at` points under root (the layer, live or a copy being saved).
function animHost(root, at, letters) {
  if (!at) return root;
  if ('child' in at) return root.children[at.child] || null;
  if (!letters.has(root)) letters.set(root, splitLetters(root));
  return letters.get(root)[at.letter] || null;
}

// Saving: each animated layer's copy gets its SMIL. `live` is the layer in
// the drawing (for its geometry), `copy` the clone being written out;
// addDef takes what goes in the file's <defs>. Returns what to write in
// copy's place (a group wrapped round it, for Wipe in and the like).
function writeAnimations(live, copy, on, addDef = () => {}) {
  for (const n of copy.querySelectorAll('[data-sc-preview]')) n.remove();
  if (!on) return copy;
  const pick = (root) =>
    [root, ...root.querySelectorAll('[data-sc-anim]')].filter((e) =>
      e.hasAttribute?.('data-sc-anim'),
    );
  const lives = pick(live);
  const copies = pick(copy);
  const letters = new Map();
  lives.forEach((el, i) => {
    const list = readAnims(el);
    const times = animTimes(el, list);
    list.forEach((a0, j) => {
      const a = timed(a0, times[j]);
      const start = times[j].t;
      if (ANIM_PRESETS[a.p].wrap) {
        const w = copies[i] && wrapLayer(el, copies[i], a, false, start, addDef);
        for (const n of w?.nodes || []) delete n.dataset.scBegin;
        return;
      }
      for (const { at: where, nodes } of animEmit(el, a, false, start)) {
        const host = copies[i] && animHost(copies[i], where, letters);
        for (const n of nodes) {
          delete n.dataset.scBegin;
          // On a layer inside it, or a letter: dropped when the file reopens.
          if (where) n.setAttribute('data-sc-gen', '');
          host?.append(n);
        }
      }
    });
  });
  let top = copy;
  while (top.parentNode?.hasAttribute?.('data-sc-gen')) top = top.parentNode;
  return top;
}
