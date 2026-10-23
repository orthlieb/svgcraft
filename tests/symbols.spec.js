import { test, expect, load, select, menu, toScreen } from './fixtures.js';

// Symbols: Make Symbol, instances, the Symbols panel, editing a symbol in
// place, Break Link, rename / delete, saving, importing, locks and undo.

const SCENE =
  '<rect id="bg" width="400" height="300" fill="#ffffff"/>' +
  '<rect id="a" x="40" y="40" width="60" height="60" fill="#dc2626" stroke="#000000" stroke-width="4"/>' +
  '<circle id="b" cx="130" cy="70" r="20" fill="#2563eb"/>';

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
    return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, pts);
const RED = [220, 38, 38];
const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];
const near = (px, rgb) => px.every((v, i) => Math.abs(v - rgb[i]) < 6);
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));

// Answer the shared name / confirm dialog.
async function answer(page, value, button = 'ok') {
  await expect(page.locator('#sc-ask')).toBeVisible();
  if (value != null) await page.fill('#sc-ask .sc-ask-input', value);
  await page.click(`#sc-ask [data-ask="${button}"]`);
  await expect(page.locator('#sc-ask')).toBeHidden();
}

async function makeSymbol(page, name = 'Badge', ...ids) {
  await select(page, ...(ids.length ? ids : ['a', 'b']));
  await menu(page, 'Object', 'makeSymbol');
  await answer(page, name);
}

const uses = (page) => page.locator('#sc-doc use');
const symbols = (page) => page.locator('#sc-defs > symbol');
const symbolsTab = (page) => page.click('[data-tab="symbols"]');

// Every probe: inside the square, inside the circle, the square's stroke, bg.
const PROBES = [
  [70, 70],
  [130, 70],
  [40, 70],
  [200, 200],
];

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 400, 300);
});

test.describe('Make Symbol', () => {
  test('replaces the selection with one instance, and nothing moves', async ({ page }) => {
    const before = await pixels(page, PROBES);
    expect(near(before[0], RED)).toBe(true);
    expect(near(before[1], BLUE)).toBe(true);
    await makeSymbol(page, 'Badge');

    await expect(uses(page)).toHaveCount(1);
    await expect(page.locator('#sc-doc > rect, #sc-doc > circle')).toHaveCount(1); // just bg
    await expect(symbols(page)).toHaveCount(1);
    const info = await page.evaluate(() => {
      const s = document.querySelector('#sc-defs > symbol');
      const u = document.querySelector('#sc-doc use');
      return {
        id: s.id,
        name: s.getAttribute('data-name'),
        overflow: s.getAttribute('overflow'),
        kids: [...s.children].map((c) => c.localName),
        href: u.getAttribute('href'),
        useName: u.getAttribute('data-name'),
        transform: u.getAttribute('transform'),
        selected: window.svgcraft.state.sel[0] === u,
      };
    });
    expect(info).toEqual({
      id: 'sc-sym-1',
      name: 'Badge',
      overflow: 'visible',
      kids: ['rect', 'circle'],
      href: '#sc-sym-1',
      useName: 'Badge',
      transform: null,
      selected: true,
    });
    expect(await pixels(page, PROBES)).toEqual(before);

    // The Layers row shows the symbol badge and name; the panel has a tile.
    const row = page.locator('#sc-layers li.sc-instance');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.sc-layer-name')).toHaveText('Badge');
    await expect(row.locator('.sc-sym-badge svg')).toHaveCount(1);
    await symbolsTab(page);
    await expect(page.locator('#sc-symlib .sc-sym-tile')).toHaveCount(1);
    await expect(page.locator('#sc-symlib .sc-sym-name')).toHaveText('Badge');
  });

  test('cancelling the name leaves the drawing alone; nothing selected says so', async ({
    page,
  }) => {
    await select(page, 'a');
    await menu(page, 'Object', 'makeSymbol');
    await answer(page, null, 'cancel');
    await expect(uses(page)).toHaveCount(0);
    await expect(symbols(page)).toHaveCount(0);
    await select(page);
    await menu(page, 'Object', 'makeSymbol');
    await expect(page.locator('#sc-msg')).toContainText('Select the artwork');
  });

  test('a nested selection keeps its look, inherited paint and all', async ({ page }) => {
    await load(
      page,
      '<rect width="400" height="300" fill="#fff"/><g id="g" fill="#dc2626" transform="translate(100 50)"><rect id="r" width="50" height="50"/></g>',
      400,
      300,
    );
    const before = await pixels(page, [
      [125, 75],
      [90, 75],
    ]);
    await select(page, 'r');
    await menu(page, 'Object', 'makeSymbol');
    await answer(page, 'Inner');
    expect(
      await pixels(page, [
        [125, 75],
        [90, 75],
      ]),
    ).toEqual(before);
    // The instance sits in the group, undoing its transform.
    expect(
      await page.evaluate(() => document.querySelector('#g > use').getAttribute('transform')),
    ).toBe('matrix(1 0 0 1 -100 -50)');
  });
});

