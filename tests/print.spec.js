// File → Print… (Ctrl+P): a module loaded on first use. Each artboard
// prints on a page of its own at its real size, or fitted to the paper;
// the editor itself never prints. Checked by printing to PDF.
import { test, expect, load, action } from './fixtures.js';

const SCENE =
  '<rect id="a" x="10" y="10" width="80" height="80" fill="#dc2626"/>' +
  '<rect id="b" x="260" y="10" width="80" height="80" fill="#2563eb"/>';

// Page sizes in a PDF, in points (a CSS px is 0.75 pt).
const pdfPages = (buf) =>
  [...buf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [
    Math.round(+m[1]),
    Math.round(+m[2]),
  ]);

async function withBoards(page) {
  await load(page, SCENE, 200, 100);
  await page.evaluate(() => {
    window.svgcraft.state.boards.push({ name: 'Icon', x: 250, y: 0, w: 100, h: 100 });
  });
}

const prepare = (page, opts) =>
  page.evaluate(async (opts) => {
    // eslint-disable-next-line no-undef -- the editor's own globals
    await loadModule('src/print.js');
    // eslint-disable-next-line no-undef
    await preparePrint(opts);
  }, opts);

test('Print is loaded on first use; Ctrl+P opens it, not the browser’s print', async ({ page }) => {
  await load(page, SCENE, 200, 100);
  expect(await page.evaluate(() => typeof window.openPrint)).toBe('undefined');
  await expect(page.locator('script[src="src/print.js"]')).toHaveCount(0);
  await page.locator('#sc-stage').focus();
  await page.keyboard.press('Control+p');
  const dlg = page.locator('#sc-print-dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-pr-btn="ok"]')).toBeFocused();
  // One artboard: no choice of which.
  await expect(dlg.locator('[data-pr="all-label"]')).toHaveText('The drawing');
  await expect(dlg.locator('[name="sc-pr-which"][value="one"]')).toBeHidden();
  await dlg.locator('[data-pr-btn="cancel"]').click();
  await expect(dlg).toBeHidden();
});

test('each artboard prints on a page of its own, at its real size', async ({ page }) => {
  await withBoards(page);
  await prepare(page, { which: 'all' });
  // 200 × 100 px and 100 × 100 px: 150 × 75 pt and 75 × 75 pt.
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true }))).toEqual([
    [150, 75],
    [75, 75],
  ]);
  // Printed, the pages are put away again.
  await expect(page.locator('#sc-print')).toHaveCount(0);
  // The editor isn't printed: only the pages show to print media.
  await prepare(page, { which: 'all' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sc-menubar')).toBeHidden();
  await expect(page.locator('#sc-print .sc-print-page')).toHaveCount(2);
});

test('just one artboard, or fitted to the paper', async ({ page }) => {
  await withBoards(page);
  await prepare(page, { which: 'one', board: 1 });
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true }))).toEqual([[75, 75]]);
  // Fitted: the printer's paper (A4 here), one page per artboard.
  await prepare(page, { which: 'all', fit: true });
  expect(pdfPages(await page.pdf({ format: 'A4' }))).toEqual([
    [596, 843],
    [596, 843],
  ]);
});

test('the dialog offers each artboard by name', async ({ page }) => {
  await withBoards(page);
  await action(page, 'print');
  const dlg = page.locator('#sc-print-dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-pr="all-label"]')).toHaveText('All 2 artboards');
  await expect(dlg.locator('[data-pr="board"] option')).toHaveText(['Artboard 1', 'Icon']);
});
