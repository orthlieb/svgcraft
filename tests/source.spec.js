// View → SVG Source: the floating, read-only source window. It shows what
// Save as SVG writes, pretty-printed and highlighted, follows edits and the
// selection, and selects a layer when its start tag is clicked.
import fs from 'node:fs';
import { test, expect, load, menu } from './fixtures.js';

const win = (page) => page.locator('#sc-source');
// The view's text, line by line (line numbers are CSS, not text).
const viewText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#sc-src-code .sc-src-c')].map((c) => c.textContent).join('\n'),
  );
// Whitespace-insensitive form of markup, for comparing pretty-printed text.
const flat = (s) =>
  s
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/\s*(\/?>)/g, '$1')
    .trim();
const saved = (page) => page.evaluate(() => window.svgcraft.serialize({ fontCss: '' }));
const selIds = (page) => page.evaluate(() => window.svgcraft.state.sel.map((el) => el.id));
// Select layers the way the Layers panel does (setSel → drawSelection).
const pickLayer = (page, name) =>
  page.click(`#sc-layers li:has(.sc-layer-name:text-is("${name}"))`);

const BODY =
  '<rect id="a" x="10" y="10" width="100" height="80" fill="#c00"/>' +
  '<g id="g1" data-name="Group"><circle id="c" cx="200" cy="200" r="40" fill="#00c"/>' +
  '<ellipse id="e" cx="300" cy="100" rx="30" ry="20"/></g>';

async function openSource(page) {
  await menu(page, 'Window', 'toggleSource');
  await expect(win(page)).toBeVisible();
}

