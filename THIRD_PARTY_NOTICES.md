# Third-party notices

Libristead is licensed under AGPL-3.0-only (see [LICENSE](LICENSE)). It includes or depends on the third-party software listed below, each under its own license.

## foliate-js (the ebook reader engine)

The reader is built on **foliate-js** by John Factotum.

- Repository: https://github.com/johnfactotum/foliate-js
- Pinned commit: `78914aef4466eb960965702401634c2cb348e9b1` (see `scripts/foliate.lock`)
- License: MIT

```
MIT License

Copyright (c) 2022 John Factotum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Libraries bundled inside foliate-js (`vendor/`)

| Component | License | Copyright |
| --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js) (`vendor/pdfjs`) | Apache-2.0 | Mozilla Foundation |
| PDF.js CMaps (`vendor/pdfjs/cmaps`) | BSD-3-Clause | Adobe Systems Incorporated |
| Foxit standard fonts (`vendor/pdfjs/standard_fonts`) | BSD-3-Clause | PDFium Authors |
| Liberation fonts (`vendor/pdfjs/standard_fonts`) | SIL Open Font License 1.1 | Red Hat, Inc. |
| [zip.js](https://github.com/gildas-lormeau/zip.js) (`vendor/zip.js`) | BSD-3-Clause | Gildas Lormeau |
| [fflate](https://github.com/101arrowz/fflate) (`vendor/fflate.js`) | MIT | Arjun Barrett |

The full license texts ship with foliate-js in `web/public/foliate-js/vendor/pdfjs/` (`LICENSE_FOXIT`, `LICENSE_LIBERATION`, `cmaps/LICENSE`) and in each upstream repository.

## npm runtime dependencies

Production dependencies of `server` and `web` (from `npm ls --omit=dev`). Their license texts are in each package under `node_modules/`.

| Package | License |
| --- | --- |
| `pako@1.0.11` | (MIT AND Zlib) |
| `jszip@3.10.2` | (MIT OR GPL-3.0-or-later) |
| `tslib@1.14.1` | 0BSD |
| `inherits@2.0.4` | ISC |
| `@hono/node-server@1.19.18` | MIT |
| `@pdf-lib/standard-fonts@1.0.0` | MIT |
| `@pdf-lib/upng@1.0.1` | MIT |
| `@remix-run/router@1.23.4` | MIT |
| `core-util-is@1.0.3` | MIT |
| `fast-xml-parser@4.5.7` | MIT |
| `hono@4.13.17` | MIT |
| `immediate@3.0.6` | MIT |
| `isarray@1.0.0` | MIT |
| `js-tokens@4.0.0` | MIT |
| `lie@3.3.0` | MIT |
| `loose-envify@1.4.0` | MIT |
| `pdf-lib@1.17.1` | MIT |
| `process-nextick-args@2.0.1` | MIT |
| `react-dom@18.3.1` | MIT |
| `react-router-dom@6.30.6` | MIT |
| `react-router@6.30.6` | MIT |
| `react@18.3.1` | MIT |
| `readable-stream@2.3.8` | MIT |
| `safe-buffer@5.1.2` | MIT |
| `scheduler@0.23.2` | MIT |
| `setimmediate@1.0.5` | MIT |
| `string_decoder@1.1.1` | MIT |
| `strnum@1.1.2` | MIT |
| `util-deprecate@1.0.2` | MIT |

`jszip` is dual-licensed MIT OR GPL-3.0-or-later; Libristead uses it under MIT.
