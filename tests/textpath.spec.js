import { test, expect, load, select, menu } from './fixtures.js';

// Text on a path (Illustrator's Type on a Path): making it, the live link to
// the path layer, start offset / align / flip, editing, the Character panel,
// releasing, save → reopen, import, duplicate, undo, locks and refusals.

// An arc over the centre (200, 220), radius 140, from the left end to the
// right end. The arc itself paints nothing, so every dark pixel is text.
const SCENE =
  '<rect id="bg" width="400" height="300" fill="#ffffff"/>' +
  '<path id="arc" d="M60 220A140 140 0 0 1 340 220" fill="none" stroke="none"/>' +
  '<text id="t" x="20" y="40" font-family="sans-serif" font-size="28" fill="#000000">HELLO CURVED WORLD</text>';

const msg = (page) => page.locator('#sc-msg');
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));

// Rasterise the export and sort its dark pixels by distance from a centre:
// in the band [r0, r1] above the chord, inside r0 (the chord side), and
// anywhere else; plus the dark pixels' mean x.
const darkness = (page, cx = 200, cy = 220, r0 = 140, r1 = 176) =>
  page.evaluate(
    async ([cx, cy, r0, r1]) => {
      const img = new Image();
      img.src =
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.svgcraft.serialize());
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 400, 300).data;
      const out = { band: 0, inside: 0, other: 0, sx: 0, n: 0 };
      for (let y = 0; y < 300; y++)
        for (let x = 0; x < 400; x++) {
          const i = (y * 400 + x) * 4;
          if (d[i] + d[i + 1] + d[i + 2] > 300) continue;
          const r = Math.hypot(x - cx, y - cy);
          if (r >= r0 && r <= r1 && y <= cy) out.band++;
          else if (r < r0 - 2) out.inside++;
          else out.other++;
          out.sx += x;
          out.n++;
        }
      out.mx = out.n ? out.sx / out.n : 0;
      return out;
    },
    [cx, cy, r0, r1],
  );

const info = (page, id = 't') =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const tp = el.querySelector(':scope > textPath');
    const href = tp?.getAttribute('href');
    const host = href && document.querySelector(href);
    return {
      link: el.getAttribute('data-sc-textpath'),
      tp: !!tp,
      href,
      hostD: host?.getAttribute('d') || null,
      hostInDefs: !!host?.closest('#sc-defs'),
      offset: tp?.getAttribute('startOffset') ?? null,
      anchor: el.getAttribute('text-anchor'),
      flip: el.hasAttribute('data-sc-flip'),
      lines: el.querySelectorAll('tspan[data-line]').length,
      runs: tp ? tp.querySelectorAll('tspan[data-run]').length : 0,
      text: el.textContent,
      x: el.getAttribute('x'),
      y: el.getAttribute('y'),
      size: el.getAttribute('font-size'),
    };
  }, id);

async function make(page) {
  await select(page, 't', 'arc');
  await menu(page, 'Object', 'textOnPath');
  await tick(page);
}

test.beforeEach(async ({ page }) => {
  await load(page, SCENE, 400, 300);
});

