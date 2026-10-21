import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/', 'node_modules/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    files: ['app.js', 'icons.js', 'symbols-library.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // These run code in the page through Playwright, too.
    files: ['tests/**/*.js', '*.config.js', 'scripts/gen-about-screens.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
