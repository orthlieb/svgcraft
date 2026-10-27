// SVGCraft — Help: help.html (built from the README by scripts/gen-help.mjs)
// opened on the topic for what you're looking at.
'use strict';

// Help → SVGCraft Help (F1), and the ? on each dialog and panel group.
function openHelp(topic = '') {
  window.open(`help.html${topic ? `#${topic}` : ''}`, 'svgcraft-help', 'noopener');
}
actions.help = () => openHelp(helpTopicNow());
// F1 from anywhere, dialogs included (the browser's own help is kept off).
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'F1') return;
    e.preventDefault();
    actions.help();
  },
  true,
);

// Each panel tab's topic (the Layers group is "layers").
const TAB_HELP = {
  color: 'colours',
  swatches: 'libraries',
  gradients: 'gradients',
  patterns: 'patterns',
  props: 'docked-panels',
  character: 'character-panel',
  paragraph: 'paragraph-panel',
  symbols: 'symbols',
  animation: 'animate',
  history: 'history-panel',
};
// What F1 opens: the open dialog's topic, if it has one.
const helpTopicNow = () => document.querySelector('dialog[open][data-help]')?.dataset.help || '';

const helpButton = (tip, topic) => {
  const b = document.createElement('button');
  b.className = 'sc-ibtn sc-help-btn';
  b.innerHTML = icon('circle-question');
  b.dataset.tip = tip;
  b.setAttribute('aria-label', tip);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    openHelp(topic());
  });
  return b;
};
// Dialogs: in the title bar.
for (const d of document.querySelectorAll('dialog[data-help]'))
  d.querySelector('.sc-dialog-title')?.append(helpButton('Help on this', () => d.dataset.help));
// Panel groups: before the fold chevron, for the open tab.
for (const g of pgroups) {
  const bar = g.querySelector('.sc-ptabs');
  const open = () => g.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab;
  bar.insertBefore(
    helpButton('Help on this panel', () => TAB_HELP[open()] || 'layers'),
    bar.querySelector('.sc-pcollapse'),
  );
}
// The phone's Info sheet.
$('#sc-pinfo-help')?.addEventListener('click', () => {
  hideDialog($('#sc-pinfo'));
  openHelp('workspace');
});
