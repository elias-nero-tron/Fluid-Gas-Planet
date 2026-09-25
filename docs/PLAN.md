# Plan: Echtzeit-Gasplaneten auf WebGPU

**Ziel:** Gasplaneten nur aus Mathematik und Simulation darstellen, ohne Bilddateien,
in Echtzeit im Browser über WebGPU. Jupiter ist der erste Maßstab, weil er am
besten vermessen ist. Das System soll aber von Anfang an auch Saturn, Uranus,
Neptun und erfundene Planeten über Parameter-Presets darstellen können.

Vorarbeit und Lizenzen: siehe [RECHERCHE.md](RECHERCHE.md).

---

## 1. Grundentscheidungen

| Frage | Entscheidung | Warum |
|---|---|---|
| API | **Reines WebGPU + WGSL**, TypeScript, Vite | WGSL läuft auch nativ (wgpu/Rust, Dawn). Keine Bindung an eine Engine; die Simulation sind Compute-Shader, dabei hilft three.js kaum. |
| Hilfsbibliotheken | `wgpu-matrix` (MIT), `tweakpane` (MIT) für Regler | klein, ohne Engine-Zwang |
| Gitter | **Cube-Sphere** (6 Flächen, `texture_2d_array` mit 6 Ebenen) | kein Polproblem wie bei equirect, fast gleich große Zellen, passt direkt zur Cubemap-Abtastung beim Rendern |
| Strömungsmodell | **Barotrope Wirbelstärke-Gleichung auf rotierender Kugel** statt reiner Stable Fluids | divergenzfrei per Konstruktion, Coriolis/β-Effekt erzeugt von selbst Jets, Rossby-Wellen und langlebige Wirbel – genau das, was Jupiter ausmacht |
| Farben | prozedurale Paletten (Gradienten aus Preset-Parametern) | keine JPG-Dateien |
| Rendering | Kugel als Impostor (Ray-Sphere im Fragment-Shader), Ellipsoid für Abplattung | pixelgenau, kein Mesh-LOD nötig |
| Lizenz | **Offen – Entscheidung nötig**, Empfehlung MIT | MIT: wir nehmen Code von MIT/BSD-Projekten und nur Ideen von GPL. GPL-3.0: wir dürfen zusätzlich Code von bloknayrb/gas-giant übernehmen, das Projekt bleibt dann aber GPL. |

## 2. Die Mathematik

### 2.1 Strömung (Wirbelstärke–Stromfunktion)
Auf der Kugel mit Radius `R` und Rotation `Ω`:

```
∂ζ/∂t + u·∇(ζ + f) = F(ζ) − ν₄ ∇⁴ζ − ζ/τ_drag
∇²ψ = ζ
u = k̂ × ∇ψ                      (Wind tangential zur Kugel, automatisch divergenzfrei)
f = 2Ω sin(φ)                    (Coriolis-Parameter, φ = Breitengrad)
```

- `ζ` relative Wirbelstärke (1 Skalar pro Zelle), `ψ` Stromfunktion.
- `u·∇f = β·v` ist der β-Effekt → Bänder, Rossby-Wellen, Wirbeldrift.
- `F(ζ)` **Jet-Forcing**: sanftes Zurückziehen zum Ziel-Windprofil des Presets:
  `F = (ζ_jet(φ) − ζ̄_zonal) / τ_jet`. `ζ_jet` folgt aus dem gemessenen zonalen
  Windprofil `U(φ)`: `ζ_jet = −(1/(R cos φ)) ∂(U cos φ)/∂φ`.
- `ν₄ ∇⁴ζ` Hyperviskosität: dämpft nur die kleinsten Skalen, lässt die großen Wirbel leben.
- Stürme: Wirbel-Patches (Gauß-Profile in `ζ`) werden eingesetzt und bei Bedarf
  „gefüttert“ (GRS, Oval BA). Kelvin-Helmholtz-Wellen an Jet-Rändern entstehen von selbst.

### 2.2 Tracer (was man sieht)
Mehrere Skalarfelder werden mit `u` advektiert, in **höherer Auflösung** als `ζ`:

