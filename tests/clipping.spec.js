import fs from 'node:fs';
import { test, expect, load, select, action, toScreen } from './fixtures.js';

// Object → Clipping Mask (Illustrator style): the topmost selected layer
// becomes a live, editable window onto the layers below it.

// No background, so anything clipped away reads back as transparent.
const SCENE =
  '<rect id="art" x="50" y="50" width="300" height="200" fill="#ff0000"/>' +
  '<rect id="other" x="360" y="20" width="30" height="30" fill="#00ff00"/>' +
  '<circle id="c" cx="200" cy="150" r="60" fill="#0000ff"/>';

const msg = (page) => page.locator('#sc-msg');
const attr = (page, id, a) =>
  page.evaluate(([id, a]) => document.getElementById(id)?.getAttribute(a) ?? null, [id, a]);
// The clipping syncs in a microtask after each change.
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));

// Rasterise the export and read pixels at doc points.
const pixels = (page, pts) =>
  page.evaluate(async (pts) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, pts);
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

// The clipping group's state, for structural checks.
const clipState = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('#sc-doc [data-sc-clip]');
    const hosts = [...document.querySelectorAll('#sc-defs > clipPath')];
    if (!g) return { group: false, hosts: hosts.length };
    const cl = g.querySelector(':scope > [data-sc-clipper]');
    const id = /^url\(#(.+)\)$/.exec(g.getAttribute('clip-path') || '')?.[1];
    const host = id && document.getElementById(id);
    return {
      group: true,
      name: g.getAttribute('data-name'),
      ref: g.getAttribute('clip-path'),
      kids: [...g.children].map((c) => c.id || c.localName),
      clipper: cl?.id || cl?.localName || null,
      hidden: cl?.getAttribute('visibility'),
      units: host?.getAttribute('clipPathUnits'),
      inner: host ? [...host.children].map((c) => c.outerHTML) : null,
      hosts: hosts.length,
      sel: window.svgcraft.state.sel.map((el) => el.getAttribute('data-name') || el.id),
    };
  });

// Object › Clipping Mask › Make / Release, as a user picks it.
async function clipMenu(page, label) {
  await page.click('.sc-menu-btn:text-is("Object")');
  await page.hover('.sc-sub-btn:has-text("Clipping Mask")');
  await page.click(`.sc-sub-list button:has-text("${label}")`);
}

async function makeIt(page) {
  await select(page, 'art', 'c');
  await clipMenu(page, 'Make');
  await tick(page);
}

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 400, 300);
});

test('Make clips the art below to the topmost shape, which stays as a hidden clipper', async ({
  page,
}) => {
  expect(await pixels(page, [[200, 150]])).toEqual([BLUE]);
  await makeIt(page);
  const s = await clipState(page);
  expect(s).toMatchObject({
    group: true,
    name: 'Clipping group',
    ref: 'url(#sc-clip-1)',
    kids: ['art', 'c'],
    clipper: 'c',
    hidden: 'hidden',
    units: 'userSpaceOnUse',
    hosts: 1,
    sel: ['Clipping group'],
  });
  // The copy in defs is bare geometry: no id, no bookkeeping, not hidden.
  expect(s.inner).toHaveLength(1);
  expect(s.inner[0]).toMatch(/^<circle /);
  expect(s.inner[0]).not.toMatch(/id=|data-|visibility/);
  // Inside the circle the art shows (the clipper itself doesn't paint);
  // outside it the art is gone; layers outside the group are untouched.
  expect(
    await pixels(page, [
      [200, 150],
      [160, 150],
      [70, 70],
      [330, 230],
      [375, 35],
    ]),
  ).toEqual([RED, RED, CLEAR, CLEAR, [0, 255, 0, 255]]);
  // The group is as big as its window.
  await expect(page.locator('#sc-pos')).toHaveAttribute('data-sel', '1 selected · 120×120');
  // Layers panel: the group row and the clipping path's row are marked.
  await expect(page.locator('#sc-layers .sc-clip-badge')).toHaveCount(2);
  await expect(page.locator('#sc-layers li.sc-clipper .sc-layer-name')).toHaveText('circle #c');
  await expect(page.locator('#sc-layers li.sc-clipper .sc-clip-badge')).toHaveAttribute(
    'aria-label',
    'Clipping path',
  );
});

