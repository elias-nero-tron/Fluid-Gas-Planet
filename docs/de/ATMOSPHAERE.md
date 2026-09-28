# Modul „Atmosphäre“: feuchte Flachwasser-Atmosphäre mit Wolkenschicht

Rechenmodell **„Feuchte Atmosphäre mit Wolken“** im Gasriesen (Panel → Verfahren → Rechenmodell).
Es läuft neben Stable Fluids und Curl-Noise, ersetzt nichts und lässt sich mit jeder Darstellung
(Farbstoff, Partikel) kombinieren. Code: `src/atmo/` (eigene Felder, eigene Shader, eigene Uniforms),
in `src/main.ts` nur eingehängt.

## Grundsatz: fertige, geprüfte Formeln statt eigener Erfindung

Alles kommt aus offenem, getestetem Forschungs- bzw. Produktionscode oder aus Standardtests:

| Baustein | Quelle | Lizenz |
|---|---|---|
| Gleichungen der feuchten, thermischen Flachwasser-Atmosphäre, Sättigung, Kondensation, Regen, Parameter | Zerroukat & Allen 2015 (J. Comput. Phys. 290), umgesetzt in [Gusto](https://github.com/firedrakeproject/gusto) (UK Met Office): `ThermalShallowWaterEquations`, `SWSaturationAdjustment`, `InstantRain`, Beispiele `moist_thermal_williamson_5.py`, `moist_convective_williamson_2.py` | MIT |
| Konvektive Rückkopplung auf die Masse (β₁) | Bouchut, Lambaerts, Lapeyre & Zeitlin 2009 (mcRSW), in Gusto `convective_feedback` | MIT (Gusto) |
| Stürme als Massenpulse mit geostrophisch balanciertem Wind, Poisson-Zeitpunkte, Parameter für Jupiter | Showman 2007 (J. Atmos. Sci. 64); Code: [canoe](https://github.com/chengcli/canoe) `examples/2023-Chen-exo3/test_injection.cpp` (Cheng Li u. a., ExoCubed) | MIT |
| Tiefe Jets als „Bodenhöhe“ der Wetterschicht | Dowling & Ingersoll 1989 (J. Atmos. Sci. 46) | – |
| Newton-Abkühlung | Held & Suarez 1994 (Bull. AMS 75) | – |
| Löser-Test | Galewsky, Scott & Polvani 2004 (Tellus A 56); Parameter wie im [Dedalus](https://github.com/DedalusProject/dedalus)-Beispiel `ivp_sphere_shallow_water` | GPL (nur Zahlenwerte des Tests) |
| Wolkendarstellung: Wetterkarte → Dichte, Höhenprofil, Form-Erosion, Mehrfachstreuung, Phase, Pulver, Integration | [takram three-clouds](https://github.com/takram-design-engineering/three-geospatial) (`clouds.glsl`, `clouds.frag`, `CloudLayers.ts`, 2024/2025), setzt Nubis (Schneider, Guerrilla Games 2015–2023) um | MIT |
| Kachelbares Perlin-Worley-Rauschen | S. Hillaire, [TileableVolumeNoise](https://github.com/sebh/TileableVolumeNoise), in takram `cloudShape.frag` | MIT |
| Energieerhaltende Streu-Integration | Hillaire 2016, *Physically Based Sky, Atmosphere and Cloud Rendering in Frostbite* | – |
| Mehrfachstreuung in Oktaven | Wrenninge et al. 2013, *Oz: The Great and Volumetric* | – |

Nicht kopiert: der WGSL-Code ist neu geschrieben, übernommen sind Gleichungen, Verfahren und Zahlenwerte.

## Gleichungen

Einheiten: Planetenradius 1, Schichtdicke D in Einheiten der mittleren Tiefe H, c² = gH, Zeit in Sim-Sekunden.

```
∂u/∂t + (u·∇)u + f k̂×u = −c²·[ b̃·∇(η + B) − ½·D·∇θ ]      b̃ = 1 − θ,  D = 1 + η
∂D/∂t + ∇·(D u)        = −β₁·C
∂θ/∂t + u·∇θ           =  β₂·C  + (θ_eq − θ)/τ
∂q_v/∂t + u·∇q_v       = −C + E
∂q_c/∂t + u·∇q_c       =  C − P
q_sat = q₀ · exp(ν·θ) / D                                   (ν = 20 wie Zerroukat & Allen)
C = γ_v·(q_v − q_sat)/Δt,  begrenzt auf [−q_c, q_v]/Δt,   γ_v = 1/(1 + ν·β₂·q_sat)
P = max(0, q_c − q_p)·(1 − e^(−Δt/τ_r))/Δt
E = max(0, RH·q_sat − q_v)·(1 − e^(−Δt/τ_e))/Δt
```

**Gasriese:** B ist die Wirkung der tiefen Jets (Dowling & Ingersoll): aus dem Gradientwind-Gleichgewicht
`(f + u·tanφ)·u = −c²·b̃·∂B/∂φ`. Die Wetterschicht selbst ist dann fast flach und trägt die Wirbel.
**Gesteinsplanet (später):** B = echtes Gelände, E nur über dem Meer. Dieselben Gleichungen.

Rotation aus der echten Rossby-Zahl: `Ω_sim = U_sim·Ω_echt·R/U_echt` (Wind, Radius, Tageslänge aus dem
Steckbrief). Jupiter mit Jet-Geschwindigkeit 0,06 → Ω ≈ 5. Schwerewellen: `c = L_d·f(45°)`, mindestens
2,5·U (Froude ≤ 0,4). Jupiter L_d ≈ 0,03 R (canoe: φ₀ = 5·10⁵ m²/s², Ω = 1,74·10⁻⁴ s⁻¹).

## Numerik (pro Teilschritt, drei Durchgänge)

1. **aAdvect**: Semi-Lagrange, Abfahrtspunkt mit Mittelpunktregel, Wind per Rodrigues-Drehung
   parallel transportiert (3D-Tangentialvektoren, keine Pol-Singularität).
2. **aMass**: `D ← D·exp(−Δt·∇·u)` (Lagrange-Form, bleibt positiv), schwache Diffusion, Newton-Abkühlung,
   Ereignisse, Sättigungsausgleich, Regen.
3. **aMomentum**: Druckkraft mit dem neuen D (Vorwärts-Rückwärts-Verfahren), Ereignis-Wind,
   Coriolis als exakte Drehung um die Flächennormale, Reibung.

Teilschritte nach der Schwerewellen-CFL: `n = ⌈c·Δt·N/0,45⌉` (N = Gitter je Würfelseite).
Kein Poisson-Löser nötig (Stable Fluids braucht 24 Jacobi-Durchgänge pro Schritt).

## Ereignisse (Tippen auf den Planeten)

Alle sind Quellterme in denselben Gleichungen, Gauß-Profil `exp(−½·d²/r²)`:

| Ereignis | Δη | Δθ | Δq_v | Asche | Wind |
|---|---|---|---|---|---|
| Sturm (Hoch/Tief) | ±0,1 | – | +0,3 | – | geostrophisch `u = c²/f·k̂×∇η` (canoe) |
| Einschlag | +0,25 | +0,05 | +0,2 | 1,5 | radialer Stoß; kein Gleichgewicht → Schwerewellen-Ring (Shoemaker-Levy 9, Ingersoll & Kanamori 1995) |
| Explosion | +0,15 | +0,12 | +0,6 | 0,4 | starker radialer Stoß → Druckwelle, Feuerwolke |
| Vulkan | 10 s lang je Sekunde +0,03 | +0,02 | +0,5 | 0,6 | – |

## Wolkenschicht

Eigener Zeichendurchgang über dem fertigen Planetenbild (vormultipliziertes Alpha), durchsichtig, wo keine
Wolke ist: `Ergebnis = Wolkenlicht + Bild × Durchlässigkeit × Wolkenschatten`. Damit lässt sie sich auch
über einen Gesteinsplaneten legen.

```
Bedeckung   w = 1 − exp(−k·q_c)
Oberkante   0,3 + 0,5·w + 6·max(θ − θ_eq, 0)        (latente Wärme hebt Türme)
Profil      1 − (2·h^0,35 − 1)²                      (takram shapeAlteringFunction)
Dichte      remap(mix(w, 1, 0,6), 1 − 0,4·Profil, 1 − 0,4·Profil + 0,6)
Form        remap(Dichte, (1 − PerlinWorley)·0,8, 1), dann Detail-Erosion
Licht       Σᵢ 0,5ⁱ · e^(−0,5ⁱ·τ) · p(0,5ⁱ·cosθ),  p = ½·HG(0,7) + ½·HG(−0,2)
Integration L += T · S · (1 − e^(−σΔs)),  T *= e^(−σΔs)
```

## Prüfung

Siehe Abschnitt „Ergebnisse“ unten (Galewsky-Test, Filmstreifen).

## Nächste Schritte

- **Gesteinsplanet:** B aus der Höhenkarte, Verdunstung nur über Meer, Erd-Windprofil (3 Zellen je Halbkugel).
  Die Wolkenschicht ist schon ein eigenständiger Zeichendurchgang.
- **Vulkan- und Explosionssäulen in 3D:** lokale Kästen mit Auftrieb (three.js `webgpu_volume_fire`, MIT),
  gespeist aus den Ereignissen dieses Moduls.
- **Detail beim Hineinzoomen:** Formrauschen mit dem Wind mitführen (Neyret 2003, zwei Phasen).
