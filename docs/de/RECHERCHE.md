# Recherche: Vorhandene Open-Source-Arbeit

Stand: 2026-09. Ziel: Möglichst viel Vorarbeit übernehmen – aber nur dort, wo die Lizenz es
erlaubt. Lizenzen wurden auf den GitHub-Seiten geprüft; **„prüfen“** heißt: vor dem
Übernehmen von Code die LICENSE-Datei selbst ansehen.

## Kurzfazit

Einen fertigen **Echtzeit-Gasplaneten auf WebGPU mit echter Strömungssimulation auf der Kugel**
gibt es nach dieser Suche **nicht**. Es gibt aber alle Einzelteile:

| Baustein | Bestes Vorbild | Lizenz | Übernehmen? |
|---|---|---|---|
| Physik-Modell Gasplanet (Jets, Stürme, Presets) | [bloknayrb/gas-giant](https://github.com/bloknayrb/gas-giant) | GPL-3.0 | Ideen und Parameter ja, Code nur wenn unser Projekt GPL wird |
| Stable Fluids in WGSL (Compute) | [kishimisu/WebGPU-Fluid-Simulation](https://github.com/kishimisu/WebGPU-Fluid-Simulation), [mikerkoval/FluidSimulation](https://github.com/mikerkoval/FluidSimulation) | prüfen | Struktur der Compute-Pässe |
| Stable Fluids + Vorticity Confinement + BFECC | [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), [artcodev/three-fluid-fx](https://github.com/artcodev/three-fluid-fx) | MIT / MIT | ja, Kernel-Logik portieren |
| Atmosphäre (Bruneton / Hillaire) in WGSL | [cgcostume/himmel-dunstkreis](https://github.com/cgcostume/himmel-dunstkreis) | MIT | ja, direkt |
| Referenz Bruneton | [ebruneton/precomputed_atmospheric_scattering](https://github.com/ebruneton/precomputed_atmospheric_scattering) | BSD-3 | ja |
| Prozedurale Gasriesen (FBM, Ringe) als Fallback | [Eluvade/cosmos](https://github.com/Eluvade/cosmos) | MIT | ja (Ring-Shader, Noise) |
| Partikel-Advektion auf der Kugel (Cubemap) | [smcameron/gaseous-giganticus](https://github.com/smcameron/gaseous-giganticus) | GPL-2.0 | nur Ideen |
| Gasplanet im Browser-Spiel (BabylonJS) | [BarthPaleologue/CosmosJourneyer](https://github.com/BarthPaleologue/CosmosJourneyer) | AGPL | nur Ideen |
| WebGPU-Projektstruktur (Kugel-Sim, Rendering) | [matsuoka-601/WaterBall](https://github.com/matsuoka-601/waterball) | prüfen | Setup/Tooling |
| Planet-Shader mit Fake-Atmosphäre | [jsulpis/realtime-planet-shader](https://github.com/jsulpis/realtime-planet-shader) | prüfen | Beleuchtung, Terminator |

## Die Projekte im Detail

### 1. bloknayrb/gas-giant – die wichtigste Referenz (GPL-3.0)
- Python 3.13 + OpenGL 4.3 (GLSL-Compute), **offline** Textur-Generator mit Live-Vorschau.
- Geschwindigkeitsfeld aus einer **Stromfunktion** (divergenzfrei per Konstruktion):
  abwechselnde Zonal-Jets, eingesetzte Sturmwirbel, Scherturbulenz.
- Advektion: **semi-Lagrange MacCormack**.
- Gitter: equirektangulär **plus zwei azimutal-äquidistante Polkappen**, die pro Schritt
  Daten austauschen (Lösung des Polproblems).
- 4 Tracer: Farbe, Höhe, Detail, Sturm-Tönung.
- 9 Presets: Jupiter-ähnlich, Saturn, Neptun, Eisriese, Brauner Zwerg, Heißer Jupiter …
- Features: Zonen/Bänder mit mäandernden Rändern, GRS-artige Antizyklone mit Nachlauf,
  weiße Ovale, braune Barges, „String of Pearls“, Kelvin-Helmholtz-Wellen.

**Für uns:** Das ist inhaltlich fast genau unser Plan – nur offline und GLSL statt Echtzeit
und WGSL. Wir lesen es als Physik-/Parameter-Referenz. Code übernehmen geht nur, wenn wir
selbst GPL-3.0 wählen (siehe Lizenzentscheidung in [PLAN.md](PLAN.md)).

### 2. Stable-Fluids-Implementierungen (die Basis aus dem mofu-dev-Artikel)
- Der verlinkte [mofu-dev-Artikel](https://mofu-dev.com/en/blog/stable-fluids/) beschreibt
  Stams Stable Fluids in three.js/WebGL (Advektion → Kräfte → Divergenz → Druck-Jacobi →
  Projektion). Das ist das Grundrezept, aber für eine **flache** 2D-Fläche.
- **kishimisu** und **mikerkoval**: dasselbe Rezept schon als WGSL-Compute-Shader.
- **PavelDoGreat** (MIT, 16k Sterne): Produktionsreife Kniffe – Vorticity Confinement,
  Splats, Dye-Auflösung höher als Sim-Auflösung.
- **three-fluid-fx** (MIT): Stable Fluids mit BFECC-Advektion und Vorticity Confinement,
  auch als WebGPU/TSL-Pipeline.

**Für uns:** Die Pässe (Advektion, Jacobi, Gradient) übernehmen wir fast 1:1, stellen aber
auf die Kugel um (Cube-Sphere-Gitter, siehe Plan) und wechseln auf die
Wirbelstärke-Formulierung, die für rotierende Planeten die richtige Physik ist.

### 3. gaseous-giganticus (GPL-2.0)
- C-Programm, erzeugt **Cubemaps**. Millionen Partikel werden über ein Curl-Noise-
  Geschwindigkeitsfeld auf der Kugel bewegt; die Farben kommen aus einem kleinen,
  verschwommenen Band-Bild (ca. 200×1200 px).
- **Für uns:** Bestätigt die Wahl **Cubemap statt Equirect**. Den Trick „Farbband als
  Eingangsverteilung“ ersetzen wir durch eine prozedurale Palette (kein Bild).
- Eine Echtzeit-Variante davon ist der Artikel „Gas giant particle sim on a sphere“
  (jasper-r.github.io/gas-giant), siehe Abschnitt 6.

### 6. jasper-r: Gas giant particle sim on a sphere (2022) – Wunsch-Look „Minimum“
Quelle: Blogartikel `_posts/2022-02-22-gas-giant.html` im Repo
[Jasper-R/Jasper-R.github.io](https://github.com/Jasper-R/Jasper-R.github.io). Gebaut in der
Unigine-Engine (C#, Shadersprache UUSL). **Der Simulationscode ist nicht veröffentlicht**, das
Verfahren ist aber vollständig beschrieben und lässt sich in WGSL nachbauen:
- Idee: Gaseous Giganticus nachbauen, aber in Echtzeit – die Partikel-Schleife läuft als
  Compute-Shader statt auf der CPU. Ergebnis: **4 Mio. Partikel bei 80 fps**.
- Partikel (Position + Lebenszeit) liegen in Polarkoordinaten in einem Puffer.
- Oberflächentextur in **sinusoidaler Projektion** (flächentreu):
  `y = H·φ/π`, `x = W·(θ/2π − 0,5)·sin φ`.
- Strömung: **3D-Curl-Noise**, auf der Kugel ausgewertet, als Flow-Map gespeichert. Das
  Noise wird über die Zeit verschoben; die Oktaven werden **eine pro Frame** aufgebaut
  (Kanäle BA), danach nach RG kopiert → billige Aktualisierung.
- Farbe: Partikel starten mit einer Farbe aus einem Breitengrad-Verlauf, werden mit
  geringer Deckkraft in die Textur gemischt; die Textur wird **weichgezeichnet und blendet
  langsam zur Grundfarbe zurück**.
- Partikel werden **blockweise neu gestartet** (nicht alle gleichzeitig), Deckkraft
  blendet über die Lebenszeit ein/aus → kein Flackern.

**Für uns:** der schnellste Weg zu einem guten Bild. Curl-Noise ist allerdings nur Zufall –
Jets und langlebige Stürme muss man zusätzlich ins Flussfeld einbauen.

### 7. mofu-dev: Stable Fluids with three.js (2022) – Wunsch-Look „schöner“
Quelle: [Blogartikel](https://mofu-dev.com/en/blog/stable-fluids/) (als PDF gelesen). Klassische
Stable Fluids nach Stam auf einer **flachen** Fläche, three.js/WebGL, Fragment-Shader + FBOs:
1. Äußere Kraft (Maus) auf die Geschwindigkeit addieren.
2. Advektion semi-Lagrange, optional **BFECC** (rückwärts, vorwärts, Fehler halbieren,
   nochmal rückwärts) → deutlich schärfere Wirbel.
3. Viskosität per Jacobi-Iteration (für Optik optional).
4. Divergenz → Druck per Jacobi (Poisson) → Druckgradient von der Geschwindigkeit abziehen.
5. Färbung aus dem Geschwindigkeitsfeld.

Keine Lizenzangabe → wir übernehmen das Rezept (Standardverfahren), keinen Code.
**Für uns:** genau diese Schritte, aber auf der Kugel: Geschwindigkeit als 3D-Tangentialvektor
in einer Cubemap, Nachbarn über Schritte entlang der Tangentialebene, Kraft = Jets +
Coriolis + Stürme statt Maus. Das ist die Brücke zum Wirbelstärke-Löser im Plan.

### 4. Atmosphäre: himmel-dunstkreis (MIT) und Bruneton (BSD-3)
- WebGPU-Compute, TypeScript, Shader als `.wgsl`-Strings, Qualität über
  Pipeline-Override-Konstanten. Bietet Bruneton 2008 und **Hillaire 2020** (schneller).
- WGSL wird gegen TypeScript-Zwillinge über Dawn getestet – guter Ansatz, den wir für
  unsere Solver-Tests übernehmen.

### 5. Prozedurale Fallbacks: Eluvade/cosmos (MIT), CosmosJourneyer (AGPL)
- Reine FBM-/Noise-Gasriesen, kein Fluid. Gut für Ringe, entfernte LOD-Stufen und als
  Sofort-Bild, während die Simulation hochfährt.

## Was es **nicht** gibt (unsere Lücke)
1. Barotrope Wirbelstärke-Gleichung auf einer rotierenden Kugel **in WGSL**, in Echtzeit.
2. Hochauflösende Tracer-Advektion auf einem Cube-Sphere-Gitter im Browser.
3. Ein Preset-System für verschiedene Gasplaneten auf dieser Basis.

## Messdaten zur Kalibrierung (keine Laufzeit-Bilder!)
Bilder werden **nur zum Vergleichen** benutzt, nie zur Laufzeit geladen.
- Zonale Windprofile Jupiter: Porco et al. 2003 (Cassini), Tollefson et al. 2017 (Hubble OPAL).
- Hubble **OPAL** (Outer Planet Atmospheres Legacy): jährliche globale Karten von
  Jupiter, Saturn, Uranus, Neptun – über MAST frei verfügbar.
- Juno JunoCam (Polaransichten, Bilder 1 und 4 im Auftrag): zeigen das Polar-Chaos
  und die Wirbel-Cluster, die kein Band-Shader erzeugt – nur eine Strömungssimulation.
