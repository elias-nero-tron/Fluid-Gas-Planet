# Research: sources that are as far as or further than this project

Collected for v0.3. Papers are method sources: we implement from the description and cite them,
no code is copied. Code repositories are only listed with their licence; GPL code stays an idea source.
German background notes: [de/RECHERCHE.md](de/RECHERCHE.md).

## A. Storms and jets that emerge from the maths (the “grandeur” problem)

| Source | What it gives us | Where it goes |
|---|---|---|
| Showman 2007, *Numerical simulations of forced shallow-water turbulence: effects of moist convection on the large-scale circulation of Jupiter and Saturn*, J. Atmos. Sci. 64(9) ([link](https://journals.ametsoc.org/view/journals/atsc/64/9/jas4007.1.xml)) | Storms as random **mass pulses** in a shallow-water layer: jets and long-lived vortices form by themselves. Exactly the “storms should form, grow, drift, dissolve” behaviour. | ROADMAP 1c + 3: convection as mass source Q in ∂h/∂t |
| Scott & Polvani 2007, *Forced-dissipative shallow-water turbulence on the sphere and the atmospheric circulation of the giant planets*, J. Atmos. Sci. 64, 3158–3176 ([portal](https://research-portal.st-andrews.ac.uk/en/publications/forced-dissipative-shallow-water-turbulence-on-the-sphere/)) | Parameter map: which deformation radius and forcing give Jupiter-like jets and equatorial super-rotation. | choosing L_d, forcing scale, hyperviscosity |
| Cho & Polvani 1996, Phys. Fluids 8, 1531 | Decaying shallow-water turbulence on a sphere: band count and vortices vs. rotation and L_d. | already cited, 1c |
| Warneford & Dellar 2014, *Thermal shallow water models of geostrophic turbulence in Jovian atmospheres*, Phys. Fluids 26, 016603 ([link](https://pubs.aip.org/aip/pof/article-abstract/26/1/016603/314425/Thermal-shallow-water-models-of-geostrophic)) | Adds temperature to shallow water: more realistic vortices at modest extra cost. | after 1c |
| Adriani et al. 2018, *Clusters of cyclones encircling Jupiter’s poles*, Nature ([link](https://www.nature.com/articles/nature25491)) | Target picture for the poles (Juno): stable polygons of cyclones. Good test for 1c. | validation |
| Williamson et al. 1992, *A standard test set for numerical approximations to the shallow water equations in spherical geometry*, J. Comput. Phys. 102 | Standard tests (steady geostrophic flow, Rossby–Haurwitz wave) to prove a new solver is right before judging looks. | 1c test suite |

## B. Detail up close and “vectors instead of pixels”

| Source | What it gives us |
|---|---|
| Neyret 2003, *Advected textures*; Perlin & Neyret 2001, *Flow noise* | Fine detail generated per pixel from advected coordinates: sharp at any zoom, cost independent of zoom. The terrain preview already uses the two-phase trick for its clouds. ROADMAP 1a. |
| Bridson et al. 2007, *Curl-noise for procedural fluid flow* | Already used; basis of the particle track. |

The author’s point “think in vectors, not pixels” is exactly 1a: the simulation stores a coarse vector
field; everything fine is a function evaluated at render time, so zooming never runs out of pixels.

## C. Light, clouds, volume

| Source | What it gives us |
|---|---|
| Hillaire 2020, *A scalable and production ready sky and atmosphere rendering technique*; MIT WebGPU port cgcostume/himmel-dunstkreis | Real scattering at the limb (ROADMAP 1b). |
| Schneider & Vos 2015, *The real-time volumetric cloudscapes of Horizon Zero Dawn* (SIGGRAPH Advances in Real-Time Rendering) | Ray-marched cloud layers with cheap lighting; the path from the terrain preview’s 2D cloud shell to real volumetric clouds, and from “relief” to real cloud height on the gas giant (ROADMAP 4). |
| Henyey & Greenstein 1941 (phase function); Cuzzi et al., Saturn ring photometry | Rings as a scattering particle layer: forward scattering, lit vs. unlit side (ROADMAP 8). |
| Blender Artists: *Fully volumetric gas giant* (2022) and *So I want to create gas giants* (2014), shown by the author | Offline references for the look: volumetric density and soft limb. Not real time; the page could not be opened from the build environment, so only the author’s screenshots were used. |

## D. Terrain and water (for the terrain track)

| Source | Licence | What it gives us |
|---|---|---|
| lisyarus, [webgpu-shallow-water](https://github.com/lisyarus/webgpu-shallow-water) | MIT | Virtual-pipes water on a height field in WebGPU: rivers and seas on continents. |
| Sebastian Lague, [Solar-System](https://github.com/SebLague/Solar-System) (Coding Adventures: procedural planets, atmospheres) | check licence before reuse | Clear explanations of procedural terrain and atmosphere rendering. |
| colordodge, [ProceduralPlanet](https://github.com/colordodge/ProceduralPlanet) (live: colordodge.com/ProceduralPlanet), suggested by the author | **WTFPL: code may be reused** | The “hammer” surface: height noise as a cube map, colour from a 2D **biome lookup** (height × second noise) painted with random gradient circles, water level with beach band, separate normal and roughness maps (shiny water), cloud map, atmosphere glow. Directly usable for the terrain track. |
| EepyBerry, [Lagrange](https://github.com/EepyBerry/lagrange) (live: lagrange.eepyberry.me), suggested by the author | “I'm So Tired” licence 1.0: custom, with restrictions on who may use it; **not compatible with Apache-2.0 redistribution, ideas only** | Planet editor with water level, climate zones (temperature × humidity → biome), rings, displacement. Good model for the terrain track’s UI and parameters. |
| Orographic lift, textbook meteorology: vertical velocity w ≈ u·∇h | – | The cloud source used in `demos/terrain.html`. |

## E. Engineering: working with an AI assistant over many sessions

Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):
progress file and feature list in the repository, small committed steps, each session starts by
reading them and checking what actually works. Applied here as `CLAUDE.md`, `docs/STATUS.md`,
`docs/ROADMAP.md` and the film-strip tool (`scripts/eyes.mjs`). See [PROCESS.md](PROCESS.md).
