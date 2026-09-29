// v0.05.1: jede Seite wird aus vielen kleinen Dateien zu EINER HTML-Datei gebaut (für OGame).
// Aufruf: SEITE=gaseous-giganticus npx vite build --config v005.1/vite.config.mjs
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
const seite = process.env.SEITE;
export default defineConfig({
  root: resolve(import.meta.dirname, seite),
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: resolve(import.meta.dirname, 'dist', seite), emptyOutDir: true, target: 'esnext' },
});
