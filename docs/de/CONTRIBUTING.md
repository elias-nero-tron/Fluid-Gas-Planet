# Mitmachen

Weiterentwicklung ist ausdrücklich erwünscht: Forke, lerne, baue darauf auf. Bitte nenne dabei
den Urheber (siehe [NOTICE](../../NOTICE), [CITATION.cff](../../CITATION.cff)). Die Apache-2.0-Lizenz
verlangt, dass die NOTICE-Datei in Weitergaben und abgeleiteten Werken erhalten bleibt.

## Einstieg

1. [README](../../README.de.md) lesen, dann [docs/STATUS.md](STATUS.md) (Stand und Befunde) und
   [docs/ROADMAP.md](ROADMAP.md) (Baustellen). Formeln und Fundstellen im Code:
   [docs/MATHEMATIK.md](MATHEMATIK.md).
2. `npm install && npm run dev`, Browser mit WebGPU öffnen.
3. Eine Baustelle aus der Roadmap wählen und im Issue oder Pull Request darauf verweisen.

## Regeln

- **Messen statt raten.** Aussagen über Fehler mit Test belegen. Werkzeuge: `#offscreen` an die
  URL hängen, dann `window.gasPlanet.capture()` (Bild) und `window.gasPlanet.readRow()` (Feldwerte).
- **Bei Standardwerten zählt der Look.** Eine Änderung eines Standardwerts vorher auf echter Hardware
  optisch mit v0.1 vergleichen. Eine sauberere Messung ist kein Grund für einen schlechter aussehenden Standard.
- **Unverifiziertes kennzeichnen.** Was nur im Software-Renderer geprüft ist, im PR so benennen.
  Auf echter Hardware Geprüftes mit Gerät und fps angeben.
- **Kein fremder Code ohne passende Lizenz.** GPL-Projekte (z. B. Gaseous Giganticus, gas-giant)
  nur als Ideenquelle. Übernommene Verfahren in [CREDITS.md](CREDITS.md) eintragen.
- **Keine Bilddateien für die Planetenoberfläche.** Bilder nur als Messvorlage (z. B. „Farben aus Bild“).
- Vor dem PR: `npm run typecheck` und `npm run build`.
- Deutsch oder Englisch, beides willkommen.
