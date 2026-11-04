// Live demos for the README's animation topics: drawings built here with
// their animations set, saved as Export Clean SVG writes them
// (docs/help/<id>.svg), and shown playing in the help (see
// scripts/gen-help-screens.mjs and scripts/gen-help.mjs).

const BG = '#123d63';
const INK = '#f3e0de';
const SHAPE = '#8fd3ff';
const DIM = '#5f8fb4';

const anim = (list) => `data-sc-anim='${JSON.stringify(list)}'`;
const label = (x, y, text, size = 13) =>
  `<text x="${x}" y="${y}" fill="${INK}" font-family="system-ui, sans-serif" font-size="${size}" text-anchor="middle">${text}</text>`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect data-name="Backdrop" width="${w}" height="${h}" rx="12" fill="${BG}"/>${body}</svg>`;
// Open a drawing and save it as the topic's live demo.
const demo = (w, h, body) => async (h2) => {
  await h2.open(svg(w, h, body), 'demo.svg');
  await h2.live();
};

// The gallery: every preset but the two with topics of their own, in
// cells of 140 × 120, under their group's name. Entrances and exits run
// again after a pause so they can be watched.
const GROUPS = [
  [
    'Entrances',
    'fadeIn slideIn popIn zoomIn dropIn backIn rollIn flipIn wipeIn irisIn blurIn typewriter',
  ],
  ['Exits', 'fadeOut slideOut zoomOut hinge'],
  [
    'Loops',
    'spin pulse bounce shake float blink swing heartbeat jello flip glowPulse shine ' +
      'rubberBand tada headShake wobble breathe ripple flipbook',
  ],
  ['Line effects', 'drawOn drawOff dashMarch strokePulse'],
  ['Colour', 'colourCycle gradientFlow patternScroll'],
];
const NAMES = {
  fadeIn: 'Fade in',
  slideIn: 'Slide in',
  popIn: 'Pop in',
  zoomIn: 'Zoom in',
  dropIn: 'Drop in',
  backIn: 'Back in',
  rollIn: 'Roll in',
  flipIn: 'Flip in',
  wipeIn: 'Wipe in',
  irisIn: 'Iris in',
  blurIn: 'Blur in',
  typewriter: 'Typewriter',
  fadeOut: 'Fade out',
  slideOut: 'Slide out',
  zoomOut: 'Zoom out',
  hinge: 'Hinge',
  spin: 'Spin',
  pulse: 'Pulse',
  bounce: 'Bounce',
  shake: 'Shake',
  float: 'Float',
  blink: 'Blink',
  swing: 'Swing',
  heartbeat: 'Heartbeat',
  jello: 'Jello',
  flip: 'Flip',
  glowPulse: 'Glow pulse',
  shine: 'Shine',
  rubberBand: 'Rubber band',
  tada: 'Tada',
  headShake: 'Head shake',
  wobble: 'Wobble',
  breathe: 'Breathe',
  ripple: 'Ripple',
  flipbook: 'Flipbook',
  drawOn: 'Draw on',
  drawOff: 'Draw off',
  dashMarch: 'Dash march',
  strokePulse: 'Stroke pulse',
  colourCycle: 'Colour cycle',
  gradientFlow: 'Gradient flow',
  patternScroll: 'Pattern scroll',
};
// Settings that differ from the preset's own, to fit a cell and keep going.
const again = { rep: 0, pause: 1.2 };
const TUNE = {
  dropIn: { dist: 50 },
  backIn: { dist: 40 },
  rollIn: { dist: 50 },
  hinge: { dist: 40 },
  shake: { rep: 0, pause: 0.8 },
  jello: { rep: 0, pause: 0.6 },
  flip: { rep: 0, pause: 0.4 },
  typewriter: { rep: 0, pause: 1.5 },
  drawOn: { rep: 0, pause: 1 },
  drawOff: { rep: 0, pause: 1 },
};

function cell(p, x, y) {
  const cx = x + 70;
  const cy = y + 46;
  const a = { p, ...(/In$|Out$|^hinge$/.test(p) ? again : {}), ...TUNE[p] };
  const name = NAMES[p];
  const tag = `data-name="${name}" ${anim([a])}`;
  let shape;
  if (p === 'typewriter')
    shape = `<text ${tag} x="${cx}" y="${cy + 8}" fill="${SHAPE}" font-family="system-ui, sans-serif" font-size="24" font-weight="700" text-anchor="middle">Hello!</text>`;
  else if (p === 'flipbook') {
    // A loading spinner: eight frames, an arc turned a step further in each.
    const arc = `M${cx} ${cy - 24}a24 24 0 0 1 24 24`;
    const frames = Array.from(
      { length: 8 },
      (_, i) =>
        `<path data-name="Frame ${i + 1}" d="${arc}" transform="rotate(${i * 45} ${cx} ${cy})" fill="none" stroke="${SHAPE}" stroke-width="7" stroke-linecap="round"/>`,
    ).join('');
    shape =
      `<circle data-name="Track" cx="${cx}" cy="${cy}" r="24" fill="none" stroke="${DIM}" stroke-width="7"/>` +
      `<g ${tag}>${frames}</g>`;
  } else if (/^(drawOn|drawOff|dashMarch|strokePulse)$/.test(p))
    shape = `<path ${tag} d="M${cx - 40} ${cy + 10}c14 -36 26 -36 40 -10s26 26 40 -10" fill="none" stroke="${SHAPE}" stroke-width="5" stroke-linecap="round"${p === 'dashMarch' ? ' stroke-dasharray="10 8"' : ''}/>`;
  else
    shape = `<rect ${tag} x="${cx - 26}" y="${cy - 26}" width="52" height="52" rx="10" fill="${SHAPE}"/>`;
  return shape + label(cx, y + 104, name);
}

function gallery() {
  const W = 840;
  let y = 8;
  let body = '';
  for (const [title, keys] of GROUPS) {
    body += `<text x="20" y="${y + 26}" fill="${INK}" font-family="system-ui, sans-serif" font-size="15" font-weight="700">${title}</text>`;
    y += 36;
    keys.split(' ').forEach((p, i) => {
      body += cell(p, (i % 6) * 140, y + Math.floor(i / 6) * 120);
    });
    y += Math.ceil(keys.split(' ').length / 6) * 120;
  }
  return [W, y + 8, body];
}

export default [
  {
    id: 'animate-presets',
    shoot: (h) => demo(...gallery())(h),
  },
  {
    id: 'when-an-animation-starts-live',
    shoot: demo(
      840,
      200,
      // On click: the star spins once when the button is clicked.
      `<path data-name="Star" ${anim([{ p: 'spin', dur: 1, rep: 1, ease: 'inout', trigger: 'click', on: 'go' }])} d="M105 28l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3z" fill="${SHAPE}"/>` +
        `<g id="go" data-name="Button"><rect x="60" y="104" width="90" height="34" rx="17" fill="${INK}"/>` +
        `<text x="105" y="126" fill="${BG}" font-family="system-ui, sans-serif" font-size="14" font-weight="700" text-anchor="middle">Click me</text></g>` +
        label(105, 176, 'On click') +
        // On hover: it spins while the pointer is over it.
        `<rect id="spinner" data-name="Hover" ${anim([{ p: 'spin', dur: 1.5, rep: 0, trigger: 'hover' }])} x="281" y="40" width="68" height="68" rx="12" fill="${SHAPE}"/>` +
        label(315, 176, 'On hover (point at it)') +
        // After another object: the second pops in once the first has faded in.
        `<rect id="first" data-name="First" ${anim([{ p: 'fadeIn', dur: 1, rep: 0, pause: 2 }])} x="470" y="48" width="52" height="52" rx="10" fill="${SHAPE}"/>` +
        `<rect data-name="Second" ${anim([{ p: 'popIn', dur: 0.5, rep: 0, pause: 2.5, afterLayer: 'first' }])} x="540" y="48" width="52" height="52" rx="10" fill="${INK}"/>` +
        label(525, 176, 'After another object') +
        // A pause between runs.
        `<circle data-name="Ball" ${anim([{ p: 'bounce', dur: 0.8, rep: 0, dist: 24, pause: 1 }])} cx="735" cy="80" r="26" fill="${SHAPE}"/>` +
        label(735, 176, 'Pause between runs'),
    ),
  },
  {
    id: 'pivot-live',
    shoot: demo(
      840,
      220,
      // A sign swinging from its hook (pivot at the top).
      `<path data-name="Hook" d="M140 20v22" stroke="${INK}" stroke-width="3"/>` +
        `<rect data-name="Sign" ${anim([{ p: 'swing', dur: 1.6, rep: 0, angle: 18, pivot: 'top' }])} x="90" y="42" width="100" height="70" rx="8" fill="${SHAPE}"/>` +
        label(140, 196, 'Swing from the top') +
        // A clock hand turning about its end.
        `<circle data-name="Clock face" cx="420" cy="90" r="64" fill="none" stroke="${DIM}" stroke-width="4"/>` +
        `<rect data-name="Hand" ${anim([{ p: 'spin', dur: 4, rep: 0, origin: [0, 0.5] }])} x="420" y="86" width="56" height="8" rx="4" fill="${SHAPE}"/>` +
        `<circle data-name="Hub" cx="420" cy="90" r="7" fill="${INK}"/>` +
        label(420, 196, 'Spin about its end') +
        // A badge growing out of its bottom-left corner.
        `<rect data-name="Badge" ${anim([{ p: 'popIn', dur: 0.6, rep: 0, pause: 1.4, origin: [0, 1] }])} x="650" y="40" width="100" height="90" rx="14" fill="${SHAPE}"/>` +
        `<circle data-name="Corner" cx="650" cy="130" r="5" fill="${INK}"/>` +
        label(700, 196, 'Pop in from a corner'),
    ),
  },
  {
    id: 'stagger-live',
    shoot: demo(
      840,
      200,
      `<g data-name="Dots" ${anim([{ p: 'popIn', dur: 0.4, rep: 0, pause: 1.6, stagger: 0.15 }])}>` +
        Array.from(
          { length: 6 },
          (_, i) => `<circle cx="${50 + i * 56}" cy="80" r="22" fill="${i % 2 ? INK : SHAPE}"/>`,
        ).join('') +
        `</g>` +
        label(190, 176, 'A group’s objects, 0.15 s apart') +
        `<text data-name="Letters" ${anim([{ p: 'fadeIn', dur: 0.4, rep: 0, pause: 1.6, stagger: 0.1 }])} x="620" y="96" fill="${SHAPE}" font-family="system-ui, sans-serif" font-size="44" font-weight="700" text-anchor="middle">Hello there</text>` +
        label(620, 176, 'A text’s letters, 0.1 s apart'),
    ),
  },
  {
    id: 'move-along-path-live',
    shoot: demo(
      840,
      260,
      // An arrow along a wave, facing the way it goes; the route stays shown.
      `<path data-name="Arrow" ${anim([{ p: 'followPath', dur: 4, rep: 0, ease: 'inout', path: 'wave', orient: true, hide: false }])} d="M30 100h28v-10l20 18-20 18v-10h-28z" fill="${SHAPE}"/>` +
        `<path id="wave" data-name="Wave" d="M40 130c80 -100 160 -100 240 0s160 100 240 0" fill="none" stroke="${DIM}" stroke-width="3" stroke-dasharray="8 7"/>` +
        label(280, 246, 'Orient to path, along an open route') +
        // A ball round a circle, for good.
        `<circle data-name="Ball" ${anim([{ p: 'followPath', dur: 3, rep: 0, ease: 'linear', path: 'loop', hide: false }])} cx="700" cy="40" r="14" fill="${INK}"/>` +
        `<path id="loop" data-name="Loop" d="M700 40a70 70 0 1 1 0 140a70 70 0 1 1 0 -140z" fill="none" stroke="${DIM}" stroke-width="3" stroke-dasharray="8 7"/>` +
        label(700, 246, 'A closed route, Forever'),
    ),
  },
  {
    id: 'morph-live',
    shoot: demo(
      840,
      220,
      // A circle into a star and back, for good.
      `<path data-name="Blob" ${anim([{ p: 'morph', dur: 1.2, rep: 0, dir: 'alternate', ease: 'inout', path: 'star', hide: true }])} d="M210 26a64 64 0 1 1 0 128a64 64 0 1 1 0 -128z" fill="${SHAPE}"/>` +
        `<path id="star" data-name="Star" d="M210 22l19 41 45 5-33 31 9 45-40-23-40 23 9-45-33-31 45-5z" fill="${SHAPE}"/>` +
        label(210, 196, 'A circle into a star, back and forth') +
        // A play button into a pause button.
        `<path data-name="Play" ${anim([{ p: 'morph', dur: 0.5, rep: 0, dir: 'alternate', ease: 'inout', pause: 1, path: 'pause', hide: true }])} d="M590 34l100 56-100 56z" fill="${INK}"/>` +
        `<path id="pause" data-name="Pause" d="M590 34h34v112h-34zM656 34h34v112h-34z" fill="${INK}"/>` +
        label(630, 196, 'Play into Pause'),
    ),
  },
];
