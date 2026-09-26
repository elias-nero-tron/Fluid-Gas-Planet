# Contributing

Building on this project is explicitly welcome: fork it, learn from it, extend it. Please credit the
author when you do (see [NOTICE](NOTICE), [CITATION.cff](CITATION.cff)); the Apache 2.0 license
requires the NOTICE file to be kept in redistributions and derivative works.
German version: [docs/de/CONTRIBUTING.md](docs/de/CONTRIBUTING.md).

## Getting started

1. Read the [README](README.md) and [HAEPPCHEN.md](HAEPPCHEN.md) (next bites, in order). Formulas and
   code locations: [docs/MATH.md](docs/MATH.md).
2. `npm install && npm run dev`, open a WebGPU browser.
3. Pick the next bite from HAEPPCHEN.md.

## Rules

- **No third-party code without a compatible license.** GPL projects (e.g. Gaseous Giganticus,
  gas-giant) are idea sources only. Add adopted methods to [CREDITS.md](CREDITS.md).
- **No image files for the planet surface.** Images only as measurement input (e.g. “Colours from image”).
- Keep both languages in the UI (`src/i18n.ts`, `t(german, english)`).
- Before a PR: `npm run typecheck` and `npm run build`.
- English or German, both welcome.
