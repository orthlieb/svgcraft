// Animations in opened files: SMIL that does what a preset does becomes
// that preset (editable in the Animation tab, playable with ▶ Play); the
// rest is reported instead of vanishing.
import { test, expect } from './fixtures.js';

const open = (page, svg, name = 'anim.svg') =>
  page.evaluate(([t, n]) => window.svgcraft.openSvg(t, n), [svg, name]);
const anims = (page, sel) =>
  page.evaluate(
    (sel) => JSON.parse(document.querySelector(`#sc-doc ${sel}`).dataset.scAnim || '[]'),
    sel,
  );
const alertText = (page) => page.locator('#sc-alert-text');
const playOn = (page) =>
  page.evaluate(() => !document.querySelector('[data-action="toggleAnimations"]').disabled);

const ARROW =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1000" height="1000">' +
  '<g transform="translate(300,300)">' +
  '<path d="m-100,-50,200,50,-200,50,50,-50 z" fill="lightblue" stroke="#999" stroke-width="10">' +
  '<animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" begin="0s" dur="5s" repeatCount="indefinite"/>' +
  '</path></g></svg>';

test('a spin about the shape’s centre becomes Spin, plays, and saves', async ({ page }) => {
  await open(page, ARROW);
  expect(await anims(page, 'path')).toEqual([
    { p: 'spin', dur: 5, delay: 0, rep: 0, dir: 'normal', ease: 'linear', turns: 1 },
  ]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Kept the file’s 1 animation: edit it in the Animation tab.',
  );
  expect(await playOn(page)).toBe(true);
  const out = await page.evaluate(() => window.svgcraft.serialize());
  expect(out).toMatch(/<animateTransform [^>]*type="rotate"[^>]*values="0 0 0;360 0 0"/);
  expect(out).toMatch(/dur="5s"/);
});

test('a rotation about another point becomes Spin with its pivot there', async ({ page }) => {
  await open(
    page,
    ARROW.replace('to="360"', 'to="360 200 0"').replace('from="0"', 'from="0 200 0"'),
  );
  // (200, 0) is half the arrow's width past its right edge, halfway down.
  expect(await anims(page, 'path')).toEqual([
    {
      p: 'spin',
      dur: 5,
      delay: 0,
      rep: 0,
      dir: 'normal',
      ease: 'linear',
      turns: 1,
      origin: [1.5, 0.5],
    },
  ]);
  await expect(alertText(page)).toHaveText('');
  const out = await page.evaluate(() => window.svgcraft.serialize());
  expect(out).toMatch(/values="0 200 0;360 200 0"/);
});

test('fades, colour, reverse, alternate, eases, delays and repeats', async ({ page }) => {
  await open(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<rect id="a" x="10" y="10" width="50" height="50" fill="red">' +
      '<animate attributeName="opacity" from="0" to="1" dur="0.8s" begin="1s" fill="freeze"/></rect>' +
      '<rect id="b" x="100" y="10" width="50" height="50" fill="#00f">' +
      '<animate attributeName="fill" values="#0000ff;#ff0000;#0000ff" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></rect>' +
      '<rect id="c" x="200" y="10" width="50" height="50">' +
      '<animateTransform attributeName="transform" type="rotate" values="0 225 35;-720 225 35" dur="2s" repeatCount="3" calcMode="spline" keySplines="0.42 0 0.58 1"/></rect>' +
      '<rect id="d" x="300" y="10" width="50" height="50">' +
      '<animate attributeName="opacity" values="1;0" dur="500ms" begin="0:00:02"/></rect>' +
      '</svg>',
  );
  // Shown until it starts, as in the file: a Fade in would start hidden.
  expect(await anims(page, '#a')).toEqual([
    { p: 'fadeOut', dur: 0.8, delay: 1, rep: 1, dir: 'reverse', ease: 'linear' },
  ]);
  expect(await anims(page, '#b')).toEqual([
    {
      p: 'colourCycle',
      dur: 2,
      delay: 0,
      rep: 0,
      dir: 'alternate',
      ease: 'linear',
      to: '#ff0000',
    },
  ]);
  expect(await anims(page, '#c')).toEqual([
    { p: 'spin', dur: 2, delay: 0, rep: 3, dir: 'normal', ease: 'inout', turns: -2 },
  ]);
  expect(await anims(page, '#d')).toEqual([
    { p: 'fadeOut', dur: 0.5, delay: 2, rep: 1, dir: 'normal', ease: 'linear' },
  ]);
  await expect(alertText(page)).toHaveText('');
});

test('event starts, a motion at a fixed angle and CSS keyframes are reported', async ({ page }) => {
  await open(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<style>@keyframes s { to { transform: rotate(1turn) } } #k { animation: s 2s infinite }</style>' +
      '<rect id="k" width="10" height="10"/>' +
      '<rect id="a" x="10" y="10" width="50" height="50">' +
      '<animate attributeName="opacity" from="0" to="1" dur="1s" begin="click"/>' +
      '<animateMotion path="M0 0H100" dur="2s" rotate="45"/>' +
      '<animate attributeName="opacity" from="0" to="1" dur="1s"/></rect>' +
      '</svg>',
  );
  expect((await anims(page, '#a')).map((a) => a.p)).toEqual(['fadeIn']);
  await expect(alertText(page)).toHaveText(
    '3 animations in this file can’t be edited in SVGCraft, so they were left out. The other one is in the Animation tab.',
  );
});

