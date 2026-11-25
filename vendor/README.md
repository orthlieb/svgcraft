# Vendored libraries

| File                              | Library                                     | Version  | Licence                                             |
| --------------------------------- | ------------------------------------------- | -------- | --------------------------------------------------- |
| `paper-core.min.js`               | [Paper.js](http://paperjs.org/) (core)      | 0.12.18  | MIT ([paper-LICENSE.txt](paper-LICENSE.txt))        |
| `opentype.min.js`                 | [opentype.js](https://opentype.js.org/)     | 1.3.4    | MIT ([opentype-LICENSE.txt](opentype-LICENSE.txt))  |
| `pdf.min.js`, `pdf.worker.min.js` | [pdf.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | Apache 2.0 ([pdfjs-LICENSE.txt](pdfjs-LICENSE.txt)) |

Paper.js does the curve-preserving boolean geometry behind Object → Combine
Shapes. `src/commands.js` loads it the first time a boolean is used, so it costs
nothing at startup. Taken unmodified from the npm package
(`paper@0.12.18/dist/paper-core.min.js`), SHA-256
`3a8c73ecdf3929a7fe05f96b82e8146193ea449c5c3e889c5f4fe0184a30ed96`.

opentype.js reads the font files (TrueType, OpenType and WOFF) behind
Object → Create Outlines. `src/outlines.js` loads it the first time outlines are
created. Taken unmodified from the npm package
(`opentype.js@1.3.4/dist/opentype.min.js`), SHA-256
`c0f9c7ca85e18075a8819e5fe2dee6e1d535f9a2269f5314f36cce94a183adba`. It is the
last 1.x release; 2.0.0 (May 2026) is a rewrite with a changed build and
wasn't needed here. The file's trailing `sourceMappingURL` comment points at a
map that isn't vendored, which only matters with developer tools open.

pdf.js reads PDFs for File → New from PDF…. `src/pdf-import.js` loads it the
first time a PDF is opened. 3.11.174 is the last release with the SVG
renderer (`SVGGraphics`) that draws a page as shapes; it was dropped in 4.0.
Taken unmodified from the npm package (`pdfjs-dist@3.11.174/build/`),
SHA-256 `5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946`
(`pdf.min.js`) and
`feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b`
(`pdf.worker.min.js`). The renderer is no longer maintained upstream, so
`src/pdf-import.js` guards each drawing operation and reports what it skips.
