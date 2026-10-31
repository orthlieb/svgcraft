// SVGCraft — The docked panels: their tabs, folding a group to its tabs,
// and collapsing the column to a strip of icons.
'use strict';

// Panel tabs (Properties | Character | …), and the Libraries window's.
for (const group of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...group.querySelectorAll('[data-tab]')];
  for (const t of tabs) {
    t.addEventListener('click', () => {
      for (const x of tabs) {
        x.setAttribute('aria-selected', x === t);
        group.querySelector(`[data-pane="${x.dataset.tab}"]`).hidden = x !== t;
      }
    });
  }
}

// Collapsing a panel group to its tab bar, as in Photoshop: double-click
// the bar or use its chevron; clicking a tab of a folded group opens it.
// Remembered between visits.
const PANELS_KEY = 'svgcraft.panels';
const pgroups = [...document.querySelectorAll('#sc-panel > .sc-pgroup')];
function setCollapsed(group, on, save = true) {
  group.classList.toggle('collapsed', on);
  const b = group.querySelector('.sc-pcollapse');
  b.setAttribute('aria-expanded', !on);
  b.dataset.tip = on ? 'Expand panel' : 'Collapse panel';
  b.setAttribute('aria-label', b.dataset.tip);
  if (save)
    store(
      PANELS_KEY,
      pgroups.map((g) => g.classList.contains('collapsed')),
    );
}
// Show a panel because the user asked for it (a menu command): its tab,
// with its group unfolded.
function showTab(name) {
  // Swatches, Gradients, Patterns and Symbols are in the Libraries window.
  if (LIB_TABS.includes(name)) return openLibraries(name);
  const t = $(`[data-tab="${name}"]`);
  if (document.body.classList.contains('sc-dock-icons')) return openPopout(t);
  t.click();
  setCollapsed(t.closest('.sc-pgroup'), false);
}
// Folded groups from last time (all open when unreadable).
const savedCollapsed = (group) => {
  const saved = stored(PANELS_KEY, []);
  return Array.isArray(saved) && saved[pgroups.indexOf(group)] === true;
};
pgroups.forEach((group) => {
  const bar = group.querySelector('.sc-ptabs');
  const b = document.createElement('button');
  b.className = 'sc-ibtn sc-pcollapse';
  b.innerHTML = icon('chevron-down');
  b.addEventListener('click', () => setCollapsed(group, !group.classList.contains('collapsed')));
  bar.append(b);
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.sc-pcollapse') || group.classList.contains('sc-popout')) return;
    setCollapsed(group, !group.classList.contains('collapsed'));
  });
  // A tab you click opens a folded group; the editor switching tabs on its
  // own (Character when text is selected) leaves it folded.
  for (const t of group.querySelectorAll('[data-tab]'))
    t.addEventListener('click', (e) => {
      if (e.isTrusted && group.classList.contains('collapsed')) setCollapsed(group, false);
    });
  setCollapsed(group, savedCollapsed(group), false);
});

