# Contributing

Building on this project is explicitly welcome: fork it, learn from it, extend it. Please credit the
author when you do (see [NOTICE](NOTICE), [CITATION.cff](CITATION.cff)); the Apache 2.0 license
requires the NOTICE file to be kept in redistributions and derivative works.
German version: [docs/de/CONTRIBUTING.md](docs/de/CONTRIBUTING.md).

## Getting started

1. Read the [README](README.md), then [docs/STATUS.md](docs/STATUS.md) (state and findings) and
   [docs/ROADMAP.md](docs/ROADMAP.md) (work items). Formulas and code locations:
   [docs/MATH.md](docs/MATH.md).
2. `npm install && npm run dev`, open a WebGPU browser.
3. Pick a roadmap item and reference it in your issue or pull request.

## Rules

- **Measure, don't guess.** Back claims about bugs with a test. Tools: append `#offscreen` to the
  URL, then `window.gasPlanet.capture()` (image) and `window.gasPlanet.readRow()` (field values).
- **Look first for defaults.** Changing a default must be compared visually against the v0.1 look on
  real hardware. A cleaner measurement is not a reason to ship a worse-looking default.
- **Label unverified work.** Say in the PR if something was only checked in a software renderer;
  for real-hardware checks, state the device and fps.
- **No third-party code without a compatible license.** GPL projects (e.g. Gaseous Giganticus,
  gas-giant) are idea sources only. Add adopted methods to [CREDITS.md](CREDITS.md).
- **No image files for the planet surface.** Images only as measurement input (e.g. “Colours from image”).
- Keep both languages in the UI (`src/i18n.ts`, `t(german, english)`).
- Before a PR: `npm run typecheck` and `npm run build`.
- English or German, both welcome.
