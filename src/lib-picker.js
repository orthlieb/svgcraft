// SVGCraft — Library pickers: a library's tiles, from a button, where a
// list of names used to be.
'use strict';

// The Custom Shape tool's Shape (the Symbols library) and the pattern
// editor's pattern (the Patterns library) are each a button showing the
// current one's picture and name. It opens the library's tiles (searchable,
// by category where it has them) in a popup, the same pictures the panel
// shows, and a link to the panel for managing them. Picking is the same as
// clicking a tile in the panel, and the panel marks the same one.
//
// opts: label (the button's name), items(), current() (an item, or null),
// thumb(item, small) (a CSS background; small for the button's own), cats (filter by category), pick(item, e),
// manage() (show the panel) and manageLabel.
let libPickOpen = null; // the picker showing
// The pickers, kept in step by the panels: { symbols, patterns }.
const libPickers = { symbols: null, patterns: null };
// Tile pictures: a library symbol in ink on white, a pattern in the active
// paint's colour.
const libSymThumb = (it) => `${libSymCss(it)} center / contain no-repeat content-box, #fff`;
const libPatThumb = (it, small) =>
  `${patCss({ ...it, scale: 1 }, state[state.active], small ? 0.7 : 1.5)}, var(--field)`;
function libPicker(btn, opts) {
  btn.classList.add('sc-libpick');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  const thumb = document.createElement('span');
  thumb.className = 'sc-libpick-thumb';
  const name = document.createElement('span');
  name.className = 'sc-libpick-name';
  const caret = document.createElement('span');
  caret.className = 'sc-libpick-caret';
  caret.innerHTML = icon('chevron-down');
  btn.replaceChildren(thumb, name, caret);
  const filter = { q: '', cat: '' };

  function sync() {
    const it = opts.current();
    name.textContent = it ? it.name : 'None';
    thumb.style.setProperty('--tile', it ? opts.thumb(it, true) : 'none');
    btn.setAttribute('aria-label', `${opts.label}: ${it ? it.name : 'none'}`);
    btn.dataset.tip = `${opts.label}: ${it ? it.name : 'none'} · click to pick another`;
    if (libPickOpen?.btn === btn) renderTiles();
  }

  function renderTiles() {
    const pop = libPickPop();
    const all = opts.items();
    const cur = opts.current();
    if (opts.cats) {
      const cats = [...new Set(all.map((x) => x.category || 'Your symbols'))];
      if (filter.cat && !cats.includes(filter.cat)) filter.cat = '';
      const sel = pop.querySelector('.sc-libpick-cat');
      sel.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: 'All' }),
        ...cats.map((c) =>
          Object.assign(document.createElement('option'), { value: c, textContent: c }),
        ),
      );
      sel.value = filter.cat;
    }
    const q = filter.q.trim().toLowerCase();
    const shown = all.filter(
      (x) =>
        (!filter.cat || (x.category || 'Your symbols') === filter.cat) &&
        (!q || `${x.name} ${x.category || ''}`.toLowerCase().includes(q)),
    );
    const grid = pop.querySelector('.sc-libpick-grid');
    grid.replaceChildren(
      ...shown.map((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sc-libpick-tile' + (cur?.id === it.id ? ' sel' : '');
        b.dataset.id = it.id;
        b.setAttribute('aria-label', it.name);
        b.setAttribute('aria-pressed', cur?.id === it.id);
        b.dataset.tip = it.category ? `${it.name} · ${it.category}` : it.name;
        const t = document.createElement('span');
        t.className = 'sc-libpick-tile-thumb';
        t.style.setProperty('--tile', opts.thumb(it));
        const n = document.createElement('span');
        n.className = 'sc-libpick-tile-name';
        n.textContent = it.name;
        b.append(t, n);
        b.addEventListener('click', (e) => {
          close();
          opts.pick(it, e);
          sync();
        });
        return b;
      }),
    );
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'sc-sym-empty';
      p.textContent = all.length ? 'Nothing matches.' : 'The library is empty.';
      grid.append(p);
    }
  }

  function open() {
    if (libPickOpen) libPickOpen.close(false);
    const pop = libPickPop();
    pop.querySelector('.sc-libpick-cat').hidden = !opts.cats;
    const q = pop.querySelector('.sc-libpick-q');
    q.value = filter.q;
    q.placeholder = 'Search';
    q.setAttribute('aria-label', `Search ${opts.label.toLowerCase()}s`);
    pop.setAttribute('aria-label', opts.label);
    pop.querySelector('.sc-libpick-manage span').textContent = opts.manageLabel;
    libPickOpen = { btn, close, filter, renderTiles, manage: opts.manage };
    renderTiles();
    pop.hidden = false;
    if (pop.popover) pop.showPopover();
    place(pop);
    btn.setAttribute('aria-expanded', 'true');
    // The current one in view.
    pop.querySelector('.sc-libpick-tile.sel')?.scrollIntoView({ block: 'nearest' });
    q.focus();
  }
  function close(refocus = true) {
    if (libPickOpen?.btn !== btn) return;
    libPickOpen = null;
    const pop = libPickPop();
    if (pop.popover && pop.matches(':popover-open')) pop.hidePopover();
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }
  // Below the button, kept on screen.
  function place(pop) {
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const x = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const below = r.bottom + 4;
    const y = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }

  btn.addEventListener('click', () => {
    if (libPickOpen?.btn === btn) return close();
    // A press on the button that closed it (light dismiss) doesn't reopen it.
    if (libPickShut.btn === btn && libPickShut.at >= libPickDown.at && btn.contains(libPickDown.el))
      return;
    open();
  });
  sync();
  return { sync, open, close };
}

