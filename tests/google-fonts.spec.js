import { test, expect, load } from './fixtures.js';

// The font picker's full Google Fonts catalogue (google-fonts.js): every
// family with the styles it really ships, browsable by category and
// searchable, and recognised in drawings opened from elsewhere. Google's
// servers are blocked in tests, so these check the requests the app makes.

const TEXT =
  '<text id="t" x="20" y="60" font-size="40" font-family="\'Fredoka\', sans-serif" font-weight="500">Hello</text>';
const links = (page, part) =>
  page.evaluate(
    (part) =>
      [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map((l) => l.href)
        .filter((h) => h.includes(part)),
    part,
  );
async function openPicker(page) {
  await page.keyboard.press('v');
  await page.locator('#sc-layers li', { hasText: 'Hello' }).click();
  await page.click('.sc-ptabs [data-tab="character"]');
  await page.click('.sc-char [data-fontpick]');
  await expect(page.locator('#sc-fontpop')).toBeVisible();
}
const styles = (page) =>
  page.locator('.sc-char select[data-type="style"] option').allTextContents();

test.beforeEach(async ({ page }) => {
  await load(page, TEXT, 400, 200);
});

test('a drawing in any Google family loads it and offers its own styles', async ({ page }) => {
  // Fredoka isn't one of the popular families.
  expect(await links(page, 'family=Fredoka:wght@300;400;500;600;700&')).toHaveLength(1);
  await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-char [data-fontpick]')).toContainText('Fredoka');
  expect(await styles(page)).toEqual(['Light', 'Regular', 'Medium', 'SemiBold', 'Bold']);
  // Saving links it, so the file draws right elsewhere.
  // eslint-disable-next-line no-undef -- the editor's own global
  expect(await page.evaluate(() => window.svgcraft.serialize({ fontCss: fontImport() }))).toContain(
    'family=Fredoka:wght@300;400;500;600;700',
  );
});

test('search finds any family, best match first; italics only where they exist', async ({
  page,
}) => {
  await openPicker(page);
  await page.keyboard.type('lekt');
  await expect(page.locator('.sc-font-item').first()).toHaveText('Lekton');
  await expect(page.locator('.sc-font-head').first()).toHaveText('Google Fonts · 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sc-fontpop')).toBeHidden();
  expect(await page.locator('#t').getAttribute('font-family')).toBe("'Lekton', monospace");
  // Lekton has Regular, Bold and Italic, but no Bold Italic.
  expect(await styles(page)).toEqual(['Regular', 'Bold', 'Italic']);
  expect(await links(page, 'family=Lekton:ital,wght@0,400;0,700;1,400&')).toHaveLength(1);

  // A word inside a name matches, ranked after names that start with it.
  await page.click('.sc-char [data-fontpick]');
  await page.keyboard.type('mono');
  const names = await page.locator('.sc-font-item').allTextContents();
  expect(names.indexOf('Monoton')).toBeLessThan(names.indexOf('Roboto Mono'));
  expect(names).toContain('JetBrains Mono');
});

test('categories browse the whole catalogue; names load their preview as they show', async ({
  page,
}) => {
  await openPicker(page);
  await expect(page.locator('.sc-font-head')).toHaveText(['System fonts', 'Popular Google Fonts']);
  await page.click('[data-font-cat="h"]');
  await expect(page.locator('[data-font-cat="h"]')).toHaveAttribute('aria-checked', 'true');
  const head = page.locator('.sc-font-head').first();
  await expect(head).toHaveText(/^Handwriting · \d{3}$/);
  const total = +(await head.textContent()).split('· ')[1];
  expect(total).toBeGreaterThan(300);
  // Long lists stop at 150 rows, with a note.
  await expect(page.locator('.sc-font-item')).toHaveCount(150);
  await expect(page.locator('.sc-font-head').last()).toHaveText(
    `${total - 150} more: type to narrow them down`,
  );
  // The first rows' names have been asked for, in their own face and cut
  // down to their letters; the rows far below haven't.
  await expect.poll(() => links(page, 'text=')).not.toHaveLength(0);
  const asked = (await links(page, 'text=')).join(' ');
  const first = await page.locator('.sc-font-item').first().textContent();
  expect(asked).toContain(`family=${first.replace(/ /g, '+')}:wght@`);
  const last = await page.locator('.sc-font-item').last().textContent();
  expect(asked).not.toContain(`family=${last.replace(/ /g, '+')}:`);
  // Search within a category.
  await page.keyboard.type('vibes');
  await expect(page.locator('.sc-font-item')).toHaveText(['Great Vibes']);
});