test('a target named by href, and SMIL on a symbol’s inside', async ({ page }) => {
  await open(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300">' +
      '<defs><symbol id="s"><rect width="10" height="10"><animate attributeName="opacity" from="1" to="0" dur="1s"/></rect></symbol></defs>' +
      '<use href="#s"/>' +
      '<rect id="a" x="10" y="10" width="50" height="50"/>' +
      '<animate xlink:href="#a" attributeName="opacity" from="0" to="1" dur="1s"/>' +
      '</svg>',
  );
  expect((await anims(page, '#a')).map((a) => a.p)).toEqual(['fadeIn']);
  await expect(alertText(page)).toContainText('1 animation in this file');
});

test('a transform that replaces the shape’s own one can’t be kept', async ({ page }) => {
  await open(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<rect id="a" x="-25" y="-25" width="50" height="50" transform="translate(100 100)">' +
      '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/></rect>' +
      '<rect id="b" x="-25" y="-25" width="50" height="50" transform="translate(200 100)">' +
      '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" additive="sum"/></rect>' +
      '</svg>',
  );
  expect(await anims(page, '#a')).toEqual([]);
  expect((await anims(page, '#b')).map((a) => a.p)).toEqual(['spin']);
  await expect(alertText(page)).toContainText('1 animation in this file');
});

test('SVGCraft’s own file keeps its settings and doesn’t double up', async ({ page }) => {
  await open(page, ARROW);
  const text = await page.evaluate(() => window.svgcraft.serialize());
  await open(page, text);
  expect((await anims(page, 'path')).map((a) => a.p)).toEqual(['spin']);
  await expect(alertText(page)).toHaveText('');
});

// Every preset, in each direction, through Export Clean SVG (which drops
// SVGCraft's settings, leaving only the SMIL) and back: it comes back as
// one animation that writes the same SMIL (the same preset, unless it's
// another one run the other way round, as a reversed Fade in is a Fade out).
const PRESETS = {
  fadeIn: {},
  fadeOut: {},
  slideIn: { from: 'top', dist: 30 },
  slideOut: { from: 'right', dist: 50 },
  popIn: {},
  zoomIn: {},
  zoomOut: {},
  spin: { turns: 2 },
  pulse: { scale: 130 },
  bounce: { dist: 20 },
  shake: { dist: 8 },
  float: { dist: 10 },
  blink: {},
  drawOn: {},
  drawOff: {},
  dashMarch: {},
  colourCycle: { to: '#16a34a' },
  swing: { angle: 20, pivot: 'bottom' },
  heartbeat: { scale: 125 },
  jello: { angle: 10 },
  flip: { axis: 'horizontal' },
  strokePulse: { scale: 300 },
  dropIn: { dist: 90 },
  backIn: { from: 'right', dist: 60 },
  rollIn: { dist: 100 },
  flipIn: { axis: 'horizontal' },
  hinge: { dist: 250 },
  rubberBand: {},
  tada: {},
  headShake: { dist: 8 },
  wobble: {},
  breathe: {},
};
const BASE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
  '<g transform="translate(40 30) scale(2)">' +
  '<path id="a" d="M10 10H120V80H10Z" fill="#2563eb" stroke="#000000" stroke-width="3" opacity="0.8"/></g></svg>';
for (const [p, opts] of Object.entries(PRESETS))
  test(`${p} comes back from Export Clean SVG`, async ({ page }) => {
    const list = ['normal', 'reverse', 'alternate'].map((dir, i) => ({
      p,
      dur: 1.5,
      delay: i * 2,
      rep: i === 1 ? 0 : 2,
      dir,
      ease: ['linear', 'out', 'inout'][i],
      ...opts,
    }));
    const back = await page.evaluate(
      ([list, base]) => {
        const s = window.svgcraft;
        /* eslint-disable no-undef -- the editor's own globals */
        const clean = () => cleanSvgText(s.serialize(), { ...CLEAN_DEFAULTS });
        return list.map((a) => {
          s.openSvg(base, 'p.svg');
          document.getElementById('a').setAttribute('data-sc-anim', JSON.stringify([a]));
          s.commit();
          const first = clean();
          s.openSvg(first, 'clean.svg');
          const got = JSON.parse(document.querySelector('#sc-doc path').dataset.scAnim || '[]');
          const alert = document.getElementById('sc-alert-text').textContent;
          return { got, same: clean() === first, alert };
          /* eslint-enable no-undef */
        });
      },
      [list, BASE],
    );
    back.forEach(({ got, same, alert }, i) => {
      const want = list[i];
      expect(alert, want.dir).toBe('');
      expect(got, want.dir).toHaveLength(1);
      expect(same, `${want.dir}: the same SMIL again`).toBe(true);
      if (want.dir === 'normal') {
        expect(got[0].p).toBe(p);
        for (const k of ['dur', 'delay', 'rep', 'ease', ...Object.keys(opts)])
          if (typeof want[k] === 'number') expect(got[0][k], k).toBeCloseTo(want[k], 1);
          else expect(got[0][k], k).toBe(want[k]);
      }
    });
  });

