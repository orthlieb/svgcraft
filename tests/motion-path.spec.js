// Animation → Move along path: a layer's centre travels along another
// layer's outline, written as <animateMotion>. Where it really is at a
// given moment is measured in the saved file, played in a page of its own.
import { test, expect, load, select as pickIds } from './fixtures.js';

// Select layers and refresh the panels, as a click would.
const select = async (page, ...ids) => {
  await pickIds(page, ...ids);
  await page.evaluate(() => window.svgcraft.commit());
};

// A red disc, a blue box in a scaled, rotated group, and a curve to follow
// (in a moved group of its own).
const SCENE =
  '<circle id="c" cx="60" cy="60" r="12" fill="#dc2626"/>' +
  '<g id="g" transform="translate(300 40) rotate(20) scale(1.5)">' +
  '<rect id="b" x="10" y="10" width="30" height="20" fill="#2563eb"/></g>' +
  '<g transform="translate(20 30)"><path id="p" data-name="Route" d="M80 200C180 60 320 340 460 200" fill="none" stroke="#999999"/></g>';

const anims = (page, id) =>
  page.evaluate((id) => JSON.parse(document.getElementById(id).dataset.scAnim || '[]'), id);
const add = (page, preset) => page.selectOption('#sc-anim-add', preset);

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 600, 400);
  await page.click('[data-tab="animation"]');
});

