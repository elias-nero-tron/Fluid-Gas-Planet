# Häppchen

Alle Hinweise von elias-nero-tron aus der Entwicklung, als einzelne Aufträge. Reihenfolge: wenig Aufwand
zuerst, viel Aufwand zuletzt. In einem neuen Chat reicht: *Repo-Link + „Mach Häppchen N“*.

## Warum der erste Prompt funktioniert hat

Zwei Links mit **fertigen, funktionierenden Verfahren** (mofu: Stable Fluids, jasper-r: Partikel auf der
Kugel). Gelesen, wie sie rechnen, genau das auf die Kugel übertragen, sofort gebaut und gezeigt.
Keine Regeln, keine Roadmap, kein Absichern. **Quelle → Verfahren → Code → Bild.**
Danach ging es schief, weil aus jedem Hinweis Forschung, Doku und Regeln wurden statt Code.
Also bei jedem Häppchen: Quelle lesen, Verfahren übernehmen (Lizenz beachten), bauen, pushen, zeigen.

---

## Offen, aufsteigend nach Aufwand

### Klein

1. **Stürme nicht festnageln.** „Stürme haben festgelegte Standorte? … am Endergebnis eher Pfusch an der
   Physik.“ Standard „Stürme festhalten“ von 1 auf 0 und „Anstoß-Dauer“ länger (z. B. 12 s), damit Stürme
   frei treiben, verschmelzen und vergehen. Fertig: Großer Roter Fleck bleibt sichtbar, bewegt sich aber frei.
2. **Druck sichtbar machen.** „Druck existiert quasi nicht.“ Die Druck-Ansicht ist viel zu schwach skaliert.
   Automatisch auf das aktuelle Maximum normieren. Fertig: Ansicht „Druck“ zeigt Hoch- und Tiefdruck klar.
3. **Größe beeinflusst die Physik (Zufallsplanet).** „Hat die Größe Einfluss auf die Physik?“ Bandzahl
   aus Rotation und Größe ableiten: Rhines-Skala L = π·√(2U/β), β = 2Ω·cos φ / R. Regler „Größe“.
   Fertig: großer, schnell drehender Planet hat viele schmale Bänder, kleiner, langsamer wenige breite.
