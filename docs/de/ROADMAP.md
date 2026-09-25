# Baustellen und Roadmap

Sortiert nach Wirkung. Jede Baustelle ist so beschrieben, dass man sie ohne Vorwissen aus
dem Entwicklungsgespräch anfangen kann. Hintergrund: [STATUS.md](STATUS.md), Formeln: [MATHEMATIK.md](MATHEMATIK.md).

## Stärken, auf denen man aufbauen kann

- **Läuft in Echtzeit im Browser**, auf integrierter Grafik 25–41 fps (Nutzer-Test v0.1).
- **Keine Bilddateien**: Planeten sind Zahlen (Windprofil, Farbbänder, Stürme). Fünf Vorlagen
  plus Zufallsplanet plus „Farben aus Bild“.
- **Zwei Verfahren frei kombinierbar**: Stable Fluids (physikalisch) und Curl-Noise/Partikel
  (Gaseous-Giganticus-Rezept), jeweils mit Farbstoff oder Partikeln.
- **Saubere Kugel-Geometrie**: Würfelkugel ohne Pol-Singularität, Wind als 3D-Tangentialvektor,
  Ableitungen mit echter Gittermetrik, nahtloses Abtasten über Kanten.
- **Physik mit Begründung**: Coriolis als exakte Drehung, Jets über das Breitenkreis-Mittel,
  Stürme frei beweglich, Drucklöser. Jeder Regler erklärt im Panel, was er physikalisch tut.
- **Darstellung**: Ellipsoid, Minnaert-Randverdunkelung, Relief, Dunstsaum, Ringe mit
  Schatten und Antialiasing.
- **Testbarkeit**: `#offscreen`-Modus mit Bild- und Feldauslese für Headless-Tests.
- **Ehrliche Befundlage**: Jeder bekannte Fehler ist gemessen und dokumentiert.

## Schwachpunkte (bekannt)

| Schwachpunkt | Ursache | Siehe |
|---|---|---|
| Wirkt aus der Nähe wie eine kleine, zähe Flüssigkeit statt wie Jupiter | Detail wird über das Gitter geschoben statt getrennt erzeugt; dazu falscher Kennzahlenbereich (Ro zu groß, effektive Reynolds-Zahl zu klein, kein Deformationsradius) | Baustelle 1a, 1c, 2 |
| Keine kompakten, runden Wirbel; stattdessen Nord-Süd-Wellen | 2D-inkompressibel = Deformationsradius unendlich | Baustelle 1c |
| Keine echte 3D-Tiefe | nur eine Schicht; Relief aus Helligkeit geschätzt | Baustelle 4 |
| Details verschwimmen oder Bänder zerfließen | Rückstellung statt Quellen; Transport ohne Begrenzer | Baustelle 2, 3 |
| v0.2-Änderungen nicht auf echter Hardware bestätigt | nur Software-Renderer geprüft | Baustelle 0 |

## Baustellen

### 0. v0.2 auf echter Hardware prüfen (klein, zuerst)
Checkliste: keine Linien an Würfelkanten (Saturn, Relief an), fps gegenüber v0.1 (25–41 fps auf
iGPU), Aussehen nicht schlechter, Kaffee-Demo läuft. Wenn `sampleCube()` zu teuer ist: Halo-Texel
(1 Texel Rand je Fläche, per eigenem Pass befüllt) statt Verzweigung.

### 1a. Advektierte Texturkoordinaten, „Maßstäbe trennen“ (mittel, größter sichtbarer Gewinn)
Befund nach Vergleich mit Alien: Isolation („baked fluid sim + noise overlays“) und
bloknayrb/gas-giant („advected-coordinate noise for flow-stretched filament detail“):
Bisher wird **Farbe** über das Gitter geschoben. Jedes Detail muss aufgelöst werden und verschmiert.
Besser: Die Simulation rechnet nur die großen Strömungen; zusätzlich wird eine **Herkunftskoordinate**
(woher kommt dieser Punkt?) mitgeführt. Beim Zeichnen entsteht die Feinstruktur aus Rauschen an
dieser Koordinate, in beliebiger Auflösung, von der Strömung zu Schlieren gezogen.
Gegen Überdehnung 2–3 Phasen, zeitversetzt neu gestartet und weich überblendet.
Quellen: Max & Becker 1995 (Flow Textures), Perlin & Neyret 2001 (Flow Noise),
Neyret 2003 (Advected Textures). Umsetzung: neues Feld `uvw` (rgba16float, Herkunft als
Richtung + Phase) mit `advectDye`-Logik, Detailrauschen in `render.wgsl` statt aus `dyeTex`.