// The one popup the pickers share.
let libPickEl = null;
let libPickShut = { btn: null, at: 0 };
// The last press anywhere: the one that may have closed the popup.
let libPickDown = { el: null, at: 0 };
addEventListener(
  'pointerdown',
  (e) => (libPickDown = { el: e.target, at: performance.now() }),
  true,
);
function libPickPop() {
  if (libPickEl) return libPickEl;
  const pop = document.createElement('div');
  pop.id = 'sc-libpick-pop';
  pop.className = 'sc-libpick-pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  if ('popover' in pop) pop.popover = 'auto';
  pop.innerHTML =
    '<div class="sc-libpick-filter"><select class="sc-libpick-cat" aria-label="Category"></select>' +
    '<input class="sc-libpick-q" type="search" spellcheck="false" /></div>' +
    '<div class="sc-libpick-grid"></div>' +
    '<button type="button" class="sc-libpick-manage"><span></span></button>';
  document.body.append(pop);
  const q = pop.querySelector('.sc-libpick-q');
  q.addEventListener('input', () => {
    if (!libPickOpen) return;
    libPickOpen.filter.q = q.value;
    libPickOpen.renderTiles();
  });
  pop.querySelector('.sc-libpick-cat').addEventListener('change', (e) => {
    if (!libPickOpen) return;
    libPickOpen.filter.cat = e.target.value;
    libPickOpen.renderTiles();
  });
  pop.querySelector('.sc-libpick-manage').addEventListener('click', () => {
    const manage = libPickOpen?.manage;
    libPickOpen?.close(false);
    manage?.();
  });
  // Light dismiss: the browser closes a popover on a click outside.
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed' || !libPickOpen) return;
    libPickShut = { btn: libPickOpen.btn, at: performance.now() };
    libPickOpen.close(false);
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      libPickOpen?.close();
      return;
    }
    // Arrows: from the search box into the tiles, and around them.
    const tiles = [...pop.querySelectorAll('.sc-libpick-tile')];
    if (!tiles.length || !/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) {
      if (e.key !== 'ArrowDown' || e.target !== q) return;
      e.preventDefault();
      (tiles.find((t) => t.classList.contains('sel')) || tiles[0]).focus();
      return;
    }
    const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    e.preventDefault();
    const j = i + step;
    if (j < 0 && e.key === 'ArrowUp') return q.focus();
    tiles[Math.max(0, Math.min(tiles.length - 1, j))].focus();
  });
  libPickEl = pop;
  return pop;
}