test('Ctrl+7 makes, Ctrl+Alt+7 releases; the Layers panel button makes too', async ({ page }) => {
  await select(page, 'art', 'c');
  await page.keyboard.press('Control+7');
  await tick(page);
  expect((await clipState(page)).clipper).toBe('c');
  await page.keyboard.press('Control+Alt+7');
  await tick(page);
  expect((await clipState(page)).group).toBe(false);

  await load(page, SCENE, 400, 300);
  await select(page, 'art', 'c');
  await page.click('.sc-layers-foot [data-action="clipMake"]');
  await tick(page);
  expect((await clipState(page)).clipper).toBe('c');
});

test('the topmost selected layer is the clipper, and must be one shape or text', async ({
  page,
}) => {
  // Selection order doesn't matter, stacking order does: here the art is on top.
  await page.evaluate(() =>
    document.getElementById('sc-doc').append(document.getElementById('art')),
  );
  await select(page, 'c', 'art');
  await action(page, 'clipMake');
  await tick(page);
  expect((await clipState(page)).clipper).toBe('art');

  await load(page, SCENE, 400, 300);
  await select(page, 'c');
  await action(page, 'clipMake');
  await expect(msg(page)).toContainText('Select the art and, on top of it, the shape or text');
  expect((await clipState(page)).group).toBe(false);

  // A group on top can't clip.
  await select(page, 'other', 'c');
  await action(page, 'group');
  await select(page, 'art');
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.state.sel = [document.getElementById('art'), document.querySelector('#sc-doc > g')];
  });
  await action(page, 'clipMake');
  await expect(msg(page)).toContainText('must be a single shape or text to clip with');
  expect((await clipState(page)).group).toBe(false);
  expect(await page.locator('#sc-doc > g').count()).toBe(1);
});

test('text can be the clipper', async ({ page }) => {
  await load(
    page,
    '<rect id="art" width="400" height="300" fill="#ff0000"/>' +
      '<text id="t" x="20" y="200" font-family="sans-serif" font-weight="900" font-size="200">HI</text>',
    400,
    300,
  );
  await select(page, 'art', 't');
  await action(page, 'clipMake');
  await tick(page);
  const s = await clipState(page);
  expect(s.clipper).toBe('t');
  expect(s.inner[0]).toMatch(/^<text [^>]*font-size="200"[^>]*>HI<\/text>$/);
  // Above the letters is clipped away; the middle of the H's stem isn't.
  const [above, stem] = await pixels(page, [
    [100, 10],
    [45, 140],
  ]);
  expect(above).toEqual(CLEAR);
  expect(stem).toEqual(RED);
});

test('moving the clipper moves the window, not the art', async ({ page }) => {
  await makeIt(page);
  // Pick the clipping path in the Layers panel and nudge it right 60px.
  await page.locator('#sc-layers li.sc-clipper').click();
  expect(await page.evaluate(() => window.svgcraft.state.sel.map((el) => el.id))).toEqual(['c']);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  await tick(page);
  expect(await attr(page, 'art', 'x')).toBe('50');
  expect((await clipState(page)).inner[0]).toContain('transform="matrix(1 0 0 1 60 0)"');
  expect(
    await pixels(page, [
      [160, 150],
      [300, 150],
    ]),
  ).toEqual([CLEAR, RED]);
  // Moving the whole group carries the window and the art together.
  await select(page);
  await page.evaluate(() => {
    window.svgcraft.state.sel = [document.querySelector('#sc-doc [data-sc-clip]')];
  });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await tick(page);
  expect(
    await pixels(page, [
      [300, 120],
      [300, 200],
      [260, 235],
    ]),
  ).toEqual([CLEAR, RED, RED]);
});

