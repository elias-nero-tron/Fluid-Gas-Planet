import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// Version und Build-Zeit ins HUD, damit man sofort sieht, ob der Browser eine alte Kopie zeigt.
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Eine Seite für alle Planetentypen (index.html?body=…), gebaut als eine Einzeldatei.
const page = 'index.html';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', emptyOutDir: true, rollupOptions: { input: page } },
  define: { __VERSION__: JSON.stringify(`v${version} · ${built}`) },
});
