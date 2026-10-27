// SVGCraft — Fill rule (non-zero / even-odd) and Reverse Path Direction.
'use strict';

// The fill rule decides what's inside where a path crosses itself or holds
// another subpath: non-zero (SVG's default) fills an area unless the
// outline's directions around it cancel out; even-odd makes every nested
// loop a hole, whichever way it runs. Properties shows it for the selected
// paths, polygons and polylines (inside groups too) and sets it on each.
// Non-zero is written as no attribute, unless something above (a group, a
// style) would make the shape even-odd.
const RULE_SHAPES = 'path,polygon,polyline';
// Reverse Path Direction works on these; basic shapes become paths.
const REVERSIBLE = 'path,polygon,polyline,line,rect,circle,ellipse';

function shapesIn(sel, query) {
  const out = [];
  for (const el of sel) {
    if (el.matches(query)) out.push(el);
    else if (el.localName === 'g' || el.localName === 'a') out.push(...el.querySelectorAll(query));
  }
  return out;
}
const ruleOf = (el) => (getComputedStyle(el).fillRule === 'evenodd' ? 'evenodd' : 'nonzero');

function syncFillRuleUI() {
  const els = shapesIn(state.sel, RULE_SHAPES);
  $('#sc-fillrule-props').hidden = !els.length;
  if (!els.length) return;
  // A mixed selection shows neither.
  const rules = new Set(els.map(ruleOf));
  for (const b of document.querySelectorAll('[data-fill-rule]'))
    b.setAttribute('aria-checked', rules.size === 1 && rules.has(b.dataset.fillRule));
}

function setFillRule(rule) {
  const els = shapesIn(state.sel, RULE_SHAPES);
  if (!els.length) return warn('Select a path, polygon or polyline to set its fill rule.');
  if (refuseLocked(state.sel, 'edit')) return;
  for (const el of els) {
    el.style.removeProperty('fill-rule');
    if (!el.getAttribute('style')) el.removeAttribute('style');
    el.removeAttribute('fill-rule');
    if (rule === 'evenodd' || ruleOf(el) !== rule) el.setAttribute('fill-rule', rule);
  }
  commit();
  syncFillRuleUI();
  say(`Fill rule: ${rule === 'evenodd' ? 'even-odd' : 'non-zero'}.`);
}

// Reversed: the nodes in the other order, each node's handles swapped. A
// closed subpath keeps its starting point, so its closing segment is the
// same segment run backwards.
function reverseSubpath(sp) {
  const nodes = sp.nodes.map((n) => ({ ...n, hin: n.hout, hout: n.hin })).reverse();
  if (sp.closed) nodes.unshift(nodes.pop());
  return { ...sp, nodes };
}

// Object → Path → Reverse Direction (and the button under Fill rule): every
// selected path, polygon, polyline or line runs the other way. That flips
// which loops are holes under non-zero, where text on the path starts, and
// which end markers and dashes begin from. Rectangles, circles and ellipses
// can't be reversed as they are, so they become paths.
function reversePaths() {
  const els = shapesIn(state.sel, REVERSIBLE);
  if (!els.length) return warn('Select a path or shape to reverse its direction.');
  if (refuseLocked(state.sel, 'edit')) return;
  for (const el of els) {
    if (el.localName === 'line') {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => el.getAttribute(k) || '0');
      el.setAttribute('x1', x2);
      el.setAttribute('y1', y2);
      el.setAttribute('x2', x1);
      el.setAttribute('y2', y1);
    } else if (el.localName === 'polygon' || el.localName === 'polyline') {
      const pts = [...el.points].map((p) => `${f(p.x)},${f(p.y)}`).reverse();
      el.setAttribute('points', pts.join(' '));
    } else {
      const subs = shapeNodes(el).map(reverseSubpath);
      const p = toPath(el);
      // A live rectangle's corners would rebuild it the old way round.
      p.removeAttribute('data-rect');
      p.removeAttribute('data-radii');
      p.setAttribute('d', nodesD(subs));
      if (p !== el) state.sel = state.sel.map((s) => (s === el ? p : s));
    }
  }
  commit();
  drawSelection();
  say(`Reversed ${els.length === 1 ? 'the path' : `${els.length} paths`}.`);
}