test('importing a file into a drawing keeps its animations too', async ({ page }) => {
  await open(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"/>');
  await page.evaluate((t) => window.svgcraft.placeSvg(t, 'arrow.svg'), ARROW);
  expect((await anims(page, 'path')).map((a) => [a.p, a.dur])).toEqual([['spin', 5]]);
  expect(await playOn(page)).toBe(true);
});

test('rings of circles turning both ways about their shared centre', async ({ page }) => {
  const ring = (r, d, dur, fill) =>
    `<g fill="${fill}" fill-opacity="0.3">` +
    [0, 90, 180, 270]
      .map((a) => {
        const t = (a * Math.PI) / 180;
        return `<circle cx="${400 + d * Math.cos(t)}" cy="${400 + d * Math.sin(t)}" r="${r}"/>`;
      })
      .join('') +
    `<animateTransform attributeName="transform" type="rotate" ${dur > 0 ? 'from="0 400 400" to="360 400 400"' : 'from="360 400 400" to="0 400 400"'} dur="${Math.abs(dur)}s" repeatCount="indefinite"/></g>`;
  await open(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">' +
      ring(90, 180, 24, 'rgb(84,241,127)') +
      ring(82, 165, -22, 'rgb(22,161,8)') +
      '</svg>',
  );
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc > g')].map((g) => JSON.parse(g.dataset.scAnim)[0]),
    ),
  ).toEqual([
    { p: 'spin', dur: 24, delay: 0, rep: 0, dir: 'normal', ease: 'linear', turns: 1 },
    { p: 'spin', dur: 22, delay: 0, rep: 0, dir: 'reverse', ease: 'linear', turns: 1 },
  ]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Kept the file’s 2 animations: edit them in the Animation tab.',
  );
});

// A loading spinner (from a file that came in with nothing kept): two rings
// turning about their centre, and bars bobbing about their place, each a
// little after the one before.
const LOADER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<circle id="c1" fill="none" stroke="#000" stroke-width="6" stroke-dasharray="14.2472,14.2472" cx="50" cy="50" r="47">' +
  '<animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="5s" from="0 50 50" to="360 50 50" repeatCount="indefinite"/></circle>' +
  '<g fill="#000">' +
  [1, 2, 3]
    .map(
      (i) =>
        `<rect id="b${i}" x="${20 + 10 * i}" y="35" width="5" height="30">` +
        `<animateTransform attributeName="transform" dur="1s" type="translate" values="0 5 ; 0 -5; 0 5" repeatCount="indefinite" begin="0.${i}"/></rect>`,
    )
    .join('') +
  '</g></svg>';

test('opened from the blank workspace, a spinner’s rings and bobbing bars are all kept', async ({
  page,
}) => {
  // No drawing open: the canvas is hidden until one is.
  await page.click('.sc-doctab[aria-selected="true"] .sc-doctab-x');
  await page.evaluate(
    // eslint-disable-next-line no-undef -- the editor's own global
    (t) => importFile(new File([t], 'loader.svg', { type: 'image/svg+xml' }), 'open'),
    LOADER,
  );
  await expect(page.locator('#sc-msg')).toHaveText('Opened loader.svg');
  expect(await anims(page, '#c1')).toEqual([
    { p: 'spin', dur: 5, delay: 0, rep: 0, dir: 'normal', ease: 'linear', turns: 1 },
  ]);
  // Each bar: Float, 10 up and back, its resting place moved down 5.
  expect(await anims(page, '#b2')).toEqual([
    { p: 'float', dur: 0.5, delay: 0.2, rep: 0, dir: 'alternate', ease: 'linear', dist: 10 },
  ]);
  expect(await page.locator('#sc-doc #b2').getAttribute('transform')).toBe('matrix(1 0 0 1 0 5)');
  await expect(alertText(page)).toHaveText('');
  // Saved, it moves as the original did.
  const out = await page.evaluate(() => window.svgcraft.serialize());
  const where = async (svg, t) => {
    const p2 = await page.context().newPage();
    await p2.setContent(
      `<body style="margin:0">${svg.replace('<svg ', '<svg width="100" height="100" ')}</body>`,
    );
    const r = await p2.evaluate((t) => {
      const s = document.querySelector('svg');
      s.pauseAnimations();
      s.setCurrentTime(t);
      const at = (id) => document.getElementById(id).getBoundingClientRect();
      const c = document.getElementById('c1').getCTM();
      return [
        Math.round(at('b1').y * 10) / 10,
        Math.round(at('b3').y * 10) / 10,
        Math.round((Math.atan2(c.b, c.a) * 180) / Math.PI),
      ];
    }, t);
    await p2.close();
    return r;
  };
  for (const t of [0.75, 1.35, 2.2])
    expect(await where(out, t), `at ${t}s`).toEqual(await where(LOADER, t));
});