// Group heights, as in Photoshop: each tabbed group keeps its height
// whatever its tab shows (more scrolls inside it), so selecting something
// doesn't shuffle the panels below; drag the divider under a group to
// resize it (double-click for its natural height). Layers takes the rest,
// and always keeps room. Desktop only; remembered.
const PANEL_H_KEY = 'svgcraft.panelHeights';
const MIN_GROUP_H = 90;
const tabGroups = pgroups.filter((g) => g.hasAttribute('data-tabs'));
function naturalHeight(g) {
  const folded = g.classList.contains('collapsed');
  g.classList.remove('collapsed');
  g.style.removeProperty('--h');
  const h = Math.ceil(g.scrollHeight);
  g.classList.toggle('collapsed', folded);
  return h || 300;
}
function setGroupHeight(g, h, save = true) {
  g.style.setProperty('--h', `${Math.round(Math.max(MIN_GROUP_H, h))}px`);
  if (save)
    store(
      PANEL_H_KEY,
      tabGroups.map((x) => parseFloat(x.style.getPropertyValue('--h')) || null),
    );
}
function applyGroupHeights() {
  const saved = stored(PANEL_H_KEY, []);
  tabGroups.forEach((g, i) => {
    const h = Array.isArray(saved) && saved[i];
    setGroupHeight(g, h > 0 ? h : naturalHeight(g), false);
  });
}
for (const g of tabGroups) {
  const split = document.createElement('div');
  split.className = 'sc-splitter sc-splitter-h sc-psplit';
  split.tabIndex = 0;
  split.setAttribute('role', 'separator');
  split.setAttribute('aria-orientation', 'horizontal');
  split.setAttribute('aria-label', 'Resize panel');
  g.after(split);
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    split.classList.add('dragging');
    const y0 = e.clientY;
    const h0 = g.getBoundingClientRect().height;
    const max = $('#sc-panel').clientHeight;
    const move = (ev) => setGroupHeight(g, Math.min(max, h0 + ev.clientY - y0), false);
    const up = () => {
      split.classList.remove('dragging');
      split.removeEventListener('pointermove', move);
      setGroupHeight(g, g.getBoundingClientRect().height);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up, { once: true });
    split.addEventListener('pointercancel', up, { once: true });
  });
  split.addEventListener('dblclick', () => setGroupHeight(g, naturalHeight(g)));
  split.addEventListener('keydown', (e) => {
    const d = { ArrowUp: -10, ArrowDown: 10 }[e.key];
    if (!d) return;
    e.preventDefault();
    setGroupHeight(g, g.getBoundingClientRect().height + d);
  });
}
applyGroupHeights();

// The » button: the panels shrink to a strip of their icons, as in
// Photoshop; an icon pops its panel out beside the strip, and a click
// elsewhere or Esc puts it away. Desktop only (tablets have the drawer).
const DOCK_KEY = 'svgcraft.dock';
const dockStrip = $('.sc-dock-strip');
const dockTabs = [
  ...pgroups.flatMap((g) => [...g.querySelectorAll('[data-tab]')]),
  pgroups.at(-1).querySelector('.sc-ptitle'),
];
let popout = null;
const dockIcons = () => document.body.classList.contains('sc-dock-icons');
for (const t of dockTabs) {
  const b = document.createElement('button');
  b.className = 'sc-ibtn sc-dock-icon';
  b.innerHTML = icon(t.querySelector('i').dataset.icon);
  const name = t.textContent.trim();
  b.dataset.tip = name;
  b.setAttribute('aria-label', name);
  b.setAttribute('aria-pressed', 'false');
  b.dockTab = t;
  b.addEventListener('click', () => (popout?.tab === t ? closePopout() : openPopout(t, b)));
  t.dockIcon = b;
  dockStrip.append(b);
}
function openPopout(t, b = t.dockIcon) {
  closePopout();
  const group = t.closest('.sc-pgroup');
  if (t.dataset.tab) t.click();
  setCollapsed(group, false, false);
  group.classList.add('sc-popout');
  const r = b.getBoundingClientRect();
  const panel = $('#sc-panel').getBoundingClientRect();
  group.style.right = `${innerWidth - panel.left + 2}px`;
  group.style.maxHeight = `${panel.height}px`;
  group.style.top = `${Math.max(panel.top, Math.min(r.top, panel.bottom - group.offsetHeight))}px`;
  b.setAttribute('aria-pressed', 'true');
  popout = { tab: t, group, icon: b };
}
function closePopout() {
  if (!popout) return;
  const { group, icon: b } = popout;
  group.classList.remove('sc-popout');
  group.style.right = group.style.top = group.style.maxHeight = '';
  b.setAttribute('aria-pressed', 'false');
  popout = null;
  // Back to how the user left it.
  setCollapsed(group, savedCollapsed(group), false);
}
function setDockIcons(on, save = true) {
  closePopout();
  document.body.classList.toggle('sc-dock-icons', on);
  const b = $('.sc-dock-toggle');
  b.setAttribute('aria-expanded', !on);
  b.dataset.tip = on ? 'Expand panels' : 'Collapse to icons';
  b.setAttribute('aria-label', b.dataset.tip);
  if (save) store(DOCK_KEY, on ? 'icons' : null);
  applyView();
  drawRulers();
}
actions.toggleDock = () => setDockIcons(!dockIcons());
document.addEventListener('pointerdown', (e) => {
  if (popout && !e.target.closest('.sc-popout, .sc-dock-strip, .sc-tip, dialog, .sc-menu-list'))
    closePopout();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && popout && !document.querySelector('dialog[open]')) {
      closePopout();
      e.stopPropagation();
    }
  },
  true,
);
if (stored(DOCK_KEY) === 'icons') setDockIcons(true, false);

