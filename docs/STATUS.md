# Stand und Übergabe

Diese Datei fasst zusammen, was geprüft ist, was nicht, und was die Fehlersuche ergeben hat.
Sie ist für spätere Sitzungen gedacht, damit niemand von vorne suchen muss.

## Geprüft vs. unverifiziert

| Stand | Commit | Status |
|---|---|---|
| v0.1.0: Erster Prototyp (beide Verfahren, Presets, Regler) | Tag `v0.1.0` (`e8dd276`) | **vom Nutzer getestet** auf echter Hardware (integrierte GPU, 25–41 fps). Urteil: aus der Ferne ca. 8/10, Details zu schnell/zu grob. |
| v0.2.0 (Vorabversion): alles danach | Tag `v0.2.0`, `main` | **unverifiziert**: nur im Headless-Browser mit Software-Rendering (SwiftShader) geprüft, nicht vom Nutzer. |
| `demos/coffee.html` (Sahne im Kaffee) | letzter Commit | **ungetestet**: Shader kompilieren, das Bild wurde nie gesehen (Headless-Chromium verliert beim Anzeigen auf dem Canvas das Gerät). |

Nutzer-Rückmeldung zu den unverifizierten Versionen 2–3: „Narben“-Linien sichtbar, wirkte schlechter.
Die Ursache ist gefunden und in Version 4 behoben (siehe unten), aber vom Nutzer noch nicht bestätigt.

## Befunde der Fehlersuche (gemessen, nicht geraten)

1. **Narben an den Würfelkanten.** Hardware-Abtasten einer Cubemap nahe den Flächenkanten:
   maximaler Fehler 0,139 gegenüber 0,0003 im Flächeninneren (Test mit bekannter Funktion,
   384² je Fläche, SwiftShader). Weil Farbe und Wind jeden Schritt neu abgetastet werden,
   wächst der Fehler zu Linien. Früher hat die starke Band-Rückstellung (0,06) ihn verdeckt,
   mit 0,02 wurde er sichtbar. **Fix:** `sampleCube()` in `common.wgsl`: im Inneren Hardware,
   an Kanten manuelles 4-Tap mit Texeln der Nachbarfläche. Offen: ob echte GPUs denselben
   Fehler haben, und was der Fix auf einer iGPU an fps kostet.
2. **Wirbelverstärkung war ~10× zu stark** (ε = 6): f = ε·Δx·ω lieferte ~0,1 rad/s² bei Jets
   von 0,06 rad/s. Das Wirbelfeld bestand aus Gitterrauschen. Neuer Standard 0,5.
3. **Jet-Rückstellung hat Wirbel plattgebügelt**: Sie zog jede Ost-West-Komponente zum Profil,
   auch die von Wirbeln. Jetzt wird nur das Breitenkreis-Mittel zurückgezogen (GPU-Summe je
   Breitenband mit Atomics, `zonalSum` in `fluid.wgsl`).
4. **Details wurden selbst gelöscht**: Weichzeichnen 12 %/Bild und Band-Rückstellung.
   Außerdem sind glatte Farbverläufe unsichtbar, wenn man sie dehnt. Daher „Feinstreifen“.
5. **Haare an Bandkanten**: nord-süd-gestreckte Rossby-Wellen (β-Effekt) aus Anfangsrauschen.
   Physikalisch korrekt für ein 2D-Modell ohne Deformationsradius (siehe unten).
6. Headless-Tests: Canvas-Präsentation verliert in SwiftShader das Gerät. Darum Testmodus
   `#offscreen` (rendert in Textur, `window.gasPlanet.capture()`, `readRow()` für Feldwerte).

## Kernbefund: das Modell rechnet im falschen Bereich

Nutzer-Einwand (berechtigt): „Die Mathematik wirkt wie für ein 10×10-cm-Objekt, nicht für
1000×1000 km." Ob etwas wie Kaffee oder wie Jupiter aussieht, bestimmen dimensionslose Zahlen:

