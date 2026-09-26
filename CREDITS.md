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
- view-dependent detail: “the closer you zoom, the better, without losing fps” (ROADMAP 1a;
  in v0.3 the particle track’s “View focus”),
- v0.3 review: the “teacup scale” of speeds (led to findings 9–10: simulation tied to the frame rate,
  wind-to-rotation ratio), storms that should emerge and grow from the maths (finding 11), that the
  particle track did not look like jasper-r because both methods were mixed (finding 12), the help-box
  jitter bug, retrograde rotation and hemisphere-dependent storm spin, clouds over continents (the
  terrain preview), 3D rings and moons as next steps, and the working rule “build new tracks instead
  of making things worse”.
- the volcano planet: volcanoes and supervolcanoes that pump rising 3D smoke into the atmosphere,
  layered umbrella clouds carried by the wind, sizes in km relative to the planet, atmosphere thickness,
  and a nebula that stays fixed in space ([demos/volcano.html](demos/volcano.html)).

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
| Max & Becker 1995; Perlin & Neyret 2001; Neyret 2003 | advected textures / flow noise (ROADMAP 1a; two-phase trick used for the clouds in `demos/terrain.html`) |
| Showman 2007; Scott & Polvani 2007 | forced shallow-water turbulence: storms as mass pulses, jets and vortices emerge (ROADMAP 1c, see [docs/RESEARCH.md](docs/RESEARCH.md)) |
| Inigo Quilez, articles on domain warping and on erosion-like fBm from noise derivatives | terrain of `demos/volcano.html` |
| F. Kenton Musgrave, *Texturing & Modeling: A Procedural Approach* (ridged multifractal) | mountain ranges in `demos/volcano.html` |
| Christian Schüler, *An Approximation to the Chapman Grazing-Incidence Function*, GPU Pro 3 (2012) | sunlight through the atmosphere in `demos/volcano.html` |
| Magnus Wrenninge et al., *Oz: The Great and Volumetric*, SIGGRAPH 2013 talk | multiple-scattering approximation for ash |
| colordodge, [ProceduralPlanet](https://github.com/colordodge/ProceduralPlanet) (WTFPL), and three.js [webgpu_volume_fire](https://threejs.org/examples/#webgpu_volume_fire) (MIT) | visual targets named by the author for `demos/volcano.html`; **no code taken**, the page is an original implementation |

### Volcanology (formulas used in `demos/volcano.html`)
| Source | Use |
|---|---|
| Morton, Taylor & Turner 1956, *Proc. R. Soc. A* 234, 1 | buoyant plume: radius b = b₀ + 6/5·α·z, height ∝ N^(−3/4) |
| Mastin et al. 2009, *J. Volcanol. Geotherm. Res.* 186, 10 | plume height H = 2.00·V^0.241 km from the eruption rate |
| Suzuki 1983, in *Arc Volcanism: Physics and Tectonics* | vertical mass distribution of the eruption column |
| Woods & Kienle 1994, *J. Volcanol. Geotherm. Res.* 62, 273 | umbrella cloud spreading R(t) ∝ t^(2/3) |
| Costa, Folch & Macedonio 2013, *Geophys. Res. Lett.* 40, 4999 | volume flux into the umbrella cloud |
| Holasek, Self & Woods 1996 (Pinatubo 1991) | calibration: ~10⁹ kg/s, ~35–40 km plume, westward stratospheric drift |

### Physics and measurements (for calibration only; no images in the project)
| Source | Use |
|---|---|
| Porco et al. 2003 (Cassini); Tollefson et al. 2017 (Hubble OPAL) | Jupiter wind profile (simplified) |
| García-Melendo et al. 2011; Sromovsky et al. 1993/2015 | Saturn, Uranus, Neptune wind profiles (simplified) |
| Cho & Polvani 1996, *Physics of Fluids* 8, 1531 | shallow-water turbulence on the sphere: next model step |
| Dowling et al. 1998, EPIC model ([NASA-Planetary-Science/EPIC_Atmospheric_Model](https://github.com/NASA-Planetary-Science/EPIC_Atmospheric_Model)) | reference for layered gas-giant atmospheres |
| NASA/JPL Juno, Bolton et al. 2021 | depth of the Great Red Spot (pancake vortex) |

The recording in `docs/media/` was made by elias-nero-tron on real hardware.
Images from NASA, Juno, Hubble, games and the web were only used as references during development
and are **not** part of the repository. Screenshots in `docs/images/` are renders of this project.

### Fonts and tools
IBM Plex Sans/Mono (SIL OFL), Barlow Condensed (SIL OFL), loaded via Google Fonts.
Vite, TypeScript, `@webgpu/types`, `vite-plugin-singlefile` (all MIT).