test('Text on Path lays the glyphs along the arc, not on the chord', async ({ page }) => {
  const before = await darkness(page);
  expect(before.band).toBe(0);
  await make(page);
  const i = await info(page);
  expect(i).toMatchObject({ link: 'arc', tp: true, lines: 0, text: 'HELLO CURVED WORLD' });
  expect(i.href).toMatch(/^#sc-tp-\d+$/);
  expect(i.hostInDefs).toBe(true);
  expect(i.x).toBeNull();
  const after = await darkness(page);
  expect(after.band).toBeGreaterThan(300);
  expect(after.inside).toBe(0);
  expect(after.other).toBeLessThan(after.band / 10);
  // The text is still the selected layer, and Properties shows its options.
  await expect(page.locator('#sc-tp-opts')).toBeVisible();
  await expect(page.locator('#sc-tp-make')).toBeHidden();
  await expect(page.locator('#sc-tp-offset')).toHaveValue('0');
});

test('the Properties button makes it too, and it keeps per-character runs', async ({ page }) => {
  await load(
    page,
    '<path id="arc" d="M60 220A140 140 0 0 1 340 220" fill="none"/>' +
      '<text id="t" x="20" y="40" font-size="28" xml:space="preserve">' +
      '<tspan x="20" y="40" data-line="">AB<tspan data-run="" font-weight="700" fill="#ff0000">CD</tspan></tspan>' +
      '<tspan x="20" y="74" data-line="">EF</tspan></text>',
    400,
    300,
  );
  await select(page, 'arc', 't');
  await page.evaluate(() => window.svgcraft.commit());
  await expect(page.locator('#sc-tp-make')).toBeVisible();
  await page.click('#sc-tp-make');
  const i = await info(page);
  expect(i).toMatchObject({ tp: true, text: 'ABCD EF', runs: 1 });
  expect(
    await page.$eval('#t textPath tspan[data-run]', (n) => [
      n.textContent,
      n.getAttribute('font-weight'),
      n.getAttribute('fill'),
    ]),
    // The line break became a space, styled like the character before it.
  ).toEqual(['CD ', '700', '#ff0000']);
});

test('moving or point-editing the path re-flows the text', async ({ page }) => {
  await make(page);
  const d0 = (await info(page)).hostD;
  // Nudge the arc down 50px with the Move tool.
  await select(page, 'arc');
  for (let k = 0; k < 5; k++) await page.keyboard.press('Shift+ArrowDown');
  await tick(page);
  expect(await page.getAttribute('#arc', 'transform')).toContain('50');
  expect((await info(page)).hostD).not.toBe(d0);
  const moved = await darkness(page, 200, 270);
  expect(moved.band).toBeGreaterThan(300);
  expect((await darkness(page)).band).toBeLessThan(moved.band / 3);

  // Point tool: select every point and push them right by 30px.
  await page.evaluate(() => {
    const s = window.svgcraft;
    s.setTool('node');
    s.tools.node.target(document.getElementById('arc'));
  });
  await page.keyboard.press('Control+a');
  for (let k = 0; k < 3; k++) await page.keyboard.press('Shift+ArrowRight');
  await tick(page);
  const edited = await darkness(page, 230, 270);
  expect(edited.band).toBeGreaterThan(300);
  expect(edited.inside).toBe(0);
});

test('the text follows the path when the text layer itself is moved', async ({ page }) => {
  await make(page);
  await select(page, 't');
  for (let k = 0; k < 4; k++) await page.keyboard.press('Shift+ArrowRight');
  await tick(page);
  // Its own transform changed, but its path copy is mapped back onto the arc.
  expect(await page.getAttribute('#t', 'transform')).toContain('40');
  const r = await darkness(page);
  expect(r.band).toBeGreaterThan(300);
  expect(r.inside).toBe(0);
});

test('start offset, align and flip', async ({ page }) => {
  await make(page);
  const start = await darkness(page);
  expect(start.mx).toBeLessThan(180);

  await page.fill('#sc-tp-offset', '20');
  await page.press('#sc-tp-offset', 'Enter');
  expect((await info(page)).offset).toBe('20%');
  expect((await darkness(page)).mx).toBeGreaterThan(start.mx + 20);

  await page.click('[data-tp-align="middle"]');
  let i = await info(page);
  expect(i).toMatchObject({ offset: '50%', anchor: 'middle' });
  await expect(page.locator('[data-tp-align="middle"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#sc-tp-offset')).toHaveValue('50');
  const mid = await darkness(page);
  expect(Math.abs(mid.mx - 200)).toBeLessThan(12);

  await page.click('[data-tp-align="end"]');
  expect(await info(page)).toMatchObject({ offset: '100%', anchor: 'end' });
  expect((await darkness(page)).mx).toBeGreaterThan(220);

  // Flip: the text runs the other way, on the inside of the arc.
  await page.click('[data-tp-align="middle"]');
  await page.click('#sc-tp-flip');
  i = await info(page);
  expect(i.flip).toBe(true);
  await expect(page.locator('#sc-tp-flip')).toHaveAttribute('aria-pressed', 'true');
  const flipped = await darkness(page, 200, 220, 104, 140);
  expect(flipped.band).toBeGreaterThan(300);
  expect((await darkness(page)).band).toBeLessThan(flipped.band / 5);
  await page.click('#sc-tp-flip');
  expect((await info(page)).flip).toBe(false);
  expect((await darkness(page)).band).toBeGreaterThan(300);
});

test('double-click edits the words in one line; Enter finishes', async ({ page }) => {
  await make(page);
  // On a glyph, not the background.
  const at = await page.evaluate(() => {
    const t = document.getElementById('t');
    const b = t.getExtentOfChar(2);
    const p = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(t.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.dblclick(at.x, at.y);
  const ed = page.locator('.sc-type-edit');
  await expect(ed).toBeVisible();
  await expect(ed).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('ROUND WE GO');
  await page.keyboard.press('Enter');
  await expect(ed).toHaveCount(0);
  const i = await info(page);
  expect(i).toMatchObject({ tp: true, text: 'ROUND WE GO', lines: 0, link: 'arc' });
  const r = await darkness(page);
  expect(r.band).toBeGreaterThan(200);
  expect(r.inside).toBe(0);
  await page.evaluate(() => window.svgcraft.undo());
  expect((await info(page)).text).toBe('HELLO CURVED WORLD');
});

test('Character panel changes restyle the whole text and keep it on the path', async ({ page }) => {
  await make(page);
  const small = await darkness(page);
  await page.click('.sc-ptabs [data-tab="character"]');
  const size = page.locator('.sc-char input[data-type="size"]');
  await size.fill('40');
  await size.press('Enter');
  const tr = page.locator('.sc-char input[data-type="tracking"]');
  await tr.fill('100');
  await tr.press('Enter');
  const i = await info(page);
  expect(i).toMatchObject({ tp: true, size: '40', lines: 0, text: 'HELLO CURVED WORLD' });
  expect(await page.getAttribute('#t', 'letter-spacing')).toBe('4');
  const big = await darkness(page, 200, 220, 140, 190);
  expect(big.band).toBeGreaterThan(small.band);
  expect(big.inside).toBe(0);
  // Paragraph-only settings don't turn it into lines.
  await page.click('.sc-ptabs [data-tab="paragraph"]');
  await page.click('#sc-type-convert');
  await expect(msg(page)).toHaveText(/release it first/);
  expect((await info(page)).tp).toBe(true);
});

test('Release Text on Path gives back one line of point text at the start', async ({ page }) => {
  await make(page);
  await menu(page, 'Object', 'releaseTextOnPath');
  await tick(page);
  const i = await info(page);
  expect(i).toMatchObject({ tp: false, link: null, lines: 1, text: 'HELLO CURVED WORLD' });
  expect(+i.x).toBeCloseTo(60, 0);
  expect(+i.y).toBeCloseTo(220, 0);
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(0);
  expect((await darkness(page)).inside).toBeGreaterThan(300);
  await select(page, 't');
  await menu(page, 'Object', 'releaseTextOnPath');
  await expect(msg(page)).toHaveText('Select a text-on-path layer to release.');
});

test('survives Save as SVG → reopen, still linked and live', async ({ page }) => {
  await make(page);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  expect(svg).toContain('data-sc-textpath="arc"');
  await load(page, '', 400, 300);
  await page.evaluate((s) => window.svgcraft.openSvg(s, 'again.svg'), svg);
  await tick(page);
  const i = await info(page);
  expect(i).toMatchObject({ tp: true, link: 'arc', hostInDefs: true });
  expect(i.href).toMatch(/^#sc-tp-\d+$/);
  expect((await darkness(page)).band).toBeGreaterThan(300);
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(1);
  await select(page, 'arc');
  for (let k = 0; k < 5; k++) await page.keyboard.press('Shift+ArrowDown');
  await tick(page);
  expect((await darkness(page, 200, 270)).band).toBeGreaterThan(300);
});

test('Import renames ids and keeps each copy linked to its own path', async ({ page }) => {
  await make(page);
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((s) => window.svgcraft.placeSvg(s, 'again.svg'), svg);
  await tick(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc text[data-sc-textpath]')].map((t) => [
      t.getAttribute('data-sc-textpath'),
      t.querySelector('textPath').getAttribute('href'),
    ]),
  );
  expect(ids).toHaveLength(2);
  expect(ids[0][0]).toBe('arc');
  expect(ids[1][0]).not.toBe('arc');
  expect(await page.$(`#${ids[1][0]}`)).not.toBeNull();
  expect(ids[0][1]).not.toBe(ids[1][1]);
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(2);
  // Editing the imported path moves only the imported text's copy.
  const hostD = (href) => page.$eval(`#sc-defs ${href}`, (n) => n.getAttribute('d'));
  const a0 = await hostD(ids[0][1]);
  const b0 = await hostD(ids[1][1]);
  await page.evaluate((id) => {
    const p = document.getElementById(id);
    p.setAttribute('d', 'M60 200A140 140 0 0 1 340 200');
    window.svgcraft.commit();
  }, ids[1][0]);
  expect(await hostD(ids[0][1])).toBe(a0);
  expect(await hostD(ids[1][1])).not.toBe(b0);
});

test('duplicate: with its path it follows the new path; alone it shares the path', async ({
  page,
}) => {
  await make(page);
  await select(page, 't', 'arc');
  await page.evaluate(() => window.svgcraft.cmds.duplicate());
  await tick(page);
  const both = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc text')].map((t) => [
      t.getAttribute('data-sc-textpath'),
      t.querySelector('textPath').getAttribute('href'),
    ]),
  );
  expect(both).toHaveLength(2);
  expect(both[0][0]).toBe('arc');
  expect(both[1][0]).toMatch(/^textpath-\d+$/);
  expect(await page.$eval(`#${both[1][0]}`, (n) => n.localName)).toBe('path');
  expect(both[0][1]).not.toBe(both[1][1]);

  await select(page, 't');
  await page.evaluate(() => window.svgcraft.cmds.duplicate());
  await tick(page);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc text')].map((t) => [
      t.getAttribute('data-sc-textpath'),
      t.querySelector('textPath').getAttribute('href'),
    ]),
  );
  expect(links.filter(([l]) => l === 'arc')).toHaveLength(2);
  expect(new Set(links.map(([, h]) => h)).size).toBe(3);
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(3);
});

