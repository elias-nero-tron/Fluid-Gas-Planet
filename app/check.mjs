// Prüft die Trennung der App mechanisch:
// (1) ein Modul (module/<id>/<version>/) importiert nur aus seinem eigenen Versionsordner,
// (2) kern/ und editor/ importieren nie aus module/, nur start.js kennt module/register.js,
// (3) jede Shader-Datei eines Moduls verweist auf ihre Quelle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
const root = import.meta.dirname;
let fehler = 0;
const f = (t) => { console.log('FEHLER ' + t); fehler++; };
const walk = (d) => readdirSync(d).flatMap((x) => { const p = join(d, x); return x === 'dist' ? [] : statSync(p).isDirectory() ? walk(p) : [p]; });
for (const datei of walk(root).filter((p) => /\.(js|wgsl|html)$/.test(p) && !p.endsWith('check.mjs'))) {
  const rel = relative(root, datei).split(sep);
  const text = readFileSync(datei, 'utf8');
  for (const m of text.matchAll(/(?:import[^'"]*?from\s*|import\s*\(\s*|src=)['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    const ziel = relative(root, resolve(dirname(datei), m[1].split('?')[0])).split(sep);
    if (rel[0] === 'module' && rel.length > 3) {
      if (ziel[0] !== 'module' || ziel[1] !== rel[1] || ziel[2] !== rel[2]) f(`${rel.join('/')} importiert außerhalb seines Moduls: ${m[1]}`);
    } else if ((rel[0] === 'kern' || rel[0] === 'editor') && ziel[0] === 'module') f(`${rel.join('/')} greift auf ein Modul zu: ${m[1]}`);
    else if (rel[0] === 'start.js' && ziel[0] === 'module' && ziel[1] !== 'register.js') f(`start.js umgeht register.js: ${m[1]}`);
  }
  if (rel[0] === 'module' && datei.endsWith('.wgsl') && !/\[(G|Q|T|B)\d+\]|Quelle|MIT/.test(text)) f(`${rel.join('/')}: keine Quellenangabe`);
}
console.log(fehler ? `${fehler} Fehler` : 'OK: Module getrennt, Kern/Editor modulfrei, alle Modul-Shader mit Quelle');
process.exit(fehler ? 1 : 0);