test.describe('instances', () => {
  test('Place, double-click and drag-and-drop add instances that draw the symbol', async ({
    page,
  }) => {
    await makeSymbol(page);
    await symbolsTab(page);
    await page.click('#sc-symlib .sc-sym-tile');
    // Place: centred in the view. The symbol spans 38..150 × 38..102.
    await page.evaluate(() => window.svgcraft.state.sel.splice(0));
    await page.click('[data-sym-act="place"]');
    await expect(uses(page)).toHaveCount(2);
    const centre = await page.evaluate(() => {
      const r = document.getElementById('sc-stage').getBoundingClientRect();
      const p = new DOMPoint(r.left + r.width / 2, r.top + r.height / 2).matrixTransform(
        document.getElementById('sc-view').getScreenCTM().inverse(),
      );
      const b = window.svgcraft.paintBox(window.svgcraft.state.sel);
      return { cx: p.x, cy: p.y, bx: b.x + b.w / 2, by: b.y + b.h / 2 };
    });
    expect(Math.abs(centre.cx - centre.bx)).toBeLessThan(1);
    expect(Math.abs(centre.cy - centre.by)).toBeLessThan(1);

    // Put that one somewhere known, then place another by double-click.
    await page.evaluate(() =>
      window.svgcraft.state.sel[0].setAttribute('transform', 'translate(0 150)'),
    );
    await page.dblclick('#sc-symlib .sc-sym-thumb');
    await expect(uses(page)).toHaveCount(3);

    // Drag the tile onto the canvas: the instance centres on the drop point.
    const at = await toScreen(page, 300, 220);
    await page.locator('#sc-symlib .sc-sym-tile').dragTo(page.locator('#sc-stage'), {
      targetPosition: await page.evaluate(
        ([x, y]) => {
          const r = document.getElementById('sc-stage').getBoundingClientRect();
          return { x: x - r.left, y: y - r.top };
        },
        [at.x, at.y],
      ),
    });
    await expect(uses(page)).toHaveCount(4);
    const dropped = await page.evaluate(() => {
      const b = window.svgcraft.paintBox([document.querySelector('#sc-doc use:last-of-type')]);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    });
    expect(Math.abs(dropped.x - 300)).toBeLessThan(3);
    expect(Math.abs(dropped.y - 220)).toBeLessThan(3);

    const px = await pixels(page, [
      [70, 70],
      [70, 220],
      [130, 220],
    ]);
    expect(near(px[0], RED)).toBe(true);
    expect(near(px[1], RED)).toBe(true);
    expect(near(px[2], BLUE)).toBe(true);
    // The painted box takes in the symbol's stroke.
    const box = await page.evaluate(() =>
      window.svgcraft.paintBox([document.querySelector('#sc-doc use')]),
    );
    expect(box).toEqual({ x: 38, y: 38, w: 112, h: 64 });
  });

  test('instances move, flip, fade and hide like any layer; Duplicate copies one', async ({
    page,
  }) => {
    await makeSymbol(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('transform')),
    ).toBe('matrix(1 0 0 1 1 10)');
    await menu(page, 'Object', 'flipH');
    // Flipped about its own centre: the circle is on the left now.
    const px = await pixels(page, [
      [60, 80],
      [130, 80],
    ]);
    expect(near(px[0], BLUE)).toBe(true);
    expect(near(px[1], RED)).toBe(true);
    await page.keyboard.press('Control+j');
    await expect(uses(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.querySelectorAll('#sc-doc use[id]').length)).toBe(0);
    await page.click('#sc-layers li.sc-instance >> nth=0 >> .sc-eye');
    await expect(page.locator('#sc-doc use[display="none"]')).toHaveCount(1);
  });

  test('a colour on an instance reaches the content that inherits', async ({ page }) => {
    await load(
      page,
      '<rect width="400" height="300" fill="#fff"/><rect id="a" x="20" y="20" width="40" height="40"/><rect id="k" x="80" y="20" width="40" height="40" fill="#2563eb"/>',
      400,
      300,
    );
    await makeSymbol(page, 'Pair', 'a', 'k');
    await page.click('[data-tab="swatches"]');
    await page.click('#sc-palette .sc-tile[aria-label="#dc2626"]');
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('fill')),
    ).toBe('#dc2626');
    const px = await pixels(page, [
      [40, 40],
      [100, 40],
    ]);
    expect(near(px[0], RED)).toBe(true); // inherited the instance's fill
    expect(near(px[1], BLUE)).toBe(true); // has its own
  });
});

