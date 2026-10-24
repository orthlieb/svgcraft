import { test, expect, load, select, menu } from './fixtures.js';

// Properties → Animate: presets on a layer, kept as data-sc-anim and written
// out as SMIL only when the drawing is saved (or previewed with ▶ Play).

const SCENE =
  '<rect id="r" x="20" y="20" width="60" height="40" fill="#2563eb" transform="translate(100 0)"/>' +
  '<path id="p" d="M10 150H190" fill="none" stroke="#000000" stroke-width="4"/>' +
  '<g id="g"><circle id="c" cx="50" cy="150" r="10" fill="#16a34a"/></g>';
const anims = (page, id) =>
  page.evaluate((id) => JSON.parse(document.getElementById(id).dataset.scAnim || '[]'), id);
const add = (page, preset) => page.selectOption('#sc-anim-add', preset);
// Select a layer and show it in Properties.
const pick = async (page, id) => {
  await select(page, id);
  await page.evaluate(() => window.svgcraft.commit());
};
// The saved file, parsed.
const saved = (page, opts) => page.evaluate((opts) => window.svgcraft.serialize(opts), opts);
const smil = (svg) => (svg.match(/<(animate|animateTransform|set)\b[^>]*>/g) || []).join('\n');

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 200, 200);
  await page.click('[data-tab="animation"]');
});

test('add, edit and remove an animation; the layer row shows it', async ({ page }) => {
  await expect(page.locator('#sc-anim-props')).toBeHidden();
  await expect(page.locator('#sc-anim-none')).toBeVisible();
  await pick(page, 'r');
  await expect(page.locator('#sc-anim-props')).toBeVisible();
  await add(page, 'spin');
  await expect(page.locator('#sc-msg')).toContainText('Added Spin');
  expect(await anims(page, 'r')).toEqual([
    { p: 'spin', dur: 1.2, delay: 0, rep: 0, dir: 'normal', ease: 'linear', turns: 1 },
  ]);
  await expect(page.locator('#sc-anim-list li')).toHaveText(['Spin · 1.2 s · ∞']);
  await expect(page.locator('#sc-layers .sc-anim-badge')).toHaveCount(1);
  await expect(page.locator('#sc-anim-add')).toHaveValue('');

  // Edit: length, a fixed number of times, the preset's own option.
  await page.fill('[data-anim="dur"]', '2');
  await page.locator('[data-anim="dur"]').blur();
  await page.locator('[data-anim="forever"]').uncheck();
  await page.fill('[data-anim="rep"]', '3');
  await page.locator('[data-anim="rep"]').blur();
  await page.fill('[data-anim-opt="turns"]', '-2');
  await page.locator('[data-anim-opt="turns"]').blur();
  expect((await anims(page, 'r'))[0]).toMatchObject({ dur: 2, rep: 3, turns: -2 });
  await expect(page.locator('#sc-anim-list li')).toHaveText(['Spin · 2 s · ×3']);

  // A second one, then remove the first; undo brings it back.
  await add(page, 'fadeIn');
  await expect(page.locator('#sc-anim-list li')).toHaveCount(2);
  await page.click('#sc-anim-list li:first-child .sc-anim-x');
  expect((await anims(page, 'r')).map((a) => a.p)).toEqual(['fadeIn']);
  await page.evaluate(() => window.svgcraft.undo());
  expect((await anims(page, 'r')).map((a) => a.p)).toEqual(['spin', 'fadeIn']);
});

test('saved as SMIL: additive, about the layer’s own centre, on top of its transform', async ({
  page,
}) => {
  await pick(page, 'r');
  await add(page, 'spin');
  const svg = await saved(page);
  expect(smil(svg)).toBe(
    '<animateTransform attributeName="transform" type="rotate" additive="sum" values="0 50 40;360 50 40" dur="1.2s" repeatCount="indefinite" begin="0s"/>',
  );
  // Nothing in the live drawing.
  expect(await page.locator('#sc-doc animateTransform').count()).toBe(0);

  // Drawn a quarter of the way through, it's turned 90° where it stands:
  // 40 × 60 about the centre (150, 40), translate included.
  const box = await page.evaluate(async (svg) => {
    const host = document.createElement('div');
    host.innerHTML = svg;
    document.body.append(host);
    const root = host.querySelector('svg');
    root.setAttribute('width', 200);
    root.setAttribute('height', 200);
    root.pauseAnimations();
    root.setCurrentTime(0.3);
    await new Promise(requestAnimationFrame);
    const r = root.querySelector('#r').getBoundingClientRect();
    const o = root.getBoundingClientRect();
    host.remove();
    return [r.x - o.x, r.y - o.y, r.width, r.height].map(Math.round);
  }, svg);
  expect(box).toEqual([130, 10, 40, 60]);
});

