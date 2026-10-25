// SVGCraft — The docked panels: their tabs, folding a group to its tabs,
// and collapsing the column to a strip of icons.
'use strict';

// Panel tabs (Color | Swatches).
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