test.describe('instance styles', () => {
  test('a drop shadow and a blend mode work on an instance', async ({ page }) => {
    await makeSymbol(page, 'Square', 'a');
    await page.evaluate(() => {
      const u = document.querySelector('#sc-doc use');
      u.setAttribute('data-sc-fx', '{"ds":{"o":100,"d":10,"s":0}}');
      window.svgcraft.commit();
    });
    await tick(page);
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('filter')),
    ).toMatch(/^url\(#sc-fx-\d+\)$/);
    const [shadow] = await pixels(page, [[104, 106]]);
    expect(shadow[0]).toBeLessThan(80);
    await page.selectOption('#sc-blend', 'multiply');
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').style.mixBlendMode),
    ).toBe('multiply');
  });
});

test.describe('Edit Symbol', () => {
  test('double-click an instance: edits show in every instance; Done writes back', async ({
    page,
  }) => {
    await makeSymbol(page);
    await page.evaluate(() => {
      const s = window.svgcraft;
      s.placeSymbol(undefined, { x: 94, y: 220 });
    });
    const hist0 = await page.evaluate(() => document.getElementById('sc-undo').disabled);
    expect(hist0).toBe(false);
    // Double-click the first instance's square.
    const p = await toScreen(page, 70, 70);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('#sc-iso')).toBeVisible();
    await expect(page.locator('#sc-iso-name')).toHaveText('Badge');
    // The symbol's content is laid out as layers; the rest sits behind.
    await expect(page.locator('#sc-doc > *')).toHaveCount(2);
    await expect(page.locator('#sc-iso-back > *')).toHaveCount(3);
    await expect(page.locator('#sc-layers li')).toHaveCount(2);

    // Pick the square and paint it green.
    await page.mouse.click(p.x, p.y);
    expect(await page.evaluate(() => window.svgcraft.state.sel[0].localName)).toBe('rect');
    await page.click('[data-tab="swatches"]');
    await page.click('#sc-palette .sc-tile[aria-label="#16a34a"]');
    await tick(page);
    // Both instances follow straight away (the export is the real drawing).
    const GREEN = [22, 163, 74];
    let px = await pixels(page, [
      [70, 70],
      [70, 220],
    ]);
    expect(near(px[0], GREEN)).toBe(true);
    expect(near(px[1], GREEN)).toBe(true);
    // Move the circle down 10 while editing.
    await page.mouse.click(...Object.values(await toScreen(page, 130, 70)));
    await page.keyboard.press('Shift+ArrowDown');
    await tick(page);
    px = await pixels(page, [
      [130, 95],
      [130, 245],
    ]);
    expect(near(px[0], BLUE)).toBe(true);
    expect(near(px[1], BLUE)).toBe(true);

    await page.click('#sc-iso [data-action="symbolDone"]');
    await expect(page.locator('#sc-iso')).toBeHidden();
    await expect(page.locator('#sc-iso-back')).toHaveCount(0);
    await expect(page.locator('#sc-doc > *')).toHaveCount(3);
    expect(await page.evaluate(() => window.svgcraft.state.sel[0].localName)).toBe('use');
    px = await pixels(page, [
      [70, 70],
      [70, 220],
      [130, 95],
      [130, 245],
    ]);
    expect(px.map((x, i) => near(x, i < 2 ? GREEN : BLUE))).toEqual([true, true, true, true]);

    // One history: undo the move, then the colour, then back out of the edit.
    await page.keyboard.press('Control+z');
    px = await pixels(page, [
      [130, 95],
      [130, 70],
    ]);
    expect(near(px[0], WHITE)).toBe(true);
    expect(near(px[1], BLUE)).toBe(true);
    await page.keyboard.press('Control+z');
    expect(near((await pixels(page, [[70, 220]]))[0], RED)).toBe(true);
    await page.keyboard.press('Control+Shift+z');
    expect(near((await pixels(page, [[70, 220]]))[0], GREEN)).toBe(true);
    await expect(page.locator('#sc-iso')).toBeHidden();
  });

  test('a rotated, scaled instance edits in place; Esc and double-click outside finish', async ({
    page,
  }) => {
    await makeSymbol(page, 'Badge', 'a');
    await page.evaluate(() =>
      document
        .querySelector('#sc-doc use')
        .setAttribute('transform', 'translate(300 150) rotate(90) scale(0.5) translate(-70 -70)'),
    );
    await page.evaluate(() => window.svgcraft.commit());
    await page.evaluate(() => window.svgcraft.editSymbol(document.querySelector('#sc-doc use')));
    await expect(page.locator('#sc-iso')).toBeVisible();
    // The content sits where the instance drew it.
    const box = await page.evaluate(() =>
      window.svgcraft.paintBox([document.querySelector('#sc-doc > rect')]),
    );
    expect(box.x).toBeCloseTo(284, 0);
    expect(box.y).toBeCloseTo(134, 0);
    expect(box.w).toBeCloseTo(32, 0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sc-iso')).toBeHidden();
    // Nothing changed, so nothing new in the symbol.
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs > symbol > rect').getAttribute('x'),
      ),
    ).toBe('40');
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs > symbol > rect').getAttribute('transform'),
      ),
    ).toBeNull();

    await page.evaluate(() => window.svgcraft.editSymbol(document.querySelector('#sc-doc use')));
    const out = await toScreen(page, 20, 280);
    await page.mouse.dblclick(out.x, out.y);
    await expect(page.locator('#sc-iso')).toBeHidden();
  });

  test('switching documents finishes the editing and keeps the edits', async ({ page }) => {
    await makeSymbol(page, 'Badge', 'a');
    await page.evaluate(() => window.svgcraft.editSymbol(document.querySelector('#sc-doc use')));
    await page.evaluate(() => {
      document.querySelector('#sc-doc > rect').setAttribute('fill', '#16a34a');
      window.svgcraft.commit();
    });
    await page.click('.sc-doctab-new');
    await expect(page.locator('#sc-iso')).toBeHidden();
    await expect(page.locator('#sc-doc > *')).toHaveCount(0);
    await page.click('.sc-doctab >> nth=0');
    await expect(uses(page)).toHaveCount(1);
    await expect(page.locator('#sc-doc > *')).toHaveCount(3);
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs symbol rect').getAttribute('fill'),
      ),
    ).toBe('#16a34a');
  });

  test('new artwork drawn while editing goes into the symbol', async ({ page }) => {
    await makeSymbol(page, 'Badge', 'a');
    await page.evaluate(() => window.svgcraft.editSymbol(document.querySelector('#sc-doc use')));
    await page.evaluate(() => window.svgcraft.setTool('rect'));
    const p0 = await toScreen(page, 200, 200);
    const p1 = await toScreen(page, 240, 240);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.move(p1.x, p1.y, { steps: 4 });
    await page.mouse.up();
    await page.click('#sc-iso [data-action="symbolDone"]');
    await expect(page.locator('#sc-defs > symbol > *')).toHaveCount(2);
    await expect(page.locator('#sc-doc > *')).toHaveCount(3); // bg, circle, instance
  });

  test('Edit Symbol from the panel, and the Object menu', async ({ page }) => {
    await makeSymbol(page);
    await select(page);
    await symbolsTab(page);
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="edit"]');
    await expect(page.locator('#sc-iso')).toBeVisible();
    await page.keyboard.press('Escape');
    await menu(page, 'Object', 'editSymbol');
    await expect(page.locator('#sc-iso')).toBeVisible();
    // Undo / redo while editing stay in the editing.
    await page.evaluate(() => {
      document.querySelector('#sc-doc > circle').setAttribute('r', '30');
      window.svgcraft.commit();
    });
    await page.keyboard.press('Control+z');
    await expect(page.locator('#sc-iso')).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc > circle').getAttribute('r')),
    ).toBe('20');
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs > symbol > circle').getAttribute('r'),
      ),
    ).toBe('20');
    await page.keyboard.press('Control+Shift+z');
    expect(
      await page.evaluate(() =>
        document.querySelector('#sc-defs > symbol > circle').getAttribute('r'),
      ),
    ).toBe('30');
    await page.keyboard.press('Escape');
    expect(near((await pixels(page, [[130, 98]]))[0], BLUE)).toBe(true);
  });
});

