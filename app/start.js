// Start: verbindet Kern, Editor und das gewählte Modul. Enthält selbst kein Verfahren.
// Adresse: ?modul=jasper-r&version=v1&n=…  (Modulwerte per Adresse überschreibbar), ?test für den Software-Renderer.
import { gpuStarten } from './kern/gpu.js';
import { kameraStarten } from './kern/kamera.js';
import { anzeigeBauen } from './kern/anzeige.js';
import { editorStarten } from './editor/editor.js';
import { MODULE } from './module/register.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('bild');
const editor = editorStarten(document.getElementById('editor'));
const meldung = (t) => editor.fehler(t);
let gpu;
try { gpu = await gpuStarten(canvas, q.has('test')); } catch (e) { meldung(e.message); throw e; }
gpu.device.lost.then((i) => meldung('Grafikgerät verloren: ' + i.message));
window.grab = gpu.grab;
const kamera = kameraStarten(canvas);

let aktiv = null, anzeige = null, schritte = 0;
async function laden(id, version) {
  aktiv?.instanz.zerstoeren();
  aktiv = null;
  const m = MODULE[id].versionen[version];
  const werte = { ...m.standard };
  for (const k in werte) if (q.has(k)) werte[k] = typeof werte[k] === 'boolean' ? q.get(k) !== '0' : Number(q.get(k));
  const instanz = await m.erstellen(gpu, werte, meldung, q);
  anzeige = anzeigeBauen(gpu, instanz.farbeWGSL, meldung);
  if (m.info.kamera) Object.assign(kamera, m.info.kamera);
  aktiv = { m, instanz, werte };
  schritte = 0;
  editor.auswahlZeigen(Object.entries(MODULE).map(([i, x]) => [i, x.name, Object.keys(x.versionen)]), id, version, laden);
  editor.modulZeigen(m.info, instanz.regler, werte, (k) => instanz.geaendert?.(k));
}
const startId = MODULE[q.get('modul')] ? q.get('modul') : 'gaseous-giganticus';
await laden(startId, q.get('version') || Object.keys(MODULE[startId].versionen).at(-1));

let fpsT = performance.now(), fpsN = 0, fps = 0;
function tick() {
  const [w, h] = gpu.groesse();
  if (aktiv) {
    const enc = gpu.device.createCommandEncoder();
    if (aktiv.instanz.schritt(enc)) schritte++;
    anzeige.zeichnen(enc, kamera.zeilen(), w / h, aktiv.instanz.rand(), aktiv.instanz.gruppe1(anzeige.layout1));
    gpu.device.queue.submit([enc.finish()]);
    fpsN++;
    const now = performance.now();
    if (now - fpsT > 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsT = now; fpsN = 0; }
    editor.status(`${fps} fps · ${aktiv.instanz.status()}`);
  }
  window.schritte_ = schritte;
  if (gpu.test) gpu.device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(tick));
  else requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
