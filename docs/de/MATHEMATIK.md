# Mathematik und Code

Jedes Verfahren mit Formel, Fundstelle im Code, Zweck und bekanntem Mangel.
Status: ✅ geprüft (Nutzer-Test auf Hardware oder Messung), 🔶 nur im Software-Renderer geprüft, ⚠️ bekannter Mangel.

## 1. Geometrie: die Kugel als aufgeblasener Würfel

**Würfelkugel (gnomonische Projektion).** Jede der 6 Würfelflächen ist ein N×N-Gitter, Parameter
a, b ∈ [−1, 1]. Richtung auf der Kugel = normalize(Flächenpunkt), z. B. +X: `normalize(1, −b, −a)`.
Reihenfolge und Orientierung folgen der WebGPU-Cubemap-Konvention (+X, −X, +Y, −Y, +Z, −Z).

- Code: `faceDir()` und `cubeUV()` in [`src/shaders/common.wgsl`](../../src/shaders/common.wgsl)
- Warum: keine Pol-Singularität (anders als eine Längen-/Breitengrad-Karte), fast gleich große Zellen.
- ✅ Zuordnung gemessen: frisch geschriebenes Richtungsfeld wird fehlerfrei zurückgelesen.
- ⚠️ Zellen an Kanten sind im Winkel etwa halb so groß wie in der Flächenmitte (1/(1+a²)).
  Equi-angulare Projektion wäre gleichmäßiger.

**Wind als 3D-Tangentialvektor.** Statt (Ost, Nord) wird u ∈ ℝ³ mit u·p = 0 gespeichert.
Tangentialprojektion: `tangent(p, v) = v − p (p·v)`. Ostvektor: `east(p) = normalize(ŷ × p)`.
- Vorteil: keine Koordinaten-Sonderfälle an Polen und Kanten.

**Nahtloses Abtasten über Würfelkanten.** `sampleCube()`: im Flächeninneren Hardware-bilinear
auf der 2D-Array-Textur; nahe der Kante werden die 4 Nachbar-Texel einzeln geholt, Texel jenseits
der Kante über `faceDir(face, st außerhalb [0,1])` auf der Nachbarfläche.
- ✅ Gemessen: Hardware-Cubemap-Abtasten hatte nahe Kanten bis 0,139 Fehler gegenüber 0,0003
  im Inneren. Das hat pro Simulationsschritt Fehler angehäuft („Narben“). Seit dem Fix sind die
  Narben im Test verschwunden. 🔶 Vom Nutzer auf Hardware noch nicht bestätigt, fps-Kosten unbekannt.

## 2. Strömung: Stable Fluids auf der Kugel

Datei: [`src/shaders/fluid.wgsl`](../../src/shaders/fluid.wgsl). Pro Schritt:
`advect → curl → zonalClear/zonalSum → forces → divergence → jacobi × K → project`.

**Gitter-Ableitungen mit echter Metrik.** Für jede Zelle werden die Nachbarn pE, pW, pN, pS
aus der Flächenparametrisierung bestimmt. Der Gradient g einer Größe f löst das 2×2-System

```
[ dA·e₁  dA·e₂ ] [g₁]   [ f_E − f_W ]
[ dB·e₁  dB·e₂ ] [g₂] = [ f_N − f_S ]     mit dA = pE − pW, dB = pN − pS
```

- Code: `cell()`, `grad2()`. Divergenz = ∂u₁/∂x + ∂u₂/∂y, Wirbelstärke ζ = ∂u₂/∂x − ∂u₁/∂y.
- Warum: Das Würfelgitter ist ungleichmäßig und schiefwinklig. Ein fester Abtastabstand
  (erste Version) hat Gitterrauschen nicht erkannt.

**Advektion (Semi-Lagrange + BFECC).** Rückverfolgung auf der Kugel:
`src = normalize(p − u·Δt)`. BFECC (Back and Forth Error Compensation): rückwärts, vorwärts,
halben Fehler abziehen, nochmal rückwärts. Danach Paralleltransport: in die Tangentialebene bei p
projizieren und den Betrag erhalten.
- Code: `advect()`. Vorlage: mofu-Artikel, Stam 1999.
- ⚠️ Kein Begrenzer (Selle 2008). In der Kaffee-Demo ist er drin, bei Jupiter noch nicht.

