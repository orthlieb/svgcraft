// SVGCraft — File → Export App Icons.
'use strict';

// ---- File → Export App Icons… --------------------------------------------------
// The drawing rendered at every size each platform asks for, in one zip:
//   web/      favicon.ico (16, 32, 48), favicon.svg, apple-touch-icon.png,
//             icon-192.png, icon-512.png, site.webmanifest, head.html
//   ios/      AppIcon.appiconset (one 1024 px icon and its Contents.json)
//   android/  res/: an adaptive icon (foreground, background, monochrome
//             layers and their XML), legacy square and round launcher
//             icons for every density; playstore-icon.png
//   macos/    AppIcon.icns, and AppIcon.iconset for iconutil
// Each size is drawn from the vector art, not scaled from a big bitmap.
// Icons that can't be transparent (iOS, the Apple touch icon) get a
// background colour; a non-square artboard is centred.

// Draws an SVG (the exported drawing, or one layer of it) into square
// PNGs. `box` is the square of document space that fills the PNG; `fill`
// paints a background first; `rgb` writes no alpha channel; `circle` clips
// to a circle; `mono` keeps only the shape (white, with its alpha).
async function svgRasterizer(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return async (size, { box = artSquare(), fill, rgb, circle, mono } = {}) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (circle) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
      ctx.clip();
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, size, size);
    }
    const k = size / box.w;
    ctx.drawImage(img, -box.x * k, -box.y * k, state.w * k, state.h * k);
    if (mono || rgb) {
      const d = ctx.getImageData(0, 0, size, size);
      if (rgb) return rgbPng(d);
      for (let p = 0; p < d.data.length; p += 4) d.data.fill(255, p, p + 3);
      ctx.putImageData(d, 0, 0);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG failed');
    return new Uint8Array(await blob.arrayBuffer());
  };
}
// The square around the artboard (a non-square one is centred in it).
function artSquare() {
  const side = Math.max(state.w, state.h);
  return { x: (state.w - side) / 2, y: (state.h - side) / 2, w: side };
}

// Android adaptive icons are two 108 dp layers: launchers show the middle
// 72 dp, masked to their own shape, and keep the middle 66 dp (the safe
// zone) whole. A top-level layer named "Background" is the background
// layer (otherwise it's a solid colour); everything else is the
// foreground. Artwork on a 108 dp canvas (New Icon's Android adaptive
// template, recognised by its guides at the visible area, 1/6 in) is
// used as it is; any other icon is fitted into the safe zone.
const BG_LAYER = /^\s*background\s*$/i;
function isAdaptiveArt() {
  if (state.w !== state.h) return false;
  const at = (axis) =>
    state.guides.some((g) => g.axis === axis && Math.abs(g.pos - state.w / 6) < 0.01);
  return at('x') && at('y');
}
// The drawing's SVG with or without its Background layer.
function layerSvg(text, keepBackground) {
  const d = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = d.documentElement;
  const bg = [...root.children].find((n) => BG_LAYER.test(n.getAttribute('data-name') || ''));
  if (!bg) return null;
  const meta = new Set(['defs', 'style', 'title', 'desc', 'metadata']);
  for (const n of [...root.children])
    if (keepBackground ? n !== bg && !meta.has(n.localName) : n === bg) n.remove();
  return new XMLSerializer().serializeToString(d);
}
const ANDROID_LAYER_SIZES = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
];
async function androidIcons(full, bg) {
  const adaptive = isAdaptiveArt();
  const fgText = layerSvg(full, false);
  const bgText = adaptive ? layerSvg(full, true) : null;
  const whole = await svgRasterizer(full);
  const fg = fgText ? await svgRasterizer(fgText) : whole;
  const back = bgText && (await svgRasterizer(bgText));
  // The 108 dp canvas, and the 72 dp a launcher shows, in document units.
  const art = artSquare();
  const side = adaptive ? art.w : (art.w * 108) / 66;
  const canvas = { x: art.x - (side - art.w) / 2, y: art.y - (side - art.w) / 2, w: side };
  const visible = { x: canvas.x + side / 6, y: canvas.y + side / 6, w: (side * 2) / 3 };
  const fill = back ? undefined : bg;
  const files = [];
  const res = (p) => `android/res/${p}`;
  for (const [d, s] of ANDROID_LAYER_SIZES) {
    files.push([res(`mipmap-${d}/ic_launcher_foreground.png`), await fg(s, { box: canvas })]);
    files.push([
      res(`mipmap-${d}/ic_launcher_monochrome.png`),
      await fg(s, { box: canvas, mono: true }),
    ]);
    if (back)
      files.push([res(`mipmap-${d}/ic_launcher_background.png`), await back(s, { box: canvas })]);
  }
  // Launchers before Android 8 use these: the visible area as it would
  // look, square and round (an ordinary icon keeps its own square look).
  for (const [d, s] of ANDROID_DENSITIES) {
    files.push([
      res(`mipmap-${d}/ic_launcher.png`),
      adaptive ? await whole(s, { box: visible, fill }) : await whole(s),
    ]);
    files.push([
      res(`mipmap-${d}/ic_launcher_round.png`),
      await whole(s, { box: visible, fill: adaptive ? fill : bg, circle: true }),
    ]);
  }
  const layers = [
    `    <background android:drawable="${back ? '@mipmap/ic_launcher_background' : '@color/ic_launcher_background'}"/>`,
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
    '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>',
  ];
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    ...layers,
    '</adaptive-icon>',
    '',
  ].join('\n');
  files.push([res('mipmap-anydpi-v26/ic_launcher.xml'), xml]);
  files.push([res('mipmap-anydpi-v26/ic_launcher_round.xml'), xml]);
  if (!back)
    files.push([
      res('values/ic_launcher_background.xml'),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        `    <color name="ic_launcher_background">${bg.toUpperCase()}</color>`,
        '</resources>',
        '',
      ].join('\n'),
    ]);
  files.push([
    'android/playstore-icon.png',
    adaptive ? await whole(512, { box: visible, fill }) : await whole(512),
  ]);
  return { files, adaptive, layered: !!back };
}