test('undo and redo', async ({ page }) => {
  await make(page);
  await page.evaluate(() => window.svgcraft.undo());
  await tick(page);
  let i = await info(page);
  expect(i).toMatchObject({ tp: false, link: null });
  await expect(page.locator('#sc-defs path[data-sc-tp]')).toHaveCount(0);
  await page.evaluate(() => window.svgcraft.redo());
  await tick(page);
  i = await info(page);
  expect(i).toMatchObject({ tp: true, link: 'arc', hostInDefs: true });
  expect((await darkness(page)).band).toBeGreaterThan(300);
});

test('deleting the path keeps the text where it was', async ({ page }) => {
  await make(page);
  await select(page, 'arc');
  await page.evaluate(() => window.svgcraft.cmds.delete());
  await tick(page);
  const i = await info(page);
  expect(i).toMatchObject({ tp: true, hostInDefs: true });
  expect((await darkness(page)).band).toBeGreaterThan(300);
  await select(page, 't');
  await page.evaluate(() => window.svgcraft.commit());
  await expect(page.locator('#sc-tp-unlinked')).toBeVisible();
  // It still saves and reopens with its last shape.
  const svg = await page.evaluate(() => window.svgcraft.serialize());
  await page.evaluate((s) => window.svgcraft.openSvg(s, 'again.svg'), svg);
  await tick(page);
  expect((await darkness(page)).band).toBeGreaterThan(300);
});