test.describe('Break Link', () => {
  test('turns an instance into an ordinary group that no longer follows', async ({ page }) => {
    await makeSymbol(page);
    await page.evaluate(() => window.svgcraft.placeSymbol(undefined, { x: 94, y: 220 }));
    const before = await pixels(page, [
      [70, 220],
      [130, 220],
    ]);
    await menu(page, 'Object', 'breakSymbolLink');
    await expect(uses(page)).toHaveCount(1);
    const g = await page.evaluate(() => {
      const g = window.svgcraft.state.sel[0];
      return { tag: g.localName, name: g.getAttribute('data-name'), kids: g.children.length };
    });
    expect(g).toEqual({ tag: 'g', name: 'Badge', kids: 2 });
    expect(
      await pixels(page, [
        [70, 220],
        [130, 220],
      ]),
    ).toEqual(before);
    // Edit the symbol: the group stays red.
    await page.evaluate(() => {
      window.svgcraft.editSymbol(document.querySelector('#sc-doc use'));
      document.querySelector('#sc-doc > rect').setAttribute('fill', '#16a34a');
      window.svgcraft.exitIso();
    });
    const px = await pixels(page, [
      [70, 70],
      [70, 220],
    ]);
    expect(near(px[0], RED)).toBe(false);
    expect(near(px[1], RED)).toBe(true);
  });

  test('carried defs get fresh ids', async ({ page }) => {
    await load(
      page,
      '<defs><linearGradient id="lg"><stop offset="0" stop-color="#dc2626"/><stop offset="1" stop-color="#dc2626"/></linearGradient></defs><rect width="400" height="300" fill="#fff"/><rect id="a" x="20" y="20" width="60" height="60" fill="url(#lg)"/>',
      400,
      300,
    );
    await makeSymbol(page, 'G', 'a');
    await menu(page, 'Object', 'breakSymbolLink');
    const fills = await page.evaluate(() => ({
      group: document.querySelector('#sc-doc g rect').getAttribute('fill'),
      symbol: document.querySelector('#sc-defs symbol rect').getAttribute('fill'),
    }));
    expect(fills.symbol).toBe('url(#lg)');
    expect(fills.group).toMatch(/^url\(#lg-\d+\)$/);
    expect(near((await pixels(page, [[50, 50]]))[0], RED)).toBe(true);
  });
});

test.describe('the Symbols panel', () => {
  test('renames a symbol, and the instances named after it follow', async ({ page }) => {
    await makeSymbol(page);
    await symbolsTab(page);
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="rename"]');
    await answer(page, 'Logo');
    await expect(page.locator('#sc-symlib .sc-sym-name')).toHaveText('Logo');
    await expect(page.locator('#sc-layers li.sc-instance .sc-layer-name')).toHaveText('Logo');
    await page.dblclick('#sc-symlib .sc-sym-name');
    await answer(page, 'Mark');
    expect(await page.evaluate(() => document.querySelector('#sc-defs symbol').dataset.name)).toBe(
      'Mark',
    );
  });

  test('deleting with instances: Break Links keeps them as groups', async ({ page }) => {
    await makeSymbol(page);
    const before = await pixels(page, PROBES);
    await symbolsTab(page);
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="delete"]');
    await expect(page.locator('#sc-ask .sc-ask-text')).toContainText('1 instance');
    await answer(page, null, 'ok');
    await expect(symbols(page)).toHaveCount(0);
    await expect(uses(page)).toHaveCount(0);
    await expect(page.locator('#sc-doc > g')).toHaveCount(1);
    expect(await pixels(page, PROBES)).toEqual(before);
    await expect(page.locator('#sc-symlib .sc-sym-tile')).toHaveCount(0);
  });

  test('deleting with instances: Delete Instances removes them too; undo brings all back', async ({
    page,
  }) => {
    await makeSymbol(page);
    const before = await pixels(page, PROBES);
    await symbolsTab(page);
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="delete"]');
    await answer(page, null, 'alt');
    await expect(symbols(page)).toHaveCount(0);
    await expect(page.locator('#sc-doc > *')).toHaveCount(1);
    const px = await pixels(page, [[70, 70]]);
    expect(near(px[0], WHITE)).toBe(true);
    await page.keyboard.press('Control+z');
    await expect(symbols(page)).toHaveCount(1);
    expect(await pixels(page, PROBES)).toEqual(before);
    // Cancel leaves it be.
    await page.click('#sc-symlib .sc-sym-tile');
    await page.click('[data-sym-act="delete"]');
    await answer(page, null, 'cancel');
    await expect(symbols(page)).toHaveCount(1);
  });
});

