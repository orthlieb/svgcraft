// samples/: every sample file (scripts/gen-samples.mjs) opens in SVGCraft
// with its animations, nothing reported lost, and plays.
import { test, expect } from './fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../samples');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.svg'));

test('there are samples, and the gallery shows every one', () => {
  expect(files.length).toBeGreaterThan(20);
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  for (const f of files) expect(html, f).toContain(`src="${f}"`);
});

for (const f of files)
  test(`${f} opens with its animations`, async ({ page }) => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    expect(text).toMatch(/<(animate|animateTransform|animateMotion|set)\b/);
    await page.evaluate(([t, n]) => window.svgcraft.openSvg(t, n), [text, f]);
    expect(
      await page.evaluate(() => document.querySelectorAll('#sc-doc [data-sc-anim]').length),
    ).toBeGreaterThan(0);
    await expect(page.locator('#sc-alert')).toBeHidden();
    expect(
      await page.evaluate(
        () => !document.querySelector('[data-action="toggleAnimations"]').disabled,
      ),
    ).toBe(true);
  });
