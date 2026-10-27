# Notes for working on SVGCraft

## Every feature has a help entry

Help → SVGCraft Help (F1, and the ? on dialogs and panels) opens
`help.html`, which is **generated** from `README.md` by
`node scripts/gen-help.mjs` (the README's sections from "Workspace" up to
"Development"; each `###` heading is a topic with its own anchor).

- **A new feature** gets its own `###` topic in the README, in the same
  branch, in the right section, written for users as a how-to:
  1. a screenshot first: `![what it shows](docs/help/<anchor>.png)`;
  2. one sentence on what it's for;
  3. how to do it, as numbered steps (or short "do this → get that"
     bullets);
  4. `####` sub-headings for the settings (one bullet per control, by its
     UI name), tips and "Good to know", with the technical detail last.
- **The screenshot** is scripted, not hand-made: add a shot with the
  topic's anchor as its id to `scripts/help-screens/*.mjs` (see
  `scripts/gen-help-screens.mjs` for the helpers) and run
  `node scripts/gen-help-screens.mjs <anchor>`. Crop to the dialog, panel or
  part of the canvas being discussed, and look at the PNG before committing.
- **A change to an existing feature** gets that topic edited to match, and
  its screenshot retaken if what it shows changed, in the same branch.
- Then run `node scripts/gen-help.mjs` and commit `help.html` with it.
- A new dialog gets `data-help="<topic anchor>"` on its `<dialog>` (the ?
  appears in its title bar); a new panel tab gets an entry in `TAB_HELP`
  in `src/help.js`.
- Markdown the generator reads: paragraphs, `####`, an image on its own
  line, tables, `- ` and `1. ` lists (with indented blocks inside items),
  `**bold**`, `` `code` `` and links.

`tests/help.spec.js` fails while `help.html` is out of date with the README,
a topic has no screenshot, a screenshot in `docs/help/` isn't used, or any ?
points at a topic that doesn't exist.

## Before pushing

`npx prettier --check .`, `npx eslint .` and the full Playwright suite
(`npx playwright test`) all pass. Keep the About page (`about.html`) and its
screenshots (`node scripts/gen-about-screens.mjs`) in step with user-visible
changes too.
