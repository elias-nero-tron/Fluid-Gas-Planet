# Atmosphere module: moist shallow-water atmosphere with a cloud layer

Maths model **“Moist atmosphere with clouds”** on the gas-giant page (panel → Method → Maths model).
It runs next to Stable Fluids and curl noise, replaces nothing and combines with every look
(dye, particles). Code: `src/atmo/` (own fields, shaders and uniforms), only hooked into `src/main.ts`.
German version with all details: [docs/de/ATMOSPHAERE.md](de/ATMOSPHAERE.md).

## Principle: proven formulas instead of invented ones

| Building block | Source | Licence |
|---|---|---|
| Moist thermal shallow-water equations, saturation, condensation, rain, parameter values | Zerroukat & Allen 2015 (J. Comput. Phys. 290) as implemented in [Gusto](https://github.com/firedrakeproject/gusto) (UK Met Office) | MIT |
| Convective mass feedback β₁ | Bouchut, Lambaerts, Lapeyre & Zeitlin 2009 (mcRSW) | – |
| Storms as mass pulses with geostrophic wind, Jupiter parameters | Showman 2007; [canoe](https://github.com/chengcli/canoe) `test_injection.cpp` (Cheng Li et al.) | MIT |
| Deep jets as bottom topography of the weather layer | Dowling & Ingersoll 1989 | – |
| Newtonian cooling | Held & Suarez 1994 | – |
| Solver test | Galewsky, Scott & Polvani 2004 | – |
| Cloud rendering (weather map → density, height profile, erosion, multiple scattering, phase, powder) | [takram three-clouds](https://github.com/takram-design-engineering/three-geospatial) after Nubis (Schneider, Guerrilla Games) | MIT |
| Tileable Perlin–Worley noise; energy-conserving integration | Hillaire, [TileableVolumeNoise](https://github.com/sebh/TileableVolumeNoise); Frostbite 2016 | MIT |
| Multiple scattering in octaves | Wrenninge et al. 2013 | – |

## Equations

Units: planet radius 1, layer depth D in units of the mean depth H, c² = gH.

```
∂u/∂t + (u·∇)u + f k̂×u = −c²·[ b̃·∇(η + B) − ½·D·∇θ ]      b̃ = 1 − θ,  D = 1 + η
∂D/∂t + ∇·(D u)        = −β₁·C
∂θ/∂t + u·∇θ           =  β₂·C + (θ_eq − θ)/τ
∂q_v/∂t + u·∇q_v       = −C + E,     ∂q_c/∂t + u·∇q_c = C − P
q_sat = q₀·exp(ν·θ)/D,   C = γ_v·(q_v − q_sat)/Δt,   γ_v = 1/(1 + ν·β₂·q_sat)
```

Gas giant: B comes from the deep jets via gradient-wind balance, so the weather layer is nearly flat
and carries the vortices. Rocky planet (later): B = terrain, evaporation over the ocean only.
Ω comes from the planet’s real Rossby number, c = L_d·f(45°) with L_d ≈ 0.03 R for Jupiter.

Numerics per substep: semi-Lagrangian advection with parallel transport → continuity
`D ← D·exp(−Δt·∇·u)` plus physics → pressure force, events, Coriolis as an exact rotation.
Substeps follow the gravity-wave CFL; no Poisson solve is needed.

Tapping the planet adds a source term (Gaussian pulse): storm (balanced), impact (mass out of
balance → gravity-wave ring as after Shoemaker-Levy 9, dark debris), explosion (blast wave, fire cloud),
volcano (10 s of heat, vapour, ash and mass).

The cloud layer is its own render pass over the finished image (premultiplied alpha), transparent where
there is no cloud, so it can also be laid over a rocky planet.
