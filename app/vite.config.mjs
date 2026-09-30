// Baut die App aus vielen kleinen Dateien zu EINER HTML-Datei (app/dist/index.html) für OGame.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
});
