// SVGCraft — Photoshop's pointers: drawn here as SVG cursors, black outlined
// in white (or white in black) so they show on any colour, with the small
// badges Photoshop adds: + to add to a selection, − to take away, * to
// start a new path, o to close one.
'use strict';

const CURSOR_SIZE = 24;
// An image cursor with its hotspot, and a stock cursor where images aren't
// allowed.
const svgCursor = (body, x, y, fallback) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 24 24">${body}</svg>`,
  )}") ${x} ${y}, ${fallback}`;
// A shape in black, outlined in white (or the other way round).
const inked = (d, dark = true) =>
  `<path d="${d}" fill="${dark ? '#000' : '#fff'}" stroke="${dark ? '#fff' : '#000'}" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/>`;
// Lines a pixel wide, with a white edge either side.
const lined = (d, w = 1.25) =>
  `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="#fff" stroke-width="${w + 2}"/><path d="${d}" stroke="#000" stroke-width="${w}"/></g>`;
// One of the app's icons (src: icons.js), fitted into a box and inked.
function iconInk(name, x, y, size, rotate = 0) {
  const svg = window.SC_ICONS?.[name] || '';
  const [, , vw, vh] = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 512 512')
    .split(' ')
    .map(Number);
  const s = size / Math.max(vw, vh);
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  const c = size / 2;
  return `<g transform="translate(${x} ${y})${rotate ? ` rotate(${rotate} ${c} ${c})` : ''} scale(${s})">${paths
    .map(
      (d) =>
        `<path d="${d}" fill="#000" stroke="#fff" stroke-width="${2 / s}" stroke-linejoin="round" paint-order="stroke"/>`,
    )
    .join('')}</g>`;
}

// The badges, at the lower right.
const BADGE = {
  add: lined('M19 15.5v7M15.5 19h7'),
  sub: lined('M15.5 19h7'),
  new: lined('M19 15v8M15.5 17l7 4M15.5 21l7-4', 1),
  close: `<circle cx="19" cy="19" r="3" fill="none" stroke="#fff" stroke-width="3.25"/><circle cx="19" cy="19" r="3" fill="none" stroke="#000" stroke-width="1.25"/>`,
  move: lined(
    'M19 14.5v9M14.5 19h9M17.5 16l1.5-1.5 1.5 1.5M17.5 22l1.5 1.5 1.5-1.5M16 17.5 14.5 19l1.5 1.5M22 17.5l1.5 1.5-1.5 1.5',
    1,
  ),
};
const ARROW = 'M3 1.5v15.25l3.9-3.65 2.55 5.9 2.55-1.1-2.5-5.85h5.4Z';
// The marquees' thin cross, the lasso's rope (its tip the hotspot) and
// Photoshop's curved, two-headed rotate arrow.
const CROSS = 'M10 2.5v15M2.5 10h15';
const LASSO =
  'M6 15.5c-3-1.5-3.6-5-1.4-8.1C7 4 12 2.5 15.6 4.1c3 1.4 3.2 4.7.4 7-2.6 2.2-7 2.9-9.6 1.6M6.6 12.6c-.8 2-.6 3.6.4 4.6s1 2.6-.6 3.8';
const cursorFor = {};
const badged = (key, base, x, y, fallback, badges) => {
  for (const b of [null, ...badges])
    cursorFor[b ? `${key}+${b}` : key] = svgCursor(base + (b ? BADGE[b] : ''), x, y, fallback);
};
badged('move', inked(ARROW), 3, 1, 'default', ['move']);
badged('direct', inked(ARROW, false), 3, 1, 'default', ['add', 'sub']);
badged('cross', lined(CROSS, 1), 10, 10, 'crosshair', ['add', 'sub']);
badged('lasso', lined(LASSO, 1.4), 6, 21, 'crosshair', ['add', 'sub']);
badged('pen', iconInk('pen-nib', 1, 1, 14), 1, 15, 'crosshair', ['new', 'close']);
cursorFor.pencil = svgCursor(iconInk('pencil', 1, 1, 16), 1, 16, 'crosshair');
cursorFor.eyedropper = svgCursor(iconInk('eye-dropper', 1, 1, 16), 1, 16, 'crosshair');
cursorFor.text = svgCursor(
  '<rect x="2.5" y="2.5" width="15" height="19" fill="none" stroke="#fff" stroke-width="2.5"/>' +
    '<rect x="2.5" y="2.5" width="15" height="19" fill="none" stroke="#000" stroke-dasharray="2 2"/>' +
    lined('M7 6.5h6M7 17.5h6M10 6.5v11', 1),
  10,
  12,
  'text',
);
cursorFor.rotate = svgCursor(
  lined('M7 17.5A11.5 11.5 0 0 1 17.5 7', 1.4) +
    inked('M3.5 16h7L7 21.5Z') +
    inked('M16 3.5v7L21.5 7Z'),
  11,
  11,
  'grab',
);

// For the point and handle markers (style.css).
document.documentElement.style.setProperty('--cursor-direct', cursorFor.direct);

// Which modifier keys are down, for the badges.
const keysDown = { shift: false, alt: false };
// Put the current tool's pointer on the canvas (not while panning).
function syncCursor() {
  // A drag keeps the pointer it began with (the rotate arrow, say).
  if (gesture || spaceDown) return;
  const c = tools[state.tool]?.cursor;
  if (c && stage.style.cursor !== c) stage.style.cursor = c;
}