// Play the saved file (in a page of its own) at `t` seconds: the centre of
// each id on the page, in drawing units, and its angle in degrees.
async function at(page, svg, t, ids) {
  const p2 = await page.context().newPage();
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  const out = await p2.evaluate(
    ([t, ids]) => {
      const s = document.querySelector('svg');
      s.pauseAnimations();
      s.setCurrentTime(t);
      const k = s.getBoundingClientRect().width / s.viewBox.baseVal.width;
      return ids.map((id) => {
        const el = document.getElementById(id);
        const b = el.getBBox();
        const m = el.getScreenCTM();
        const c = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(m);
        return { x: c.x / k, y: c.y / k, deg: (Math.atan2(m.b, m.a) * 180) / Math.PI };
      });
    },
    [t, ids],
  );
  await p2.close();
  return out;
}
// The route's point (and heading) at a fraction of its length, in the drawing.
const routeAt = (page, frac) =>
  page.evaluate((frac) => {
    const p = document.getElementById('p');
    const L = p.getTotalLength();
    const m = document.getElementById('sc-doc').getCTM().inverse().multiply(p.getCTM());
    const q = (s) => p.getPointAtLength(Math.max(0, Math.min(L, s))).matrixTransform(m);
    const a = q(frac * L - 0.5);
    const b = q(frac * L + 0.5);
    const c = q(frac * L);
    return { x: c.x, y: c.y, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  }, frac);
const near = (a, b, tol = 1) => {
  expect(a.x).toBeCloseTo(b.x, 0);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

test('select a layer and the path above it, add Move along path', async ({ page }) => {
  await select(page, 'c', 'p');
  await expect(page.locator('#sc-anim-pair')).toHaveText(
    'Animating “circle #c”. Add Move along path to send it along “Route”, or Morph to turn it into that shape.',
  );
  await add(page, 'followPath');
  expect(await anims(page, 'c')).toEqual([
    {
      p: 'followPath',
      dur: 3,
      delay: 0,
      rep: 1,
      dir: 'normal',
      ease: 'inout',
      path: 'p',
      orient: false,
      hide: true,
    },
  ]);
  // The layer alone stays selected, with its options showing.
  expect(await page.evaluate(() => window.svgcraft.state.sel.map((e) => e.id))).toEqual(['c']);
  await expect(page.locator('#sc-anim-opts select[data-anim-opt="path"]')).toHaveValue('p');
  await expect(page.locator('#sc-anim-opts [data-anim-opt="orient"]')).not.toBeChecked();
  await expect(page.locator('#sc-anim-opts [data-anim-opt="hide"]')).toBeChecked();
});

test('one layer on its own says what Move along path needs', async ({ page }) => {
  await select(page, 'c');
  await add(page, 'followPath');
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'Move along path needs a path: select the layer, then Shift-click the path above it.',
  );
  expect(await anims(page, 'c')).toEqual([]);
});

test('the centre rides the path, start to end, and stays at the end', async ({ page }) => {
  await page.evaluate(() =>
    document
      .getElementById('c')
      .setAttribute(
        'data-sc-anim',
        JSON.stringify([{ p: 'followPath', dur: 2, rep: 1, ease: 'linear', path: 'p' }]),
      ),
  );
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(svg).toMatch(/<animateMotion [^>]*keyPoints="0;1"/);
  for (const [t, frac] of [
    [0, 0],
    [1, 0.5],
    [2, 1],
    [5, 1],
  ]) {
    const [c] = await at(page, svg, t, ['c']);
    near(c, await routeAt(page, frac));
  }
});

test('a scaled, rotated layer in a group: centre on the path, turned with Orient', async ({
  page,
}) => {
  await page.evaluate(() =>
    document
      .getElementById('b')
      .setAttribute(
        'data-sc-anim',
        JSON.stringify([
          { p: 'followPath', dur: 2, rep: 1, ease: 'linear', path: 'p', orient: true },
        ]),
      ),
  );
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  const [rest] = await at(page, svg, 0.0001, ['b']);
  for (const frac of [0.25, 0.5, 0.75]) {
    const [b] = await at(page, svg, frac * 2, ['b']);
    const r = await routeAt(page, frac);
    near(b, r);
    // Facing the way the path goes, in the drawing.
    expect(Math.abs(((b.deg - r.deg + 540) % 360) - 180)).toBeLessThan(2);
  }
  expect(rest).toBeTruthy();
});

test('reverse runs end to start; back and forth returns', async ({ page }) => {
  await page.evaluate(() =>
    document
      .getElementById('c')
      .setAttribute(
        'data-sc-anim',
        JSON.stringify([
          { p: 'followPath', dur: 2, rep: 1, ease: 'linear', path: 'p', dir: 'reverse' },
        ]),
      ),
  );
  let svg = await page.evaluate(() => window.svgcraft.serialize());
  near((await at(page, svg, 0, ['c']))[0], await routeAt(page, 1));
  near((await at(page, svg, 2, ['c']))[0], await routeAt(page, 0));
  await page.evaluate(() =>
    document
      .getElementById('c')
      .setAttribute(
        'data-sc-anim',
        JSON.stringify([
          { p: 'followPath', dur: 1, rep: 1, ease: 'linear', path: 'p', dir: 'alternate' },
        ]),
      ),
  );
  svg = await page.evaluate(() => window.svgcraft.serialize());
  near((await at(page, svg, 1, ['c']))[0], await routeAt(page, 1));
  near((await at(page, svg, 2, ['c']))[0], await routeAt(page, 0));
});

test('the path is hidden in the saved file and shown again when reopened', async ({ page }) => {
  await select(page, 'c', 'p');
  await add(page, 'followPath');
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(svg).toMatch(/<path id="p"[^>]*display="none"[^>]*data-sc-route=""/);
  // Still drawn while editing.
  expect(await page.evaluate(() => document.getElementById('p').getAttribute('display'))).toBe(
    null,
  );
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'again.svg'), svg);
  expect(await page.evaluate(() => document.getElementById('p').getAttribute('display'))).toBe(
    null,
  );
  expect((await anims(page, 'c'))[0].path).toBe('p');
  // Hide the path when saved, off: it's drawn in the file.
  await select(page, 'c');
  await page.locator('#sc-anim-opts [data-anim-opt="hide"]').uncheck();
  expect(await page.evaluate(() => window.svgcraft.serialize())).not.toMatch(/data-sc-route/);
});

test('another path can be picked; a deleted one turns it off', async ({ page }) => {
  await load(page, SCENE + '<line x1="0" y1="350" x2="600" y2="350" stroke="#000"/>', 600, 400);
  await select(page, 'c', 'p');
  await add(page, 'followPath');
  const pick = page.locator('#sc-anim-opts select[data-anim-opt="path"]');
  await expect(pick.locator('option')).toHaveText(['rect #b', 'Route', 'line']);
  await pick.selectOption({ label: 'line' });
  const id = (await anims(page, 'c'))[0].path;
  expect(await page.evaluate((id) => document.getElementById(id).localName, id)).toBe('line');
  await page.evaluate((id) => {
    document.getElementById(id).remove();
    window.svgcraft.commit();
  }, id);
  await select(page, 'c');
  await expect(pick).toHaveValue('');
  await expect(pick.locator('option').first()).toHaveText('— gone —');
  expect(await page.evaluate(() => window.svgcraft.serialize())).not.toMatch(/animateMotion/);
});

