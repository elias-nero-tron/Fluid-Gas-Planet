# Mathematics and code

Every method with formula, location in the code, purpose and known flaw.
Status: ✅ verified (author test on hardware or measurement), 🔶 software renderer only, ⚠️ known flaw.
German original: [de/MATHEMATIK.md](de/MATHEMATIK.md).

## 1. Geometry: the sphere as an inflated cube

**Cube-sphere (gnomonic projection).** Each of the 6 cube faces is an N×N grid with parameters
a, b ∈ [−1, 1]. Direction on the sphere = normalize(face point), e.g. +X: `normalize(1, −b, −a)`.
Order and orientation follow the WebGPU cube-map convention (+X, −X, +Y, −Y, +Z, −Z).
- Code: `faceDir()` and `cubeUV()` in [`src/shaders/common.wgsl`](../src/shaders/common.wgsl).
- Why: no pole singularity (unlike a lat/long map), nearly equal cell sizes.
- ✅ Mapping measured: a freshly written direction field reads back without error.
- ⚠️ Cells at face edges are about half the angular size of central cells (1/(1+a²)).
  An equi-angular projection would be more uniform.

**Wind as a 3D tangent vector.** Instead of (east, north), u ∈ ℝ³ with u·p = 0 is stored.
Tangent projection: `tangent(p, v) = v − p (p·v)`. East vector: `east(p) = normalize(ŷ × p)`.
No coordinate special cases at poles or edges.

**Seam-exact sampling across cube edges.** `sampleCube()`: hardware bilinear on the 2D-array texture
inside a face; near an edge the 4 neighbouring texels are fetched individually, texels beyond the edge
via `faceDir(face, st outside [0,1])` on the neighbouring face.
- ✅ Measured: hardware cube-map sampling had up to 0.139 error near edges vs 0.0003 inside, which
  accumulated per step into visible lines. Gone in tests after the fix. 🔶 Not yet confirmed on real
  hardware; fps cost unknown.

## 2. Flow: Stable Fluids on the sphere

File: [`src/shaders/fluid.wgsl`](../src/shaders/fluid.wgsl). Per step:
`advect → curl → zonalClear/zonalSum → forces → divergence → jacobi × K → project`.

**Grid derivatives with the real metric.** For each cell, neighbours pE, pW, pN, pS come from the
face parametrisation. The gradient g of a quantity f solves the 2×2 system

```
[ dA·e₁  dA·e₂ ] [g₁]   [ f_E − f_W ]
[ dB·e₁  dB·e₂ ] [g₂] = [ f_N − f_S ]     with dA = pE − pW, dB = pN − pS
```

- Code: `cell()`, `grad2()`. Divergence = ∂u₁/∂x + ∂u₂/∂y, vorticity ζ = ∂u₂/∂x − ∂u₁/∂y.
- Why: the cube grid is non-uniform and skewed. A fixed sampling distance (first version) could not
  see grid-scale noise.

**Advection (semi-Lagrangian + BFECC).** Back-tracing on the sphere: `src = normalize(p − u·Δt)`.
BFECC (back and forth error compensation): back, forth, subtract half the error, back again. Then
parallel transport: project into the tangent plane at p, keep the magnitude.
- Code: `advect()`. Based on the mofu article and Stam 1999.
- ⚠️ No limiter (Selle 2008) yet; the coffee demo has one.

**Coriolis as an exact rotation.** The Coriolis acceleration −f k̂×u rotates the wind vector in the
tangent plane. Instead of an Euler step, an exact rotation about the normal p:

```
u' = u·cos(a) + (p × u)·sin(a),    a = −2Ω·sin(φ)·Δt = −2Ω·p_y·Δt
```

- Code: `forces()`. Produces the β-effect, Rossby waves and geostrophic balance of the jets.

**Jet restoring on the latitude-circle mean only.**

```
u += ê_east · (U_profile(φ) − ⟨u·ê_east⟩_latitude circle) · min(k·Δt, 1)
```

The mean ⟨·⟩ is formed on the GPU every step: 128 latitude bands, area-weighted fixed-point sums
with `atomicAdd` (`zonalSum`), linearly interpolated (`zonalMean`).
- ✅ Finding: the first version restored *every* east–west component and flattened vortices in seconds.

**Pressure projection (Helmholtz decomposition).** ∇²p = ∇·u with a compact 5-point stencil and Jacobi:

```
p₀ = ( a_x (p_E + p_W) + a_y (p_N + p_S) − ∇·u ) / (2 (a_x + a_y)),   a_x = 1/h_x², a_y = 1/h_y²
u ← u − ∇p
```