// ---- Window menu -------------------------------------------------------------
// Each panel by name (ticked when it's showing), the floating / docked
// windows, and the workspace: collapse to icons, hide the panels, reset.
const PANEL_TABS = {
  Color: 'color',
  Properties: 'props',
  Character: 'character',
  Paragraph: 'paragraph',
  Animation: 'animation',
  History: 'history',
};
const layersGroup = pgroups.at(-1);
const panelsHidden = () =>
  document.body.classList.contains('sc-no-panels') ||
  document.body.classList.contains('sc-no-right');
// Bring a panel into view: the panels back if Tab hid them, then its tab,
// unfolded (or popped out of the icon strip).
function showPanel(tab) {
  if (panelsHidden()) togglePanels(false);
  if (tab) return showTab(tab);
  if (dockIcons()) return openPopout(layersGroup.querySelector('.sc-ptitle'));
  setCollapsed(layersGroup, false);
}
// Chosen again while it's showing, a panel puts its group away, as
// Photoshop's Window menu closes it.
function togglePanel(tab) {
  if (!panelShowing(tab)) return showPanel(tab);
  if (dockIcons()) return closePopout();
  const t = tab ? $(`[data-tab="${tab}"]`) : layersGroup.querySelector('.sc-ptitle');
  setCollapsed(t.closest('.sc-pgroup'), true);
}
for (const [name, tab] of Object.entries(PANEL_TABS))
  actions[`panel${name}`] = () => togglePanel(tab);
actions.panelLayers = () => togglePanel(null);
function panelShowing(tab) {
  if (panelsHidden()) return false;
  const t = tab ? $(`[data-tab="${tab}"]`) : layersGroup.querySelector('.sc-ptitle');
  const group = t.closest('.sc-pgroup');
  if (tab && t.getAttribute('aria-selected') !== 'true') return false;
  return dockIcons() ? popout?.group === group : !group.classList.contains('collapsed');
}
function syncWindowMenu() {
  for (const [name, tab] of [...Object.entries(PANEL_TABS), ['Layers', null]])
    $(`[data-action="panel${name}"]`).setAttribute('aria-checked', panelShowing(tab));
  $('.sc-menu-list [data-action="toggleDock"]').setAttribute('aria-checked', dockIcons());
}

// Window → Reset Workspace: every panel open on its first tab, the icon
// strip and Tab's hiding undone, Icon Preview and SVG Source docked at the
// standard size, and dialogs back where they open.
actions.resetWorkspace = () => {
  if (panelsHidden()) togglePanels(false);
  setDockIcons(false);
  for (const g of pgroups) {
    setCollapsed(g, false, false);
    g.querySelector('[data-tab]')?.click();
  }
  store(PANELS_KEY, null);
  store(PANEL_H_KEY, null);
  applyGroupHeights();
  for (const k of [DOCK_W_KEY, DOCK_SPLIT_KEY]) store(k, null);
  for (const d of dockables) {
    store(d.key, null);
    if (dockRoomQuery.matches) setDocked(d, true, false);
  }
  for (const dlg of document.querySelectorAll('dialog.sc-dialog'))
    dlg.style.left = dlg.style.top = dlg.style.transform = '';
  syncDock();
  say('Workspace reset.');
};
