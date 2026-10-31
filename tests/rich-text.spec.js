// Per-character styling inside the type editor: runs from the options bar,
// Character panel, swatches and font picker; caret read-back; auto leading;
// whole-layer settings clearing runs; mixed-size wrapping; round-trip.
import { test, expect, toScreen, parkLibraries } from './fixtures.js';

const editor = (page) => page.locator('.sc-type-edit');

async function clickDoc(page, x, y) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

// The editor's styled spans, as [text, weight, size, first family, decoration, colour].
const spans = (page) =>
  page.$$eval('.sc-type-edit span', (s) =>
    s.map((x) => [
      x.textContent,
      x.style.fontWeight,
      x.style.fontSize,
      x.style.fontFamily.split(',')[0],
      x.style.textDecoration,
      x.style.color || '-',
    ]),
  );

const PLAIN = ['400', '32px', 'system-ui', 'none', '-'];
const BRAVE = ['700', '48px', 'system-ui', 'none', '-'];
const NEW = ['400', '32px', 'system-ui', 'underline', '-'];
const WORLD = ['400', '32px', 'Georgia', 'none', 'rgb(220, 38, 38)'];

// Select `n` characters starting at offset `from` in the editor, and let the
// app's selectionchange handler (which tracks the range for the panels) run.
async function selectChars(page, from, n) {
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < from; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => getSelection().toString().length)).toBe(n);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

// A swatch from the Libraries window, opened and put away again without
// taking the caret.
async function pickSwatch(page, colour) {
  await page.evaluate(() => {
    const w = document.getElementById('sc-libraries');
    w.hidden = false;
    w.querySelector('[data-tab="swatches"]').click();
  });
  await parkLibraries(page);
  await page.click(`#sc-palette button[aria-label="${colour}"]`);
  await page.evaluate(() => (document.getElementById('sc-libraries').hidden = true));
}

async function setSize(page, v) {
  await page.click('.sc-ptabs [data-tab="character"]');
  const size = page.locator('.sc-char input[data-type="size"]');
  await size.fill(String(v));
  await size.press('Enter');
}

async function pickFont(page, query) {
  await page.click('.sc-options [data-fontpick]');
  await expect(page.locator('#sc-fontpop')).toBeVisible();
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-fontpop')).toBeHidden();
}

// "Hello brave new world" at (80, 150), editor left open.
async function startText(page) {
  await page.keyboard.press('t');
  await clickDoc(page, 80, 150);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Hello brave new world');
}

// "brave" bold 48, "world" red Georgia, "new" underlined.
async function styleRuns(page) {
  await selectChars(page, 6, 5);
  await page.selectOption('.sc-options select[data-type="style"]', '700');
  await setSize(page, 48);
  await selectChars(page, 16, 5);
  await pickSwatch(page, '#dc2626');
  await pickFont(page, 'georgia');
  await selectChars(page, 12, 3);
  await page.click('.sc-ptabs [data-tab="character"]');
  await page.click('.sc-char [data-type-toggle="underline"]');
}

// …plus a second line, committed.
async function makeRichText(page) {
  await startText(page);
  await styleRuns(page);
  await selectChars(page, 18, 0);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  await page.keyboard.press('Control+Enter');
  await expect(editor(page)).toHaveCount(0);
}

const textHtml = (page) =>
  page
    .locator('#sc-doc text')
    .first()
    .evaluate((t) => t.outerHTML);

test.describe('styling characters while editing', () => {
  test('the options-bar style menu bolds the selection and keeps editing', async ({ page }) => {
    await startText(page);
    await selectChars(page, 6, 5);
    await page.selectOption('.sc-options select[data-type="style"]', '700');
    await expect(editor(page)).toHaveCount(1);
    await setSize(page, 48);
    await expect(editor(page)).toHaveCount(1);
    expect(await spans(page)).toEqual([
      ['Hello ', ...PLAIN],
      ['brave', ...BRAVE],
      [' new world', ...PLAIN],
    ]);
  });

  test('swatch colour, font picker and underline each style their own run', async ({ page }) => {
    await startText(page);
    await styleRuns(page);
    expect(await spans(page)).toEqual([
      ['Hello ', ...PLAIN],
      ['brave', ...BRAVE],
      [' ', ...PLAIN],
      ['new', ...NEW],
      [' ', ...PLAIN],
      ['world', ...WORLD],
    ]);
  });

  test('the panels follow the characters under the caret', async ({ page }) => {
    await startText(page);
    await styleRuns(page);
    await selectChars(page, 8, 0);
    await expect(page.locator('.sc-char input[data-type="size"]')).toHaveValue('48');
    await expect(page.locator('.sc-char select[data-type="style"] option:checked')).toHaveText(
      'Bold',
    );
    await selectChars(page, 18, 0);
    await expect(page.locator('.sc-char [data-type-show="family"]')).toHaveText('Georgia');
    await expect.poll(() => page.evaluate(() => window.svgcraft.state.fill)).toBe('#dc2626');
  });
});

