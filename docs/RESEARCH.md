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

## F. Author’s links, read at source level (v0.3 review, round 2)

| Link | What is really inside (read in the code) | Licence | Use for us |
|---|---|---|---|
| [colordodge/ProceduralPlanet](https://github.com/colordodge/ProceduralPlanet) | No physics. 16–32 octaves of 4D simplex noise baked once into 6 cube-map faces (256–4096² selectable), with **domain warping** (`p + 1.8·n₃`), mixing of normal/ridged/“cloud” (sin-folded) noise, a 2D **biome lookup** (height × moisture), water level, and separate normal and roughness maps. The “endless zoom” comes from the high bake resolution plus the normal map. | WTFPL (reuse allowed) | Ground layer of a climate planet: height + moisture maps, biome LUT, roughness (shiny water). |
| [EepyBerry/lagrange](https://github.com/EepyBerry/lagrange) | three.js WebGPU/TSL. Climate zones = `smoothstep(latitude) × fbm` for temperature and humidity, then a (humidity, temperature) biome texture (Whittaker-diagram idea). Water level = step(height). Clouds = warped fbm on a shell. Also noise, not physics. | “I’m So Tired” 1.0 (restrictive, not Apache-compatible) | Ideas only: parameter set and UI. |
| [three.js webgpu_volume_fire](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_volume_fire.html) | A real **3D Stable Fluids** solver on 100×100×200 voxels (rgba16float 3D storage textures): semi-Lagrangian advection, buoyancy F = (β·T − w·ρ)·ŷ, curl-noise turbulence decaying with age, 2 Jacobi iterations; rendering by ray marching with **Beer–Lambert** transmittance e^(−τ), **Henyey–Greenstein** phase, a “powder” term 1 − e^(−2τ), a cheap multiple-scattering term and volumetric shadows. | MIT | This is the maths for rising cloud towers and the lighting for volumetric clouds. Directly portable to WGSL. |
| [matsuoka-601/WaterBall](https://github.com/matsuoka-601/WaterBall) | Real particle fluid on a sphere: **MLS-MPM** (Moving Least Squares Material Point Method, after nialltl’s article) plus screen-space fluid rendering (GDC 2010). | MIT | Real water physics; the right reference for close-up water (splashes, waves), not for planet-wide oceans. Planet oceans are a thin layer, so they belong to shallow-water equations. |
| Reddit r/Unity3D “procedural Earth-sized planet” | Could not be opened from the build environment (reddit blocked). | – | Needs a title or video from the author. |

**Verdict:** the planet generators everyone admires (ProceduralPlanet, Lagrange) are *noise*, not *computed weather*.
They look strong because of high-octave warped noise, a biome lookup and good normal and roughness maps.
The “computed” part the author asks for has to come from atmospheric physics, and published models exist for
exactly this at real-time cost:

## G. Higher maths for a climate planet (formulas, all published)

1. **Moist-convective rotating shallow water** (Bouchut, Lambaerts, Lapeyre & Zeitlin 2009, Phys. Fluids 21, 116604;
   improved by Rostami & Zeitlin 2018, QJRMS; [overview slides](https://team.inria.fr/ange/files/2017/11/zeitlin.pdf)):
   ```
   ∂u/∂t + (u·∇)u + f k̂×u = −g∇h
   ∂h/∂t + ∇·(h u) = −β·P               (condensation lifts air out of the layer = convection)
   ∂q/∂t + ∇·(q u) = E − P               (moisture: evaporation E, precipitation P)
   P = (q − q_s)/τ  if q > q_s, else 0   (precipitation threshold)
   ```
   This is the same shallow-water core as ROADMAP 1c, plus one scalar q. It produces fronts, moist vortices
   and hurricane-like structures by itself. Clouds are where P > 0 or q is close to q_s.
2. **Clausius–Clapeyron** for saturation: q_s(T) ≈ q₀·exp(−L/(R_v·T)), about +7 % per kelvin. Warm oceans
   evaporate, cold mountain tops and poles condense.
3. **Temperature** without a 3D model: T(φ, h) = T_eq(φ) − Γ·h, relaxed like **Held–Suarez 1994**
   (Newtonian relaxation toward an equilibrium profile T_eq(φ) plus Rayleigh friction near the ground, the
   standard benchmark for GCM dynamical cores; [DCPAM notes](https://www.gfd-dennou.org/library/dcpam/sample/held-suarez-1994.htm)).
   The equator-to-pole contrast then drives jets (thermal wind), with Γ ≈ 6.5 K/km the lapse rate.
4. **Orographic lift**: w = u·∇h (already in the terrain sketch) as an extra condensation source.
5. **Global circulation** (Hadley, Ferrel and polar cells, ITCZ, trade winds, westerlies; the author’s Grok list:
   Met Office, Wikipedia “Hadley cell”, LibreTexts 12.4). A one-layer model cannot produce the overturning
   cells itself; they enter as a prescribed meridional convergence pattern (rising at the ITCZ and 60°,
   sinking at 30° and the poles) that feeds the moisture equation, which is how many teaching models do it.
6. **Volumetric rendering** of the condensate as a shell 0–15 km thick: Beer–Lambert, Henyey–Greenstein,
   powder term, shadow march toward the sun (three.js volume fire, MIT). Towers: the local P and convergence
   set the cloud top height. Only there does a 3D look come from computed numbers.
7. **Why a cube-sphere is right**: research dynamical cores for planetary atmospheres use it too
   (e.g. ExoCubed, [arXiv 2403.06844](https://arxiv.org/pdf/2403.06844), with halo cells at face edges).
   Our seam fix (“Exact edges”) is the cheap version of their halos.