```
∂c/∂t + u·∇c = (c_band(φ) − c)/τ_c + S_konvektion
```
- `c` z. B. RGBA16F: Wolkendicke (Ammoniak), Chromophor („braun/rot“), Wolkenhöhe, Sturm-Tönung.
- Das Zurückziehen zu `c_band(φ)` verhindert, dass alles zu grauem Brei vermischt.
- `S_konvektion`: zufällige helle Quellen (weiße Konvektionsflecken, Blitzstürme).

### 2.3 Numerik
- **Advektion:** semi-Lagrange mit MacCormack/BFECC (aus PavelDoGreat / three-fluid-fx).
  Rückverfolgung in **3D auf der Kugel** (Rotation um die Achse `p × u`), dann
  Cubemap-Abtastung → keine Kanten-Sonderfälle bei der Advektion.
- **Poisson-Löser** `∇²ψ = ζ` auf der Cube-Sphere: erst Jacobi/Red-Black-Gauss-Seidel
  (warm gestartet mit `ψ` vom letzten Frame), dann **Multigrid** (V-Zyklus) für Leistung.
- **Kanten zwischen Würfelflächen:** Halo-/Ghost-Zellen, ein eigener Compute-Pass
  kopiert Randstreifen zwischen Nachbarflächen (mit der richtigen Achsdrehung).
- Metrik-Terme: gnomonische (besser: equi-angular) Projektion, Zellflächen und
  Längen einmal vorberechnen und als Puffer ablegen.

### 2.4 Budget (Richtwerte, Mittelklasse-GPU)
| Feld | Auflösung | Zellen |
|---|---|---|
| `ζ`, `ψ` | 6 × 256² | 0,4 M |
| Tracer RGBA16F | 6 × 1024² | 6,3 M |
| Render-Detail | prozedurales Flow-Noise zur Laufzeit | – |

Ziel: Simulation ≤ 4 ms pro Frame, Rendering ≤ 4 ms bei 1440p.

## 3. Rendering

1. **Kugel/Ellipsoid**: Strahl-Ellipsoid-Schnitt im Fragment-Shader, Abplattung aus dem
   Preset (Jupiter 0,065, Saturn 0,098).
2. **Oberfläche**: Tracer-Cubemap abtasten → Palette → Albedo. Wolkenhöhe → Normalen
   (Relief der Sturmtürme wie in Bild 3/4).
3. **Unter-Gitter-Detail**: Flow-Noise, das mit `u` zweiphasig verschoben wird
   (Flow-Map-Technik mit zwei Phasen), damit Nahaufnahmen feine Wirbel zeigen, ohne die
   Simulationsauflösung zu erhöhen.
4. **Licht**: Randverdunkelung (Minnaert), Terminator mit Dunst-Streuung,
   Atmosphärenhülle über Hillaire 2020 aus `himmel-dunstkreis` (MIT).
5. **Ringe** (Saturn, Uranus): analytische Ringebene, Dichteprofil prozedural,
   Schatten Planet↔Ring. Grundlage: Ring-Shader aus `Eluvade/cosmos` (MIT).
6. **Tonemapping** HDR → sRGB (AgX oder ACES), optional Falschfarben-Modus
   wie bei JunoCam-Bearbeitungen (Bild 1).

## 4. Preset-System

Ein Planet ist eine JSON-Datei, kein Bild:

```jsonc
{
  "name": "Jupiter",
  "radius_km": 71492, "oblateness": 0.0649, "rotation_h": 9.925, "axial_tilt_deg": 3.13,
  "wind_profile": [[-80, 0], [-23, 60], [-7, 140], [7, 100], [23.5, 150], [80, 0]],  // [Breite°, m/s], wird geglättet
  "bands": { "palette": "jupiter", "contrast": 0.8, "chromophore": 0.6 },
  "storms": [
    { "name": "GRS", "lat": -22.0, "lon": 0, "size_km": 16000, "sign": "anticyclone", "persistent": true },
    { "name": "Oval BA", "lat": -33.0, "lon": 60, "size_km": 8000, "sign": "anticyclone", "persistent": true }
  ],
  "convection_rate": 0.3,
  "polar": { "cyclone_cluster": 8 },
  "rings": null
}
```
(Die Windprofil-Stützpunkte oben sind Platzhalter; echte Werte kommen aus
Tollefson 2017 / Porco 2003.)

