import { test, expect, load, select } from './fixtures.js';

test('Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo', async ({ page }) => {
  await load(page, '<rect id="a" x="10" y="10" width="50" height="50"/>');
  await select(page, 'a');
  const count = () => page.locator('#sc-doc rect').count();
  await page.keyboard.press('Control+d');
  expect(await count()).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(1);
  await page.keyboard.press('Control+y');
  expect(await count()).toBe(2);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+Z');
  expect(await count()).toBe(2);
});
