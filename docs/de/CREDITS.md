# Credits

## Urheber: wem das Projekt zu verdanken ist

Dieses Projekt ist **elias-nero-tron** zu verdanken. Die Urheberschaft gilt der Person, nicht
einem bestimmten Konto: Zieht das Projekt auf ein anderes Konto oder eine Organisation um,
bleibt diese Nennung bestehen.

**elias-nero-tron** (GitHub-Konto zum Zeitpunkt der Veröffentlichung): Idee, Konzept, Zielsetzung,
Projektleitung, Bewertung der Ergebnisse auf echter Hardware und die entscheidenden fachlichen
Einwände während der Entwicklung, unter anderem:
- die Frage nach der Atmosphärendicke (führte zum Befund „Deformationsradius fehlt“),
- „die Mathematik wirkt wie für ein 10×10-cm-Objekt, nicht für 1000 km“ (führte zur
  Kennzahlen-Analyse Rossby/Reynolds, siehe [docs/STATUS.md](STATUS.md)),
- „die Narben gab es vorher nicht“ (führte zur Messung des Kantenfehlers beim Cubemap-Abtasten),
- das Bild „Sahne in Kaffee gießen“ als Prüfstein für Quellen, Hindernisse und scharfen Transport.

Umsetzung mit Unterstützung von **Claude** (Anthropic) als KI-Programmierassistent.

Bitte zitiere das Projekt nach [CITATION.cff](../../CITATION.cff), wenn du es nutzt oder darauf aufbaust.

## Worauf das Projekt aufbaut

Es wurde **kein fremder Quellcode kopiert**. Übernommen wurden veröffentlichte Verfahren und Ideen.
Die Implementierung ist eigenständig. Wir danken den Autorinnen und Autoren:

### Verfahren und Artikel
| Quelle | Was wir daraus gelernt haben |
|---|---|
| Jos Stam, *Stable Fluids*, SIGGRAPH 1999 | Grundverfahren: Advektion, Druck-Projektion |
| Mark J. Harris, *Fast Fluid Dynamics Simulation on the GPU*, GPU Gems Kap. 38 (2004) | GPU-Aufteilung in Pässe, kompakter Jacobi-Stern |
| mofu, [*Stable Fluids with three.js*](https://mofu-dev.com/en/blog/stable-fluids/) (2022) | anschauliche Herleitung, BFECC-Advektion |
| jasper-r, [*Gas giant particle sim on a sphere*](https://jasper-r.github.io/gas-giant) (2022) | Partikel per Compute-Shader, Einblenden/Ausblenden, Weichzeichnen |
| Stephen M. Cameron, [Gaseous Giganticus](https://github.com/smcameron/gaseous-giganticus) (GPL-2.0) | Rezept: Curl-Noise + Bandprofil, Wirbel nur in schwacher Scherung, Profil sin(π·d/r), ewig lebende Partikel. **Nur Rezept und Zahlenwerte, kein Code.** |
| bloknayrb, [gas-giant](https://github.com/bloknayrb/gas-giant) (GPL-3.0) | Überblick, welche Jupiter-Phänomene ein Modell braucht. **Nur Ideen, kein Code.** |
| PavelDoGreat, [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT) | Vorticity Confinement in der Praxis, Farbe feiner als Windgitter |
| Ronald Fedkiw et al., *Visual Simulation of Smoke*, SIGGRAPH 2001 | Vorticity Confinement |
| Andrew Selle et al., *An Unconditionally Stable MacCormack Method*, 2008 | Begrenzer gegen Überschwinger |
| Robert Bridson, *Curl-Noise for Procedural Fluid Flow*, SIGGRAPH 2007 | divergenzfreies Rauschen als Stromfunktion |
| Inigo Quilez, Artikel zu Gradientenrauschen mit analytischer Ableitung | Formel für Rauschen samt Gradient |
| Mark Jarzynski, Marc Olano, *Hash Functions for GPU Rendering*, JCGT 2020 | `pcg3d`-Hash |
| Marcel Minnaert, 1941 | Randverdunkelung |
| Krzysztof Narkowicz, *ACES Filmic Tone Mapping Curve* (2016) | Tonemapping |

### Physik und Messdaten (nur zur Kalibrierung, keine Bilder im Projekt)
| Quelle | Verwendung |
|---|---|
| Porco et al. 2003 (Cassini); Tollefson et al. 2017 (Hubble OPAL) | Jupiter-Windprofil (vereinfacht) |
| García-Melendo et al. 2011; Sromovsky et al. 1993/2015 | Saturn-, Uranus-, Neptun-Windprofile (vereinfacht) |
| Cho & Polvani 1996, *Physics of Fluids* 8, 1531 | Flachwasser-Turbulenz auf der Kugel: nächster Modellschritt |
| Dowling et al. 1998, EPIC-Modell ([NASA-Planetary-Science/EPIC_Atmospheric_Model](https://github.com/NASA-Planetary-Science/EPIC_Atmospheric_Model)) | Referenz für geschichtete Gasplaneten-Atmosphären |
| NASA/JPL Juno, Bolton et al. 2021 | Tiefe des Großen Roten Flecks (Pfannkuchen-Wirbel) |

Bilder von NASA, Juno, Hubble und aus dem Web wurden nur im Gespräch als Vergleich benutzt
und sind **nicht** Teil des Repos.

### Schriften und Werkzeuge
IBM Plex Sans/Mono (SIL OFL), Barlow Condensed (SIL OFL), über Google Fonts geladen.
Vite, TypeScript, `@webgpu/types`, `vite-plugin-singlefile` (alle MIT).
