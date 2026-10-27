// Errors and refusals stay on screen until dismissed (warn() in
// src/core.js), and an unexpected bug says so, with details to copy,
// instead of leaving a command silently half-done.
import { test, expect, load, action } from './fixtures.js';

const alert = (page) => page.locator('#sc-alert');

test('a refusal stays above the status bar until it’s dismissed', async ({ page }) => {
  await load(page, '<rect id="r" width="10" height="10"/>');
  // Its menu item is off with fewer than three selected; the command
  // itself still says why.
  await action(page, 'distributeH');
  await expect(alert(page)).toBeVisible();
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'Select three or more objects to distribute.',
  );
  await expect(page.locator('#sc-alert-copy')).toBeHidden();
  // Still there after news has come and gone in the status bar.
  await page.waitForTimeout(4000);
  await expect(alert(page)).toBeVisible();
  await page.click('#sc-alert-close');
  await expect(alert(page)).toBeHidden();
});

test('an unexpected bug says so, with details to copy', async ({ page, errors, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error('boom');
    }),
  );
  await expect(page.locator('#sc-alert-text')).toHaveText(
    'Something went wrong: boom. What you were doing may not have finished.',
  );
  await page.click('#sc-alert-copy');
  await expect(page.locator('#sc-msg')).toContainText('Copied the details');
  const report = await page.evaluate(() => navigator.clipboard.readText());
  // eslint-disable-next-line no-undef -- the editor's own global
  expect(report).toContain(`SVGCraft ${await page.evaluate(() => APP_VERSION)}`);
  expect(report).toContain('uncaught exception');
  expect(report).toMatch(/Error: boom\n\s+at /);
  // A promise that fails with nothing waiting for it is caught too.
  await page.evaluate(() => {
    Promise.reject(new Error('nope'));
  });
  await expect(page.locator('#sc-alert-text')).toContainText('Something went wrong: nope.');
  // These were on purpose: not failures of this test.
  expect(errors.splice(0).length).toBe(2);
});

test('a run of bugs shows only the first few', async ({ page, errors }) => {
  await page.evaluate(() => {
    for (let i = 1; i <= 8; i++)
      setTimeout(() => {
        throw new Error(`bug ${i}`);
      }, i * 20);
  });
  await page.waitForFunction(
    () =>
      window.__dummy === undefined &&
      document.getElementById('sc-alert-text').textContent.includes('bug 5'),
  );
  await page.waitForTimeout(300);
  await expect(page.locator('#sc-alert-text')).toContainText('bug 5');
  errors.splice(0);
});