// A PNG with no alpha channel at all (colour type 2), which the App Store
// insists on for app icons; canvas.toBlob always writes one.
async function rgbPng({ width, height, data }) {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = data[i];
      raw[o++] = data[i + 1];
      raw[o++] = data[i + 2];
    }
  }
  const zlib = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const chunk = (type, body) => {
    const b = new Uint8Array(12 + body.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, body.length);
    b.set(new TextEncoder().encode(type), 4);
    b.set(body, 8);
    v.setUint32(8 + body.length, crc32(b.subarray(4, 8 + body.length)));
    return b;
  };
  const ihdr = new DataView(new ArrayBuffer(13));
  ihdr.setUint32(0, width);
  ihdr.setUint32(4, height);
  ihdr.setUint8(8, 8); // bit depth
  ihdr.setUint8(9, 2); // RGB
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', new Uint8Array(ihdr.buffer)),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array()),
  ]);
}

// Windows icon: a directory of PNG images (Vista and later read PNG).
function icoBytes(pngs) {
  const head = new DataView(new ArrayBuffer(6 + 16 * pngs.length));
  head.setUint16(2, 1, true);
  head.setUint16(4, pngs.length, true);
  let offset = head.byteLength;
  pngs.forEach(([size, data], i) => {
    const p = 6 + 16 * i;
    head.setUint8(p, size >= 256 ? 0 : size);
    head.setUint8(p + 1, size >= 256 ? 0 : size);
    head.setUint16(p + 4, 1, true); // planes
    head.setUint16(p + 6, 32, true); // bits per pixel
    head.setUint32(p + 8, data.length, true);
    head.setUint32(p + 12, offset, true);
    offset += data.length;
  });
  return concatBytes([new Uint8Array(head.buffer), ...pngs.map(([, d]) => d)]);
}
// Apple icon image: 'icns', then [type, length, PNG] blocks.
function icnsBytes(blocks) {
  const enc = new TextEncoder();
  const parts = [];
  for (const [type, data] of blocks) {
    const h = new DataView(new ArrayBuffer(8));
    enc.encode(type).forEach((b, i) => h.setUint8(i, b));
    h.setUint32(4, 8 + data.length);
    parts.push(new Uint8Array(h.buffer), data);
  }
  const total = 8 + parts.reduce((n, p) => n + p.length, 0);
  const h = new DataView(new ArrayBuffer(8));
  enc.encode('icns').forEach((b, i) => h.setUint8(i, b));
  h.setUint32(4, total);
  return concatBytes([new Uint8Array(h.buffer), ...parts]);
}
function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ANDROID_DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];
// macOS: the .iconset names iconutil expects, and the matching icns types.
const MAC_ICONSET = [
  [16, 'icon_16x16.png', 'icp4'],
  [32, 'icon_16x16@2x.png', 'ic11'],
  [32, 'icon_32x32.png', 'icp5'],
  [64, 'icon_32x32@2x.png', 'ic12'],
  [128, 'icon_128x128.png', 'ic07'],
  [256, 'icon_128x128@2x.png', 'ic13'],
  [256, 'icon_256x256.png', 'ic08'],
  [512, 'icon_256x256@2x.png', 'ic14'],
  [512, 'icon_512x512.png', 'ic09'],
  [1024, 'icon_512x512@2x.png', 'ic10'],
];

