// SVGCraft — right-click menus: on the canvas and in the Layers panel.
//
// ---- context menus (Photoshop's right-click menus) -----------------------------
// Each menu is a list of entries: an action's name (its menu bar item is
// copied, icon, label and shortcut, and runs through the usual click
// handler), '-' for a divider, { sub, items } for a submenu, or
// { label, icon, run, checked } for an item of its own. An action that
// isn't allowed right now is left out rather than greyed, and so is a
// submenu left empty, so the menu only offers what can be done.
const ctx = document.createElement('div');
ctx.className = 'sc-menu-list sc-ctx';
ctx.id = 'sc-ctx';
ctx.setAttribute('role', 'menu');
ctx.hidden = true;
// Focus sits on the menu itself until an arrow key picks an item, so
// nothing looks chosen when it opens under the pointer.
ctx.tabIndex = -1;
document.body.append(ctx);

// The menu bar's item for an action, copied (with its own label, if
// given); an action with no menu bar item gets one of its own.
function ctxAction(name, { when, label, icon: ic } = {}) {
  if (!actionAllowed(name) || (when && !when())) return null;
  const src = document.querySelector(`.sc-menubar [data-action="${name}"]`);
  if (!src) return ctxItem({ label, icon: ic, run: () => ifAllowed(name) });
  const b = src.cloneNode(true);
  b.removeAttribute('id');
  b.disabled = false;
  b.hidden = false;
  if (label) b.querySelector('span').textContent = label;
  return b;
}
function ctxItem({ label, icon: ic, run, checked }) {
  const b = document.createElement('button');
  b.setAttribute('role', checked == null ? 'menuitem' : 'menuitemcheckbox');
  if (checked != null) b.setAttribute('aria-checked', !!checked);
  b.innerHTML = `<i${ic ? ` data-icon="${ic}"` : ''}>${ic ? icon(ic) : ''}</i><span></span>`;
  b.querySelector('span').textContent = label;
  b.addEventListener('click', () => {
    closeCtx();
    run();
  });
  return b;
}
function ctxSub(label, ic, items) {
  const kids = ctxBuild(items);
  if (!kids.some((k) => k.localName === 'button' || k.classList.contains('sc-submenu')))
    return null;
  const sm = document.createElement('div');
  sm.className = 'sc-submenu';
  sm.innerHTML =
    `<button role="menuitem" class="sc-sub-btn" aria-haspopup="menu" aria-expanded="false">` +
    `<i${ic ? ` data-icon="${ic}"` : ''}>${ic ? icon(ic) : ''}</i><span></span>` +
    `<i data-icon="chevron-right" class="sc-sub-caret">${icon('chevron-right')}</i></button>` +
    '<div class="sc-menu-list sc-sub-list" role="menu" hidden></div>';
  sm.querySelector('.sc-sub-btn span').textContent = label;
  sm.querySelector('.sc-sub-list').append(...kids);
  const btn = sm.querySelector('.sc-sub-btn');
  btn.addEventListener('pointerenter', () => openSub(sm));
  btn.addEventListener('click', () => openSub(sm, true));
  return sm;
}
// The entries as elements, with no divider at either end or twice running.
function ctxBuild(entries) {
  const out = [];
  for (const e of entries) {
    let el;
    if (e === '-') {
      if (out.length && out.at(-1).localName !== 'hr') out.push(document.createElement('hr'));
      continue;
    }
    if (typeof e === 'string') el = ctxAction(e);
    else if (e.act) el = ctxAction(e.act, e);
    else if (e.sub) el = ctxSub(e.sub, e.icon, e.items);
    else el = ctxItem(e);
    if (el) out.push(el);
  }
  while (out.at(-1)?.localName === 'hr') out.pop();
  return out;
}

