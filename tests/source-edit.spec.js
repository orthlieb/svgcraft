// SVG Source's Edit, and File → New from Text… which is the same on a new
// tab: the source as text, checked as it's typed (what's wrong, with its
// line and column), applied back to the drawing as one step.
import { test, expect, load, menu } from './fixtures.js';

const win = (page) => page.locator('#sc-source');
const text = (page) => page.locator('#sc-src-text');
const status = (page) => page.locator('#sc-src-status');
const apply = (page) => page.locator('#sc-src-apply');
const tabs = (page) => page.locator('#sc-doctabs .sc-doctab');
const layers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#sc-doc > *')].map(
      (n) => `${n.localName}${n.id ? '#' + n.id : ''}`,
    ),
  );

test('New from Text: paste shapes, see them read, Apply makes the drawing', async ({ page }) => {
  await menu(page, 'File', 'newFromText');
  await expect(win(page)).toBeVisible();
  await expect(text(page)).toBeFocused();
  await expect(text(page)).toHaveValue('');
  await expect(status(page)).toHaveText('Paste or type SVG code.');
  await expect(apply(page)).toBeDisabled();
  // Shapes on their own: put in an <svg> sized to fit them.
  await text(page).fill('<circle id="dot" cx="150" cy="80" r="30" fill="#c00"/>');
  await expect(status(page)).toHaveText('Put in an <svg>, sized to fit. Reads as SVG: 1 element.');
  await page.keyboard.press('Control+Enter');
  await expect(win(page)).toBeVisible();
  await expect(page.locator('#sc-src-editor')).toBeHidden();
  expect(await layers(page)).toEqual(['circle#dot']);
  const size = await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h]);
  expect(size).toEqual([60, 60]);
  await expect(page.locator('#sc-msg')).toHaveText('Made a new drawing from the text.');
  // Its own tab, not edited since: no *.
  await expect(tabs(page).last()).not.toContainText('*');
});

test('an error says where, a click selects that line, and Apply waits', async ({ page }) => {
  await menu(page, 'File', 'newFromText');
  await text(page).fill(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <g>\n    <rect width="10" height="10">\n  </g>\n</svg>',
  );
  await expect(status(page)).toContainText(/^Line 4, column \d+: /);
  await expect(status(page)).toHaveClass(/sc-src-bad/);
  await expect(apply(page)).toBeDisabled();
  await status(page).click();
  const sel = await text(page).evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(sel).toBe('  </g>');
  // Fixed: it reads, and Apply goes.
  await text(page).fill(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="r" width="10" height="10"/></svg>',
  );
  await expect(status(page)).toHaveText('Reads as SVG: 1 element.');
  await apply(page).click();
  expect(await layers(page)).toEqual(['rect#r']);
});

test('an <svg> inside an HTML page is taken out of it', async ({ page }) => {
  await menu(page, 'File', 'newFromText');
  await text(page).fill(
    '<!doctype html><html><body><h1>Logo</h1><svg viewBox="0 0 50 50"><rect id="in" width="20" height="20"/></svg></body></html>',
  );
  await expect(status(page)).toHaveText(
    'Took the <svg> out of the page around it. Reads as SVG: 1 element.',
  );
  await apply(page).click();
  expect(await layers(page)).toEqual(['rect#in']);
});

test('Cancel on New from Text leaves no empty tab behind', async ({ page }) => {
  const before = await tabs(page).count();
  await menu(page, 'File', 'newFromText');
  await expect(tabs(page)).toHaveCount(before + 1);
  await page.click('#sc-src-cancel');
  await expect(tabs(page)).toHaveCount(before);
  // Esc does the same.
  await menu(page, 'File', 'newFromText');
  await text(page).press('Escape');
  await expect(tabs(page)).toHaveCount(before);
});

test('Edit the source of a drawing: Apply changes it in place, one undo step', async ({ page }) => {
  await load(page, '<rect id="a" x="10" y="10" width="100" height="80" fill="#cc0000"/>');
  await menu(page, 'Window', 'toggleSource');
  const view = await page.evaluate(() => [window.svgcraft.state.zoom, window.svgcraft.state.panX]);
  await page.click('#sc-src-edit');
  await expect(text(page)).toBeFocused();
  expect(await text(page).inputValue()).toContain('fill="#cc0000"');
  await expect(apply(page)).toBeEnabled();
  // Ctrl+Z in the text undoes typing, not the drawing.
  await text(page).evaluate((t) => {
    t.value = t.value.replace('#cc0000', '#0000cc');
    t.dispatchEvent(new Event('input'));
  });
  await expect(apply(page)).toBeEnabled();
  await apply(page).click();
  await expect(page.locator('#sc-doc #a')).toHaveAttribute('fill', '#0000cc');
  // In place: same view, the tab marked changed, and one step back undoes it.
  expect(
    await page.evaluate(() => [window.svgcraft.state.zoom, window.svgcraft.state.panX]),
  ).toEqual(view);
  await expect(tabs(page).first()).toContainText('*');
  await expect(page.locator('#sc-history button.on')).toHaveText('Edit Source');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sc-doc #a')).toHaveAttribute('fill', '#cc0000');
});

test('Cancel leaves the drawing as it was; the source view comes back', async ({ page }) => {
  await load(page, '<rect id="a" width="10" height="10"/>');
  await menu(page, 'Window', 'toggleSource');
  await page.click('#sc-src-edit');
  await text(page).fill('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
  await page.click('#sc-src-cancel');
  await expect(page.locator('#sc-src-editor')).toBeHidden();
  await expect(page.locator('#sc-src-code')).toBeVisible();
  expect(await layers(page)).toEqual(['rect#a']);
  await expect(win(page)).toBeVisible();
});

test('scripts in pasted text are taken out, as when opening a file', async ({ page }) => {
  await menu(page, 'File', 'newFromText');
  await text(page).fill(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect id="r" width="5" height="5" onclick="alert(2)"/></svg>',
  );
  await apply(page).click();
  expect(await layers(page)).toEqual(['rect#r']);
  expect(await page.locator('#sc-doc #r').getAttribute('onclick')).toBeNull();
});

test('with nothing open, New from Text still works', async ({ page }) => {
  await page.click('.sc-doctab[aria-selected="true"] .sc-doctab-x');
  await expect(tabs(page)).toHaveCount(0);
  await menu(page, 'File', 'newFromText');
  await text(page).fill('<rect id="r" width="40" height="20"/>');
  await apply(page).click();
  expect(await layers(page)).toEqual(['rect#r']);
  await expect(tabs(page)).toHaveCount(1);
});
