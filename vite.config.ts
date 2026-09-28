import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// Version und Build-Zeit ins HUD, damit man sofort sieht, ob der Browser eine alte Kopie zeigt.
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Jede Planeten-Seite wird eine eigenständige Einzeldatei (singlefile kann nur einen Eingang je Lauf),
// darum baut `npm run build` zweimal: index.html (Gasriese) und planets.html (Gesteinsplanet).
const page = process.env.PAGE === 'planets' ? 'planets.html' : 'index.html';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', emptyOutDir: page === 'index.html', rollupOptions: { input: page } },
  define: { __VERSION__: JSON.stringify(`v${version} · ${built}`) },
});