test('View → SVG Source opens a labelled window with focus on the source', async ({ page }) => {
  await load(page, BODY);
  await openSource(page);
  await expect(win(page)).toHaveAttribute('role', 'dialog');
  await expect(win(page)).toHaveAccessibleName('SVG Source');
  await expect(page.locator('#sc-src-code')).toBeFocused();
  await expect(page.locator('[data-action="toggleSource"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Line numbers count every line.
  const n = await page.locator('#sc-src-code .sc-src-ln').count();
  await expect(page.locator('#sc-src-code .sc-src-ln').last()).toHaveAttribute('data-n', String(n));
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
  await expect(page.locator('[data-action="toggleSource"]')).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('Ctrl+U toggles the window', async ({ page }) => {
  await load(page, BODY);
  await page.keyboard.press('Control+u');
  await expect(win(page)).toBeVisible();
  await page.keyboard.press('Control+u');
  await expect(win(page)).toBeHidden();
  await page.keyboard.press('Control+u');
  await expect(win(page)).toBeVisible();
  await page.click('#sc-src-close');
  await expect(win(page)).toBeHidden();
});

test('shows the saved markup, one element per line, indented by nesting', async ({ page }) => {
  // (The docked pane is narrow: a tag that doesn't fit has one attribute
  // per line, indented a level under it.)
  await load(page, BODY);
  await openSource(page);
  const text = await viewText(page);
  expect(flat(text)).toBe(flat(await saved(page)));
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^<svg/);
  const rect = lines.indexOf('  <rect');
  expect(lines.slice(rect + 1, rect + 7)).toEqual([
    '    id="a"',
    '    x="10"',
    '    y="10"',
    '    width="100"',
    '    height="80"',
    '    fill="#c00"/>',
  ]);
  expect(lines).toContain('    <circle');
  expect(lines).toContain('      id="c"');
  expect(lines.at(-1)).toBe('</svg>');
  // Highlighted: tags, attribute names and values have their own colours.
  const code = page.locator('#sc-src-code');
  await expect(code.locator('.sc-syn-tag', { hasText: 'circle' })).toHaveCount(1);
  await expect(code.locator('.sc-syn-attr', { hasText: 'fill' }).first()).toBeVisible();
  await expect(code.locator('.sc-syn-val', { hasText: '"#c00"' })).toHaveCount(1);
});

test('long attribute lists wrap, and the text is still the saved markup', async ({ page }) => {
  const d = 'M0 0 ' + Array.from({ length: 30 }, (_, i) => `L${i * 10} ${i * 7}`).join(' ');
  await load(
    page,
    `<path id="p" d="${d}" fill="none" stroke="#123456" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" data-name="A long one"/>`,
  );
  await openSource(page);
  const text = await viewText(page);
  expect(flat(text)).toBe(flat(await saved(page)));
  const pathLines = text.split('\n').filter((l) => /stroke-linejoin|<path/.test(l));
  expect(pathLines.length).toBe(2); // the tag continues on a later line
});

test('includes the font @import that Save as SVG writes', async ({ page }) => {
  await load(page, '<text id="t" x="10" y="50" font-family="Lobster" font-size="30">Hi</text>');
  await openSource(page);
  expect(await viewText(page)).toMatch(
    /<style>\n\s+@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Lobster/,
  );
});

test('CSS is coloured: selectors, at-rules, properties and values, nothing lost', async ({
  page,
}) => {
  const css =
    '@import url(a.css); @media (min-width: 4px) { .a, #b > c { fill: red; stroke: url(#g) } } ' +
    '/* note */ text { font: 12px "My Font", serif }';
  const toks = await page.evaluate((s) => window.cssTokens(s), css);
  // Exactly the text it was given.
  expect(toks.map((t) => t[1]).join('')).toBe(css);
  // Neighbouring pieces of one colour read as one.
  const runs = toks.reduce((rs, [c, t]) => {
    if (rs.length && rs.at(-1)[0] === c) rs.at(-1)[1] += t;
    else rs.push([c, t]);
    return rs;
  }, []);
  const of = (cls) =>
    runs
      .filter((r) => r[0] === cls)
      .map((r) => r[1].trim())
      .filter(Boolean);
  expect(of('at')).toEqual(['@import', '@media']);
  expect(of('sel')).toEqual(['.a', '#b > c', 'text']);
  expect(of('prop')).toEqual(['fill', 'stroke', 'font']);
  expect(of('cval')).toEqual([
    'url(a.css)',
    '(min-width: 4px)',
    'red',
    'url(#g)',
    '12px "My Font", serif',
  ]);
  expect(of('com')).toEqual(['/* note */']);

  // In the view: the font @import in <style>, and a style="" attribute.
  await load(
    page,
    '<text id="t" x="10" y="50" font-family="Lobster" font-size="30">Hi</text>' +
      '<rect id="m" width="9" height="9" style="mix-blend-mode:multiply;opacity:0.5"/>',
  );
  await openSource(page);
  const code = page.locator('#sc-src-code');
  await expect(code.locator('.sc-syn-at')).toHaveText(['@import']);
  await expect(code.locator('.sc-syn-prop')).toHaveText(['mix-blend-mode', 'opacity']);
  await expect(code.locator('.sc-syn-cval').filter({ hasText: 'multiply' })).toHaveCount(1);
  // And the text itself is unchanged, apart from the font @import that
  // Save as SVG adds (and the test's save leaves out).
  const view = flat(await viewText(page))
    .replace(/<defs><style>[^<]*<\/style><\/defs>/, '')
    .replace(/<style>[^<]*<\/style>/, '');
  // (Line breaks inside long values add only whitespace.)
  const noWs = (t) => t.replace(/\s+/g, '');
  expect(noWs(view)).toBe(noWs(flat(await saved(page))));
});

test('follows edits to the document', async ({ page }) => {
  await load(page, BODY);
  await openSource(page);
  await page.evaluate(() => {
    document.getElementById('a').setAttribute('fill', '#0a0');
    window.svgcraft.commit();
  });
  await expect.poll(() => viewText(page)).toContain('fill="#0a0"');
  expect(flat(await viewText(page))).toBe(flat(await saved(page)));
  await page.evaluate(() => window.svgcraft.undo());
  await expect.poll(() => viewText(page)).toContain('fill="#c00"');
});

test('keeps its scroll position across updates', async ({ page }) => {
  const many = Array.from(
    { length: 200 },
    (_, i) => `<rect id="r${i}" x="${i}" y="${i}" width="5" height="5"/>`,
  ).join('');
  await load(page, many);
  await openSource(page);
  await page.locator('#sc-src-code').evaluate((c) => (c.scrollTop = 1500));
  await page.evaluate(() => {
    document.getElementById('r0').setAttribute('fill', '#abc');
    window.svgcraft.commit();
  });
  await expect.poll(() => viewText(page)).toContain('fill="#abc"');
  expect(await page.locator('#sc-src-code').evaluate((c) => c.scrollTop)).toBe(1500);
});

test('the selected layer’s lines light up and scroll into view', async ({ page }) => {
  const many = Array.from(
    { length: 150 },
    (_, i) => `<rect id="r${i}" data-name="R${i}" x="${i}" y="${i}" width="5" height="5"/>`,
  ).join('');
  await load(page, many);
  await openSource(page);
  await pickLayer(page, 'R140');
  const on = page.locator('#sc-src-code .sc-src-on');
  // Its tag's lines, from <rect to />.
  await expect(on.first()).toHaveText('  <rect');
  await expect(on.filter({ hasText: 'id="r140"' })).toHaveCount(1);
  await expect(on.last()).toContainText('/>');
  await expect(on.first()).toBeInViewport();
  // A group lights up from its start tag to its end tag.
  await load(page, BODY);
  await pickLayer(page, 'Group');
  await expect(on.first()).toContainText('<g');
  await expect(on.filter({ hasText: 'id="e"' })).toHaveCount(1);
  await expect(on.last()).toHaveText('  </g>');
});

test('clicking a start tag selects that layer on the canvas', async ({ page }) => {
  await load(page, BODY);
  await openSource(page);
  const code = page.locator('#sc-src-code');
  await code.locator('.sc-src-ln', { hasText: '<circle' }).click();
  expect(await selIds(page)).toEqual(['c']);
  await expect(page.locator('#sc-layers li.sel .sc-layer-name')).toHaveText('circle #c');
  await expect(code.locator('.sc-src-on').first()).toHaveText('    <circle');
  await code.locator('.sc-src-ln', { hasText: '<rect' }).click();
  expect(await selIds(page)).toEqual(['a']);
  // The root <svg> isn't a layer: the selection stays.
  await code.locator('.sc-src-ln').first().click();
  expect(await selIds(page)).toEqual(['a']);
});

test('Copy puts the whole source on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, BODY);
  await openSource(page);
  await page.click('#sc-src-copy');
  await expect(page.locator('#sc-msg')).toHaveText('Copied the SVG source');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe((await viewText(page)) + '\n');
  expect(flat(clip)).toBe(flat(await saved(page)));
});

test('Download saves what is shown and leaves the tab unsaved', async ({ page }) => {
  await load(page, BODY);
  await page.evaluate(() => {
    document.getElementById('a').setAttribute('fill', '#0a0');
    window.svgcraft.commit();
  });
  const name = page.locator('#sc-doctabs .sc-doctab[aria-selected="true"] .sc-doctab-name');
  await expect(name).toContainText('test.svg*');
  await openSource(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sc-src-download')]);
  expect(dl.suggestedFilename()).toBe('test.svg');
  const file = fs.readFileSync(await dl.path(), 'utf8');
  expect(file).toBe((await viewText(page)) + '\n');
  await expect(name).toContainText('test.svg*');
});

test('document text is shown literally, never run as markup', async ({ page }) => {
  await page.evaluate(() => (window.__ran = false));
  await load(page, '<text id="t" x="10" y="50">x</text>');
  await page.evaluate(() => {
    document.getElementById('t').textContent =
      '<script>window.__ran = true</script><img src=x onerror="window.__ran=true"> & co';
    window.svgcraft.commit();
  });
  await openSource(page);
  const text = await viewText(page);
  expect(text).toContain(
    '&lt;script&gt;window.__ran = true&lt;/script&gt;&lt;img src=x onerror="window.__ran=true"&gt; &amp; co',
  );
  await expect(page.locator('#sc-src-code script, #sc-src-code img')).toHaveCount(0);
  await expect(page.locator('#sc-src-code .sc-syn-ent', { hasText: '&amp;' })).toHaveCount(1);
  expect(await page.evaluate(() => window.__ran)).toBe(false);
});

test('long data URIs are cut short on screen but copied in full', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const b64 = 'iVBORw0KGgo' + 'A'.repeat(5000) + 'END';
  await load(page, `<image id="im" width="10" height="10" href="data:image/png;base64,${b64}"/>`);
  await openSource(page);
  const text = await viewText(page);
  expect(text).toContain('data:image/png;base64,iVBORw0KGgo');
  expect(text).toContain('…');
  expect(text).not.toContain('END');
  expect(text.length).toBeLessThan(1000);
  await page.click('#sc-src-copy');
  await expect(page.locator('#sc-msg')).toHaveText('Copied the SVG source');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(`base64,${b64}"`);
  expect(flat(clip)).toBe(flat(await saved(page)));
});

test('Ctrl+F finds text in the source and Enter steps through matches', async ({ page }) => {
  await load(page, BODY);
  await openSource(page);
  const steps = page.locator('#sc-src-prev, #sc-src-next');
  // Nothing to step through yet: previous / next are off.
  for (const b of await steps.all()) await expect(b).toBeDisabled();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#sc-src-find')).toBeFocused();
  await page.keyboard.type('cx=');
  await expect(page.locator('#sc-src-count')).toHaveText('1 of 2');
  for (const b of await steps.all()) await expect(b).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-src-count')).toHaveText('2 of 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-src-count')).toHaveText('1 of 2');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#sc-src-count')).toHaveText('2 of 2');
  expect(await page.evaluate(() => CSS.highlights.get('sc-src-find').size)).toBe(2);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('nothing-like-this');
  await expect(page.locator('#sc-src-count')).toHaveText('No matches');
  for (const b of await steps.all()) await expect(b).toBeDisabled();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('rect');
  for (const b of await steps.all()) await expect(b).toBeEnabled();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  for (const b of await steps.all()) await expect(b).toBeDisabled();
  // Esc from the find box closes the window too.
  await page.keyboard.press('Escape');
  await expect(win(page)).toBeHidden();
});

