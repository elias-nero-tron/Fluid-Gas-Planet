# Fluid Gas Planet – Einstieg für neue Sitzungen

Urheber: **elias-nero-tron** (in CREDITS/NOTICE nennen). Lizenz Apache-2.0. Nie die E-Mail oder einen
Sitzungslink des Urhebers veröffentlichen.

Arbeitsauftrag: **[HAEPPCHEN.md](HAEPPCHEN.md)**, das nächste offene Häppchen.
So wie im ersten Prompt: Quelle lesen → Verfahren übernehmen → bauen → pushen → zeigen.

Code: `src/main.ts` (Regler, App), `src/shaders/*.wgsl` (Simulation, Darstellung), `demos/` (eigene Seiten).
`npm run dev`, `npm run build` (schreibt auch `demo/` für den Klick-Link im README).
Headless-Bilder: `node scripts/eyes.mjs --preset Jupiter --track fluid --out /tmp/x` (Software-Renderer, langsam).