test('point-editing and transforming the clipper re-clip live', async ({ page }) => {
  await load(
    page,
    '<rect id="art" x="50" y="20" width="300" height="260" fill="#ff0000"/>' +
      '<rect id="c" x="100" y="100" width="200" height="50" fill="#0000ff"/>',
    400,
    300,
  );
  await select(page, 'art', 'c');
  await action(page, 'clipMake');
  await tick(page);
  expect(
    await pixels(page, [
      [200, 125],
      [200, 200],
    ]),
  ).toEqual([RED, CLEAR]);

  // Rotate the clipper 90° about its centre: the window turns upright.
  await page.locator('#sc-layers li.sc-clipper').click();
  await action(page, 'rot90cw');
  await tick(page);
  expect(
    await pixels(page, [
      [200, 200],
      [120, 125],
    ]),
  ).toEqual([RED, CLEAR]);
  await page.evaluate(() => window.svgcraft.undo());
  await tick(page);

  // Drag the bottom-right corner point of the clipper down and out.
  await page.locator('#sc-layers li.sc-clipper').click();
  await page.keyboard.press('a');
  await expect(page.locator('#sc-nodes [data-node]')).toHaveCount(4);
  const from = await toScreen(page, 300, 150);
  const to = await toScreen(page, 300, 260);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await tick(page);
  const s = await clipState(page);
  // The clipper became a path, still the clipper, still hidden.
  expect(s.clipper).toBe('c');
  expect(s.hidden).toBe('hidden');
  expect(s.inner[0]).toMatch(/^<path /);
  expect(
    await pixels(page, [
      [290, 230],
      [110, 230],
    ]),
  ).toEqual([RED, CLEAR]);
});

test('Release restores the clipper and keeps the group', async ({ page }) => {
  await makeIt(page);
  // Releasing from a member inside the group works too.
  await select(page, 'art');
  await clipMenu(page, 'Release');
  await tick(page);
  const left = await page.evaluate(() => {
    const g = document.querySelector('#sc-doc > g');
    return {
      kids: [...g.children].map((c) => c.id),
      attrs: [...g.attributes].map((a) => a.name).sort(),
      name: g.getAttribute('data-name'),
      c: [...document.getElementById('c').attributes].map((a) => a.name).sort(),
      hosts: document.querySelectorAll('#sc-defs > clipPath').length,
    };
  });
  expect(left).toEqual({
    kids: ['art', 'c'],
    attrs: ['data-name'],
    name: expect.stringMatching(/^Group \d+$/),
    c: ['cx', 'cy', 'fill', 'id', 'r'],
    hosts: 0,
  });
  expect(
    await pixels(page, [
      [200, 150],
      [70, 70],
    ]),
  ).toEqual([BLUE, RED]);
  await expect(page.locator('#sc-layers .sc-clip-badge')).toHaveCount(0);

  // Nothing to release.
  await select(page, 'other');
  await action(page, 'clipRelease');
  await expect(msg(page)).toContainText('Select a clipping group');
});

test('deleting the clipper or moving it out of the group ends the clip', async ({ page }) => {
  await makeIt(page);
  await page.locator('#sc-layers li.sc-clipper').click();
  await page.keyboard.press('Delete');
  await tick(page);
  expect(await clipState(page)).toEqual({ group: false, hosts: 0 });
  expect(await pixels(page, [[70, 70]])).toEqual([RED]);

  await page.evaluate(() => window.svgcraft.undo());
  await tick(page);
  expect((await clipState(page)).clipper).toBe('c');
  // Out of the group (to the top level), it's an ordinary visible shape again.
  await page.evaluate(() => {
    document.getElementById('sc-doc').append(document.getElementById('c'));
    window.svgcraft.commit();
  });
  await tick(page);
  expect(await clipState(page)).toEqual({ group: false, hosts: 0 });
  expect(await attr(page, 'c', 'visibility')).toBeNull();
  expect(await attr(page, 'c', 'data-sc-clipper')).toBeNull();
  expect(await pixels(page, [[200, 150]])).toEqual([BLUE]);
});

