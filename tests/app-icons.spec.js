import fs from 'node:fs';
import { test, expect, load, menu } from './fixtures.js';
import { readZip } from './zip.js';

// File → Export App Icons…: every size each platform needs, in one zip.

const DOT = '<circle cx="32" cy="32" r="28" fill="#2563eb"/>';
const dialog = (page) => page.locator('#sc-appicons');

// Export with some platforms switched off; returns the zip's files.
async function exportIcons(page, { off = [], bg } = {}) {
  await menu(page, 'File', 'exportAppIcons');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-ai-btn="ok"]')).toBeFocused();
  for (const k of off) await dialog(page).locator(`[data-ai="${k}"]`).uncheck();
  if (bg) await page.locator('#sc-ai-bg').fill(bg);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    dialog(page).locator('[data-ai-btn="ok"]').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('icon-app-icons.zip');
  return readZip(fs.readFileSync(await dl.path()));
}
// A PNG's width, height and colour type (2 = RGB, 6 = RGBA).
const png = (b) => {
  expect(b.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]];
};
// Decode a PNG in the page and read pixels: [[x, y], …] → [r, g, b, a] each.
const pixels = (page, b, pts) =>
  page.evaluate(
    async ([b64, pts]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    [b.toString('base64'), pts],
  );

test.beforeEach(({ page }) => load(page, DOT, 64, 64, 'icon.svg'));

test('every platform, every size', async ({ page }) => {
  const z = await exportIcons(page);
  expect(Object.keys(z)).toEqual([
    'web/favicon.ico',
    'web/favicon.svg',
    'web/apple-touch-icon.png',
    'web/icon-192.png',
    'web/icon-512.png',
    'web/site.webmanifest',
    'web/head.html',
    'ios/AppIcon.appiconset/AppIcon-1024.png',
    'ios/AppIcon.appiconset/Contents.json',
    'android/res/mipmap-mdpi/ic_launcher.png',
    'android/res/mipmap-hdpi/ic_launcher.png',
    'android/res/mipmap-xhdpi/ic_launcher.png',
    'android/res/mipmap-xxhdpi/ic_launcher.png',
    'android/res/mipmap-xxxhdpi/ic_launcher.png',
    'android/playstore-icon.png',
    'macos/AppIcon.iconset/icon_16x16.png',
    'macos/AppIcon.iconset/icon_16x16@2x.png',
    'macos/AppIcon.iconset/icon_32x32.png',
    'macos/AppIcon.iconset/icon_32x32@2x.png',
    'macos/AppIcon.iconset/icon_128x128.png',
    'macos/AppIcon.iconset/icon_128x128@2x.png',
    'macos/AppIcon.iconset/icon_256x256.png',
    'macos/AppIcon.iconset/icon_256x256@2x.png',
    'macos/AppIcon.iconset/icon_512x512.png',
    'macos/AppIcon.iconset/icon_512x512@2x.png',
    'macos/AppIcon.icns',
    'README.txt',
  ]);
  const sizes = {
    'web/apple-touch-icon.png': 180,
    'web/icon-192.png': 192,
    'web/icon-512.png': 512,
    'ios/AppIcon.appiconset/AppIcon-1024.png': 1024,
    'android/res/mipmap-mdpi/ic_launcher.png': 48,
    'android/res/mipmap-xxxhdpi/ic_launcher.png': 192,
    'android/playstore-icon.png': 512,
    'macos/AppIcon.iconset/icon_16x16@2x.png': 32,
    'macos/AppIcon.iconset/icon_512x512@2x.png': 1024,
  };
  for (const [f, s] of Object.entries(sizes)) expect(png(z[f]).slice(0, 2), f).toEqual([s, s]);

  // favicon.ico: a directory of 16, 32 and 48 px PNGs.
  const ico = z['web/favicon.ico'];
  expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]);
  for (let i = 0; i < 3; i++) {
    const at = 6 + 16 * i;
    const off = ico.readUInt32LE(at + 12);
    const img = ico.subarray(off, off + ico.readUInt32LE(at + 8));
    expect(png(img).slice(0, 2)).toEqual([ico[at], ico[at]]);
  }
  expect([0, 1, 2].map((i) => ico[6 + 16 * i])).toEqual([16, 32, 48]);

  // AppIcon.icns: 'icns', its length, then typed PNG blocks.
  const icns = z['macos/AppIcon.icns'];
  expect(icns.toString('latin1', 0, 4)).toBe('icns');
  expect(icns.readUInt32BE(4)).toBe(icns.length);
  const types = [];
  for (let p = 8; p < icns.length; p += icns.readUInt32BE(p + 4)) {
    types.push(icns.toString('latin1', p, p + 4));
    png(icns.subarray(p + 8, p + icns.readUInt32BE(p + 4)));
  }
  expect(types).toEqual([
    'icp4',
    'ic11',
    'icp5',
    'ic12',
    'ic07',
    'ic13',
    'ic08',
    'ic14',
    'ic09',
    'ic10',
  ]);

  // Web: the manifest and the <head> snippet point at the files.
  expect(JSON.parse(z['web/site.webmanifest'])).toEqual({
    name: 'icon',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
  expect(z['web/head.html'].toString()).toContain(
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  );
  expect(z['web/favicon.svg'].toString()).toContain('fill="#2563eb"');
  // iOS: the asset catalogue's single universal icon.
  expect(JSON.parse(z['ios/AppIcon.appiconset/Contents.json']).images).toEqual([
    { filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
  ]);
  expect(z['README.txt'].toString()).toContain('Xcode');
  await expect(page.locator('#sc-msg')).toHaveText('Exported icon-app-icons.zip.');
});

test('iOS and the Apple touch icon are opaque, on the background colour', async ({ page }) => {
  const z = await exportIcons(page, { bg: '#ff0000' });
  for (const f of ['ios/AppIcon.appiconset/AppIcon-1024.png', 'web/apple-touch-icon.png']) {
    // Colour type 2: no alpha channel at all, as the App Store requires.
    expect(png(z[f])[2], f).toBe(2);
    const [corner, middle] = await pixels(page, z[f], [
      [1, 1],
      [png(z[f])[0] / 2, png(z[f])[0] / 2],
    ]);
    expect(corner).toEqual([255, 0, 0, 255]);
    expect(middle).toEqual([37, 99, 235, 255]);
  }
  // The others keep their transparency.
  const f = 'android/playstore-icon.png';
  expect(png(z[f])[2]).toBe(6);
  expect((await pixels(page, z[f], [[1, 1]]))[0][3]).toBe(0);
});

test('only the platforms picked; a wide artboard is centred', async ({ page }) => {
  await load(page, '<rect width="128" height="64" fill="#16a34a"/>', 128, 64, 'icon.svg');
  const z = await exportIcons(page, { off: ['web', 'ios', 'macos'] });
  expect(Object.keys(z).every((f) => f.startsWith('android/') || f === 'README.txt')).toBe(true);
  const icon = z['android/playstore-icon.png'];
  const [top, mid, bottom] = await pixels(page, icon, [
    [256, 100],
    [256, 256],
    [256, 400],
  ]);
  expect(top[3]).toBe(0);
  expect(mid).toEqual([22, 163, 74, 255]);
  expect(bottom[3]).toBe(0);
  expect(z['README.txt'].toString()).not.toContain('Xcode');
});

test('nothing picked: nothing exported; Esc cancels', async ({ page }) => {
  await menu(page, 'File', 'exportAppIcons');
  for (const k of ['web', 'ios', 'android', 'macos'])
    await dialog(page).locator(`[data-ai="${k}"]`).uncheck();
  await dialog(page).locator('[data-ai-btn="ok"]').click();
  await expect(page.locator('#sc-msg')).toHaveText('Pick at least one platform.');
  await menu(page, 'File', 'exportAppIcons');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});
