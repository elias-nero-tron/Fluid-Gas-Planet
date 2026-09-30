# Regeln (verbindlich, vom Urheber elias-nero-tron)

Urheber: elias-nero-tron. Lizenz Apache-2.0. Nie E-Mail oder Sitzungslinks veröffentlichen.
Commits: Autor `elias-nero-tron <321670013+elias-nero-tron@users.noreply.github.com>`, KEINE
`Co-Authored-By: Claude`- oder `Claude-Session:`-Zeilen, kein „Generated with Claude Code“ in PRs.

## Arbeitsweise
1. Kein Code ohne gelesene, benannte Quelle (aktuelle Profi-Lösung). Nichts ausdenken, nichts raten.
   Schweigt die Quelle, fragen statt wählen.
2. Jede Datei nennt oben ihre Quelle; jeder Codeblock verweist auf einen Schritt der Quelle ([G1], [Q3] …).
3. Eine Aufgabe pro Runde. Vorher Bild gegen Bild mit der Vorlage, Testhardware immer angeben.
4. „Rückgängig“ = alten Stand 1:1 aus Git holen, nie nachbauen.
5. Nichts still ändern; Standard bleibt der alte Wert, bis der Urheber umschaltet.

## Aufbau (modular = getrennte Dateien) – aktueller Stand: `app/`
- EINE Seite, EIN CSS (`app/style.css`), EINE Grafikkarten-Verbindung (`app/kern/`), EIN Editor (`app/editor/`).
- Verfahren = Module: `app/module/<id>/<version>/` (modul.js, farbe.wgsl, shaders/*.wgsl). Neue Version = neuer
  Ordner + eine Zeile in `app/module/register.js`; alte Versionen bleiben wählbar. Ein Fix gehört in das Modul, das er betrifft.
- Modul liefert: info, standard (Werte), erstellen() → { regler, schritt, farbeWGSL (fn modulFarbe), gruppe1, rand, status, zerstoeren }.
  Regler beschreibt das Modul, gezeichnet werden sie nur vom Editor. Module haben kein eigenes CSS und keine eigene Oberfläche.
- `npm run check` prüft: Module importieren nur aus ihrem Ordner, Kern/Editor nie aus Modulen, Shader mit Quelle.
- `npm run build:app` baut `app/dist/index.html` (eine Datei für OGame).
- Befunde des Urhebers für kommende Module: `app/fakten.txt`.
- `v005/`, `v005.1/` und alles Alte (`src/`, `demo/`) nicht ändern (Archiv/Vergleich).

## Testen
Headless: Playwright mit `executablePath: /opt/pw-browsers/chromium`, `--use-webgpu-adapter=swiftshader`,
Seite mit `?test` öffnen, `window.grab()` liefert das Bild. Software-Renderer = CPU, nur kleine Partikelzahlen.