test('entrances, loops and line presets write what they need', async ({ page }) => {
  await pick(page, 'r');
  await add(page, 'fadeIn');
  await page.fill('[data-anim="delay"]', '0.5');
  await page.locator('[data-anim="delay"]').blur();
  // An entrance with a delay starts hidden; it holds its last frame.
  let s = smil(await saved(page));
  expect(s).toContain('<set attributeName="opacity" to="0" begin="0s"/>');
  expect(s).toContain(
    'attributeName="opacity" values="0;1" dur="0.6s" repeatCount="1" calcMode="spline" keyTimes="0;1" keySplines="0 0 0.58 1" fill="freeze" begin="0.5s"',
  );

  // Back and forth doubles the run and mirrors the values.
  await pick(page, 'c');
  await add(page, 'float');
  s = smil(await saved(page));
  expect(s).toContain('values="0 0;0 -6;0 0" dur="4s" repeatCount="indefinite"');

  // A line drawing on: dashes the length of the path.
  await pick(page, 'p');
  await add(page, 'drawOn');
  s = smil(await saved(page));
  expect(s).toContain('<set attributeName="stroke-dasharray" to="180 180" begin="0s"/>');
  expect(s).toContain('attributeName="stroke-dashoffset" values="180;0"');

  // Not every preset fits every layer.
  await pick(page, 'c');
  await add(page, 'drawOn');
  await expect(page.locator('#sc-msg')).toHaveText('Draw on needs a stroke.');
  expect((await anims(page, 'c')).map((a) => a.p)).toEqual(['float']);
});

test('a group animates as one; reopening regenerates from the layer data', async ({ page }) => {
  await pick(page, 'g');
  await add(page, 'pulse');
  const first = await saved(page);
  expect(smil(first)).toContain('type="scale"');
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'again.svg'), first);
  // The file's SMIL is dropped on the way in, the settings kept…
  expect(await page.locator('#sc-doc animateTransform, #sc-doc animate').count()).toBe(0);
  expect((await anims(page, 'g')).map((a) => a.p)).toEqual(['pulse']);
  // …and written again the same.
  expect(smil(await saved(page))).toBe(smil(first));
});

test('▶ Play previews in the editor; editing, Esc or a click stops it', async ({ page }) => {
  await pick(page, 'r');
  await add(page, 'spin');
  const play = page.locator('[data-pane="animation"] [data-action="toggleAnimations"]');
  await play.click();
  await expect(play).toHaveText('■ Stop');
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(1);
  // The rectangle really moves.
  const a = await page.locator('#r').boundingBox();
  await page.waitForTimeout(300);
  expect(await page.locator('#r').boundingBox()).not.toEqual(a);
  await page.keyboard.press('Escape');
  await expect(play).toHaveText('▶ Play');
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(0);

  // The View menu's item plays too, and a change stops it before it's recorded.
  await menu(page, 'View', 'toggleAnimations');
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(1);
  await page.evaluate(() => {
    document.getElementById('c').setAttribute('r', '12');
    window.svgcraft.commit();
  });
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(0);
  await page.evaluate(() => window.svgcraft.undo());
  await expect(page.locator('#sc-doc animateTransform')).toHaveCount(0);

  // A click on the canvas stops it.
  await pick(page, 'r');
  await play.click();
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(1);
  await page.locator('#sc-stage').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#sc-doc [data-sc-preview]')).toHaveCount(0);
});

test('still images leave the animation out; Clean SVG keeps it', async ({ page }) => {
  await pick(page, 'g');
  await add(page, 'colourCycle');
  await expect(page.locator('#sc-msg')).toHaveText('Colour cycle needs a shape with a solid fill.');
  await add(page, 'zoomIn');
  await pick(page, 'c');
  await add(page, 'colourCycle');
  expect(smil(await saved(page, { animate: false }))).toBe('');
  const clean = await page.evaluate(
    (svg) =>
      window.cleanSvgText(svg, {
        decimals: 1,
        meta: true,
        hidden: true,
        responsive: true,
        currentColor: true,
        minify: true,
      }),
    await saved(page),
  );
  expect(clean).not.toContain('data-sc-anim');
  // The group holding its animations isn't unwrapped, freeze isn't paint,
  // and the numbers are rounded.
  expect(clean).toMatch(
    /<g><circle [^>]*><animate attributeName="fill" values="#16a34a;#dc2626;#16a34a"[^>]*\/><\/circle><animateTransform /,
  );
  expect(clean).toContain('fill="freeze"');
  expect(clean).toContain('values="35 105;0 0"');
  // Timing isn't rounded away.
  expect(clean).toContain('keySplines="0 0 0.58 1"');
  expect(clean).toContain('dur="0.6s"');
});

test('a locked layer can’t be given an animation', async ({ page }) => {
  await page.evaluate(() => document.getElementById('r').setAttribute('data-sc-lock', 'all'));
  await pick(page, 'r');
  await add(page, 'spin');
  await expect(page.locator('#sc-msg')).toContainText('is locked');
  expect(await anims(page, 'r')).toEqual([]);
});