**Sichtabhängiges Detail (Idee von elias-nero-tron):** Detailarbeit nur dort, wo die Kamera hinschaut.
Heranzoomen wird schärfer, ohne fps zu kosten. Reine Partikel-Konzentration im Sichtfeld hat einen Haken:
Neu sichtbare Stellen haben beim Drehen keine Schlieren-Vorgeschichte. Mit advektierten Koordinaten bleibt
die Strömung global und billig, das Detail entsteht pro sichtbarem Pixel, also genau „näher = feiner,
gleiche Kosten“. (jasper-rs Artikel verteilt die Partikel über die ganze Kugel; das ist nicht der Grund
für den guten Look dort, sondern Licht und weiche Schlieren.)

### 1b. Echte Atmosphärenstreuung (mittel)
Weiches Streulicht am Rand und durchscheinende Wolken machen einen großen Teil des
Alien-Isolation-Looks aus. MIT-lizenzierte WebGPU-Umsetzung: cgcostume/himmel-dunstkreis
(Bruneton 2008 / Hillaire 2020), für eine Kugel mit dichter Atmosphäre anpassen.

### 1c. Flachwasser-Kern (groß, richtige Wirbel-Physik)
Ersetze in `fluid.wgsl` die Druck-Projektion durch Flachwasser-Gleichungen auf der Kugel:
`∂u/∂t + (u·∇)u + f k̂×u = −g∇h + ν₄∇⁴u`, `∂h/∂t + ∇·(h u) = Q`.
Parameter aus Jupiter-Kennzahlen ableiten: Ro ≈ 0,1, L_d = √(gH)/f ≈ 0,02·R.
Erwartung (Cho & Polvani 1996): Bänder und kompakte, langlebige Wirbel entstehen von selbst.
Zeitschritt: Schwerewellen begrenzen Δt (CFL mit √(gH)), eventuell semi-implizit.

### 2. Hyperviskosität und Begrenzer (mittel)
∇⁴-Dämpfung nur der kleinsten Skalen. In `advect`/`advectDye` den Min/Max-Begrenzer aus
`demos/coffee.html` (`advectCream`) übernehmen. Ziel: Filamente bleiben scharf, ohne Rauschen.

### 3. Konvektion als Quelle (mittel)
Aufquellende Wolken als Quellterm Q (in Flachwasser: Masse in h) statt als Farbfleck.
Prototyp in der Kaffee-Demo (`source()`, `divergence()`). Liefert die turbulenten Gebiete neben
dem Großen Roten Fleck und weiße Konvektionstürme.

### 4. Schichten und echte Höhe (groß)
2–3 Schichten (NH₄SH-Wolken, NH₃-Wolken, Dunst), h als Wolkenhöhe fürs Relief, Schatten der
oberen Schicht auf die untere. Referenzmodell: EPIC (isentrope Schichten).

### 5. Nahaufnahmen (mittel)
Level-of-Detail: beim Zoomen zusätzliches, mit dem Wind verschobenes Detailrauschen
(zweiphasige Flow-Map), damit Juno-artige Filamente unterhalb der Gitterauflösung entstehen.

### 6. Leistung (mittel)
Multigrid statt Jacobi; Flussfeld im Curl-Modus nur alle n Bilder neu; Qualitätsstufen automatisch nach fps.

### 7. Kleinere Wünsche
- ~~Zufallsplanet mit mehr Zufall~~ erledigt in v0.2.3 (Familien, ungleiche Bänder, Sturmtypen, Ringe; Speichern/Rückgängig).
- Gleichmäßigere equi-angulare Würfelprojektion.
- Presets als JSON-Dateien laden/speichern.
- Idee „Kontinente unter die Atmosphäre“ (Erdwetter): braucht Heizung, Wasserdampf mit
  Kondensation und Topographie. Eigenes Folgeprojekt, gleiche Grundlage.
