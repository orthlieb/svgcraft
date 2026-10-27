// Writes src/version.js: SVGCraft's version, a hash of every file the app
// is made of (the ones the service worker keeps for offline use). A copy
// of SVGCraft that's running compares its version with the one on the
// server to know there's a newer one (src/update.js).
//
//   node scripts/gen-version.mjs                 write src/version.js
//   node scripts/gen-version.mjs --check         exit 1 if it's out of date
//   node scripts/gen-version.mjs --index         from the files staged to commit
//   node scripts/gen-version.mjs --check --ref X  check commit X's files
//
// The git hooks in .githooks run it (npm install turns them on): pre-commit
// writes it from what's being committed, and pre-push refuses to push to
// main a commit whose version is stale. CI checks it too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src/version.js');
// The files read from the working tree, the index (--index) or a commit
// (--ref X): git show :path and git show X:path.
const arg = process.argv.indexOf('--ref');
const tree = process.argv.includes('--index') ? '' : arg > 0 ? process.argv[arg + 1] : null;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28 });
const read = (f) =>
  tree == null ? fs.readFileSync(path.join(ROOT, f)) : git('show', `${tree}:${f}`);
const exists = (f) => {
  if (tree == null) return fs.existsSync(path.join(ROOT, f));
  try {
    git('cat-file', '-e', `${tree}:${f}`);
    return true;
  } catch {
    return false;
  }
};
const html = read('index.html').toString('utf8');
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
  .filter((f) => f !== 'src/version.js' && exists(f))
  .sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(`${f}\0`).update(read(f));
const version = hash.digest('hex').slice(0, 12);
const text = `// SVGCraft — The version: a hash of the app's files, written by
// scripts/gen-version.mjs. src/update.js compares it with the server's.
'use strict';

const APP_VERSION = '${version}';
`;
if (process.argv.includes('--check')) {
  const now = exists('src/version.js') ? read('src/version.js').toString('utf8') : '';
  if (now !== text) {
    console.error('src/version.js is out of date: run node scripts/gen-version.mjs');
    process.exit(1);
  }
  console.log(`src/version.js is up to date (${version})`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote src/version.js (${version}, ${files.length} files)`);
}
