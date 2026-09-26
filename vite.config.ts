import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// Version und Build-Zeit ins HUD, damit man sofort sieht, ob der Browser eine alte Kopie zeigt.
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022' },
  define: { __VERSION__: JSON.stringify(`v${version} · ${built}`) },
});
