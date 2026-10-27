// Writes src/version.js: SVGCraft's version, a hash of every file the app
// is made of (the ones the service worker keeps for offline use). A copy
// of SVGCraft that's running compares its version with the one on the
// server to know there's a newer one (src/update.js).
//
//   node scripts/gen-version.mjs          write src/version.js
//   node scripts/gen-version.mjs --check  exit 1 if it's out of date
//
// Run it last, after any other generator, before committing a change to
// the app; tests/update.spec.js fails while it's stale.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src/version.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// As sw.js lists them: what index.html loads, and the other pages.
const files = [
  ...new Set([
    'index.html',
    'about.html',
    'help.html',
    'sw.js',
    'manifest.webmanifest',
    ...[...html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]),
  ]),
]
  .filter((f) => f !== 'src/version.js' && fs.existsSync(path.join(ROOT, f)))
  .sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(`${f}\0`).update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest('hex').slice(0, 12);
const text = `// SVGCraft — The version: a hash of the app's files, written by
// scripts/gen-version.mjs. src/update.js compares it with the server's.
'use strict';

const APP_VERSION = '${version}';
`;
if (process.argv.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (now !== text) {
    console.error('src/version.js is out of date: run node scripts/gen-version.mjs');
    process.exit(1);
  }
  console.log(`src/version.js is up to date (${version})`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote src/version.js (${version}, ${files.length} files)`);
}
