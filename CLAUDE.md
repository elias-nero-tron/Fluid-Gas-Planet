# Fluid Gas Planet – Einstieg für neue Sitzungen

Urheber: **elias-nero-tron** (in CREDITS/NOTICE nennen). Lizenz Apache-2.0. Nie die E-Mail oder einen
Sitzungslink des Urhebers veröffentlichen.

Commits: keine `Co-Authored-By: Claude`- oder `Claude-Session:`-Zeilen anhängen. Claude ist hier
Werkzeug, kein Co-Autor (Hinweis dazu steht bereits in NOTICE/CREDITS.md).

**Regeln gegen Verschlechterung (vom Urheber, verbindlich):**
- Nichts still ändern. Jede Änderung an Aussehen, Leistung oder Verhalten wird ein **Modul/Schalter**; Standard bleibt der
  alte Wert, bis der Urheber umschaltet. Auch „Firlefanz“ wie Kantenglättung, Bloom-Varianten, Auflösungs-Automatik.
- Neue Verfahren kommen **zusätzlich** als Auswahl ins Menü; alte fliegen erst raus, wenn der Urheber es sagt.
- „Rückgängig“ heißt: alten Code 1:1 aus Git holen und **Bild gegen Bild** mit dem alten Stand prüfen, nichts nachbauen.
- Ein Modul ist wirklich abtrennbar (eigener Codeblock/eigene Uniforms, aus = nicht mitkompiliert), nicht in fremde
  Uniform-Felder oder den Basis-Shader verdrahtet.
- Eine Aufgabe pro Runde. Vor dem Veröffentlichen Vorher/Nachher-Bild.
- Gute Stände sind eingefroren in `demo/gas-v0.1.html`, `demo/gas-v0.4.html`, `demo/planets-v21.html`
  (Versionsschalter in der Kopfzeile). Diese Dateien nie neu bauen oder ändern.
- Git: Autor `elias-nero-tron <321670013+elias-nero-tron@users.noreply.github.com>`; beim Squash-Merge die
  Commit-Nachricht selbst vorgeben und prüfen, dass keine `Co-authored-by: Claude`-Zeile entsteht.

Arbeitsauftrag: **[HAEPPCHEN.md](HAEPPCHEN.md)**, das nächste offene Häppchen.
So wie im ersten Prompt: Quelle lesen → Verfahren übernehmen → bauen → pushen → zeigen.

Code: eine App, ein Planetentyp pro Seite mit gemeinsamer Hülle (`src/shell.ts`, `src/shell.css`, Menü `src/ui.ts`,
Himmel `src/sky/`). Gasriese: `index.html`, `src/main.ts`, `src/shaders/*.wgsl`. Gesteinsplanet: `planets.html`,
`src/rocky/main.js`. `demos/` = Nebenseiten (Kaffee).
`npm run dev`, `npm run build` (schreibt auch `demo/` für den Klick-Link im README).
Headless-Bilder: `node scripts/eyes.mjs --preset Jupiter --track fluid --out /tmp/x` (Software-Renderer, langsam).
