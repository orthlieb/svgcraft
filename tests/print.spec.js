// File → Print… (Ctrl+P): a module loaded on first use. The canvas prints
// at its real size, or fitted to the paper; the editor itself never prints. Checked by printing to PDF.
import { test, expect, load } from './fixtures.js';

const SCENE =
  '<rect id="a" x="10" y="10" width="80" height="80" fill="#dc2626"/>' +
  '<rect id="b" x="260" y="10" width="80" height="80" fill="#2563eb"/>';

// Page sizes in a PDF, in points (a CSS px is 0.75 pt).
const pdfPages = (buf) =>
  [...buf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [
    Math.round(+m[1]),
    Math.round(+m[2]),
  ]);

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
  await dlg.locator('[data-pr-btn="cancel"]').click();
  await expect(dlg).toBeHidden();
});

test('the canvas prints at its real size, or fitted to the paper', async ({ page }) => {
  await load(page, SCENE, 200, 100);
  await prepare(page, {});
  // 200 × 100 px: 150 × 75 pt.
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true }))).toEqual([[150, 75]]);
  // Printed, the page is put away again.
  await expect(page.locator('#sc-print')).toHaveCount(0);
  // The editor isn't printed: only the page shows to print media.
  await prepare(page, {});
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sc-menubar')).toBeHidden();
  await expect(page.locator('#sc-print .sc-print-page')).toHaveCount(1);
  await page.emulateMedia({ media: 'screen' });
  // Fitted: the printer's paper (A4 here).
  await prepare(page, { fit: true });
  expect(pdfPages(await page.pdf({ format: 'A4' }))).toEqual([[596, 843]]);
});