test.describe('committed rich text', () => {
  test('commits runs as nested tspans', async ({ page }) => {
    await makeRichText(page);
    const runs = await page.$$eval('#sc-doc text > tspan', (lines) =>
      lines.map((l) =>
        [...l.children].map((r) => ({
          text: r.textContent,
          run: r.hasAttribute('data-run'),
          weight: r.getAttribute('font-weight'),
          size: r.getAttribute('font-size'),
          family: r.getAttribute('font-family'),
          fill: r.getAttribute('fill'),
          deco: r.getAttribute('text-decoration'),
        })),
      ),
    );
    const run = (text, o = {}) => ({
      text,
      run: true,
      weight: null,
      size: null,
      family: null,
      fill: null,
      deco: 'none',
      ...o,
    });
    const world = { family: 'Georgia, serif', fill: '#dc2626' };
    expect(runs).toEqual([
      [
        run('Hello '),
        run('brave', { weight: '700', size: '48' }),
        run(' '),
        run('new', { deco: 'underline' }),
        run(' '),
        run('world', world),
      ],
      // The new line continues the run the caret was in.
      [run('second line', world)],
    ]);
    const t = await page.locator('#sc-doc text').evaluate((t) => ({
      size: t.getAttribute('font-size'),
      x: t.getAttribute('x'),
      y: t.getAttribute('y'),
    }));
    expect(t).toEqual({ size: '32', x: '80', y: '150' });
  });

  test('auto leading follows each line’s own largest size', async ({ page }) => {
    // The app's rule (layoutText: "auto leading = 120% of its largest size")
    // sets each line's baseline from the previous one by 1.2 × the
    // largest size *on that line*. "second line" is all 32px, so the gap is
    // 1.2 × 32 = 38.4 — the 48px "brave" above it doesn't push it down. (The
    // original check script expected 57.6 = 1.2 × 48, which contradicts this.)
    await makeRichText(page);
    const ys = await page.$$eval('#sc-doc text > tspan', (t) => t.map((s) => +s.getAttribute('y')));
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBe(150);
    expect(ys[1] - ys[0]).toBeCloseTo(38.4, 1);
  });

  test('re-editing keeps the runs; Esc leaves the content untouched', async ({ page }) => {
    await makeRichText(page);
    const svg = await textHtml(page);
    await page.keyboard.press('v');
    const r = await page.locator('#sc-doc text').boundingBox();
    await page.mouse.dblclick(r.x + 10, r.y + r.height / 3);
    await expect(editor(page)).toBeFocused();
    expect(await spans(page)).toEqual([
      ['Hello ', ...PLAIN],
      ['brave', ...BRAVE],
      [' ', ...PLAIN],
      ['new', ...NEW],
      [' ', ...PLAIN],
      ['world\nsecond line', ...WORLD],
    ]);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    expect(await textHtml(page)).toBe(svg);
  });
});

test.describe('whole-layer settings over runs', () => {
  test('layer size clears per-character sizes but keeps bold', async ({ page }) => {
    await makeRichText(page);
    await page.keyboard.press('v');
    await page.locator('#sc-layers li').first().click();
    await setSize(page, 24);
    const runs = await page.$$eval('#sc-doc tspan[data-run]', (t) =>
      t.map((r) => [r.textContent, r.getAttribute('font-size'), r.getAttribute('font-weight')]),
    );
    expect(runs).toEqual([
      ['Hello ', null, null],
      ['brave', null, '700'],
      [' ', null, null],
      ['new', null, null],
      [' ', null, null],
      ['world', null, null],
      ['second line', null, null],
    ]);
    expect(await page.locator('#sc-doc text').getAttribute('font-size')).toBe('24');
  });

  test('layer fill clears per-character fills', async ({ page }) => {
    await makeRichText(page);
    await page.keyboard.press('v');
    await page.locator('#sc-layers li').first().click();
    await pickSwatch(page, '#2563eb');
    await expect(page.locator('#sc-doc tspan[fill]')).toHaveCount(0);
    expect(await page.locator('#sc-doc text').getAttribute('fill')).toBe('#2563eb');
  });
});

test.describe('mixed-size paragraph text', () => {
  async function makeMixedParagraph(page) {
    await page.keyboard.press('t');
    const a = await toScreen(page, 80, 300);
    const z = await toScreen(page, 330, 450);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 4 });
    await page.mouse.up();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Small words then HUGE and more small words follow here');
    await selectChars(page, 17, 4);
    await setSize(page, 64);
    await page.keyboard.press('Control+Enter');
    await expect(editor(page)).toHaveCount(0);
  }

  test('wraps by real glyph widths and leads by each line’s largest size', async ({ page }) => {
    await makeMixedParagraph(page);
    const p = await page.evaluate(() => {
      const t = document.querySelector('#sc-doc text[data-box]');
      return {
        box: +t.dataset.box,
        size: +t.getAttribute('font-size'),
        lines: [...t.children].map((l) => ({
          text: l.textContent,
          width: l.getComputedTextLength(),
          y: +l.getAttribute('y'),
          big: !!l.querySelector('tspan[font-size="64"]'),
        })),
      };
    });
    // The box is the dragged width: 80 → 330.
    expect(p.box).toBeCloseTo(250, 0);
    expect(p.lines.map((l) => l.text).join(' ')).toBe(
      'Small words then HUGE and more small words follow here',
    );
    for (const l of p.lines) expect(l.width, l.text).toBeLessThanOrEqual(p.box + 0.5);
    const huge = p.lines.findIndex((l) => l.text.includes('HUGE'));
    expect(huge).toBeGreaterThan(0);
    expect(p.lines[huge].big).toBe(true);
    p.lines.slice(1).forEach((l, i) => {
      const gap = l.y - p.lines[i].y;
      expect(gap, `gap before "${l.text}"`).toBeCloseTo(1.2 * (l.big ? 64 : p.size), 1);
    });
  });

  test('export → reopen reproduces the runs exactly; undo still works', async ({ page }) => {
    await makeRichText(page);
    await makeMixedParagraph(page);
    const all = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#sc-doc text')].map((t) => t.outerHTML).join(''),
      );
    const before = await all();
    await page.evaluate(() => window.svgcraft.openSvg(window.svgcraft.serialize(), 'rt.svg'));
    expect(await all()).toBe(before);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#sc-doc text')).not.toHaveCount(0);
  });
});
