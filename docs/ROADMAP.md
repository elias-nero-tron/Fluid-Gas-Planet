# Roadmap and open work

Ranked by impact. Each item can be started without knowledge of the original conversation.
Background: [STATUS.md](STATUS.md), formulas: [MATH.md](MATH.md). German original: [de/ROADMAP.md](de/ROADMAP.md).

## Strengths to build on

- **Runs in real time in the browser**, on integrated graphics (author test, v0.1).
- **No image files**: planets are numbers (wind profile, colour bands, storms). Five presets,
  random planets and “Colours from image”.
- **Two methods, freely combined**: Stable Fluids (physical) and curl noise/particles (Gaseous
  Giganticus recipe), each with dye or particles.
- **Clean sphere geometry**: cube-sphere without pole singularity, wind as 3D tangent vectors,
  metric-aware derivatives, seam-exact sampling across edges.
- **Physics with reasons**: Coriolis as an exact rotation, jets via the latitude-circle mean, free
  storms, pressure solver. Every control explains what it does physically.
- **Rendering**: ellipsoid, Minnaert limb darkening, relief, haze rim, rings with shadows and anti-aliasing.
- **Testability**: `#offscreen` mode with image and field read-back for headless tests.
- **Honest record**: every known bug is measured and documented.

## Known weaknesses

| Weakness | Cause | Item |
|---|---|---|
| Up close it looks like a small, viscous fluid rather than Jupiter | detail is transported on the grid instead of generated separately; wrong regime (Ro too high, effective Reynolds number too low, no deformation radius) | 1a, 1c, 2 |
| No compact round vortices; north–south waves instead | 2D incompressible = infinite deformation radius | 1c |
| No real 3D depth | single layer; relief estimated from brightness | 4 |
| Detail blurs or bands dissolve | restoring instead of sources; transport without limiter | 2, 3 |
| v0.2 not confirmed on real hardware | only software renderer | 0 |

## Work items

### 0. Verify v0.2 on real hardware (small, first)
Checklist: no lines along cube edges (Saturn, relief on); steady-state fps vs. v0.1; look not worse;
coffee demo runs. If `sampleCube()` is too expensive: halo texels (1-texel border per face filled by
a separate pass) instead of branching.

### 1a. Advected texture coordinates — “separate the scales” (medium, biggest visible gain)
So far **colour** is pushed across the grid: every detail must be resolved, and it blurs. Better: the
simulation computes only the large-scale flow; additionally a **source coordinate** (where did this
point come from?) is advected. At render time, fine structure is generated from noise at that
coordinate, at any resolution, stretched into streaks by the flow. Against over-stretching, 2–3
phases restart staggered in time and cross-fade. Sources: Max & Becker 1995 (flow textures),
Perlin & Neyret 2001 (flow noise), Neyret 2003 (advected textures). Implementation: new field
`uvw` (rgba16float, source direction + phase) using the `advectDye` logic; detail noise in
`render.wgsl` instead of reading `dyeTex`.

**View-dependent detail (idea by elias-nero-tron):** spend the detail work only where the camera
looks, so zooming in gets sharper without losing fps. Pure particle concentration in the view has a
catch: when the planet turns, newly visible areas lack the accumulated streak history. With advected
coordinates the flow stays global and cheap, and detail is generated per visible pixel, which gives
exactly this “closer = finer, same cost” behaviour. (Note: jasper-r’s article distributes particles
over the whole sphere, so this is not what makes that demo look good; lighting and soft streaks do.)

### 1b. Real atmospheric scattering (medium)
Soft rim scattering and translucent clouds are a large part of the Alien: Isolation look.
MIT-licensed WebGPU implementation: cgcostume/himmel-dunstkreis (Bruneton 2008 / Hillaire 2020),
to be adapted to a sphere with a dense atmosphere.

### 1c. Shallow-water core (large, the right vortex physics)
Replace the pressure projection in `fluid.wgsl` with shallow-water equations on the sphere:
`∂u/∂t + (u·∇)u + f k̂×u = −g∇h + ν₄∇⁴u`, `∂h/∂t + ∇·(h u) = Q`.
Derive parameters from Jupiter’s numbers: Ro ≈ 0.1, L_d = √(gH)/f ≈ 0.02·R. Expected (Cho & Polvani
1996): bands and compact, long-lived vortices emerge by themselves. Time step limited by gravity
waves (CFL with √(gH)); possibly semi-implicit.

### 2. Hyperviscosity and limiter (medium)
∇⁴ damping of only the smallest scales. Port the min/max limiter from `demos/coffee.html`
(`advectCream`) into `advect`/`advectDye`. Goal: sharp filaments without noise.

### 3. Convection as a source (medium)
Upwelling clouds as source term Q (in shallow water: mass into h) instead of a colour blob.
Prototype in the coffee demo (`source()`, `divergence()`). Produces the turbulent regions next to
the Great Red Spot and white convective towers.

### 4. Layers and real height (large)
2–3 layers (NH₄SH clouds, NH₃ clouds, haze), h as cloud height for relief, shadows of the upper
layer on the lower one. Reference model: EPIC (isentropic layers).

### 5. Close-ups (medium)
Level of detail: when zooming in, extra detail noise advected by the wind (two-phase flow map) so
Juno-like filaments appear below grid resolution. Largely covered by 1a.

### 6. Performance (medium)
Multigrid instead of Jacobi; recompute the curl flow field only every n frames; automatic quality
levels from measured fps.

### 7. Smaller wishes
- ~~Random planet with more variety~~ done in v0.2.3 (families, uneven bands, storm types, rings; save/undo).
- Equi-angular cube projection for more uniform cells.
- Load/save presets as JSON.
- “Continents under the atmosphere” (Earth weather): needs heating, water vapour with condensation
  and topography. A separate follow-up project on the same foundation.