test('keys inside the window do not edit the drawing', async ({ page }) => {
  await load(page, BODY);
  await openSource(page);
  await page.locator('#sc-src-code .sc-src-ln', { hasText: '<rect' }).click();
  await page.locator('#sc-src-code').focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sc-doc #a')).toHaveAttribute('x', '10');
  // Ctrl+A selects the source text, not the layers.
  await page.keyboard.press('Control+a');
  expect(await selIds(page)).toEqual(['a']);
  expect(await page.evaluate(() => getSelection().toString())).toMatch(/<rect\s+id="a"/);
});

test('Wrap is on to start and toggles line wrapping, remembered; floated, the title bar drags the window', async ({
  page,
}) => {
  await load(page, BODY);
  await openSource(page);
  await expect(page.locator('#sc-src-wrap')).toHaveAttribute('aria-pressed', 'true');
  await expect(win(page)).toHaveClass(/sc-src-wrap/);
  await page.click('#sc-src-wrap');
  await expect(page.locator('#sc-src-wrap')).toHaveAttribute('aria-pressed', 'false');
  await expect(win(page)).not.toHaveClass(/sc-src-wrap/);
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await load(page, BODY);
  await openSource(page);
  await expect(page.locator('#sc-src-wrap')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#sc-src-wrap');
  await expect(win(page)).toHaveClass(/sc-src-wrap/);
  await page.click('#sc-src-dock');
  const before = await win(page).boundingBox();
  const bar = await page.locator('#sc-src-title').boundingBox();
  await page.mouse.move(bar.x + 5, bar.y + 5);
  await page.mouse.down();
  await page.mouse.move(bar.x - 95, bar.y + 45, { steps: 4 });
  await page.mouse.up();
  const after = await win(page).boundingBox();
  expect(Math.round(after.x - before.x)).toBe(-100);
  expect(Math.round(after.y - before.y)).toBe(40);
});

test('a large drawing draws its lines as they come into view', async ({ page }) => {
  const many = Array.from(
    { length: 1200 },
    (_, i) =>
      `<rect id="r${i}" data-name="R${i}" x="${i % 700}" y="${i % 500}" width="5" height="5"/>`,
  ).join('');
  await load(page, many);
  await openSource(page);
  const rows = page.locator('#sc-src-code .sc-src-ln');
  const drawn = await rows.count();
  expect(drawn).toBeLessThan(1200);
  // The scroll range still covers every line.
  const h = await page.locator('#sc-src-code').evaluate((c) => c.scrollHeight);
  expect(h).toBeGreaterThan(1200 * 18);
  // Selecting the topmost layer draws and reveals its line at the end.
  await pickLayer(page, 'R1199');
  const on = page.locator('#sc-src-code .sc-src-on');
  await expect(on.filter({ hasText: 'id="r1199"' })).toHaveCount(1);
  await expect(on.filter({ hasText: 'id="r1199"' })).toBeInViewport();
  // Find reaches lines that weren't drawn yet.
  await page.keyboard.press('Control+u');
  await openSource(page);
  await page.fill('#sc-src-find', 'id="r1100"');
  await expect(page.locator('#sc-src-count')).toHaveText('1 of 1');
  await expect(rows.filter({ hasText: 'id="r1100"' })).toBeInViewport();
});

test('docked beside the canvas by default: a split view, sharing the column', async ({ page }) => {
  await load(page, BODY);
  const stageW = () => page.locator('#sc-stage').evaluate((s) => s.clientWidth);
  const full = await stageW();
  await openSource(page);
  // A pane in the dock column, and the canvas narrows to make room.
  expect(await win(page).evaluate((w) => w.parentNode.id)).toBe('sc-dock');
  expect(full - (await stageW())).toBeGreaterThanOrEqual(380);
  await expect(page.locator('#sc-src-dock')).toHaveAttribute('aria-label', 'Float');
  // Still live and linked to the canvas.
  await page.evaluate(() => window.svgcraft.state.sel.splice(0));
  await expect(page.locator('#sc-src-code')).toContainText('<svg');

  // With Icon Preview docked too, they stack: preview above, source below,
  // with a divider between them that moves the split.
  await menu(page, 'Window', 'toggleIconPreview');
  const order = () => page.$$eval('#sc-dock > :not([hidden])', (els) => els.map((e) => e.id));
  expect(await order()).toEqual(['sc-iconprev', 'sc-dock-divider', 'sc-source']);
  const h = () => page.locator('#sc-iconprev').evaluate((e) => e.offsetHeight);
  const h0 = await h();
  const d = await page.locator('#sc-dock-divider').boundingBox();
  await page.mouse.move(d.x + 50, d.y + 2);
  await page.mouse.down();
  await page.mouse.move(d.x + 50, d.y + 102, { steps: 4 });
  await page.mouse.up();
  expect(Math.abs((await h()) - (h0 + 100))).toBeLessThan(3);

  // Floated, the source leaves the column to the preview alone.
  await page.click('#sc-src-dock');
  expect(await win(page).evaluate((w) => w.parentNode === document.body)).toBe(true);
  expect(await order()).toEqual(['sc-iconprev']);
  // Remembered: it opens floating after a reload.
  await page.reload();
  await page.waitForFunction(() => !!window.svgcraft);
  await openSource(page);
  expect(await win(page).evaluate((w) => getComputedStyle(w).position)).toBe('fixed');
});

test('beautify: long values break where whitespace is free, one attribute per line, same drawing', async ({
  page,
}) => {
  const sub = (x) =>
    `M${x} 10c5 0 10 5 10 10s-5 10-10 10-10-5-10-10 5-10 10-10zm0 4c3 0 6 3 6 6s-3 6-6 6-6-3-6-6 3-6 6-6z`;
  const d = Array.from({ length: 12 }, (_, i) => sub(20 + i * 30)).join('');
  const pts = Array.from({ length: 40 }, (_, i) => `${i * 9},${200 + ((i * 37) % 60)}`).join(' ');
  await load(
    page,
    `<path id="p" d="${d}" fill="#2563eb" stroke="#000" stroke-width="2" stroke-linejoin="round"` +
      ` transform="translate(10 20) rotate(5 200 100) scale(1.1) skewX(3) translate(-4 -6)"/>` +
      `<polygon points="${pts}"/>`,
    420,
    300,
  );
  await page.keyboard.press('0');
  const before = await page.locator('#sc-stage').screenshot();
  await openSource(page);
  const text = await page.evaluate(() => srcView.full); // eslint-disable-line no-undef
  const lines = text.split('\n');
  // Nothing past the width.
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(100);
  // A tag that doesn't fit: one attribute per line.
  expect(lines.filter((l) => /^\s+stroke-linejoin="round"$/.test(l))).toHaveLength(1);
  // Path data: a line per absolute M (two packed subpaths fit on each).
  expect(lines.filter((l) => /^\s+M\d/.test(l)).length).toBeGreaterThanOrEqual(11);
  // Points: the lone attribute stays beside the tag, continued under its quote.
  const at = lines.findIndex((l) => l.includes('<polygon'));
  const q = lines[at].indexOf('"') + 1;
  expect(lines[at + 1].search(/\S/)).toBe(q);
  // The same drawing, reopened from the beautified text.
  await page.evaluate((t) => window.svgcraft.openSvg(t, 'again.svg'), text);
  await page.keyboard.press('Control+u');
  await expect(win(page)).toBeHidden();
  await page.keyboard.press('0');
  const after = await page.locator('#sc-stage').screenshot();
  expect(after.equals(before)).toBe(true);
});
