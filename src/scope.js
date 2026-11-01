// SVGCraft — Isolation mode: working inside a group.
'use strict';

// Double-clicking a group with the Move tool isolates it: clicks pick the
// group's own children, the rest of the drawing is dimmed and out of
// reach, and new shapes go into the group. A bar names where you are
// (Drawing › Palette › Brush); a crumb jumps back up, Done or a
// double-click off the group leaves, and Esc steps out a level. The group
// is `scope` (null: the whole drawing). What's dimmed carries data-sc-dim,
// an editor mark that's never saved or kept in the history.

const scopeRoot = () => (scope && doc.contains(scope) ? scope : doc);

// What a click inside the scope picks: the scope's child the node is in.
function topIn(node) {
  const root = scopeRoot();
  if (!node || !root.contains(node) || node === root) return null;
  while (node.parentNode !== root) node = node.parentNode;
  return selectable(node) ? node : null;
}
const scopeItems = () => [...scopeRoot().children].filter(selectable);
const inScope = (el) => !!el && el !== scopeRoot() && scopeRoot().contains(el);

// Dim everything beside the path down to the scope.
function markDims() {
  for (const n of doc.querySelectorAll('[data-sc-dim]')) n.removeAttribute('data-sc-dim');
  if (!scope || !doc.contains(scope)) return;
  for (let n = scope; n !== doc; n = n.parentNode)
    for (const s of n.parentNode.children)
      if (s !== n && selectable(s)) s.setAttribute('data-sc-dim', '');
}
// fn's result read with the marks off (for the history and saving).
function withoutDims(fn) {
  const marked = [
    ...doc.querySelectorAll('[data-sc-dim]'),
    ...(iso ? iso.back.querySelectorAll('[data-sc-dim]') : []),
  ];
  for (const n of marked) n.removeAttribute('data-sc-dim');
  try {
    return fn();
  } finally {
    for (const n of marked) n.setAttribute('data-sc-dim', '');
  }
}

// Set the scope (a group in the drawing, or null) and show it.
function setScope(g) {
  scope = g && g.localName === 'g' && doc.contains(g) ? g : null;
  markDims();
  renderScopeBar();
}

// Isolate group g.
function enterScope(g) {
  if (!g || g.localName !== 'g' || !doc.contains(g)) return;
  if (lockOf(g) === 'all') return warn('This group is locked: unlock it to work inside it.');
  tools[state.tool].leave?.();
  if (state.tf) endTransform(true);
  setScope(g);
  setSel([]);
  renderLayers();
}
// Step out a level (or all the way), selecting the group just left.
function leaveScope(all = false) {
  if (!scope) return;
  const was = doc.contains(scope) ? scope : null;
  tools[state.tool].leave?.();
  if (state.tf) endTransform(true);
  const up = was && !all && was.parentNode !== doc ? was.parentNode : null;
  setScope(up);
  setSel(was ? [was] : []);
  renderLayers();
}

// Shapes added at the drawing's top level while a group is isolated (drawn,
// placed or pasted) go into it, keeping where they are on the page.
function adoptIntoScope() {
  if (!scope || iso || !doc.contains(scope)) return;
  for (const c of [...doc.children])
    if (selectable(c) && !c.hasAttribute('data-sc-dim') && !c.contains(scope)) reparent(c, scope);
}

// The bar: Drawing › … › the group, each level above a button back to it.
function renderScopeBar() {
  const bar = $('#sc-scope');
  bar.hidden = !scope || !!iso;
  if (bar.hidden) return;
  const path = [];
  for (let n = scope; n && n !== doc; n = n.parentNode) path.unshift(n);
  const crumbs = $('#sc-scope-path');
  crumbs.replaceChildren();
  const crumb = (label, target) => {
    const b = document.createElement('button');
    b.className = 'sc-scope-crumb';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (target) enterScope(target);
      else leaveScope(true);
    });
    crumbs.append(b, document.createTextNode(' › '));
  };
  crumb('Drawing', null);
  path.slice(0, -1).forEach((g) => crumb(layerName(g), g));
  const here = document.createElement('b');
  here.textContent = layerName(scope);
  crumbs.append(here);
}