| Kennzahl | Kaffeetasse | Jupiter (GRS) | aktuelles Modell |
|---|---|---|---|
| Rossby-Zahl Ro = U/(f·L) | ≫ 1 (Rotation egal) | ≈ 0,1 | ≈ 0,7 bei Standardreglern |
| Reynolds-Zahl (effektiv) | ~10⁴ | riesig | ~10²–10³ durch numerische Zähigkeit |
| Deformationsradius L_d/R | – | ≈ 0,02 (1000–2000 km) | ∞ (starrer Deckel) |
| Tiefe : Breite der Wirbel | ~1 : 1 (Trichter) | ~1 : 40 (Pfannkuchen, GRS einige 100 km tief) | 2D |

Übersehen in der Recherche: Cho & Polvani 1996 (Physics of Fluids 8, 1531): Flachwasser-Turbulenz
auf der rotierenden Kugel bildet von selbst Bänder und Wirbel, gesteuert von Rotation,
Deformationsradius und (Hyper-)Dissipation. Referenzmodell der Planetenforschung: EPIC
(NASA-Planetary-Science/EPIC_Atmospheric_Model, GPL, isentrope Schichten). Der Plan hat die
barotrope Wirbelgleichung gewählt. Das ist der Sonderfall L_d = ∞, also der falsche Ausgangspunkt.

**Nächster Schritt (empfohlen, neue Sitzung):**
1. Strömungskern durch Flachwasser-Gleichungen auf der Kugel ersetzen (Felder: u, h),
   Parameter auf Jupiter-Werte: Ro ≈ 0,1, L_d/R ≈ 0,02.
2. Hyperviskosität (∇⁴ oder ∇⁸) statt numerischer Zähigkeit; Transport mit Begrenzer.
3. h als Wolkenhöhe fürs Relief (echte Schatten statt Helligkeits-Schätzung).
4. Danach 2–3 Schichten (NH₄SH-Wolken, NH₃-Wolken, Dunst) für echte Tiefe; Konvektion als
   Quellen (∇·u ≠ 0 an der Wolkenobergrenze), wie in der Kaffee-Demo.

## Was dem Modell physikalisch noch fehlt

- **Atmosphärendicke / Rossby-Deformationsradius.** Das Modell ist 2D-inkompressibel
  (starrer Deckel, L_d = ∞). Mit Flachwasser-Gleichungen (Schichtdicke h als Feld) entstehen
  kompakte, langlebige Wirbel statt langer Wellen. Das ist der wichtigste nächste Schritt.
- **Quellen/Senken (Aufquellen).** Konvektionswolken quellen auf und strömen von einem Punkt
  weg: an der Wolkenobergrenze ist ∇·u ≠ 0. Der Löser erzwingt ∇·u = 0. In der Kaffee-Demo
  ist das umgesetzt (Poisson mit `div − Quelle`), bei Jupiter noch nicht.
- **Begrenzer beim Farbtransport** (Min/Max-Klammer nach BFECC, Selle et al. 2008): in der
  Kaffee-Demo drin, bei Jupiter noch nicht.
- **Sturm als Hindernis**: Die Wirbelschleppe links vom Großen Roten Fleck entsteht, weil der
  Sturm im Strom steht. Gezielt nachbilden, wenn die Wirbel kompakt genug sind.

## Wünsche des Nutzers, noch offen

- Nahaufnahmen wie Juno (Filamente, Relief) statt nur Fernansicht.
- Zufallsplanet mit mehr Zufall.
- Idee: Kontinente unter die Atmosphäre legen (Erdwetter). Braucht Heizung, Wasserdampf mit
  Kondensation, Topographie. Eigenes Projekt.
- Referenzen: Gaseous Giganticus (Rezept übernommen, Code GPL, nicht kopiert),
  jasper-r (Partikel), mofu (Stable Fluids), Juno/Voyager-Bilder im Chat.
