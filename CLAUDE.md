# Planeten-Editor (Urheber: elias-nero-tron, Apache-2.0)

IMPORTANT: Kein Code ohne gelesene, benannte Quelle. Nichts ausdenken, nichts raten. Schweigt die Quelle: fragen.

- Aktueller Stand: `app/` – eine Seite, ein CSS, ein Kern, ein Editor; Verfahren als Module `app/module/<id>/<version>/`.
  Für jede Arbeit in app/ den Skill **modul-bauen** benutzen. Vor „fertig“: `npm run pruefen` und den Agenten **quellen-pruefer**.
- Ein Fix gehört in das Modul, das er betrifft, als neue Version. Alte Versionen bleiben wählbar. Standard bleibt der alte Wert.
- „Rückgängig“ = alten Stand 1:1 aus Git holen, nie nachbauen.
- Nachweis statt Behauptung: Bild neben Vorlage, Befehlsausgabe, Testhardware nennen.
- Befunde des Urhebers: `app/fakten.txt`. Nie E-Mail oder Sitzungslinks veröffentlichen.
- Hooks in `.claude/settings.json` sperren eingefrorene Stände (demo/, v005/, v005.1/, src/), Claude-Zeilen in Commits,
  Force-Push auf main, und lassen eine Runde mit Änderungen in app/ erst enden, wenn `npm run pruefen` besteht.