async function exportAppIcons({ web, ios, android, macos }, bg) {
  if (!web && !ios && !android && !macos) return say('Pick at least one platform.');
  say('Drawing the app icons…');
  const full = serialize({ fontCss: await embeddedFontCss(usedGoogleFonts()) });
  const cache = new Map();
  let draw;
  try {
    draw = await svgRasterizer(full);
  } catch {
    return say('App icon export failed: the drawing couldn’t be drawn as an image.');
  }
  // The whole drawing at a size, opaque (on the background colour) or not.
  const png = (size, opaque = false) => {
    const k = `${size}${opaque ? 'o' : ''}`;
    if (!cache.has(k)) cache.set(k, draw(size, opaque ? { fill: bg, rgb: true } : {}));
    return cache.get(k);
  };
  const name = state.fileName;
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const files = [];
  const readme = [`App icons for ${name}, exported by SVGCraft.`, ''];
  if (web) {
    files.push(
      [
        'web/favicon.ico',
        icoBytes([
          [16, await png(16)],
          [32, await png(32)],
          [48, await png(48)],
        ]),
      ],
      ['web/favicon.svg', serialize({ fontCss: fontImport() })],
      ['web/apple-touch-icon.png', await png(180, true)],
      ['web/icon-192.png', await png(192)],
      ['web/icon-512.png', await png(512)],
      [
        'web/site.webmanifest',
        json({
          name,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        }),
      ],
      [
        'web/head.html',
        [
          '<link rel="icon" href="/favicon.ico" sizes="32x32">',
          '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
          '<link rel="manifest" href="/site.webmanifest">',
          '',
        ].join('\n'),
      ],
    );
    readme.push("web/      Put these at your site root and add head.html to your pages' <head>.");
  }
  if (ios) {
    files.push(
      ['ios/AppIcon.appiconset/AppIcon-1024.png', await png(1024, true)],
      [
        'ios/AppIcon.appiconset/Contents.json',
        json({
          images: [
            {
              filename: 'AppIcon-1024.png',
              idiom: 'universal',
              platform: 'ios',
              size: '1024x1024',
            },
          ],
          info: { author: 'svgcraft', version: 1 },
        }),
      ],
    );
    readme.push(
      'ios/      Drag AppIcon.appiconset into your Xcode asset catalogue (Xcode 14+).',
      '          iOS rounds the corners itself.',
    );
  }
  if (android) {
    let a;
    try {
      a = await androidIcons(full, bg);
    } catch {
      return say('App icon export failed: the drawing couldn’t be drawn as an image.');
    }
    files.push(...a.files);
    readme.push(
      'android/  Copy res/ into app/src/main/ (it replaces ic_launcher). The adaptive icon',
      `          (Android 8+) has ${a.layered ? 'the Background layer as its background' : 'a solid background colour'}, the rest as foreground,`,
      '          and a monochrome layer for themed icons (Android 13+). ' +
        (a.adaptive ? 'The artwork fills' : 'The artwork sits in the safe zone of'),
      '          the 108 dp canvas. playstore-icon.png is for the Play Console.',
    );
  }
  if (macos) {
    const mac = [];
    for (const [s, file, type] of MAC_ICONSET) mac.push([s, file, type, await png(s)]);
    for (const [, file, , data] of mac) files.push([`macos/AppIcon.iconset/${file}`, data]);
    files.push(['macos/AppIcon.icns', icnsBytes(mac.map(([, , t, data]) => [t, data]))]);
    readme.push(
      'macos/    AppIcon.icns is ready to use; iconutil -c icns AppIcon.iconset rebuilds it.',
    );
  }
  files.push(['README.txt', readme.join('\n') + '\n']);
  download(zipBlob(files), `${name}-app-icons.zip`);
  say(`Exported ${name}-app-icons.zip.`);
}

const aiDlg = $('#sc-appicons');
function openAppIcons() {
  showDialog(aiDlg, () => closeAppIcons(false));
  setTimeout(() => aiDlg.querySelector('[data-ai-btn="ok"]').focus(), 0);
}
function closeAppIcons(ok) {
  hideDialog(aiDlg);
  if (!ok) return;
  const on = (k) => aiDlg.querySelector(`[data-ai="${k}"]`).checked;
  exportAppIcons(
    { web: on('web'), ios: on('ios'), android: on('android'), macos: on('macos') },
    $('#sc-ai-bg').value,
  );
}
aiDlg.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.target.closest('[data-ai-btn="cancel"]')) {
    e.preventDefault();
    closeAppIcons(true);
  } else if (e.key === 'Escape') closeAppIcons(false);
});
aiDlg.querySelector('[data-ai-btn="ok"]').addEventListener('click', () => closeAppIcons(true));
aiDlg.querySelector('[data-ai-btn="cancel"]').addEventListener('click', () => closeAppIcons(false));
