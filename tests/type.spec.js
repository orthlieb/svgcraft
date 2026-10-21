// Type tool: point and paragraph text, re-editing, the Character / Paragraph
// panels, the font picker, conversion, export and round-trip.
//
// Google Fonts can't load offline, so font checks assert the attributes and
// <link>/@import the app writes, never that a web font actually rendered.
import { test, expect, action, menu, toScreen } from './fixtures.js';
import fs from 'node:fs/promises';

const SENTENCE = 'The quick brown fox jumps over the lazy dog and keeps on running far away.';

const editor = (page) => page.locator('.sc-type-edit');
const texts = (page) => page.locator('#sc-doc text');
const para = (page) => page.locator('#sc-doc text[data-box]');

async function clickDoc(page, x, y) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

// Type tool → click at a doc point → an editor opens with the caret in it.
async function startPointText(page, x, y) {
  await page.keyboard.press('t');
  await clickDoc(page, x, y);
  await expect(editor(page)).toBeFocused();
}

// "Hello⏎World" as point text at (100, 120), committed with Ctrl+Enter.
async function makePointText(page) {
  await startPointText(page, 100, 120);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('World');
  await page.keyboard.press('Control+Enter');
  await expect(editor(page)).toHaveCount(0);
}

// Drag a 200 × 150 box at (100, 250), type the sentence, click away to commit.
async function makeParagraph(page) {
  await page.keyboard.press('t');
  const a = await toScreen(page, 100, 250);
  const z = await toScreen(page, 300, 400);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 5 });
  await page.mouse.up();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(SENTENCE);
  await clickDoc(page, 700, 550);
  await expect(editor(page)).toHaveCount(0);
}

// Pick the paragraph from the Layers panel with the Move tool.
async function selectParagraph(page) {
  await page.keyboard.press('v');
  await page.locator('#sc-layers li', { hasText: 'quick' }).click();
  await expect
    .poll(() => page.evaluate(() => window.svgcraft.state.sel.map((e) => e.localName)))
    .toEqual(['text']);
}

// The paragraph's lines: text, rendered width, soft-wrap flag, baseline y.
const paraLines = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('#sc-doc text[data-box]');
    return {
      box: +t.dataset.box,
      lines: [...t.children].map((s) => ({
        text: s.textContent,
        width: s.getComputedTextLength(),
        soft: s.hasAttribute('data-soft'),
        y: +s.getAttribute('y'),
      })),
    };
  });

const attrs = (page, sel, names) =>
  page.evaluate(
    ([sel, names]) => {
      const t = document.querySelector(sel);
      return Object.fromEntries(names.map((n) => [n, t.getAttribute(n)]));
    },
    [sel, names],
  );

async function setChar(page, k, v) {
  const el = page.locator(`.sc-char input[data-type="${k}"]`);
  await el.fill(String(v));
  await el.press('Enter');
}

async function pickFont(page, scope, query) {
  await page.click(`${scope} [data-fontpick]`);
  await expect(page.locator('#sc-fontpop')).toBeVisible();
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-fontpop')).toBeHidden();
}