let ctxReturn = null;
function openCtx(entries, x, y) {
  closeMenus();
  closeCtx();
  syncActions();
  const kids = ctxBuild(entries);
  if (!kids.length) return;
  ctx.replaceChildren(...kids);
  for (const b of ctx.querySelectorAll(':scope > button'))
    b.addEventListener('pointerenter', closeSubs);
  ctxReturn = document.activeElement;
  ctx.hidden = false;
  // Below and right of the pointer, flipped where it would run off.
  const w = ctx.offsetWidth;
  const h = ctx.offsetHeight;
  ctx.style.left = `${Math.max(4, x + w + 4 > innerWidth ? x - w : x)}px`;
  ctx.style.top = `${Math.max(4, y + h + 4 > innerHeight ? Math.max(4, innerHeight - h - 4) : y)}px`;
  ctx.focus({ preventScroll: true });
}
function closeCtx() {
  if (ctx.hidden) return;
  closeSubs();
  ctx.hidden = true;
  ctx.replaceChildren();
  if (ctxReturn?.isConnected && ctx.contains(document.activeElement)) ctxReturn.focus();
  ctxReturn = null;
}
// A menu bar action chosen from it runs (actions.js) and the menu goes.
ctx.addEventListener('click', (e) => {
  if (e.target.closest('[data-action]')) setTimeout(closeCtx, 0);
});
ctx.addEventListener('keydown', (e) => {
  const list = e.target.closest('.sc-menu-list');
  const items = [...list.querySelectorAll(':scope > button, :scope > .sc-submenu > .sc-sub-btn')];
  const at = items.indexOf(document.activeElement);
  const n = items.length;
  const go = (d) => items[at < 0 ? (d > 0 ? 0 : n - 1) : (at + d + n) % n]?.focus();
  const sub = list.classList.contains('sc-sub-list');
  const keys = {
    ArrowDown: () => go(1),
    ArrowUp: () => go(-1),
    ArrowRight: () =>
      document.activeElement.classList.contains('sc-sub-btn') &&
      openSub(document.activeElement.parentElement, true),
    ArrowLeft: () => {
      if (!sub) return;
      closeSubs();
      list.parentElement.querySelector('.sc-sub-btn').focus();
    },
    Escape: () => {
      if (!sub) return closeCtx();
      closeSubs();
      list.parentElement.querySelector('.sc-sub-btn').focus();
    },
  };
  if (!keys[e.key]) return;
  e.preventDefault();
  e.stopPropagation();
  keys[e.key]();
});
document.addEventListener('pointerdown', (e) => {
  if (!ctx.hidden && !ctx.contains(e.target)) closeCtx();
});
window.addEventListener('blur', closeCtx);
window.addEventListener('resize', closeCtx);

// ---- the canvas -----------------------------------------------------------------
// The layers under a page point, top first: each shape (or text, or symbol
// instance) as Auto-Select: Layer would pick it.
function layersAt(x, y) {
  const out = [];
  for (const n of document.elementsFromPoint(x, y)) {
    if (!doc.contains(n) || n === doc) continue;
    const el = n.closest('text') || n;
    if (selectable(el) && !out.includes(el)) out.push(el);
  }
  return out;
}

const TRANSFORM_ITEMS = [
  'tfScale',
  'tfRotate',
  'tfSkew',
  '-',
  'rot180',
  'rot90cw',
  'rot90ccw',
  'flipH',
  'flipV',
  '-',
  { act: 'tfCommit', label: 'Commit Transform', icon: 'check' },
  { act: 'tfCancel', label: 'Cancel Transform', icon: 'xmark' },
];
const isLocked = (el) => el.hasAttribute('data-sc-lock');

// What the selection can do, for the canvas and the Layers panel alike.
const selectionItems = () => [
  {
    sub: 'Transform',
    icon: 'rotate',
    items: ['flipH', 'flipV', '-', 'rot180', 'rot90cw', 'rot90ccw'],
  },
  { sub: 'Arrange', icon: 'layer-group', items: ['front', 'forward', 'backward', 'back'] },
  {
    sub: 'Align',
    icon: 'align-left',
    items: [
      'alignLeft',
      'alignHCenter',
      'alignRight',
      'alignTop',
      'alignVCenter',
      'alignBottom',
      '-',
      'distributeH',
      'distributeV',
    ],
  },
  '-',
  'group',
  'ungroup',
  'clipMake',
  'clipRelease',
  {
    sub: 'Combine Shapes',
    icon: 'sc-unite',
    items: ['combineUnite', 'combineSubtract', 'combineIntersect', 'combineExclude'],
  },
  'makeSymbol',
  'editSymbol',
  'breakSymbolLink',
  '-',
  'imageTrace',
  'createOutlines',
  'convertTextKind',
  'textOnPath',
  'releaseTextOnPath',
  'reversePath',
  '-',
  'layerStyle',
  'copyLayerStyle',
  'pasteLayerStyle',
  'clearLayerStyle',
  { act: 'lockAll', when: () => !state.sel.every(isLocked) },
  { act: 'unlockLayers', when: () => state.sel.some(isLocked) },
];

