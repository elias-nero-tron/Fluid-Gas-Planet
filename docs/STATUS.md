# Status and handover

What is verified, what is not, and what debugging found. Written so a new session (human or AI)
can continue without reading the original development conversation. German original: [de/STATUS.md](de/STATUS.md).

## Verified vs. unverified

| State | Where | Status |
|---|---|---|
| v0.1.0: first prototype (both methods, presets, controls) | branch `release/v0.1.0` (`e8dd276`) | **tested by the author on real hardware** (integrated GPU; counter showed 25–41 fps, by eye up to ~60). Verdict: about 8/10 from afar, too fast and too coarse up close. |
| v0.2.0 (pre-release): everything after | `main` | **unverified**: checked only in a headless browser with software rendering (SwiftShader). |
| v0.2.3 | `main` before v0.3 | **tested by the author**: ~240 fps on an RTX 5080 (desktop), “current state is really good”, missing: grandeur/scale. Observations listed as findings 9–15. |
| v0.3.0: tracks, film strips, device classes, terrain preview | `main` | **unverified**: software renderer only. |
| `demos/terrain.html` (clouds over terrain) | `main` | **unverified**: preview, software renderer only. |
| `demos/coffee.html` (cream in coffee) | `main` | **untested visually**: shaders compile; the rendered image has never been seen (headless Chromium loses the device when presenting to a canvas). |

Author feedback on intermediate versions 2–3: visible “scar” lines, looked worse. The cause was found
and fixed in version 4 (below); the author’s first look at version 4 showed swirling detail and relief,
but 10 fps while spinning up. Spin-up is now adaptive (keeps ~30 fps). Steady-state fps pending.

## Findings (measured, not guessed)

1. **Scars along cube edges.** Hardware cube-map sampling near face edges: max error 0.139 vs 0.0003
   in face interiors (known test function, 384² per face, SwiftShader). Dye and wind are resampled
   every step, so the error accumulated into lines. Strong band restoring (0.06) had hidden it;
   lowering it to 0.02 exposed it. **Fix:** `sampleCube()` in `common.wgsl` — hardware bilinear inside
   a face, manual 4-tap across edges using texels of the neighbouring face. Open: whether real GPUs
   show the same error, and the fps cost on integrated GPUs.
2. **Vorticity confinement ε = 6 amplifies grid noise**: f = ε·Δx·ω gave ~0.1 rad/s² against jets of
   0.06 rad/s. It is nonetheless the default again (v0.1 look, see 7); 0.5 is the cleaner option.
3. **Jet restoring flattened vortices:** it pulled every east–west component to the profile,
   including a vortex’s. Now only the latitude-circle mean is restored (GPU sum per latitude band with
   atomics, `zonalSum` in `fluid.wgsl`).
4. **Detail was being erased** by blur (12 %/frame) and band restoring. Also, smooth colour
   gradients stay invisible when stretched, hence “fine stripes”.
5. **Hair at band edges**: meridionally stretched Rossby waves (β-effect) from initial noise.
   Physically correct for a 2D model without a deformation radius (below).
6. Headless tests: presenting to a canvas loses the device in SwiftShader. Hence `#offscreen` mode
   (renders to a texture; `window.gasPlanet.capture()`, `readRow()` for field values).

7. **Over-correction (lesson).** Author observations were treated as bug reports, and defaults were
   tuned until the measurements were clean. The look got worse (flat “wood grain” stripes, GRS
   fading) even though each change was locally justified. Since v0.2.1 the **defaults are the v0.1
   look** confirmed by the author on hardware (confinement 6, band restoring 0.06, fine stripes off,
   storms held, 12 s spin-up); the cleaner settings remain available as controls. Rule: changes to
   defaults must be compared visually against v0.1 on real hardware before they ship.

8. **Frame rate (v0.2.2).** Author requirement: at least 60 fps; v0.2.1 ran at ~25 fps on an integrated
   GPU (v0.1: ~60). `sampleCube()` (seam-exact sampling) carries its edge-case code into every one of the
   dozens of samples per cell and was the main suspect; compute passes are back on hardware cube
   sampling (the v0.1 path; scars stay invisible with band restoring 0.06). Also: fine-stripe noise is
   skipped when the control is 0, the zonal sum reduces per workgroup first (~64× fewer global atomics),
   default pixel density 1.25 instead of 1.75. New: **auto quality** measures GPU time per step while
   loading and drops one resolution tier if a step exceeds 8 ms; afterwards the render scale adapts to
   stay above 58 fps. New: **loading screen**: the simulation pre-runs hidden (≤ 5 s, up to 20 s of
   simulated time) so the planet appears mid-flow instead of starting from stripes.
   🔶 60 fps not yet confirmed on the author's hardware.

9. **Simulation speed depended on the frame rate (fixed in v0.3).** One simulation step was taken per
   rendered frame, so at 240 fps (RTX 5080) the atmosphere ran 4× faster than at 60 fps and the visible
   spin (real time) no longer matched it. That explains a good part of “details too fast, like
   raindrops” and “time lapse changes the physics”. Now: 60 steps per second × time lapse, independent of
   the frame rate; the visible spin runs in simulation time too.
