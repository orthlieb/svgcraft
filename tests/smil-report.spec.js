// Animations an opened file has that SVGCraft can't keep: the warning's
// More info opens a report of each one, where it was, its markup, why it
// was left out, and the preset that came nearest.
import { test, expect } from './fixtures.js';

const open = (page, body) =>
  page.evaluate(
    (b) =>
      window.svgcraft.openSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${b}</svg>`,
        'anim.svg',
      ),
    body,
  );
const report = async (page) => {
  await page.click('#sc-alert-more');
  await expect(page.locator('#sc-smil-report')).toBeVisible();
  return page.locator('#sc-smil-list li').evaluateAll((lis) =>
    lis.map((li) => ({
      where: li.querySelector('.sc-smil-where').textContent,
      what: li.querySelector('.sc-smil-what').textContent,
      why: li.querySelector('p').textContent,
      near: li.querySelector('.sc-smil-near')?.textContent ?? null,
    })),
  );
};

test('a near miss names the preset and how it differs', async ({ page }) => {
  // A rotation with a third value no preset writes: 0 → 180 → 360 eased.
  await open(
    page,
    '<rect data-name="Card" x="10" y="10" width="40" height="40" fill="red">' +
      '<animateTransform attributeName="transform" type="rotate" values="0 30 30;90 30 30;360 30 30" dur="2s" repeatCount="indefinite"/>' +
      '</rect>',
  );
  await expect(page.locator('#sc-alert-text')).toHaveText(
    '1 animation in this file can’t be edited in SVGCraft, so it was left out.',
  );
  await expect(page.locator('#sc-alert-more')).toBeVisible();
  const [e] = await report(page);
  expect(e.where).toBe('Layer “Card”');
  expect(e.what).toContain('<animateTransform attributeName="transform" type="rotate"');
  expect(e.why).toBe('No preset writes exactly this.');
  expect(e.near).toBe(
    'Nearest preset: Spin: It has 3 values (0 30 30 → 90 30 30 → 360 30 30); Spin writes 2 (0 30 30 → 360 30 30).',
  );
  await page.click('#sc-smil-report-close');
  await expect(page.locator('#sc-smil-report')).toBeHidden();
});

test('each kind of loss says why', async ({ page }) => {
  await open(
    page,
    '<style>@keyframes wiggle { from { opacity: 0 } }</style>' +
      '<animate attributeName="opacity" values="0;1" dur="1s"/>' +
      '<animate href="#gone" attributeName="opacity" values="0;1" dur="1s"/>' +
      '<rect id="r" width="10" height="10">' +
      '<animate attributeName="x" values="0;10" dur="indefinite"/>' +
      '<animate attributeName="stroke-miterlimit" values="1;9" dur="1s"/>' +
      '</rect>',
  );
  await expect(page.locator('#sc-alert-text')).toHaveText(
    '5 animations in this file can’t be edited in SVGCraft, so they were left out.',
  );
  const list = await report(page);
  expect(list.map((e) => [e.where, e.why])).toEqual([
    [
      'A <style> block',
      'A CSS animation: SVGCraft keeps animations as SVG animation (SMIL) only, so CSS ones aren’t read.',
    ],
    ['The whole drawing', 'It animates the <svg> itself; SVGCraft animates the layers in it.'],
    ['The file', 'It animates #gone, which isn’t in the file.'],
    [
      'Layer “rect #r”',
      'Its timing (dur="indefinite") isn’t one SVGCraft can set: it needs a length (dur), a start in seconds or on a click or hover, and a whole number of repeats or forever.',
    ],
    ['Layer “rect #r”', 'No preset animates stroke-miterlimit.'],
  ]);
  expect(list[0].what).toBe('@keyframes wiggle { … }');
});

test('Copy report puts it all on the clipboard as text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(
    page,
    '<circle data-name="Dot" cx="50" cy="50" r="9"><animate attributeName="stroke-miterlimit" values="1;9" dur="1s"/></circle>',
  );
  await report(page);
  await page.click('#sc-smil-report-copy');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      'Animations left out: 1\n\n1. Layer “Dot”\n   <animate attributeName="stroke-miterlimit" values="1;9" dur="1s"/>\n   Why: No preset animates stroke-miterlimit.',
    );
});

test('a file can’t plant its own report', async ({ page }) => {
  await page.evaluate(() =>
    window.svgcraft.openSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-sc-smil-lost=\'[{"where":"x","what":"y","why":"z"}]\'><rect width="5" height="5"/></svg>',
      'x.svg',
    ),
  );
  await expect(page.locator('#sc-alert-text')).toHaveText('');
});