function canvasMenu(x, y) {
  if (state.tf) return TRANSFORM_ITEMS;
  const here = layersAt(x, y);
  const layersHere = here.length > 1 && {
    sub: 'Layers Here',
    icon: 'layer-group',
    items: here.map((el) => ({
      label: layerName(el),
      checked: state.sel.includes(el),
      run: () => setSel([el]),
    })),
  };
  if (!state.sel.length)
    return [
      layersHere,
      'paste',
      { act: 'selectAll', label: 'Select All' },
      'cropToDrawing',
      '-',
      'zoomIn',
      'zoomOut',
      'fit',
      'zoom100',
    ].filter(Boolean);
  return [
    layersHere,
    '-',
    'cut',
    'copy',
    'paste',
    'duplicate',
    'delete',
    '-',
    'freeTransform',
    ...selectionItems(),
    '-',
    'deselect',
    { act: 'invertSelection', label: 'Select Inverse' },
    'cropToSelection',
  ].filter(Boolean);
}

stage.addEventListener('contextmenu', (e) => {
  // Editing text: the browser's own menu (cut, copy, paste, spelling).
  if (e.target.closest?.('[contenteditable="true"], input, textarea')) return;
  e.preventDefault();
  if (!curDoc) return;
  // Right-clicking a layer outside the selection selects it first, as a
  // click with the Move tool would.
  if (!state.tf) {
    const el = pickLayer(document.elementFromPoint(e.clientX, e.clientY));
    if (el && !state.sel.includes(el)) setSel([el]);
  }
  openCtx(canvasMenu(e.clientX, e.clientY), e.clientX, e.clientY);
});

// ---- the Layers panel -------------------------------------------------------------
const layerRowItems = (el) => [
  {
    label: 'Rename Layer…',
    icon: 'pen',
    run: () => {
      const name = [...$('#sc-layers').children]
        .find((r) => r.layerEl === el)
        ?.querySelector('.sc-layer-name');
      if (name) renameLayer(el, name);
    },
  },
  'duplicate',
  'delete',
  '-',
  ...selectionItems().filter((e) => !['Transform', 'Align'].includes(e.sub)),
  '-',
  'mergeDown',
  'mergeVisible',
  '-',
  'copySvg',
];
// The eye column: this layer, or all the others.
function eyeItems(el) {
  const hidden = el.getAttribute('display') === 'none';
  const vis = (n) => n.getAttribute('display') !== 'none';
  const others = layerSiblings(el);
  const alone = others.length > 0 && others.every((n) => !vis(n));
  const setShown = (els, on) => {
    noteStep(on ? 'Show Layers' : 'Hide Layers');
    for (const n of els)
      if (on) n.removeAttribute('display');
      else n.setAttribute('display', 'none');
    commit();
  };
  return [
    {
      label: hidden ? 'Show This Layer' : 'Hide This Layer',
      icon: hidden ? 'eye' : 'eye-slash',
      run: () => setShown([el], hidden),
    },
    others.length && {
      label: alone ? 'Show All Other Layers' : 'Hide All Other Layers',
      icon: alone ? 'eye' : 'eye-slash',
      run: () => setShown(others, alone),
    },
  ].filter(Boolean);
}
// Every other layer: el's siblings, and its groups' siblings up to the top,
// so hiding them leaves el the only thing showing.
function layerSiblings(el) {
  const out = [];
  for (let a = el; a && a !== doc && doc.contains(a); a = a.parentNode)
    out.push(...[...a.parentNode.children].filter((n) => n !== a && selectable(n)));
  return out;
}

$('#sc-layers').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('li');
  if (e.target.closest('input')) return;
  e.preventDefault();
  if (!row?.layerEl) return;
  const el = row.layerEl;
  if (e.target.closest('.sc-eye')) return openCtx(eyeItems(el), e.clientX, e.clientY);
  if (!state.sel.includes(el)) setSel([el]);
  openCtx(layerRowItems(el), e.clientX, e.clientY);
});