10. **Wind-to-rotation ratio is far from a planet’s.** Real Jupiter: jets ~150 m/s against 12.6 km/s
    equatorial rotation, ~1 %. The model at defaults: jets 0.06 rad/s against 0.08 rad/s visible spin,
    ~75 %; physics rotation Ω = 0.4 gives Ro = U/(2ΩR) ≈ 0.08 at planet scale but ≈ 1–2 for 1/10 R
    eddies. Small eddies therefore behave like a stirred cup (“teacup scale”). The Coriolis range now
    goes to 30 (Ro ≈ 0.001–0.1) so the planetary regime can be tried; the default stays (look first).
    In a 2D incompressible model a uniform f is removed by the pressure projection; only its gradient
    β acts (Rossby waves, band width via the Rhines scale L = π√(2U/β)). Compact long-lived vortices
    need the finite deformation radius of ROADMAP 1c.
11. **New storms were short kicks with random spin.** Spawned storms were driven for 2.5 s and got a
    random spin; one spinning against the local shear is torn apart, so they flickered and vanished.
    Now the spin follows the background vorticity ζ ≈ −∂U/∂φ at the spawn latitude (anticyclones in
    anticyclonic zones, cyclones in cyclonic belts), and the drive duration is a control (“Kick duration”,
    default 2.5 s = old look). Long kicks let a vortex grow and then live on physics alone.
12. **Particle look was mixed with the dye look.** The particle mode restored colours to the band
    colours, storm tints and convection spots, exactly like the dye. jasper-r fades the texture to one
    centre colour, so structure comes only from particles. v0.3 separates the methods into tracks;
    the “Particles” track uses fade-to-centre (`blurFade`) and birth-latitude colours only. The old
    mixture is kept as the “Hybrid” track.
13. **Help box moved the controls (UI bug).** The help box grew with its text; the controls moved under
    the pointer, a different hint appeared, the box shrank again: an endless jitter. Now fixed height.
14. **Visible transitions on the sphere (open).** The author still sees face transitions (screenshot of a
    hot Jupiter, close-up). On Direct3D 12/Vulkan/Metal, cube sampling is specified as seamless, so
    finding 1 (measured in SwiftShader) may not apply. Second candidate: anisotropic numerical
    diffusion; grid lines kink at face edges, so smearing along a jet differs on both sides. v0.3 adds a
    **self-test** (Diagnostics) that measures seam error on the user’s GPU and switches on exact edge
    sampling if needed. **Measured in v0.3 (software renderer, film strips in `docs/eyes/`):** with
    hardware sampling the fluid track shows clear cube seams; with “Exact edges” on, they are gone
    completely ([before](eyes/v030-fluid-hardware-sampling.png), [after](eyes/v030-fluid-exact-edges.png)).
    The fix works; whether a given GPU needs it is what the self-test answers. Real fix candidates: equi-angular cube + halo texels, and ROADMAP 1a.
    Why a cube at all: a sphere cannot be covered by one regular grid without singular points (the
    poles of a latitude/longitude grid). The cube-sphere is what NASA’s FV3 weather model uses too.
15. **Relief is a lighting trick, not depth.** The normal is tilted by the brightness gradient; there is
    no height, parallax or silhouette. Real height needs a height field (ROADMAP 4). The terrain preview
    places its clouds on a real shell above the ground, so they show parallax and offset shadows.

## Core finding: the model runs in the wrong regime

Author’s objection (correct): “the maths behaves like a 10×10 cm object, not 1000×1000 km.”
Whether something looks like coffee or like Jupiter is decided by dimensionless numbers:

| Number | Coffee cup | Jupiter (GRS) | current model |
|---|---|---|---|
| Rossby number Ro = U/(f·L) | ≫ 1 (rotation irrelevant) | ≈ 0.1 | ≈ 0.7 with default controls (Coriolis now adjustable up to 30) |
| Reynolds number (effective) | ~10⁴ | enormous | ~10²–10³ from numerical viscosity |
| Deformation radius L_d/R | – | ≈ 0.02 (1000–2000 km) | ∞ (rigid lid) |
| Depth : width of vortices | ~1 : 1 (funnels) | ~1 : 40 (pancake; GRS a few 100 km deep) | 2D |

Missed in the research: Cho & Polvani 1996 (Physics of Fluids 8, 1531) — shallow-water turbulence on a
rotating sphere forms bands and vortices by itself, controlled by rotation, deformation radius and
(hyper)dissipation. Reference model in planetary science: EPIC (NASA-Planetary-Science/EPIC_Atmospheric_Model,
GPL, isentropic layers). The first plan chose the barotropic vorticity equation, which is the special
case L_d = ∞, the wrong starting point.

Second finding (comparison with the Alien: Isolation gas giant, “baked fluid sim and noise overlays”):
fine detail should not be transported as colour on the grid, but generated at render time from noise
at advected source coordinates. See [ROADMAP.md](ROADMAP.md) item 1a.

**Recommended next step:** ROADMAP 1a (advected texture coordinates, biggest visible gain), then
1b (atmospheric scattering), then 1c (shallow water with Ro ≈ 0.1, L_d/R ≈ 0.02, hyperviscosity,
h as cloud height).

## Author wishes still open

- Close-ups like Juno (filaments, relief) instead of only the distant view.
- Grandeur: slow, huge structures instead of fast small eddies (findings 9–11, ROADMAP 1c).
- Close-ups: when a game shows only a quarter of the planet, that quarter should get most of the work
  (particle track: “View focus”; fluid track: ROADMAP 1a).
- Rings that look like a 3D belt of particles with a soft volumetric shadow (ROADMAP 8).
- Moons on Kepler orbits with shadows (ROADMAP 9).
- Instant start without visible spin-up (ROADMAP 10: cached settled state).
- Continents under the atmosphere: first preview in `demos/terrain.html` (orographic clouds).