- Code: `divergence()`, `jacobi()`, `project()`. Warm-started from the previous step’s pressure.
- ⚠️ Jacobi converges slowly; multigrid is the next performance step.

**Vorticity confinement (Fedkiw 2001).** `f = ε·Δx·(N × ζ p̂)`, N = ∇|ζ|/|∇|ζ||.
- ✅ Finding: default ε = 6 was about 10× too strong and amplified grid noise. Now 0.5.

**Storms.** Profile v(d) = x·e^{−x²}·2.33 with x = d/r; spin from cyclone/anticyclone and hemisphere
(northern cyclones counter-clockwise). Seeded as initial vortices (`initVel`), then free. Optionally
held, or spawned as short convective kicks.
- Code: `stormFlow()`, `stormMask()` in `common.wgsl`, `updateStorms()` in `main.ts`.

## 3. Noise and curl noise

**Gradient noise with analytic derivative** (quintic 6t⁵ − 15t⁴ + 10t³): value and gradient in one
pass. Code: `noised()`. Hash: `pcg3d` (Jarzynski & Olano 2020).

**Curl noise on the sphere.** With noise ψ as a stream function,

```
v = p × ∇ψ
```

is tangent and divergence-free (Bridson 2007, carried over to the sphere). Code: `curlOnSphere()`.

**Gaseous Giganticus recipe** (code: `flowField()`, `curlVortices()` in `tracers.wgsl`): wind = band
profile + curl noise + vortices. Vortices only where |U| < 0.35·U_max, spinning with the background
vorticity ζ ≈ −∂U/∂φ (otherwise shear tears them apart), angular velocity ω(d) = ω₀·sin(π·d/r).
Particles may live forever.

## 4. Visible clouds

**Dye (tracer).** Colour is advected like the wind and slowly restored to the band colour:
`c ← mix(c, c_band(φ + meander), 1 − e^{−k·Δt})`. Plus “fine stripes”: small colour variations along
latitude so stretching becomes visible.
- ⚠️ Restoring and blur erase detail; with little restoring, detail survives but bands smear in the
  long run. The proper fix is sources instead of restoring, and advected texture coordinates (ROADMAP 1a).

**Particles (jasper-r / Gaseous Giganticus).** Up to 4 M particles, RK2 step on the sphere:
`mid = normalize(p + v(p)·Δt/2)`, `p ← normalize(p + v(mid)·Δt)`. Each particle blends its colour
with opacity α·sin(π·age/lifetime) into the texture; then blur and restoring.

## 5. Rendering (`render.wgsl`)

| Method | Formula / idea |
|---|---|
| Planet as ellipsoid | ray–ellipsoid intersection: scale y by 1/(1−oblateness), then intersect a unit sphere |
| Limb darkening (Minnaert) | I = A·(n·l)^k·(n·v)^(k−1); k = 1 is Lambert |
| Relief | normal tilted by the brightness gradient: bright clouds = higher (approximation!) |
| Haze rim | e^{−h/0.025}·sun factor at the limb |
| Rings | plane y = 0 in the body frame, density profile with Cassini division, shadows both ways |
| Ring anti-aliasing | pixel footprint = t·pixel angle/|d_y|; detail fades out once narrower than a pixel |
| Tone mapping | ACES fit (Narkowicz), then gamma 2.2 |

## 6. Coffee demo (`demos/coffee.html`)

2D Stable Fluids plus three building blocks the planet model still lacks:
- **Source term in the pressure solve:** ∇²p = ∇·u* − S, so afterwards ∇·u = S: the surface spreads
  where cream wells up or pours in.
- **Moving obstacle:** inside the spoon, u is set to the spoon velocity; a wake forms behind it.
- **BFECC with min/max limiter:** sharp cream threads without overshoot.
- Status: shaders compile; rendered image untested.

## 7. What is mathematically missing (priority)

1. **Advected texture coordinates** for detail independent of grid resolution (ROADMAP 1a).
2. **Shallow-water equations** instead of 2D incompressible: fields u and h,
   ∂u/∂t + (u·∇)u + f k̂×u = −g∇h, ∂h/∂t + ∇·(h u) = 0. Only this gives a Rossby deformation radius
   L_d = √(gH)/f and compact vortices (Cho & Polvani 1996). Jupiter: L_d/R ≈ 0.02, Ro ≈ 0.1.
3. **Hyperviscosity** ν₄∇⁴ instead of numerical viscosity.
4. **Limiter** (Selle 2008) in the planet transport too.
5. **Convection as a source** (∇·u = S at the cloud tops) instead of a colour blob.
6. **Multiple layers** (NH₄SH, NH₃, haze) for real depth and shadows; h as cloud height.
7. **Multigrid** for pressure, **equi-angular** cube projection.
