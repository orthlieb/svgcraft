// Writes samples/: one SVG file per animation feature, made in the editor
// and saved as File → Save does (so each reopens editable, and plays in any
// browser), plus samples/index.html, a page playing them all, and
// samples/README.md listing them.
//
//   node scripts/gen-samples.mjs
//
// Entrances and exits run back and forth forever here, so they can be
// watched without reloading.
/* global window, document -- in page.evaluate, run in the editor */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'samples');

// ---- the drawings --------------------------------------------------------------
const W = 400;
const H = 300;
const BG = `<rect data-name="Background" width="${W}" height="${H}" fill="#f8fafc"/>`;
const STAR = (cx, cy, r, id = 'star', fill = '#facc15') => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon id="${id}" data-name="Star" points="${pts.join(' ')}" fill="${fill}"/>`;
};
const CARD = (fill = '#2563eb') =>
  `<rect id="it" data-name="Card" x="130" y="95" width="140" height="110" rx="16" fill="${fill}"/>`;
const DISC = (fill = '#dc2626') =>
  `<circle id="it" data-name="Disc" cx="200" cy="150" r="60" fill="${fill}"/>`;
const LABEL = (text, size = 44, fill = '#0f172a') =>
  `<text id="it" data-name="Label" x="200" y="165" font-family="Georgia, serif" font-size="${size}" font-weight="700" text-anchor="middle" fill="${fill}">${text}</text>`;
const LOOP = { rep: 0, dir: 'alternate' };

// Each sample: [file name, title, what it shows, drawing, { id: animations }].
const SAMPLES = [
  // Entrances (and back out, so they loop).
  [
    'fade-in',
    'Fade in',
    'Fades in, and out again.',
    DISC(),
    { it: [{ p: 'fadeIn', dur: 1, ...LOOP }] },
  ],
  [
    'slide-in',
    'Slide in',
    'Slides in from the left.',
    CARD(),
    { it: [{ p: 'slideIn', dur: 1, from: 'left', dist: 120, ...LOOP }] },
  ],
  [
    'pop-in',
    'Pop in',
    'Pops in with a little overshoot.',
    STAR(200, 150, 80, 'it'),
    { it: [{ p: 'popIn', dur: 0.8, ...LOOP }] },
  ],
  [
    'zoom-in',
    'Zoom in',
    'Grows in from small.',
    DISC('#16a34a'),
    { it: [{ p: 'zoomIn', dur: 1, ...LOOP }] },
  ],
  [
    'wipe-in',
    'Wipe in',
    'Uncovered from the left.',
    CARD('#7c3aed'),
    { it: [{ p: 'wipeIn', dur: 1.2, from: 'left', ...LOOP }] },
  ],
  [
    'iris-in',
    'Iris in',
    'Uncovered from the middle out.',
    STAR(200, 150, 90, 'it', '#f97316'),
    { it: [{ p: 'irisIn', dur: 1.2, ...LOOP }] },
  ],
  [
    'blur-in',
    'Blur in',
    'Comes into focus.',
    LABEL('Focus'),
    { it: [{ p: 'blurIn', dur: 1.2, size: 14, ...LOOP }] },
  ],
  // Exits.
  [
    'fade-out',
    'Fade out',
    'Fades away, and back.',
    DISC('#0891b2'),
    { it: [{ p: 'fadeOut', dur: 1, ...LOOP }] },
  ],
  [
    'slide-out',
    'Slide out',
    'Slides off to the right.',
    CARD('#db2777'),
    { it: [{ p: 'slideOut', dur: 1, from: 'right', dist: 120, ...LOOP }] },
  ],
  [
    'zoom-out',
    'Zoom out',
    'Shrinks away.',
    DISC('#65a30d'),
    { it: [{ p: 'zoomOut', dur: 1, ...LOOP }] },
  ],
  // Loops.
  [
    'spin',
    'Spin',
    'Turns round, forever.',
    STAR(200, 150, 90, 'it'),
    { it: [{ p: 'spin', dur: 3, rep: 0, ease: 'linear', turns: 1 }] },
  ],
  [
    'pulse',
    'Pulse',
    'Grows and shrinks.',
    DISC('#e11d48'),
    { it: [{ p: 'pulse', dur: 1, rep: 0, scale: 120 }] },
  ],
  [
    'bounce',
    'Bounce',
    'Bounces up and down.',
    DISC('#f59e0b'),
    { it: [{ p: 'bounce', dur: 1, rep: 0, dist: 40 }] },
  ],
  [
    'shake',
    'Shake',
    'Shakes side to side.',
    CARD('#475569'),
    { it: [{ p: 'shake', dur: 0.5, rep: 0, dist: 8 }] },
  ],
  [
    'float',
    'Float',
    'Drifts gently up and down.',
    CARD('#0ea5e9'),
    { it: [{ p: 'float', dur: 2, rep: 0, dist: 12 }] },
  ],
  ['blink', 'Blink', 'On, off, on.', DISC('#a855f7'), { it: [{ p: 'blink', dur: 1, rep: 0 }] }],
  [
    'swing',
    'Swing',
    'Swings from its top, like a hanging sign.',
    CARD('#b45309'),
    { it: [{ p: 'swing', dur: 1.4, rep: 0, angle: 15, pivot: 'top' }] },
  ],
  [
    'heartbeat',
    'Heartbeat',
    'A double beat, then a rest.',
    '<path id="it" data-name="Heart" d="M200 245C120 190 95 150 95 120C95 90 120 70 148 70C170 70 190 85 200 105C210 85 230 70 252 70C280 70 305 90 305 120C305 150 280 190 200 245Z" fill="#e11d48"/>',
    { it: [{ p: 'heartbeat', dur: 1.3, rep: 0, scale: 115 }] },
  ],
  [
    'jello',
    'Jello',
    'A wobble that settles, every so often.',
    CARD('#22c55e'),
    { it: [{ p: 'jello', dur: 1, rep: 0, angle: 12 }] },
  ],
  [
    'flip',
    'Flip',
    'Turned over like a card, and back.',
    CARD('#6366f1'),
    { it: [{ p: 'flip', dur: 1.6, rep: 0, axis: 'vertical' }] },
  ],
  [
    'glow-pulse',
    'Glow pulse',
    'A glow round it that comes and goes.',
    STAR(200, 150, 80, 'it', '#fde047'),
    { it: [{ p: 'glowPulse', dur: 1, rep: 0, dir: 'alternate', size: 10, to: '#f97316' }] },
  ],
  [
    'shine',
    'Shine',
    'A highlight sweeps across it.',
    '<rect id="it" data-name="Button" x="100" y="110" width="200" height="80" rx="40" fill="#2563eb"/><text data-name="Text" x="200" y="160" font-family="Georgia, serif" font-size="30" font-weight="700" text-anchor="middle" fill="#ffffff">Buy now</text>',
    { it: [{ p: 'shine', dur: 1.8, rep: 0 }] },
  ],
  [
    'flipbook',
    'Flipbook',
    'A group’s layers shown one at a time: a spinner.',
    `<circle data-name="Track" cx="200" cy="150" r="60" fill="none" stroke="#cbd5e1" stroke-width="2"/><g id="it" data-name="Spinner">${Array.from(
      { length: 8 },
      (_, i) => {
        const a = (i * Math.PI) / 4;
        return `<circle data-name="Frame ${i + 1}" cx="${(200 + 60 * Math.cos(a)).toFixed(1)}" cy="${(150 + 60 * Math.sin(a)).toFixed(1)}" r="16" fill="#0f172a"/>`;
      },
    ).join('')}</g>`,
    { it: [{ p: 'flipbook', dur: 0.8, rep: 0 }] },
  ],
  // Lines and colour.
  [
    'draw-on',
    'Draw on',
    'The line draws itself, and undraws.',
    '<path id="it" data-name="Squiggle" d="M60 200C110 60 160 260 210 140S320 60 340 160" fill="none" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/>',
    { it: [{ p: 'drawOn', dur: 1.6, ...LOOP }] },
  ],
  [
    'draw-off',
    'Draw off',
    'The line takes itself away.',
    '<path id="it" data-name="Loop" d="M200 70C300 70 300 230 200 230S100 70 200 70Z" fill="none" stroke="#2563eb" stroke-width="8"/>',
    { it: [{ p: 'drawOff', dur: 1.6, ...LOOP }] },
  ],
  [
    'dash-march',
    'Dash march',
    'Marching ants round a box.',
    '<rect id="it" data-name="Box" x="90" y="80" width="220" height="140" rx="10" fill="none" stroke="#0f172a" stroke-width="4" stroke-dasharray="12 8"/>',
    { it: [{ p: 'dashMarch', dur: 1, rep: 0 }] },
  ],
  [
    'stroke-pulse',
    'Stroke pulse',
    'The outline grows thicker and back.',
    '<circle id="it" data-name="Ring" cx="200" cy="150" r="70" fill="#fef3c7" stroke="#d97706" stroke-width="6"/>',
    { it: [{ p: 'strokePulse', dur: 1.2, rep: 0, scale: 250 }] },
  ],
  [
    'colour-cycle',
    'Colour cycle',
    'Its fill changes colour and back.',
    DISC('#2563eb'),
    { it: [{ p: 'colourCycle', dur: 1.5, rep: 0, dir: 'alternate', to: '#dc2626' }] },
  ],
  // Motion and shape.
  [
    'move-along-path',
    'Move along path',
    'An arrow follows the road, turning with it.',
    '<path id="road" data-name="Road" d="M40 220C120 40 220 300 360 90" fill="none" stroke="#cbd5e1" stroke-width="14" stroke-linecap="round"/><path id="it" data-name="Arrow" d="M-18 -10L18 0L-18 10L-10 0Z" transform="translate(40 220)" fill="#dc2626"/>',
    {
      it: [
        {
          p: 'followPath',
          dur: 4,
          rep: 0,
          dir: 'alternate',
          ease: 'inout',
          path: 'road',
          orient: true,
          hide: false,
        },
      ],
    },
  ],
  [
    'morph',
    'Morph',
    'A circle turns into a star, and back.',
    `<path id="it" data-name="Circle" d="M120 150A80 80 0 1 0 280 150A80 80 0 1 0 120 150Z" fill="#7c3aed"/>${STAR(200, 150, 95, 'target', '#7c3aed')}`,
    { it: [{ p: 'morph', dur: 1.2, rep: 0, dir: 'alternate', path: 'target', hide: true }] },
  ],
  // Groups and text.
  [
    'stagger',
    'Stagger',
    'One Bounce, on each dot in turn: a wave.',
    `<g id="it" data-name="Dots">${[0, 1, 2, 3, 4].map((i) => `<circle data-name="Dot ${i + 1}" cx="${100 + i * 50}" cy="170" r="16" fill="#0ea5e9"/>`).join('')}</g>`,
    { it: [{ p: 'bounce', dur: 1, rep: 0, dist: 40, stagger: 0.12 }] },
  ],
  [
    'letters',
    'Letter by letter',
    'Fade in, on each letter in turn.',
    LABEL('Hello, SVG!', 46, '#be123c'),
    { it: [{ p: 'fadeIn', dur: 0.5, rep: 0, dir: 'alternate', stagger: 0.08 }] },
  ],
  [
    'typewriter',
    'Typewriter',
    'Typed out, and taken back.',
    LABEL('Type me out…', 40),
    { it: [{ p: 'typewriter', dur: 2.5, rep: 0, dir: 'alternate' }] },
  ],
  // When they start.
  [
    'on-click',
    'On click',
    'Click the button: it beats once.',
    '<rect id="it" data-name="Button" x="110" y="110" width="180" height="80" rx="40" fill="#16a34a"/><text data-name="Text" x="200" y="160" font-family="Georgia, serif" font-size="28" font-weight="700" text-anchor="middle" fill="#ffffff" pointer-events="none">Click me</text>',
    { it: [{ p: 'heartbeat', dur: 0.8, rep: 1, scale: 115, trigger: 'click' }] },
  ],
  [
    'on-hover',
    'On hover',
    'Point at the sign: it swings while the pointer is over it.',
    '<line data-name="String" x1="200" y1="30" x2="200" y2="95" stroke="#475569" stroke-width="3"/><rect id="it" data-name="Sign" x="130" y="95" width="140" height="90" rx="10" fill="#f59e0b"/>',
    { it: [{ p: 'swing', dur: 1, rep: 0, angle: 12, pivot: 'top', trigger: 'hover' }] },
  ],
  [
    'after-layer',
    'After another layer',
    'The title fades in; then the star pops in after it.',
    `<text id="title" data-name="Title" x="200" y="250" font-family="Georgia, serif" font-size="36" font-weight="700" text-anchor="middle" fill="#0f172a">Ta-da!</text>${STAR(200, 120, 70, 'it')}`,
    {
      title: [{ p: 'fadeIn', dur: 1, rep: 1 }],
      it: [{ p: 'popIn', dur: 0.6, rep: 1, afterLayer: 'title' }],
    },
  ],
  [
    'pause-between-runs',
    'Pause between runs',
    'A Shake, then a two-second wait, over and over.',
    '<path id="it" data-name="Bell" d="M200 70C150 70 135 110 135 150V190H265V150C265 110 250 70 200 70ZM180 200A20 20 0 0 0 220 200Z" fill="#eab308"/>',
    { it: [{ p: 'shake', dur: 0.6, rep: 0, dist: 8, pause: 2 }] },
  ],
];

// ---- make them ------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForFunction(() => !!window.svgcraft);
await page.evaluate(() => window.svgcraft.ready);

const written = new Set();
for (const [file, title, , body, anims] of SAMPLES) {
  const svg = await page.evaluate(
    ([body, anims, title, W, H, bg]) => {
      const s = window.svgcraft;
      s.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><title>${title}</title>${bg}${body}</svg>`,
        title,
      );
      for (const [id, list] of Object.entries(anims)) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`${title}: no #${id}`);
        el.setAttribute('data-sc-anim', JSON.stringify(list));
      }
      s.commit();
      return s.serialize();
    },
    [body, anims, title, W, H, BG],
  );
  // An animation that can't go on its layer writes nothing: say so.
  if (!/<(animate|animateTransform|animateMotion|set)\b/.test(svg))
    throw new Error(`${file}: no animation was written`);
  fs.writeFileSync(path.join(OUT, `${file}.svg`), svg + '\n');
  written.add(`${file}.svg`);
  console.log(`wrote samples/${file}.svg`);
}
await browser.close();