test.describe('point text', () => {
  test('Type tool shows the Character tab and focuses a new editor', async ({ page }) => {
    await page.keyboard.press('t');
    await expect(page.locator('[data-pane="character"]')).toBeVisible();
    await clickDoc(page, 100, 120);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveClass(/\bsc-type-edit\b/);
  });

  test('typing two lines and Ctrl+Enter makes a two-line text layer', async ({ page }) => {
    await makePointText(page);
    await expect(texts(page)).toHaveCount(1);
    const t = await attrs(page, '#sc-doc text', ['x', 'y', 'font-size', 'font-family']);
    expect(t).toEqual({
      x: '100',
      y: '120',
      'font-size': '32',
      'font-family': 'system-ui, sans-serif',
    });
    const lines = await page.$$eval('#sc-doc text > tspan', (t) =>
      t.map((s) => ({ text: s.textContent, x: +s.getAttribute('x'), y: +s.getAttribute('y') })),
    );
    expect(lines.map((l) => l.text)).toEqual(['Hello', 'World']);
    expect(lines.every((l) => l.x === 100)).toBe(true);
    expect(lines[0].y).toBe(120);
    // Auto leading = 1.2 × 32.
    expect(lines[1].y - lines[0].y).toBeCloseTo(38.4, 2);
    await expect(page.locator('#sc-layers .sc-layer-name').first()).toHaveText('“Hello World”');
  });

  test('clicking the text re-opens an editor over it; Esc discards the edit', async ({ page }) => {
    await makePointText(page);
    const before = await page.locator('#sc-doc text').evaluate((t) => t.outerHTML);
    await clickDoc(page, 110, 110);
    await expect(editor(page)).toBeFocused();
    const ov = await page.evaluate(() => {
      const ta = document.querySelector('.sc-type-edit');
      const t = document.querySelector('#sc-doc text');
      const a = ta.getBoundingClientRect();
      const hidden = t.style.visibility;
      t.style.visibility = '';
      const r = t.getBoundingClientRect();
      t.style.visibility = hidden;
      return { dx: a.left - r.left, dy: a.top - r.top, val: ta.innerText.replace(/\n$/, '') };
    });
    expect(ov.val).toBe('Hello\nWorld');
    // The overlay sits on the text: same left edge, top within the half-leading.
    expect(Math.abs(ov.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(ov.dy)).toBeLessThanOrEqual(4);

    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    expect(await page.locator('#sc-doc text').evaluate((t) => t.outerHTML)).toBe(before);
    await expect(texts(page)).not.toContainText('!');
  });

  test('a new text cancelled with Esc leaves nothing behind', async ({ page }) => {
    await makePointText(page);
    await clickDoc(page, 400, 400);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('temp');
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await expect(texts(page)).toHaveCount(1);
  });
});

test.describe('paragraph text', () => {
  test('dragging a box wraps the text to it; clicking away only commits', async ({ page }) => {
    await makePointText(page);
    await makeParagraph(page);
    // The click away committed without starting another text.
    await expect(editor(page)).toHaveCount(0);
    await expect(texts(page)).toHaveCount(2);
    const p = await paraLines(page);
    expect(p.box).toBe(200);
    expect(p.lines.length).toBeGreaterThan(1);
    expect(p.lines.map((l) => l.text).join(' ')).toBe(SENTENCE);
    for (const l of p.lines) expect(l.width, l.text).toBeLessThanOrEqual(p.box + 0.5);
    expect(p.lines[0].soft).toBe(false);
    expect(p.lines.slice(1).every((l) => l.soft)).toBe(true);
  });

  test('selecting it with Move shows its settings in the panels', async ({ page }) => {
    await makePointText(page);
    await makeParagraph(page);
    await selectParagraph(page);
    expect(await page.evaluate(() => window.svgcraft.state.sel[0].dataset.box)).toBe('200');
    await expect(page.locator('#sc-layers .sc-layer-name')).toHaveText([
      /^“The quick brown fox/,
      '“Hello World”',
    ]);
    expect(await page.evaluate(() => window.svgcraft.state.tool)).toBe('select');
    expect(await page.evaluate(() => window.svgcraft.state.type?.box)).toBe(200);
    await expect(page.locator('.sc-char [data-type-show="family"]')).toHaveText('System UI');
    await expect(page.locator('.sc-char [data-type="size"]')).toHaveValue('32');
    await expect(page.locator('[data-type="box"]')).toHaveValue('200');
  });

  test('Character panel: size, leading and tracking re-lay the paragraph', async ({ page }) => {
    await makeParagraph(page);
    const before = (await paraLines(page)).lines.length;
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    await setChar(page, 'size', 20);
    await setChar(page, 'leading', 30);
    await setChar(page, 'tracking', 100);
    const t = await attrs(page, '#sc-doc text[data-box]', ['font-size', 'letter-spacing']);
    // Tracking is in 1/1000 em: 100 × 20 / 1000 = 2.
    expect(t).toEqual({ 'font-size': '20', 'letter-spacing': '2' });
    const p = await paraLines(page);
    expect(p.lines[1].y - p.lines[0].y).toBeCloseTo(30, 2);
    // Smaller type rewraps into fewer lines, all still inside the box.
    expect(p.lines.length).toBeLessThan(before);
    for (const l of p.lines) expect(l.width, l.text).toBeLessThanOrEqual(p.box + 0.5);
  });

  test('Character toggles: caps, underline, strike, superscript, small caps', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    for (const k of ['caps', 'underline', 'strike', 'super'])
      await page.click(`.sc-char [data-type-toggle="${k}"]`);
    const sel = '#sc-doc text[data-box]';
    expect(await page.locator(sel).evaluate((t) => t.style.textTransform)).toBe('uppercase');
    expect(await attrs(page, sel, ['text-decoration', 'baseline-shift'])).toEqual({
      'text-decoration': 'underline line-through',
      'baseline-shift': 'super',
    });
    // Small caps replaces all caps.
    await page.click('.sc-char [data-type-toggle="smallcaps"]');
    expect(await page.locator(sel).evaluate((t) => t.style.textTransform)).toBe('');
    expect((await attrs(page, sel, ['font-variant']))['font-variant']).toBe('small-caps');
  });

  test('font picker: search, pick a system font and a style', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    await page.click('.sc-char [data-fontpick]');
    await expect(page.locator('.sc-font-item')).toHaveCount(32);
    await expect(page.locator('.sc-font-head')).toHaveText(['System fonts', 'Google Fonts']);
    await page.keyboard.type('geor');
    await page.keyboard.press('Enter');
    await page.selectOption('.sc-char select[data-type="style"]', '700i');
    expect(
      await attrs(page, '#sc-doc text[data-box]', ['font-family', 'font-weight', 'font-style']),
    ).toEqual({ 'font-family': 'Georgia, serif', 'font-weight': '700', 'font-style': 'italic' });
  });

  test('font picker: a Google font narrows the styles and links its stylesheet', async ({
    page,
  }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    await pickFont(page, '.sc-char', 'geor');
    await page.selectOption('.sc-char select[data-type="style"]', '700i');
    // Lobster has only Regular: the style list collapses and weight/style reset.
    await pickFont(page, '.sc-char', 'lobster');
    await expect(page.locator('.sc-char select[data-type="style"] option')).toHaveText(['Regular']);
    const a = await attrs(page, '#sc-doc text[data-box]', [
      'font-family',
      'font-weight',
      'font-style',
    ]);
    expect(a['font-family']).toBe("'Lobster', cursive");
    expect(a['font-weight'] ?? '400').toBe('400');
    expect(a['font-style'] ?? 'normal').toBe('normal');
    await expect(
      page.locator('link[href*="fonts.googleapis.com/css2?family=Lobster"]'),
    ).toHaveCount(1);
  });

  test('Paragraph panel: centre alignment and box width', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="paragraph"]');
    await page.click('[data-pane="paragraph"] [data-type-align="middle"]');
    const c = await page.evaluate(() => {
      const t = document.querySelector('#sc-doc text[data-box]');
      return {
        anchor: t.getAttribute('text-anchor'),
        lineX: +t.firstElementChild.getAttribute('x'),
        mid: +t.getAttribute('x') + +t.dataset.box / 2,
      };
    });
    expect(c.anchor).toBe('middle');
    expect(c.lineX).toBeCloseTo(c.mid, 2);
    expect(c.lineX).toBeCloseTo(200, 2);

    const before = (await paraLines(page)).lines.length;
    const bw = page.locator('[data-type="box"]');
    await bw.fill('400');
    await bw.press('Enter');
    const p = await paraLines(page);
    expect(p.box).toBe(400);
    expect(p.lines.length).toBeLessThan(before);
    for (const l of p.lines) expect(l.width, l.text).toBeLessThanOrEqual(p.box + 0.5);
  });

  test('Convert to point text and back', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="paragraph"]');
    await page.click('#sc-type-convert');
    const pt = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#sc-doc text')].at(-1);
      return { box: t.dataset.box ?? null, lines: t.children.length, text: t.textContent };
    });
    // Soft wraps are joined: one line, no box.
    expect(pt).toEqual({ box: null, lines: 1, text: SENTENCE });
    await expect(page.locator('#sc-type-convert')).toHaveText('Convert to Paragraph Text');
    await page.click('#sc-type-convert');
    await expect(para(page)).toHaveCount(1);
  });
});