**Coriolis als exakte Drehung.** Die Coriolis-Beschleunigung −f k̂×u dreht den Windvektor in der
Tangentialebene. Statt Euler-Schritt eine exakte Drehung um die Normale p:

```
u' = u·cos(a) + (p × u)·sin(a),    a = −2Ω·sin(φ)·Δt = −2Ω·p_y·Δt
```

- Code: `forces()`. Erzeugt β-Effekt, Rossby-Wellen und geostrophisches Gleichgewicht der Jets.

**Jet-Rückstellung nur auf das Breitenkreis-Mittel.**

```
u += ê_Ost · (U_Profil(φ) − ⟨u·ê_Ost⟩_Breitenkreis) · min(k·Δt, 1)
```

Das Mittel ⟨·⟩ wird jeden Schritt auf der GPU gebildet: 128 Breitenbänder, flächengewichtete
Summe mit `atomicAdd` in Festkomma (`zonalSum`), linear interpoliert (`zonalMean`).
- ✅ Befund: Die erste Version zog *jede* Ost-West-Komponente zurück und bügelte damit
  jeden Wirbel in Sekunden platt.

**Druck-Projektion (Helmholtz-Zerlegung).** ∇²p = ∇·u mit kompaktem 5-Punkt-Stern und Jacobi:

```
p₀ = ( a_x (p_E + p_W) + a_y (p_N + p_S) − ∇·u ) / (2 (a_x + a_y)),   a_x = 1/h_x², a_y = 1/h_y²
u ← u − ∇p
```

- Code: `divergence()`, `jacobi()`, `project()`. Warmstart mit dem Druck des letzten Schritts.
- ⚠️ Jacobi konvergiert langsam. Multigrid wäre der nächste Leistungsschritt.

**Vorticity Confinement (Fedkiw 2001).** `f = ε·Δx·(N × ζ p̂)`, N = ∇|ζ|/|∇|ζ||.
- ✅ Befund: Standard ε = 6 war etwa 10-mal zu stark (≈ 0,1 rad/s² bei Jets von 0,06 rad/s)
  und hat Gitterrauschen aufgepumpt. Jetzt 0,5.

**Stürme.** Drehprofil v(d) = x·e^{−x²}·2,33 mit x = d/r, Drehsinn aus Zyklon/Antizyklon und
Hemisphäre (Nordhalbkugel: Zyklon gegen den Uhrzeigersinn). Beim Start als Anfangswirbel
eingesetzt (`initVel`), danach frei. Optional festgehalten oder als kurzer Konvektionsstoß neu erzeugt.
- Code: `stormFlow()`, `stormMask()` in `common.wgsl`, `updateStorms()` in `main.ts`.

**Turbulenz.** Langsam wandernde, divergenzfreie Anregung (siehe 3.) mit Reibung als Energiegrenze.

## 3. Rauschen und Curl-Noise

**Gradientenrauschen mit analytischer Ableitung** (Quintic-Interpolation 6t⁵ − 15t⁴ + 10t³):
liefert Wert und Gradient in einem Durchgang. Code: `noised()`. Hash: `pcg3d` (Jarzynski & Olano 2020).

**Curl-Noise auf der Kugel.** Nimmt man Rauschen ψ als Stromfunktion, ist

```
v = p × ∇ψ
```

tangential und divergenzfrei (Bridson 2007, auf die Kugel übertragen). Code: `curlOnSphere()`.

**Rezept Gaseous Giganticus** (Code: `flowField()`, `curlVortices()` in `tracers.wgsl`):
Wind = Bandprofil + Curl-Noise + Wirbel. Wirbel nur dort, wo |U| < 0,35·U_max, Drehsinn wie die
Hintergrund-Wirbelstärke ζ ≈ −∂U/∂φ (sonst reißt die Scherung sie), Winkelgeschwindigkeit
ω(d) = ω₀·sin(π·d/r). Partikel dürfen ewig leben.

