---
name: modul-bauen
description: Neues Verfahren, neue Version oder Fix in der Planeten-App (app/) bauen. Immer benutzen, wenn Code in app/ entstehen oder sich ändern soll.
---
# Modul bauen oder ändern (Planeten-App)

1. **Quelle zuerst.** Die benannte Quelle lesen (Original-Code, Artikel, Handbuch). Nichts ohne Quelle bauen.
   Findet sich keine: dem Urheber sagen, welche fehlt, und stoppen. Nur Quellen aus dem letzten Jahr oder das
   Original selbst; eigene frühere Stände nur, wenn der Urheber sie bestätigt hat (siehe app/fakten.txt).
2. **Schrittliste.** Verfahren als nummerierte Schritte [X1], [X2] … oben in modul.js aufschreiben, Abweichungen als [T1] ….
   Werte, zu denen die Quelle schweigt, werden Regler mit dem Hinweis „nicht aus der Quelle (Platzhalter)“.
3. **Ort.** Neues Verfahren: `app/module/<id>/v1/`. Änderung an einem bestehenden: neue Version `app/module/<id>/vN+1/`
   (Kopie der letzten Version, dann ändern). Eine Zeile in `app/module/register.js`. Alte Versionen nie ändern.
   Kern (`app/kern/`), Editor (`app/editor/`) und `app/style.css` nur ändern, wenn der Auftrag genau das ist.
4. **Schnittstelle** (siehe vorhandene Module): `info`, `standard`, `erstellen(gpu, werte, meldung, adresse)` →
   `{ regler, schritt, farbeWGSL (fn modulFarbe(n, b)), gruppe1, rand, status, zerstoeren }`.
   Jeder Regler hat `abschnitt`, `hilfe` (mit Quellenverweis) und `fx` (Formel).
5. **Prüfen:** `npm run pruefen` (Trennprüfung, Build, Bildtest). Für ein neues Modul/eine neue Version einen Fall in
   `app/pruefung/sichttest.mjs` ergänzen und das Referenzbild erst nach Freigabe des Urhebers mit `--neu` schreiben.
6. **Nachweis zeigen:** Bild der eigenen Fassung neben dem Vorlagebild der Quelle, Testhardware nennen
   (Software-Renderer = CPU, kleine Partikelzahlen). Dann den `quellen-pruefer`-Agenten den Diff prüfen lassen.
7. **Commit:** Autor `elias-nero-tron <321670013+elias-nero-tron@users.noreply.github.com>`, ohne Claude-Zeilen.