test.describe('files', () => {
  test('Save → reopen keeps real <symbol> / <use>', async ({ page }) => {
    await makeSymbol(page);
    await page.evaluate(() => window.svgcraft.placeSymbol(undefined, { x: 94, y: 220 }));
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    expect(svg).toContain('<symbol id="sc-sym-1" data-name="Badge" overflow="visible">');
    expect(svg.match(/<use href="#sc-sym-1"/g)).toHaveLength(2);
    const before = await pixels(page, [...PROBES, [70, 220]]);
    await page.evaluate((svg) => window.svgcraft.openSvg(svg, 'again.svg'), svg);
    await expect(symbols(page)).toHaveCount(1);
    await expect(uses(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.querySelector('#sc-defs symbol').id)).toBe(
      'sc-sym-1',
    );
    expect(await pixels(page, [...PROBES, [70, 220]])).toEqual(before);
    await symbolsTab(page);
    await expect(page.locator('#sc-symlib .sc-sym-name')).toHaveText('Badge');
  });

  test('importing into a drawing with its own symbols renames ids and repoints hrefs', async ({
    page,
  }) => {
    await makeSymbol(page);
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    // Another drawing that has a different sc-sym-1.
    await load(
      page,
      '<defs><symbol id="sc-sym-1" data-name="Dot" overflow="visible"><circle cx="395" cy="295" r="4" fill="#2563eb"/></symbol></defs><rect width="400" height="300" fill="#fff"/><use href="#sc-sym-1"/>',
      400,
      300,
    );
    await page.evaluate((svg) => window.svgcraft.placeSvg(svg, 'badge.svg'), svg);
    const info = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('#sc-defs > symbol')].map((s) => s.id),
      hrefs: [...document.querySelectorAll('#sc-doc use')].map((u) => u.getAttribute('href')),
    }));
    expect(info.ids).toEqual(['sc-sym-1', 'sc-sym-2']);
    expect(info.hrefs).toEqual(['#sc-sym-1', '#sc-sym-2']);
    // Both draw: the drawing's own dot, and (placed scaled to fit) the import.
    expect(near((await pixels(page, [[395, 295]]))[0], BLUE)).toBe(true);
    const box = await page.evaluate(() =>
      window.svgcraft.paintBox([document.querySelector('#sc-doc > g use')]),
    );
    expect(box.w).toBeGreaterThan(50);
    const inside = await pixels(page, [[box.x + 15, box.y + 15]]);
    expect(near(inside[0], RED)).toBe(true);
  });

  test('a sprite sheet’s top-level symbols land in defs', async ({ page }) => {
    await page.evaluate(() =>
      window.svgcraft.placeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300"><symbol id="star" viewBox="0 0 10 10"><rect width="10" height="10" fill="#dc2626"/></symbol><use xlink:href="#star" width="100" height="100"/></svg>',
        'sprite.svg',
      ),
    );
    await expect(page.locator('#sc-defs > symbol#star')).toHaveCount(1);
    await expect(page.locator('#sc-doc symbol')).toHaveCount(0);
    expect(near((await pixels(page, [[50, 50]]))[0], RED)).toBe(true);
  });

  test('Copy as SVG and paste reuses the symbol; other symbols stay behind', async ({ page }) => {
    await makeSymbol(page, 'Square', 'a');
    await makeSymbol(page, 'Circle', 'b');
    await page.evaluate(
      () => (window.svgcraft.state.sel = [document.querySelector('#sc-doc use')]),
    );
    const clip = await page.evaluate(() => window.svgcraft.serialize({ selection: true }));
    expect(clip).toContain('data-name="Square"');
    expect(clip).not.toContain('data-name="Circle"');
    await page.evaluate((clip) => window.svgcraft.placeSvg(clip), clip);
    await expect(symbols(page)).toHaveCount(2);
    await expect(uses(page)).toHaveCount(3);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('#sc-doc use')].map((u) => u.getAttribute('href')),
      ),
    ).toEqual(['#sc-sym-1', '#sc-sym-2', '#sc-sym-1']);
    // Pasted 10 px down and right.
    expect(near((await pixels(page, [[105, 105]]))[0], RED)).toBe(true);
  });

  test('Define Pattern on an instance carries the symbol into the tile', async ({ page }) => {
    await makeSymbol(page);
    await menu(page, 'Edit', 'definePattern');
    await answer(page, 'Badges');
    const svg = await page.evaluate(
      () => JSON.parse(localStorage.getItem('svgcraft.library.v1')).patterns.at(-1).svg,
    );
    expect(svg).toContain('symbol');
    expect(svg).toMatch(/<use href="#p[a-z0-9]+-sc-sym-1"/);
  });
});

