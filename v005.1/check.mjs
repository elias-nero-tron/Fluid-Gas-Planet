// Prüft mechanisch: (1) kein Ordner importiert aus einem anderen, (2) jede Shader-Datei verweist auf eine Quelle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
const root = import.meta.dirname;
let fehler = 0;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const seite of readdirSync(root).filter((f) => f !== 'dist' && statSync(join(root, f)).isDirectory())) {
  const dir = join(root, seite);
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:import[^'"]*|src=)['"]([^'"]+)['"]/g)) {
      if (!m[1].startsWith('.')) continue;
      const ziel = relative(dir, resolve(join(f, '..'), m[1].split('?')[0]));
      if (ziel.startsWith('..')) { console.log(`FEHLER ${relative(root, f)}: importiert außerhalb des Ordners: ${m[1]}`); fehler++; }
    }
    if (f.endsWith('.wgsl') && !/\[(G|Q|T|B)\d+\]|Quelle|MIT/.test(text)) { console.log(`FEHLER ${relative(root, f)}: keine Quellenangabe`); fehler++; }
  }
}
console.log(fehler ? `${fehler} Fehler` : 'OK: getrennt, alle Shader mit Quelle');
process.exit(fehler ? 1 : 0);
