# Notes for AI assistants (and humans) continuing this project

Author: **elias-nero-tron** (credit the person, see NOTICE/CREDITS). Licence Apache-2.0.
Real-time gas giants in WebGPU, no image textures. TypeScript + WGSL + Vite, no engine.

## Read first
1. `docs/PROCESS.md`: tracks instead of rebuilds, observations are not bug reports, defaults are protected.
2. `docs/STATUS.md`: findings with causes. `docs/ROADMAP.md`: next items. `docs/MATH.md`: formulas.

## Hard rules
- Never change a default look without a before/after film strip on real hardware and the author’s OK.
  The v0.1 look (track “Fluid”, confinement 6, bandRelax 0.06) is the reference.
- New ideas go into a new track, option or demo page (`demos/`), not into the existing track.
- Keep both languages: `t(german, english)` in `src/i18n.ts`; docs English with German in `docs/de/`.
- Mark work as verified (device, fps) or unverified (software renderer only).
- No third-party code without a compatible licence; GPL projects are idea sources only. Add sources to CREDITS.md.
- Never publish the author’s e-mail address.

## Eyes (look at motion, not single frames)
```
npm run dev
PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node scripts/eyes.mjs --preset Jupiter --track fluid --out /tmp/x
```
Writes a 4×2 film strip PNG and `detail`/`change` numbers. In the browser console (with `#offscreen`):
`gasPlanet.filmstrip({frames: 8, everySteps: 120})`, `gasPlanet.selftest()`, `gasPlanet.readRow('vel', face, y)`.
SwiftShader is slow (minutes per run); keep resolutions at “phone”.

## Map of the code
- `src/main.ts`: settings `S`, device tiers `QUALITY`, `App` (resources, stepping, UI, save/undo, film strip).
- `src/shaders/common.wgsl`: `Sim` uniform (must match offsets in main.ts), cube-sphere mapping, noise, storms.
- `src/shaders/fluid.wgsl`: Stable Fluids on the sphere. `tracers.wgsl`: dye, curl flow, particles.
- `src/shaders/render.wgsl`: ray-traced ellipsoid, lighting, rings.
- `demos/coffee.html`, `demos/terrain.html`: standalone tracks. `npm run build` also writes `demo/`.
