import fs from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';

// The editor is classic scripts in src/ that share one scope (see
// index.html), so each file may use what the others declare at the top
// level. Each file gets the others' top-level names as globals: let and
// var ones writable, the rest read-only.
const TOP = /^(?:async\s+)?function\*?\s+([\w$]+)|^(const|let|var|class)\s+([\w$]+)/gm;
const srcFiles = fs.readdirSync('src').filter((f) => f.endsWith('.js'));
const declared = Object.fromEntries(
  srcFiles.map((f) => {
    const names = {};
    for (const m of fs.readFileSync(`src/${f}`, 'utf8').matchAll(TOP))
      names[m[1] || m[3]] = m[2] === 'let' || m[2] === 'var' ? 'writable' : 'readonly';
    return [f, names];
  }),
);

// Two files declaring the same name would stop the second from loading.
const seen = {};
for (const [f, names] of Object.entries(declared))
  for (const n of Object.keys(names)) {
    if (seen[n]) throw new Error(`src/${f} and src/${seen[n]} both declare ${n}`);
    seen[n] = f;
  }

export default [
  { ignores: ['vendor/', 'node_modules/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'icons.js', 'symbols-library.js', 'google-fonts.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  ...srcFiles.map((f) => ({
    files: [`src/${f}`],
    languageOptions: {
      globals: Object.assign({}, ...srcFiles.filter((g) => g !== f).map((g) => declared[g])),
    },
    // A top-level name used only by another file isn't unused.
    rules: { 'no-unused-vars': ['error', { vars: 'local' }] },
  })),
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // These run code in the page through Playwright, too.
    files: ['tests/**/*.js', '*.config.js', 'scripts/gen-about-screens.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