// Old samples no longer made.
for (const f of fs.readdirSync(OUT))
  if (f.endsWith('.svg') && !written.has(f)) fs.rmSync(path.join(OUT, f));

// ---- the gallery and the list ------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tiles = SAMPLES.map(
  ([file, title, what]) =>
    `      <figure>
        <object data="${file}.svg" type="image/svg+xml" width="${W}" height="${H}">${esc(title)}: ${esc(what)}</object>
        <figcaption><a href="${file}.svg">${esc(title)}</a> ${esc(what)}</figcaption>
      </figure>`,
).join('\n');
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html>
<!-- Generated by scripts/gen-samples.mjs. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SVGCraft animation samples</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font: 15px/1.4 system-ui, sans-serif;
        background: #e2e8f0;
        color: #0f172a;
      }
      main {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
      }
      figure {
        margin: 0;
        padding: 10px;
        border-radius: 10px;
        background: #fff;
      }
      object {
        display: block;
        width: 100%;
        height: auto;
      }
      figcaption a {
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>SVGCraft animation samples</h1>
    <p>
      Each is an SVG file saved by SVGCraft. It plays here, and opens in SVGCraft with its
      animations ready to edit in the Animation tab. The click and hover samples respond here
      too, but not in an &lt;img&gt; tag, which never passes on clicks or the pointer.
    </p>
    <main>
${tiles}
    </main>
  </body>
</html>
`,
);
const rows = SAMPLES.map(([file, title, what]) => `| [${title}](${file}.svg) | ${what} |`).join(
  '\n',
);
fs.writeFileSync(
  path.join(OUT, 'README.md'),
  `# Animation samples

One SVG file per animation feature, made and saved by SVGCraft. Open
[index.html](index.html) in a browser to see them all play, or open any of
them in SVGCraft (File → Open…) to edit its animation in the Animation tab.

Entrances and exits run back and forth forever here, so they can be
watched without reloading.

| Sample | What it shows |
| ------ | ------------- |
${rows}

They're generated: change \`scripts/gen-samples.mjs\` and run
\`node scripts/gen-samples.mjs\` rather than editing them.
`,
);
// In the repository's own format, so prettier --check stays clean.
execFileSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules/prettier/bin/prettier.cjs'),
    '--write',
    'samples/index.html',
    'samples/README.md',
  ],
  { cwd: ROOT, stdio: 'ignore' },
);
console.log('wrote samples/index.html and samples/README.md');