Geplante Presets: **Jupiter, Saturn, Uranus, Neptun**, dazu Heißer Jupiter, Brauner Zwerg,
Eisriese und ein Zufallsgenerator (Seed → Parameter).

## 5. Projektstruktur

```
src/
  gpu/            Device, Feature-Erkennung, Puffer/Textur-Helfer
  sim/
    cubesphere.wgsl   Flächen ↔ Richtung, Metrik, Halo-Austausch
    advect.wgsl       MacCormack-Advektion auf der Kugel
    vorticity.wgsl    β-Term, Forcing, Hyperviskosität, Sturm-Einsatz
    poisson.wgsl      Jacobi / Multigrid
    velocity.wgsl     u = k × ∇ψ
    tracers.wgsl      Band-Relaxation, Konvektionsquellen
  render/
    planet.wgsl       Ellipsoid, Beleuchtung, Flow-Noise-Detail
    atmosphere/       übernommen aus himmel-dunstkreis
    rings.wgsl
  presets/*.json
  ui/             Tweakpane-Regler, Preset-Auswahl, Zeitraffer
tests/            WGSL-Kernel gegen TS-Referenz (Node + Dawn, wie himmel-dunstkreis)
```

## 6. Phasen

| # | Phase | Ergebnis |
|---|---|---|
| 0 | Gerüst: Vite + TS + WebGPU-Init, Fehlermeldung ohne WebGPU, Test-Setup | leere Szene, CI grün |
| 1 | Planet ohne Simulation: Ellipsoid-Impostor, Bänder aus `wind_profile`, FBM, Licht | sofort sichtbarer „Jupiter light“ |
| 2 | Cube-Sphere-Infrastruktur: Texturen, Koordinaten, Halo-Austausch, Debug-Ansicht | Testbild läuft nahtlos über alle 6 Flächen |
| 3 | Tracer-Advektion mit **vorgegebenem** Windfeld (nur Jets) | Bänder fließen, Scherung sichtbar |
| 4 | Wirbelstärke-Löser (`ζ`, Poisson, `u`) mit β-Effekt und Jet-Forcing | Jets und Wirbel entstehen selbst, Kelvin-Helmholtz-Wellen |
| 5 | Stürme und Konvektion: GRS, Ovale, Barges, Polarwirbel-Cluster | Bild 2 (Hubble) wiedererkennbar |
| 6 | Detail und Licht: Flow-Noise, Relief-Normalen, Atmosphäre, Tonemapping | Nahaufnahmen wie Bild 3/4 |
| 7 | Presets Saturn/Uranus/Neptun, Ringe, Abplattung, Zufallsplaneten | mehrere Gasplaneten |
| 8 | Leistung: Multigrid, Qualitätsstufen, Einschwingen vor Anzeige (Warm-up), Snapshot-Export | stabile 60 fps |

**Kalibrierung ab Phase 4:** Vergleich mit Hubble-OPAL-Karten (nur als Referenz, nie im Build):
Breite der Bänder, Drift-Geschwindigkeit des GRS (~ −3 bis −4 m/s relativ System III),
Jet-Maxima (~ 150 m/s bei 23,5° N).

## 7. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Poisson-Löser zu langsam | Warmstart + Multigrid; notfalls `ψ` nur jeden 2. Frame lösen |
| Tracer vermischen zu grauem Brei | Relaxation zu `c_band`, MacCormack statt einfacher Advektion |
| Sichtbare Nähte an Würfelkanten | equi-angulare Projektion, Advektion in 3D, Halo-Tests in CI |
| Simulation braucht lange bis zum „fertigen“ Look | Warm-up-Schritte mit großem Zeitschritt vor der ersten Anzeige; sofort Phase-1-Shader zeigen |
| WebGPU-Unterstützung | Chrome/Edge/Safari 26+/Firefox 141+ haben WebGPU; sonst klare Meldung |