4. **Sterne und Nebel wie colordodge.** „Besseren Nebular als alle anderen & bessere Sterne, aber da dreht
   sich der Nebel mit, was dumm ist.“ Quelle: [colordodge/ProceduralPlanet](https://github.com/colordodge/ProceduralPlanet)
   (WTFPL, `src/js/shaders/nebula.frag`, `stars.frag`). Übernehmen, fest im Weltraum (dreht nur mit der Kamera).
5. **Kaffee-Demo reparieren.** „Sahne in der Mitte 99 % der Pixel, Kaffee am Rand 1 %; beim Rühren passiert
   am Rand was, in der Mitte nichts.“ Sahnemenge und Quellgröße klein, Löffel treibt die Strömung über seine
   ganze Bahn. Fertig: dunkler Kaffee, weiße Sahnefäden, Rühren in der Mitte verwirbelt sichtbar.
6. **Sitzungs-Link aus alten Commit-Nachrichten entfernen** (steht noch in 22 Commits auf `main`, nicht mehr
   in PRs). Braucht einen Force-Push auf `main` und ein ausdrückliches Ja des Urhebers.

### Mittel

7. **Partikel besser als jasper-r.** „Die Partikel-Arbeit sieht nicht aus wie die Vorschau vom Partikel-Dude …
   Partikel optimieren, dass es besser aussieht als die Vorlage.“ Quelle: [jasper-r](https://jasper-r.github.io/gas-giant):
   gleichmäßig verteilte Neugeburt in Blöcken, Flussfeld Oktave für Oktave aufbauen und bewegen, weiche
   Kante am Planetenrand. Dazu mehr Partikel (bis 32 Mio.) und dünnere, längere Schlieren.
8. **Curl-Noise soll nicht wie Tinte / LSD aussehen.** „Sieht aus wie Tinte, die auf einem Teller verläuft.“
   Quelle: [Gaseous Giganticus](https://github.com/smcameron/gaseous-giganticus) (nur Ideen, GPL): Bänder
   stärker als Rauschen, Rauschen nur an Bandgrenzen, Wirbel nur in schwacher Scherung, Partikel ewig leben lassen.
9. **Planetenringe als 3D-Gürtel.** „Wirkt wie eine 2D-Scheibe aus einem PC-Spiel von 2004.“ Ringe als
   Teilchenschicht: optische Tiefe τ, Durchlässigkeit e^(−τ/|μ|), helle Vorwärtsstreuung von hinten
   (Henyey–Greenstein), weicher Schatten auf dem Planeten, Planetenschatten auf den Ringen, feine radiale Struktur.
10. **Monde.** „Ein paar Monde, die sich in korrekter Distanz und Geschwindigkeit mit der Gravitation bewegen.“
    Kepler: T² = 4π²a³/(GM). Kugeln mit Licht, Schatten als dunkler Fleck auf dem Planeten.
11. **Sofort mitten im Geschehen, ohne Einpendeln.** „Wie lösen wir, dass sich beim Laden erst alles
    sekundenlang aufbauen muss?“ Eingeschwungenen Zustand nach dem ersten Laden im Browser speichern
    (IndexedDB) und beim nächsten Mal sofort laden.
12. **Nähte dauerhaft weg.** „Ich sehe immer noch die Übergänge.“ „Exakte Kanten“ wirkt im Software-Renderer.
    Schneller: Halo-Texel pro Würfelfläche und equi-angulare Würfelprojektion (wie ExoCubed, arXiv 2403.06844).
13. **90 % der Rechenleistung auf den sichtbaren Ausschnitt** (Handys). „Wenn man nur 25 % vom Planeten sieht …“
    Für Partikel gibt es „Sichtfeld-Anteil“. Für die Flüssigkeit: Detail pro Pixel erzeugen (Häppchen 17).
14. **Kontinentplanet-Oberfläche wie colordodge.** „Sieht unfassbar gut & nahezu unendlich zoombar aus.“
    Quelle: [colordodge/ProceduralPlanet](https://github.com/colordodge/ProceduralPlanet) (WTFPL): Rauschen mit
    16–32 Oktaven und Domain Warping in Würfel-Texturen (bis 4096²), Farbtabelle Höhe × Feuchte, Wasserlinie,
    Strand, Normal- und Glanzkarte. Als eigene Seite, ersetzt `demos/terrain.html`.
15. **Klimazonen und Meeresspiegel wie Lagrange.** „Die hat Klimazonen und echte Meeresspiegel-Erhöhung.“
    Quelle: [Lagrange](https://github.com/EepyBerry/lagrange) (nur Ideen, Lizenz eingeschränkt): Temperatur aus
    Breite und Höhe, Feuchte, Biom aus (Feuchte, Temperatur), Regler Meeresspiegel. Auf Häppchen 14.

### Groß

16. **Wolken über dem Kontinentplaneten aus der Strömungssimulation.** „Hättest du die Liquid-Formel nicht
    über einen Kontinentplaneten legen können und dort transparent, wo weniger Wolken sind, und wo Wolkentürme
    sind bzw. sich etwas konzentriert, einfach weniger durchsichtig?“ Unsere Kugel-Simulation als
    Atmosphäre, Feuchte q mitführen: Verdunstung über Meer, Kondensation wenn q > q_s(T) (Clausius–Clapeyron),
    Hebung an Bergen w = u·∇h. Wolkendichte = Kondensat. Auf Häppchen 14/15.
17. **Hineinzoomen ohne Pixel: Vektoren statt Pixel.** „Gute Formeln verwenden & Reinzoombarkeit haben, nicht
    mehr in Pixeln, sondern in Vektorisierung denken.“ Mitgeführte Texturkoordinaten (Neyret 2003, Perlin &
    Neyret 2001): feine Struktur pro Pixel aus Rauschen an der mitgeführten Herkunftsstelle, zwei Phasen überblenden.
18. **Volumen-Wolken und aufsteigender Rauch.** „three.js volume fire, so cool als Vulkan! Deine Wolken sind
    2D gezeichnet, hier ist aufsteigender Rauch.“ Quelle: [three.js webgpu_volume_fire](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_volume_fire.html)
    (MIT): 3D-Strömung mit Auftrieb, Raymarching mit Beer–Lambert, Henyey–Greenstein, Powder-Term, Schatten.
    Für Wolkentürme auf Häppchen 16 und für Neptun („bei Neptun könnte es Wolken simulieren“).
19. **Mächtigkeit: Stürme entstehen, wachsen, wandern, lösen sich auf.** „Die Mathematik wirkt für
    10×10-cm-Objekte … Stürme sehen aus wie zufällig ausgelöste Ereignisse, nicht wie aus der Mathematik.“
    Flachwasser-Gleichungen auf der Kugel mit Deformationsradius (Cho & Polvani 1996, Showman 2007: Stürme als
    Massenpulse), dazu Feuchte-Konvektion (Bouchut et al. 2009). Langsame, riesige Strukturen statt Regentropfen.
20. **Echte 3D-Tiefe, Wirbel mit Trichtern.** „3D-Tiefe fehlt völlig … das sieht nicht aus wie Wirbelstürme,
    die Trichter bilden.“ „Ist das Relief nur fake?“ (Ja.) Höhenfeld aus der Simulation (Schichtdicke h
    aus Häppchen 19) und Raymarching der Wolkenoberfläche mit echter Silhouette und Schatten.
21. **Look wie der volumetrische Blender-Gasplanet, aber in Echtzeit.** Links: [Fully volumetric gas giant](https://blenderartists.org/t/fully-volumetric-gas-giant/1383427),
    [So I want to create gas giants](https://blenderartists.org/t/so-i-want-to-create-gas-giants/627998).
    Aus Häppchen 17 + 18 + 20 zusammen.
22. **Echtes Wasser wie WaterBall.** „Schau mal, echtes Wasser :0“ Quelle: [matsuoka-601/WaterBall](https://github.com/matsuoka-601/WaterBall)
    (MIT, MLS-MPM + Screen-Space-Fluid-Rendering). Für Nahaufnahmen von Küsten und Wellen.
23. **Glasregen-Planet und andere Kondensate.** HD 189733 b: Silikat regnet als Glas, Winde bis 8700 km/h.
    Gleiches Feuchte-Modell wie Häppchen 16, nur andere Sättigungskurve und Farbe. Als Zufallsplanet-Familie.

### Braucht Infos vom Urheber

24. **Reddit „procedural earth-sized planet“** (r/Unity3D, 1f5fkrq): „sieht nach Wolken, Wasser und Planet
    aus“. Vom Build-Rechner nicht erreichbar; Titel oder Video nötig.

---

## Erledigt (damit nichts verloren geht)

- Gasriesen in WebGPU ohne Bilddateien, mehrere Planeten, Jupiter als Maßstab; Regler zum Testen
- Veröffentlicht auf GitHub, Klick-Link, Englisch und Deutsch, professionelles Open Source mit Credits und Zitierung, Umzug auf anderes Konto möglich
- Mindestens 60 fps (Automatik), Start mitten im Geschehen (Ladebild mit Vorrechnen)
- Zufallsplanet wirklich zufällig, speicherbar, steuerbar (Familie, Bänder, Stürme, Ringe); Zurücksetzen, Rückgängig
- Zeitraffer ändert die Physik nicht mehr (Simulation war an die Bildrate gekoppelt)
- Drehrichtung im oder gegen den Uhrzeigersinn; Sturm-Drehsinn je nach Halbkugel; Drehgeschwindigkeit
- „Neuer Lauf“ statt sinnlosem Neustart; Filmstreifen statt Einzelfotos
- Hilfebox oben entfernt (nichts springt mehr), HUD springt nicht mehr; ausgeblendete Regler sind wirklich ausgeblendet
- Neben jedem Regler ⓘ: Erklärfenster unten links mit allen Details und Formel; beim Drüberfahren eine kurze Blase
- 5080 ans Limit: alle Regler bis 32 Mio. Partikel, 2048² Farbe, 384² Gitter, Render-Auflösung bis 3× (Supersampling)
- Auflösungsregler bauen erst beim Loslassen um (keine Lags mehr beim Ziehen)
- Partikel-Verfahren vom Flüssigkeits-Verfahren getrennt (eigene Schiene)
- Beobachtung „sieht aus wie Schwarztee mit Milch“, Relief-Regler „so cool“, Neptun-Wolken „echt & geil“: bleiben so