test('a duplicated clipping group gets its own clipPath', async ({ page }) => {
  await makeIt(page);
  await page.keyboard.press('Control+d');
  await tick(page);
  const refs = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc > [data-sc-clip]')].map((g) =>
      g.getAttribute('clip-path'),
    ),
  );
  expect(refs).toEqual(['url(#sc-clip-1)', 'url(#sc-clip-2)']);
  await expect(page.locator('#sc-defs > clipPath')).toHaveCount(2);
  // Each one clips to its own window: the copy's clipper can move alone.
  await page.evaluate(() => {
    const s = window.svgcraft;
    const copy = document.querySelectorAll('#sc-doc > [data-sc-clip]')[1];
    s.state.sel = [copy.querySelector('[data-sc-clipper]')];
  });
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowUp');
  await tick(page);
  const inner = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-defs > clipPath')].map((h) => h.innerHTML),
  );
  expect(inner[0]).not.toContain('transform');
  expect(inner[1]).toContain('transform');
  // Deleting the copy prunes its clipPath.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.svgcraft.state.sel = [document.querySelectorAll('#sc-doc > [data-sc-clip]')[1]];
  });
  await page.keyboard.press('Delete');
  await tick(page);
  await expect(page.locator('#sc-defs > clipPath')).toHaveCount(1);
});

test('undo and redo restore everything', async ({ page }) => {
  await makeIt(page);
  await page.keyboard.press('Control+z');
  await tick(page);
  expect(await clipState(page)).toEqual({ group: false, hosts: 0 });
  expect(await attr(page, 'c', 'visibility')).toBeNull();
  expect(await pixels(page, [[200, 150]])).toEqual([BLUE]);
  await page.keyboard.press('Control+Shift+z');
  await tick(page);
  expect((await clipState(page)).clipper).toBe('c');
  expect(await pixels(page, [[200, 150]])).toEqual([RED]);
  // Undoing a release brings the clip back.
  await select(page, 'art');
  await action(page, 'clipRelease');
  await tick(page);
  await page.keyboard.press('Control+z');
  await tick(page);
  expect((await clipState(page)).clipper).toBe('c');
  expect(await pixels(page, [[70, 70]])).toEqual([CLEAR]);
});

test('Save as SVG → Open keeps the clip live and editable', async ({ page }) => {
  await makeIt(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  expect(file).toContain('data-sc-clip');
  expect(file).toContain('data-sc-clipper');
  expect(file).toMatch(/<clipPath [^>]*id="sc-clip-1"/);
  await load(page, '<rect width="10" height="10"/>', 400, 300);
  await page.setInputFiles('#sc-file', {
    name: 'again.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(file),
  });
  await expect(page.locator('#sc-doc-title')).toHaveText(/^again\.svg/);
  await tick(page);
  expect(await clipState(page)).toMatchObject({ clipper: 'c', hosts: 1, ref: 'url(#sc-clip-1)' });
  expect(
    await pixels(page, [
      [200, 150],
      [70, 70],
    ]),
  ).toEqual([RED, CLEAR]);
  // Still editable: moving the clipper re-clips.
  await page.locator('#sc-layers li.sc-clipper').click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  await tick(page);
  expect(
    await pixels(page, [
      [100, 150],
      [240, 150],
    ]),
  ).toEqual([RED, CLEAR]);
});

test('locks are honoured', async ({ page }) => {
  // A locked layer can't be clipped.
  await select(page, 'art');
  await action(page, 'lockAll');
  await select(page, 'art', 'c');
  await action(page, 'clipMake');
  await expect(msg(page)).toContainText('is locked');
  expect((await clipState(page)).group).toBe(false);

  await action(page, 'unlockLayers');
  await select(page, 'art', 'c');
  await action(page, 'clipMake');
  await tick(page);
  // A locked clipping group can't be released.
  await action(page, 'lockAll');
  await action(page, 'clipRelease');
  await expect(msg(page)).toContainText('is locked');
  expect((await clipState(page)).clipper).toBe('c');
});