## 4. Sichtbare Wolken

**Farbstoff (Tracer).** Farbe wird wie der Wind advektiert und langsam zur Bandfarbe zurückgezogen:
`c ← mix(c, c_Band(φ + Mäander), 1 − e^{−k·Δt})`. Dazu „Feinstreifen“: feine Farbschwankungen
entlang der Breite, damit Dehnung sichtbar wird.
- ⚠️ Rückstellung und Weichzeichnen löschen Details. Mit wenig Rückstellung bleiben Details,
  aber die Bänder verschwimmen langfristig. Ein echter Ausgleich fehlt (Quellen statt Rückstellung).

**Partikel (jasper-r / Gaseous Giganticus).** Bis zu 4 Mio. Partikel, RK2-Schritt auf der Kugel:
`mid = normalize(p + v(p)·Δt/2)`, `p ← normalize(p + v(mid)·Δt)`. Jedes Partikel mischt seine
Farbe mit Deckkraft α·sin(π·Alter/Lebensdauer) in die Textur, danach Weichzeichnen und Rückstellung.

## 5. Darstellung (`render.wgsl`)

| Verfahren | Formel / Idee |
|---|---|
| Planet als Ellipsoid | Strahl-Ellipsoid-Schnitt: y wird mit 1/(1−Abplattung) skaliert, dann Kugelschnitt |
| Randverdunkelung (Minnaert) | I = A·(n·l)^k·(n·v)^(k−1), k = 1 ist Lambert |
| Relief | Normale gekippt um den Helligkeitsgradienten: helle Wolken = höher (Näherung!) |
| Dunstsaum | e^{−h/0,025}·Sonnenstand am Rand |
| Ringe | Ebenenschnitt y = 0 im Körpersystem, Dichteprofil mit Cassini-Teilung, Schatten beidseitig |
| Ring-Antialiasing | Pixel-Fußabdruck = t·Pixelwinkel/|d_y|; Feinstruktur wird ausgeblendet, sobald schmaler als ein Pixel |
| Tonemapping | ACES-Näherung (Narkowicz), dann Gamma 2,2 |

## 6. Kaffee-Demo (`demos/coffee.html`)

Stable Fluids in 2D, dazu drei Bausteine, die dem Jupiter-Modell noch fehlen:
- **Quellterm im Drucklöser:** ∇²p = ∇·u* − S. Danach gilt ∇·u = S: Die Oberfläche strömt dort
  auseinander, wo Sahne aufquillt oder einfließt.
- **Bewegtes Hindernis:** Im Löffel wird u auf die Löffelgeschwindigkeit gesetzt, dahinter entsteht eine Wirbelschleppe.
- **BFECC mit Min/Max-Begrenzer:** scharfe Sahnefäden ohne Überschwinger.
- Status: Shader kompilieren, das Bild ist ungetestet.

## 7. Was mathematisch fehlt (Priorität)

1. **Flachwasser-Gleichungen** statt 2D-inkompressibel: Felder u und h,
   ∂u/∂t + (u·∇)u + f k̂×u = −g∇h, ∂h/∂t + ∇·(h u) = 0.
   Erst damit gibt es einen Rossby-Deformationsradius L_d = √(gH)/f und kompakte Wirbel
   (Cho & Polvani 1996). Jupiter: L_d/R ≈ 0,02, Ro ≈ 0,1.
2. **Hyperviskosität** ν₄∇⁴ statt numerischer Zähigkeit: dämpft nur die kleinsten Skalen.
3. **Begrenzer** (Selle 2008) auch im Jupiter-Transport.
4. **Konvektion als Quelle** (∇·u = S an der Wolkenobergrenze) statt als Farbfleck.
5. **Mehrere Schichten** (NH₄SH, NH₃, Dunst) für echte Tiefe und Schatten; h als Wolkenhöhe.
6. **Multigrid** für den Druck, **equi-angulare** Würfelprojektion.