test.describe('saving text', () => {
  test('Export SVG carries an @import for the Google fonts used', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    await pickFont(page, '.sc-char', 'lobster');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      menu(page, 'File', 'exportSvg'),
    ]);
    const svg = await fs.readFile(await dl.path(), 'utf8');
    expect(svg).toMatch(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Lobster/);
  });

  test('export → open restores editable paragraph text', async ({ page }) => {
    await makeParagraph(page);
    await selectParagraph(page);
    await page.click('.sc-ptabs [data-tab="character"]');
    await pickFont(page, '.sc-char', 'lobster');
    const read = () =>
      page.evaluate(() => {
        const t = document.querySelector('#sc-doc text[data-box]');
        return (
          t && {
            box: t.dataset.box,
            lines: t.children.length,
            family: t.getAttribute('font-family'),
          }
        );
      });
    const before = await read();
    expect(before.family).toBe("'Lobster', cursive");
    const svg = await page.evaluate(() => window.svgcraft.serialize());
    await page.evaluate((t) => window.svgcraft.openSvg(t, 'rt.svg'), svg);
    expect(await read()).toEqual(before);
  });
});

test.describe('transformed text', () => {
  test('the editor follows the text’s rotation; undo reverts it', async ({ page }) => {
    await makePointText(page);
    await makeParagraph(page);
    await page.keyboard.press('v');
    await page.locator('#sc-layers li', { hasText: 'Hello' }).click();
    await action(page, 'rot90cw');
    const hello = page.locator('#sc-doc text', { hasText: 'Hello' });
    expect(await hello.getAttribute('transform')).toBeTruthy();

    const r = await hello.boundingBox();
    await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 4);
    await expect(editor(page)).toBeFocused();
    const m = await editor(page).evaluate((d) => new DOMMatrix(d.style.transform));
    // A 90° clockwise turn with uniform scale.
    expect((Math.atan2(m.b, m.a) * 180) / Math.PI).toBeCloseTo(90, 2);
    expect(m.a).toBeCloseTo(0, 4);
    expect(m.d).toBeCloseTo(0, 4);
    expect(m.c).toBeCloseTo(-m.b, 4);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);

    await page.keyboard.press('Control+z');
    await expect(texts(page)).toHaveCount(2);
    await expect.poll(() => hello.getAttribute('transform')).toBeNull();
  });
});
