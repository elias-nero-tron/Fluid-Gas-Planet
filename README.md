# Fluid Gas Planet

Echtzeit-Gasplaneten im Browser mit WebGPU: Strömungssimulation auf der Kugel statt
Bildtexturen. Jupiter ist der erste Maßstab, dazu Saturn, Neptun, Uranus, ein heißer Jupiter
und Zufallsplaneten.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/index.html (eine Datei) und dist/artifact.html
```

Braucht einen Browser mit WebGPU: Chrome/Edge ab 113, Safari ab 26, Firefox ab 141,
Android-Chrome ab 121.

## Zwei Verfahren, frei kombinierbar

| | Strömung | Darstellung |
|---|---|---|
| **mofu** (Stable Fluids) | Navier-Stokes auf der Kugel: Advektion (BFECC) → Kräfte → Druck-Jacobi → Projektion. Kräfte sind Jet-Rückstellung zum gemessenen Windprofil, Coriolis, Stürme, Turbulenz, Wirbelverstärkung. | Farbstoff-Textur wird mit dem Wind verschoben und langsam zur Bandfarbe zurückgezogen. |
| **jasper-r** (Partikel) | Curl-Noise als Stromfunktion auf der Kugel (divergenzfrei) + Jets + Stürme. | Bis zu 4 Mio. Partikel fliegen mit dem Wind und färben die Textur, die weichgezeichnet wird und verblasst. |

Im Panel lassen sich Strömung und Darstellung unabhängig umschalten; jeder Regler erklärt,
was er in der Simulation verändert.

## Aufbau

```
src/
  main.ts              WebGPU-Start, Felder, Ablauf pro Frame, Kamera, Regler
  presets.ts           Planeten als Zahlen: Windprofil, Farbbänder, Stürme, Ringe
  ui.ts                Reglerpanel
  math.ts              Matrizen
  shaders/common.wgsl  Cubemap-Abbildung, Rauschen mit Ableitung, Tabellen, Stürme
  shaders/fluid.wgsl   Stable-Fluids-Löser auf der Kugel
  shaders/tracers.wgsl Farbstoff, Curl-Noise-Feld, Partikel
  shaders/render.wgsl  Ellipsoid, Licht, Relief, Dunstsaum, Ringe, Debug-Ansichten
```

Alle Felder liegen als Cubemap (6 × N² Zellen). Wind wird als 3D-Tangentialvektor gespeichert;
Nachbarwerte werden über kleine Schritte in der Tangentialebene abgetastet. So gibt es weder
Pol-Singularität noch Nähte an den Würfelkanten.

`#offscreen` am Ende der URL rendert in eine Textur statt auf den Canvas (für Headless-Tests).

- [docs/RECHERCHE.md](docs/RECHERCHE.md): vorhandene Open-Source-Projekte, Lizenzen
- [docs/PLAN.md](docs/PLAN.md): Architektur, Mathematik, nächste Phasen
- [docs/STATUS.md](docs/STATUS.md): was getestet ist, was nicht, Befunde der Fehlersuche
- [demos/coffee.html](demos/coffee.html): Sahne im Kaffee (Stable Fluids mit Quellen und Löffel, ungetestet)

Lizenz: MIT
