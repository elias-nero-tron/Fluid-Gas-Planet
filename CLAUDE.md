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

## Aufbau (modular = getrennte Dateien)
- Aktueller Stand: `v005.1/<verfahren>/` – ein Ordner pro Verfahren, kleine Dateien, eine Datei pro Schritt.
- Kein Ordner importiert aus einem anderen. `npm run check` prüft das und die Quellenangaben.
- `npm run build:v005` baut jede Seite zu EINER HTML-Datei (`v005.1/dist/`) für OGame.
- `v005/` (Einzeldatei-Stand) und alles Alte (`src/`, `demo/`) nicht ändern.

## Testen
Headless: Playwright mit `executablePath: /opt/pw-browsers/chromium`, `--use-webgpu-adapter=swiftshader`,
Seite mit `?test` öffnen, `window.grab()` liefert das Bild. Software-Renderer = CPU, nur kleine Partikelzahlen.
