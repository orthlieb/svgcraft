// SVGCraft — Window → Libraries: making and managing swatches, gradients,
// patterns and symbols.
'use strict';

// Using them happens where you work: the Color panel's Fill and Stroke
// pick from them, the Custom Shape tool draws a symbol, and tiles drag
// onto the canvas. Their pickers' Custom… opens this window on the right
// tab. It floats, like SVG Source, and remembers its tab, place and size.
const libWin = $('#sc-libraries');
const LIB_TABS = ['swatches', 'gradients', 'patterns', 'symbols'];
const LIB_TAB_KEY = 'svgcraft.librariesTab';
let libReturnFocus = null;

function showLibTab(name) {
  if (!LIB_TABS.includes(name)) return;
  libWin.querySelector(`[data-tab="${name}"]`).click();
}
// Each tab click (the panel-tab wiring in src/panels.js does the
// switching) is remembered.
for (const t of libWin.querySelectorAll('[data-tab]'))
  t.addEventListener('click', () => store(LIB_TAB_KEY, t.dataset.tab));

function openLibraries(tab) {
  showLibTab(tab || stored(LIB_TAB_KEY) || 'swatches');
  if (libWin.hidden) {
    libReturnFocus = document.activeElement;
    libWin.hidden = false;
    // First time: beside the panels, at the top.
    if (!libWin.style.left) {
      libWin.style.left = `${Math.max(8, innerWidth - libWin.offsetWidth - 320)}px`;
      libWin.style.top = '96px';
    }
    winClamp(libWin);
  }
  $('[data-action="toggleLibraries"]').setAttribute('aria-checked', 'true');
  libWin.querySelector('[data-tab][aria-selected="true"]').focus();
}
function closeLibraries() {
  if (libWin.hidden) return;
  libWin.hidden = true;
  $('[data-action="toggleLibraries"]').setAttribute('aria-checked', 'false');
  if (libWin.contains(document.activeElement)) {
    const back = libReturnFocus;
    if (back?.isConnected && !libWin.contains(back) && !back.closest('.sc-menus')) back.focus();
    else document.activeElement.blur();
  }
}
const toggleLibraries = () => (libWin.hidden ? openLibraries() : closeLibraries());

$('#sc-lib-close').addEventListener('click', closeLibraries);
libWin.addEventListener('keydown', (e) => {
  // Esc closes it, unless a field or popup inside wants it.
  if (e.key !== 'Escape' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  closeLibraries();
});
dragWindow(libWin, $('#sc-lib-titlebar'));

// Fill and Stroke's swatches: the library's colours, and Custom… to make
// and manage them.
for (const k of ['fill', 'stroke'])
  libPickers[k] = libPicker($(`#sc-${k}-swatch`), {
    label: `${k === 'fill' ? 'Fill' : 'Stroke'} swatches`,
    compact: true,
    items: () => lib.swatches,
    current: () =>
      state[k + 'On'] && !state[k + 'Grad'] && !state[k + 'Pat']
        ? lib.swatches.find((x) => x.c === state[k] && x.a === state[k + 'A'])
        : null,
    thumb: libSwatchThumb,
    pick: (x) => {
      state.active = k;
      applySwatch(x.c, x.a);
    },
    manage: () => openLibraries('swatches'),
    manageTip: 'Make and manage swatches in the Libraries window',
  });
