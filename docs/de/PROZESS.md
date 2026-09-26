# Arbeitsweise: neue Schienen statt Verschlimmbessern

English: [../PROCESS.md](../PROCESS.md).

Bis v0.2 lief es so: Der Urheber meldete Beobachtungen, der Assistent „reparierte“ jede einzelne, und am
Ende ging es an einer Stelle drei Schritte vor und an einer anderen drei zurück (v0.2.1 hat den Look
überkorrigiert, siehe [STATUS.md](STATUS.md) Befund 7). Diese Regeln sollen das verhindern.

## 1. Beobachtungen sind keine Fehlerberichte

„Die Stürme halten nur 2–3 Sekunden“ ist eine **Beobachtung**. Sie bekommt zuerst eine Erklärung (was im
Code oder in der Mathematik das verursacht). Erst dann wird entschieden, ob und wie sich etwas ändert.
Jede Beobachtung landet mit Ursache in [STATUS](../STATUS.md), auch wenn nichts geändert wird.
Auf GitHub: Issue mit der Vorlage „Beobachtung“, am besten mit Filmstreifen.

## 2. Schienen statt Umbau

Ein Look, der funktioniert, wird nie ersetzt. Neue Ideen bekommen **eine eigene Schiene** daneben:
Flüssigkeit (mofu, Look von v0.1), Partikel (jasper-r), Mischform (v0.2, für alte Codes),
Wolken über Gelände (`demos/terrain.html`), Kaffee (`demos/coffee.html`).
Eine Schiene wird erst Standard, wenn sie auf echter Hardware gegen den bisherigen Standard verglichen
wurde und der Urheber zustimmt. Wer einen gemeinsamen Teil (Geometrie, Licht) ändert, braucht einen
Filmstreifen **jeder** Schiene vorher und nachher.

## 3. Standardwerte sind geschützt

Standardwerte ändern sich nur mit Vorher-nachher-Filmstreifen auf echter Hardware. Neue Physik kommt als
neuer Regler, neue Option oder als Knopf, der eine Gruppe von Werten setzt (rückgängig machbar).

## 4. Augen: Filmstreifen statt Einzelbilder

- **In der App:** Diagnose → „Filmstreifen aufnehmen“ speichert 8 Bilder im Abstand von 2 s als ein PNG,
  mit Einstellungen und fps in der Fußzeile. Einfach an ein Issue hängen.
- **Ohne Fenster (Assistent, CI):** `node scripts/eyes.mjs --preset Jupiter --track fluid --out docs/eyes/x`
  erzeugt denselben Bogen plus Messwerte `detail` (Feinstruktur) und `change` (Bewegung).

## 5. Ein Thema pro Änderung

Ein Pull Request pro Thema, mit Filmstreifen, markiert als **geprüft** (Gerät, fps) oder **ungeprüft**.

## 6. Übergabe ohne Chat

Alles für eine neue Sitzung steht im Repository: [CLAUDE.md](../../CLAUDE.md), [STATUS](../STATUS.md),
[ROADMAP](../ROADMAP.md). Das folgt Anthropics veröffentlichtem Rat für lange Agentenarbeit: Fortschritt
und Aufgabenliste im Repository, kleine geprüfte Commits, die nächste Sitzung startet aus den Dateien
([Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

## Was von deiner Seite am meisten hilft

1. Eine Beobachtung pro Issue, mit Filmstreifen oder Planeten-Code (`FGP1:…`).
2. Sagen, was vorher **besser** war, nicht nur was jetzt schlechter ist.
3. Wünsche als „später“ markieren, wenn sie nicht in diese Runde gehören.