test.describe('locks and undo', () => {
  test('locked instances refuse what their lock forbids', async ({ page }) => {
    await makeSymbol(page);
    await menu(page, 'Object', 'lockAll');
    await menu(page, 'Object', 'breakSymbolLink');
    await expect(page.locator('#sc-msg')).toContainText('is locked');
    await expect(uses(page)).toHaveCount(1);
    await menu(page, 'Object', 'editSymbol');
    await expect(page.locator('#sc-iso')).toBeHidden();
    await menu(page, 'Object', 'lockPosition');
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(() => document.querySelector('#sc-doc use').getAttribute('transform')),
    ).toBeNull();
    // Position-locked instances can still have their symbol edited.
    await menu(page, 'Object', 'editSymbol');
    await expect(page.locator('#sc-iso')).toBeVisible();
    await page.keyboard.press('Escape');
    // Locked artwork can't become a symbol.
    await select(page, 'bg');
    await menu(page, 'Object', 'lockAll');
    await menu(page, 'Object', 'makeSymbol');
    await expect(page.locator('#sc-ask')).toBeHidden();
    await expect(symbols(page)).toHaveCount(1);
  });

  test('undo takes Make Symbol back; redo makes it again', async ({ page }) => {
    const before = await page.evaluate(() => document.getElementById('sc-doc').innerHTML);
    await makeSymbol(page);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => document.getElementById('sc-doc').innerHTML)).toBe(before);
    await expect(symbols(page)).toHaveCount(0);
    await symbolsTab(page);
    await expect(page.locator('#sc-symlib .sc-sym-tile')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(symbols(page)).toHaveCount(1);
    await expect(uses(page)).toHaveCount(1);
    await expect(page.locator('#sc-symlib .sc-sym-tile')).toHaveCount(1);
  });

  test('effects on a symbol’s content survive (their filters aren’t pruned)', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('a').setAttribute('data-sc-fx', '{"ds":{"o":100,"d":10,"s":0}}');
      window.svgcraft.commit();
    });
    await tick(page);
    // Shadow down-right of the square (light from 120°).
    const before = await pixels(page, [[104, 106]]);
    expect(before[0][0]).toBeLessThan(80);
    await makeSymbol(page);
    await tick(page);
    const f = await page.evaluate(() => {
      const r = document.querySelector('#sc-defs symbol rect');
      const id = r.getAttribute('filter').slice(5, -1);
      return !!document.getElementById(id);
    });
    expect(f).toBe(true);
    expect(await pixels(page, [[104, 106]])).toEqual(before);
  });
});
