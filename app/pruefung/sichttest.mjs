// Bildtest der App: jedes Modul in jeder Version laden, einige Schritte rechnen, Bild holen und prüfen:
// keine Seitenfehler, keine Shaderfehler, Planet nicht schwarz, und Bild gegen das freigegebene Referenzbild.
// Aufruf: node app/pruefung/sichttest.mjs            (prüfen)
//         node app/pruefung/sichttest.mjs --neu      (Referenzbilder neu schreiben – nur nach Freigabe des Urhebers)
// Läuft im Software-Renderer (CPU): kleine Partikelzahlen, Werte fest über die Adresse.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = join(import.meta.dirname, '..', 'dist');
const refDir = join(import.meta.dirname, 'referenz');
const neu = process.argv.includes('--neu');
const FAELLE = [   // Modul, Version, Adresszusatz, Schritte
  ['gaseous-giganticus', 'v1', '&n=200000&vf=128', 40],
  ['jasper-r', 'v1', '&n=100000', 40],
];
const TOLERANZ = 4;   // mittlere Abweichung in Helligkeitsstufen (Partikel malen parallel → Lauf-zu-Lauf-Streuung ≈ 1,6)

const typen = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let daten;
  try { daten = await readFile(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': typen[extname(p)] ?? 'application/octet-stream' }); res.end(daten);
}).listen(0);
const port = server.address().port;

const args = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1', '--ignore-certificate-errors');
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe, args });
let fehler = 0;
await mkdir(refDir, { recursive: true });
for (const [modul, version, extra, schritte] of FAELLE) {
  const name = `${modul}-${version}`;
  const page = await browser.newPage();
  const seitenfehler = [];
  page.on('pageerror', (e) => seitenfehler.push(e.message));
  await page.goto(`http://localhost:${port}/index.html?test&modul=${modul}&version=${version}${extra}`);
  const t0 = Date.now();
  while ((await page.evaluate(() => window.schritte_ || 0)) < schritte) {
    if (Date.now() - t0 > 240000) { seitenfehler.push('Zeitüberschreitung'); break; }
    await page.waitForTimeout(500);
  }
  const meldung = (await page.textContent('#fehler')) ?? '';
  const png = Buffer.from((await page.evaluate(() => window.grab())).split(',')[1], 'base64');
  // Pixel über den Browser auslesen (keine Bildbibliothek nötig)
  const pixel = async (buf) => page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(img.width, img.height).getContext('2d'); c.drawImage(img, 0, 0);
    return Array.from(c.getImageData(0, 0, img.width, img.height).data);
  }, buf.toString('base64'));
  const a = await pixel(png);
  let hell = 0; for (let i = 0; i < a.length; i += 4) hell += (a[i] + a[i + 1] + a[i + 2]) / 3;
  hell /= a.length / 4;
  const probleme = [...seitenfehler];
  if (/Shader|Zeile \d+/.test(meldung)) probleme.push('Shaderfehler: ' + meldung);
  if (hell < 5) probleme.push(`Bild fast schwarz (mittlere Helligkeit ${hell.toFixed(1)})`);
  const ref = join(refDir, `${name}.png`);
  if (neu) { await writeFile(ref, png); console.log(`${name}: Referenz geschrieben`); }
  else if (!existsSync(ref)) probleme.push('kein Referenzbild (mit --neu anlegen, nur nach Freigabe)');
  else {
    const b = await pixel(await readFile(ref));
    let d = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) d += Math.abs(a[i] - b[i]);
    d /= (a.length / 4) * 3;
    if (d > TOLERANZ) probleme.push(`weicht vom Referenzbild ab: ${d.toFixed(2)} Stufen (erlaubt ${TOLERANZ})`);
    else console.log(`${name}: OK (Abweichung ${d.toFixed(2)}, Helligkeit ${hell.toFixed(1)})`);
  }
  if (probleme.length) { fehler++; console.log(`${name}: FEHLER\n  ${probleme.join('\n  ')}`); await writeFile(join(refDir, `${name}.ist.png`), png); }
  await page.close();
}
await browser.close(); server.close();
console.log(fehler ? `${fehler} Fall/Fälle fehlgeschlagen` : 'Bildtest bestanden');
process.exit(fehler ? 1 : 0);
