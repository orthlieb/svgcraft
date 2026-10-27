# Notes for working on SVGCraft

## Every feature has a help entry

Help → SVGCraft Help (F1, and the ? on dialogs and panels) opens
`help.html`, which is **generated** from `README.md` by
`node scripts/gen-help.mjs` (the README's sections from "Workspace" up to
"Development"; each top-level bullet with a bold name is a topic with its
own anchor).

- **A new feature** gets its own entry in the README, in the same branch:
  a bullet starting with its bold name in the right section, written for
  users.
- **A change to an existing feature** gets that feature's README entry
  edited to match, in the same branch.
- Then run `node scripts/gen-help.mjs` and commit `help.html` with it.
- A new dialog gets `data-help="<topic anchor>"` on its `<dialog>` (the ?
  appears in its title bar); a new panel tab gets an entry in `TAB_HELP`
  in `src/help.js`.

`tests/help.spec.js` fails while `help.html` is out of date with the README,
or while any ? points at a topic that doesn't exist.

## Before pushing

`npx prettier --check .`, `npx eslint .` and the full Playwright suite
(`npx playwright test`) all pass. Keep the About page (`about.html`) and its
screenshots (`node scripts/gen-about-screens.mjs`) in step with user-visible
changes too.
