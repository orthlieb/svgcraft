// File → New from PDF…: page previews, the page picked, and three ways in:
// shapes and editable text, text as outlines, or a picture of the page;
// what doesn't come across is named.
import { test, expect } from './fixtures.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Two pages, printed to a PDF by the browser: shapes and text on the first,
// and a gradient (which the converter can't do) on the second.
const PAGES =
  '<style>@page{size:600px 400px;margin:0}body{margin:0}div{width:600px;height:400px;page-break-after:always}</style>' +
  '<div><svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="30" y="30" width="240" height="160" fill="#2563eb"/>' +
  '<text x="40" y="300" font-family="Georgia" font-size="44" fill="#0f2b39">Page one</text></svg></div>' +
  '<div><svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><linearGradient id="g"><stop offset="0" stop-color="#f59e0b"/>' +
  '<stop offset="1" stop-color="#2563eb"/></linearGradient><rect width="300" height="300" fill="url(#g)"/></svg></div>';
let PDF;
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.setContent(PAGES);
  PDF = path.join(os.tmpdir(), `sc-test-${process.pid}.pdf`);
  await page.pdf({ path: PDF, width: '600px', height: '400px', printBackground: true });
  await page.close();
});
test.afterAll(() => fs.rmSync(PDF, { force: true }));

async function openPdf(page, file = PDF) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate(() => window.svgcraft.actions.newFromPdf()),
  ]);
  await chooser.setFiles(file);
}
const as = (page, v) => page.check(`input[name="sc-pdf-as"][value="${v}"]`);
const activeTab = (page) => page.locator('#sc-doctabs [aria-selected="true"]');

test('New from PDF previews the pages and opens the one picked, with editable text', async ({
  page,
}) => {
  await openPdf(page);
  const dlg = page.locator('#sc-pdfnew');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#sc-pdf-file')).toHaveText(/: 2 pages/);
  await expect(page.locator('.sc-pdf-page')).toHaveCount(2);
  // The previews are drawn.
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.sc-pdf-page canvas').width))
    .toBeGreaterThan(1);
  await expect(page.locator('.sc-pdf-page').first()).toHaveAttribute('aria-selected', 'true');
  await as(page, 'text');
  await page.click('#sc-pdf-open');
  await expect(dlg).toBeHidden();
  await expect(activeTab(page)).toContainText('p1');
  // Real letters, spaces put back; in the font the PDF names, or a like one.
  await expect(page.locator('#sc-doc text')).toHaveText('Page one');
  expect(await page.locator('#sc-doc tspan').first().getAttribute('font-family')).toMatch(/serif/);
  // The page's size, in pixels.
  expect(await page.evaluate(() => [window.svgcraft.state.w, window.svgcraft.state.h])).toEqual([
    600, 400,
  ]);
  await expect(page.locator('#sc-doc path').first()).toBeAttached();
});

test('text as outlines, and a picture of the page', async ({ page }) => {
  await openPdf(page);
  await as(page, 'outlines');
  await page.click('#sc-pdf-open');
  await expect(activeTab(page)).toContainText('p1');
  await expect(page.locator('#sc-doc text')).toHaveCount(0);
  await expect(page.locator('#sc-doc path[fill="#0f2b39"]')).toHaveCount(1);

  await openPdf(page);
  // The last choice is remembered while the page is open.
  await expect(page.locator('input[name="sc-pdf-as"][value="outlines"]')).toBeChecked();
  await page.click('.sc-pdf-page[data-page="2"]');
  await as(page, 'picture');
  await page.locator('.sc-pdf-page[data-page="2"]').dblclick();
  await expect(activeTab(page)).toContainText('p2');
  await expect(page.locator('#sc-doc image')).toHaveCount(1);
  await expect(page.locator('#sc-doc path')).toHaveCount(0);
});

test('what doesn’t come across is named; a file that isn’t a PDF says so', async ({ page }) => {
  await openPdf(page);
  await page.click('.sc-pdf-page[data-page="2"]');
  await as(page, 'text');
  await page.click('#sc-pdf-open');
  await expect(page.locator('#sc-alert-text')).toContainText('gradients');
  await expect(page.locator('#sc-alert-text')).toContainText('picture of the page');

  const bad = path.join(os.tmpdir(), `sc-test-${process.pid}-bad.pdf`);
  fs.writeFileSync(bad, 'not a pdf');
  await openPdf(page, bad);
  await expect(page.locator('#sc-alert-text')).toContainText('couldn’t be read as a PDF');
  await expect(page.locator('#sc-pdfnew')).toBeHidden();
  fs.rmSync(bad);
});
