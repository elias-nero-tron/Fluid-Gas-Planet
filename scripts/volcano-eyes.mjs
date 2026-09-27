// "Augen" für den Vulkanplaneten: rechnet ohne Fenster (Offscreen-Textur, keine Swapchain) und speichert
// Bilder aus festgelegten Blickwinkeln nebeneinander in einem PNG.
//
//   npx http-server -p 5198 -c-1 .     (in einem zweiten Terminal; oder npm run dev und --url anpassen)
//   node scripts/volcano-eyes.mjs --set res=1024,warm=8 --out /tmp/volcano
//
// Optionen: --url (Standard http://localhost:5198/demo/volcano.html), --set key=value,... (Regler, wie #key=value),
// --views JSON-Liste mit {look: Vulkan-Index, alt: km, dpitch, dyaw, sunRel: Grad, set: {...}, adv: Stunden},
// --width/--height pro Bild, --gpu (echte GPU statt SwiftShader), --out (Pfad ohne Endung).
// Braucht Playwright (npm i -D playwright oder PLAYWRIGHT_MODULE=/pfad/zu/playwright/index.mjs).

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
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const hash = String(args.set || 'res=1024,warm=8').split(',').filter(Boolean).join('&');
await page.goto(`${args.url || 'http://localhost:5198/demo/volcano.html'}#offscreen&${hash}`);
await page.waitForFunction(() => window.volcanoPlanet?.ready || !document.getElementById('status').hidden, null, { timeout: 30 * 60000, polling: 1000 });
const status = await page.evaluate(() => (document.getElementById('status').hidden ? '' : document.getElementById('status').innerText));
if (status) { console.error(status); process.exit(1); }

const n = await page.evaluate(() => window.volcanoPlanet.volcs().length);
const views = args.views ? JSON.parse(args.views) : [
  { alt: 12000 },
  { look: n - 1, alt: 4000, sunRel: 60 },
  { look: n - 1, alt: 2000, dpitch: -0.45, sunRel: 80, set: { tilt: 55 } },
  { look: 0, alt: 1500, dpitch: -0.25, sunRel: 70, set: { tilt: 50 } },
];
const w = Number(args.width || 480), h = Number(args.height || 300);
const shots = [];
for (const v of views) {
  shots.push(await page.evaluate(async ([v, w, h]) => {
    const a = window.volcanoPlanet;
    if (v.set) Object.assign(a.S, v.set);
    if (v.adv) await a.advance(v.adv);
    for (const k of ['yaw', 'pitch', 'alt']) if (v[k] !== undefined) a.cam[k] = v[k];
    if (v.look !== undefined) { a.look(v.look, v.alt); a.cam.yaw += v.dyaw || 0; a.cam.pitch += v.dpitch || 0; }
    if (v.sunRel !== undefined) { a.S.sunAz = (a.cam.yaw * 180) / Math.PI + v.sunRel; a.S.sunEl = v.sunEl ?? 10; }
    return a.capture(w, h);
  }, [v, w, h]));
}
// Nebeneinander in ein PNG
const strip = await page.evaluate(async ([urls, w, h]) => {
  const cv = document.createElement('canvas'); cv.width = w * urls.length; cv.height = h;
  const c = cv.getContext('2d');
  for (let i = 0; i < urls.length; i++) { const im = new Image(); im.src = urls[i]; await im.decode(); c.drawImage(im, i * w, 0); }
  return cv.toDataURL('image/png');
}, [shots, w, h]);
const out = args.out || 'eyes-out/volcano';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.png`, Buffer.from(strip.split(',')[1], 'base64'));
console.log(`${out}.png`);
if (errors.length) console.log('Fehler:', errors.slice(0, 5).join('\n'));
await browser.close();
