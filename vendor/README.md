# Vendored libraries

| File                | Library                                 | Version | Licence                                            |
| ------------------- | --------------------------------------- | ------- | -------------------------------------------------- |
| `paper-core.min.js` | [Paper.js](http://paperjs.org/) (core)  | 0.12.18 | MIT ([paper-LICENSE.txt](paper-LICENSE.txt))       |
| `opentype.min.js`   | [opentype.js](https://opentype.js.org/) | 1.3.4   | MIT ([opentype-LICENSE.txt](opentype-LICENSE.txt)) |

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