test('▶ Play moves it in the editor', async ({ page }) => {
  await select(page, 'c', 'p');
  await add(page, 'followPath');
  await page.click('.sc-anim-top [data-action="toggleAnimations"]');
  await expect(page.locator('#sc-doc animateMotion')).toHaveCount(1);
  await page.waitForTimeout(1500);
  const moved = await page.evaluate(() => {
    const c = document.getElementById('c').getBoundingClientRect();
    return c.x;
  });
  await page.keyboard.press('Escape');
  const rest = await page.evaluate(() => document.getElementById('c').getBoundingClientRect().x);
  expect(Math.abs(moved - rest)).toBeGreaterThan(20);
  await expect(page.locator('#sc-doc animateMotion')).toHaveCount(0);
});

// ---- motion in opened files ---------------------------------------------------

test('a file’s <animateMotion> becomes Move along path, with its route as a layer', async ({
  page,
}) => {
  const file =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">' +
    '<circle id="c" cx="0" cy="0" r="10" fill="red">' +
    '<animateMotion path="M100 100C200 0 300 300 400 200" dur="4s" begin="1s" repeatCount="indefinite" rotate="auto"/></circle>' +
    '<rect id="r" x="20" y="300" width="40" height="20">' +
    '<animateMotion dur="2s" keyPoints="1;0" keyTimes="0;1" calcMode="linear"><mpath href="#m"/></animateMotion></rect>' +
    '<path id="m" d="M0 0H200" fill="none"/></svg>';
  const before = (t) => at(page, file, t, ['c', 'r']);
  const was = [await before(2), await before(3.5)];
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'm.svg'), file);
  expect((await anims(page, 'c'))[0]).toMatchObject({
    p: 'followPath',
    dur: 4,
    delay: 1,
    rep: 0,
    dir: 'normal',
    ease: 'linear',
    orient: true,
    hide: true,
  });
  expect((await anims(page, 'r'))[0]).toMatchObject({ p: 'followPath', dur: 2, dir: 'reverse' });
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('#sc-doc > path')].map((p) => p.dataset.name),
    ),
  ).toEqual(['Motion path', 'Motion path', undefined]);
  await expect(page.locator('#sc-msg')).toHaveText(
    'Kept the file’s 2 animations: edit them in the Animation tab.',
  );
  // It plays as it did.
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  const now = [await at(page, svg, 2, ['c', 'r']), await at(page, svg, 3.5, ['c', 'r'])];
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      near(now[i][j], was[i][j]);
      if (j === 0) expect(now[i][j].deg).toBeCloseTo(was[i][j].deg, 0);
    }
});

test('Move along path comes back from Export Clean SVG', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('b').setAttribute(
      'data-sc-anim',
      JSON.stringify([
        {
          p: 'followPath',
          dur: 2,
          delay: 0.5,
          rep: 3,
          dir: 'alternate',
          ease: 'out',
          path: 'p',
          orient: true,
        },
      ]),
    );
    window.svgcraft.commit();
  });
  const back = await page.evaluate(() => {
    const s = window.svgcraft;
    /* eslint-disable no-undef -- the editor's own globals */
    const clean = () => cleanSvgText(s.serialize(), { ...CLEAN_DEFAULTS });
    const first = clean();
    s.openSvg(first, 'clean.svg');
    return {
      a: JSON.parse(document.querySelector('#sc-doc rect').dataset.scAnim || '[]'),
      same: clean() === first,
      alert: document.getElementById('sc-alert-text').textContent,
      hidden: !first.includes('id="p"'),
    };
    /* eslint-enable no-undef */
  });
  expect(back.hidden, 'the hidden route isn’t in the clean file').toBe(true);
  expect(back.alert).toBe('');
  expect(back.a).toEqual([
    expect.objectContaining({
      p: 'followPath',
      dur: 2,
      delay: 0.5,
      rep: 3,
      dir: 'alternate',
      ease: 'out',
      orient: true,
    }),
  ]);
  expect(back.same).toBe(true);
});
