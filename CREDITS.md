# Credits

## Author — the person this project is owed to

This project is owed to **elias-nero-tron**. Authorship belongs to the person, not to a specific
account: if the project moves to another account or organisation, this credit stays.

**elias-nero-tron** (GitHub account at the time of publication): idea, concept, goals, project lead,
evaluation on real hardware, and the decisive expert objections during development, including:
- the question about atmospheric thickness (led to the finding “the deformation radius is missing”),
- “the maths behaves like a 10×10 cm object, not 1000 km” (led to the Rossby/Reynolds regime
  analysis, see [docs/STATUS.md](docs/STATUS.md)),
- “the scars were not there before” (led to measuring the cube-map sampling error at edges),
- the image of pouring cream into coffee as a test for sources, obstacles and sharp transport,
- the comparison with the Alien: Isolation gas giant (led to “separate the scales”, ROADMAP 1a),
- view-dependent detail: “the closer you zoom, the better, without losing fps” (ROADMAP 1a).

Implemented with the help of **Claude** (Anthropic) as an AI programming assistant.

Please cite the project via [CITATION.cff](CITATION.cff) if you use or build on it.
German version: [docs/de/CREDITS.md](docs/de/CREDITS.md).

## What the project builds on

**No third-party source code was copied.** Published methods and ideas were adopted; the
implementation is original. Thanks to the authors:

### Methods and articles
| Source | What we learned from it |
|---|---|
| Jos Stam, *Stable Fluids*, SIGGRAPH 1999 | core method: advection, pressure projection |
| Mark J. Harris, *Fast Fluid Dynamics Simulation on the GPU*, GPU Gems ch. 38 (2004) | GPU pass structure, compact Jacobi stencil |
| mofu, [*Stable Fluids with three.js*](https://mofu-dev.com/en/blog/stable-fluids/) (2022) | clear derivation, BFECC advection |
| jasper-r, [*Gas giant particle sim on a sphere*](https://jasper-r.github.io/gas-giant) (2022) | compute-shader particles, fade in/out, blur |
| Stephen M. Cameron, [Gaseous Giganticus](https://github.com/smcameron/gaseous-giganticus) (GPL-2.0) | recipe: curl noise + band profile, vortices only in weak shear, sin(π·d/r) profile, immortal particles. **Recipe and parameter values only, no code.** |
| bloknayrb, [gas-giant](https://github.com/bloknayrb/gas-giant) (GPL-3.0) | overview of which Jupiter phenomena a model needs; advected-coordinate noise idea. **Ideas only, no code.** |
| PavelDoGreat, [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT) | vorticity confinement in practice, dye finer than the velocity grid |
| Ronald Fedkiw et al., *Visual Simulation of Smoke*, SIGGRAPH 2001 | vorticity confinement |
| Andrew Selle et al., *An Unconditionally Stable MacCormack Method*, 2008 | limiter against overshoot |
| Robert Bridson et al., *Curl-Noise for Procedural Fluid Flow*, SIGGRAPH 2007 | divergence-free noise as a stream function |
| Inigo Quilez, articles on gradient noise with analytic derivatives | noise-plus-gradient formula |
| Mark Jarzynski, Marc Olano, *Hash Functions for GPU Rendering*, JCGT 2020 | `pcg3d` hash |
| Marcel Minnaert, 1941 | limb darkening |
| Krzysztof Narkowicz, *ACES Filmic Tone Mapping Curve* (2016) | tone mapping |
| Max & Becker 1995; Perlin & Neyret 2001; Neyret 2003 | advected textures / flow noise (planned, ROADMAP 1a) |

### Physics and measurements (for calibration only; no images in the project)
| Source | Use |
|---|---|
| Porco et al. 2003 (Cassini); Tollefson et al. 2017 (Hubble OPAL) | Jupiter wind profile (simplified) |
| García-Melendo et al. 2011; Sromovsky et al. 1993/2015 | Saturn, Uranus, Neptune wind profiles (simplified) |
| Cho & Polvani 1996, *Physics of Fluids* 8, 1531 | shallow-water turbulence on the sphere: next model step |
| Dowling et al. 1998, EPIC model ([NASA-Planetary-Science/EPIC_Atmospheric_Model](https://github.com/NASA-Planetary-Science/EPIC_Atmospheric_Model)) | reference for layered gas-giant atmospheres |
| NASA/JPL Juno, Bolton et al. 2021 | depth of the Great Red Spot (pancake vortex) |

Images from NASA, Juno, Hubble, games and the web were only used as references during development
and are **not** part of the repository. Screenshots in `docs/images/` are renders of this project.

### Fonts and tools
IBM Plex Sans/Mono (SIL OFL), Barlow Condensed (SIL OFL), loaded via Google Fonts.
Vite, TypeScript, `@webgpu/types`, `vite-plugin-singlefile` (all MIT).
