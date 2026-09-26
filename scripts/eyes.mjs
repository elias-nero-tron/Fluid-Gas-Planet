// "Augen" für Menschen und KI-Assistenten: startet die Simulation in einem Browser ohne Fenster,
// lässt sie einschwingen und speichert einen Filmstreifen (mehrere Bilder nebeneinander) plus
// Messwerte. So lassen sich Bewegung und Schärfe vergleichen, ohne Einzelbilder zu beschreiben.
//
//   npm run dev                       (in einem zweiten Terminal)
//   node scripts/eyes.mjs --preset Jupiter --track fluid --out docs/eyes/jupiter-fluid
//   node scripts/eyes.mjs --set omega=6,kickLife=12 --frames 8 --every 240
//
// Optionen: --url (Standard http://localhost:5173/), --preset, --track, --quality (Standard phone),
// --set key=value,... (beliebige Regler), --frames, --every (Simulationsschritte zwischen Bildern),
// --map (Kartenansicht), --warm (Vorrechen-Schritte, Standard 1200), --gpu (echte GPU statt SwiftShader), --out (Pfad ohne Endung).
// Braucht Playwright: npm i -D playwright (oder PLAYWRIGHT_MODULE=/pfad/zu/playwright/index.mjs).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const launch = { headless: true, args: ['--enable-unsafe-webgpu', ...(args.gpu ? [] : ['--use-webgpu-adapter=swiftshader'])] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: Number(args.width || 960), height: Number(args.height || 640) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${args.url || 'http://localhost:5173/'}#offscreen${args.warm ? `&warm=${args.warm}` : ''}`);
await page.waitForFunction(() => window.gasPlanet, null, { timeout: 60000 });

// Regler über die Bedienelemente setzen, damit die App genauso reagiert wie bei einem Klick.
async function set(key, value) {
  await page.evaluate(([k, v]) => {
    const el = document.getElementById(`ctl-${k}`);
    if (!el) { window.gasPlanet.settings[k] = isNaN(Number(v)) ? v : Number(v); return; }
    if (el.type === 'checkbox') { el.checked = v === 'true' || v === true; el.dispatchEvent(new Event('change')); }
    else if (el.tagName === 'SELECT') { el.value = String(v); el.dispatchEvent(new Event('change')); }
    else { el.value = String(v); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
  }, [key, value]);
}

await set('quality', args.quality || 'phone');
// Feste Auflösung: die 60-fps-Automatik würde im langsamen Software-Renderer herunterschalten.
await set('autoQuality', false);
if (args.preset) await set('preset', args.preset);
if (args.track) await set('track', args.track);
for (const kv of String(args.set || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  await set(k, v);
}
if (args.map) await set('map', true);

// Warten, bis das Vorrechnen fertig ist.
await page.waitForFunction(() => document.getElementById('loading').classList.contains('done'), null, { timeout: 20 * 60000, polling: 1000 });

const film = await page.evaluate(([frames, every]) => window.gasPlanet.filmstrip({ frames, everySteps: every, cols: 4, scale: 0.5 }),
  [Number(args.frames || 8), Number(args.every || 120)]);

const out = args.out || 'eyes-out/filmstrip';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.png`, Buffer.from(film.image.split(',')[1], 'base64'));
const settings = await page.evaluate(() => window.gasPlanet.settings);
writeFileSync(`${out}.json`, JSON.stringify({ stats: film.stats, errors, settings }, null, 2));
console.log(`${out}.png`);
for (const s of film.stats) console.log(`t=${s.t}s  detail=${s.detail}  change=${s.change}`);
if (errors.length) console.log('Fehler:', errors.slice(0, 5).join('\n'));
await browser.close();