test('refusals and locks', async ({ page }) => {
  await select(page, 't');
  await menu(page, 'Object', 'textOnPath');
  await expect(msg(page)).toHaveText(/Select one text layer and one path or shape/);
  await select(page, 't', 'arc', 'bg');
  await menu(page, 'Object', 'textOnPath');
  await expect(msg(page)).toHaveText(/Select one text layer and one path or shape/);
  await select(page, 'arc', 'bg');
  await menu(page, 'Object', 'textOnPath');
  await expect(msg(page)).toHaveText(/Select one text layer and one path or shape/);
  expect((await info(page)).tp).toBe(false);

  await page.evaluate(() => document.getElementById('t').setAttribute('data-sc-lock', 'all'));
  await make(page);
  await expect(msg(page)).toHaveText(/is locked/);
  expect((await info(page)).tp).toBe(false);

  await page.evaluate(() => document.getElementById('t').removeAttribute('data-sc-lock'));
  await make(page);
  await page.evaluate(() => document.getElementById('t').setAttribute('data-sc-lock', 'all'));
  await select(page, 't');
  await page.evaluate(() => window.svgcraft.commit());
  await page.fill('#sc-tp-offset', '30');
  await page.press('#sc-tp-offset', 'Enter');
  await expect(msg(page)).toHaveText(/is locked/);
  expect((await info(page)).offset).toBe('0%');
  await menu(page, 'Object', 'releaseTextOnPath');
  expect((await info(page)).tp).toBe(true);
});
