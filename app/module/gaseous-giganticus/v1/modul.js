// Modul: Verfahren von „Gaseous Giganticus“ (Stephen M. Cameron), Version 1.
// Quelle: https://github.com/smcameron/gaseous-giganticus (GPL-2.0). Kein Code übernommen: Verfahren gelesen,
// als Schritte [G1]–[G12] aufgeschrieben, neu als WebGPU geschrieben. Abweichungen [T1]–[T9]:
// [T1] 4D-Simplex nach Gustavson (MIT) statt OpenSimplex · [T2] Feld 1024² statt 2048² (?vf=) ·
// [T3] Partikel malen parallel · [T4] Drehrichtung der 90°-Drehung nach Rechte-Hand-Regel ·
// [T5] Anzeige unbeleuchtet (Licht im Beispielbild stammt aus mesh_viewer) · [T6] Standard-Eingabe = Spalte des Beispielbilds ·
// [T7] andere Zufallszahlen · [T9] Bänder waagerecht (wie Automatik-Modus und Beispielbild).
import uniforms from './shaders/uniforms.wgsl?raw';
import wuerfel from './shaders/wuerfel.wgsl?raw';
import rauschen from './shaders/rauschen.wgsl?raw';
import feld from './shaders/feld.wgsl?raw';
import partikel from './shaders/partikel.wgsl?raw';
import bild from './shaders/bild.wgsl?raw';
import farbe from './farbe.wgsl?raw';
import { bildLaden, beispielStreifen } from './eingabe.js';
import { wirbelErzeugen } from './wirbel.js';

export const info = { name: 'Gaseous Giganticus', quelle: 'github.com/smcameron/gaseous-giganticus (Verfahren, neu geschrieben)', kamera: { pitch: 0.15 } };
// Standardwerte des Originals
export const standard = { noiseScale: 2.6, velocityFactor: 1200, bands: 6, bandFactor: 2.9, bandPower: 1, poleAtt: 0.5,
  vortices: 0, vortexSize: 0.04, vortexVar: 0.02, vortexThresh: 0.2, fade: 0.01, opacityLimit: 0.2, wOffset: 0,
  octaves: 4, falloff: 0.5, stop1000: true };

export async function erstellen(gpu, P, meldung, q) {
  const { device } = gpu;
  const DIM = 1024;                                    // [G8]
  const VF = Number(q.get('vf')) || 1024;              // [T2]
  const COUNT = Math.min(Number(q.get('n')) || 8000000, Math.floor(device.limits.maxStorageBufferBindingSize / 16));  // [G2]
  const m = device.createShaderModule({ label: 'gg', code: [uniforms, wuerfel, rauschen, feld, partikel, bild].join('') });
  m.getCompilationInfo().then((i) => { const e = i.messages.filter((x) => x.type === 'error'); if (e.length) meldung(e.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('\n')); });
  const S = GPUBufferUsage.STORAGE;
  const ubuf = device.createBuffer({ size: 32 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const field = device.createBuffer({ size: 6 * VF * VF * 8, usage: S });
  const parts = device.createBuffer({ size: COUNT * 16, usage: S });
  const img = device.createBuffer({ size: 6 * DIM * DIM * 4, usage: S });
  const vortBuf = device.createBuffer({ size: 200 * 16, usage: S | GPUBufferUsage.COPY_DST });
  const C = GPUShaderStage.COMPUTE;
  const cl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'storage' } },
    { binding: 2, visibility: C, buffer: { type: 'storage' } },
    { binding: 3, visibility: C, buffer: { type: 'storage' } },
    { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 5, visibility: C, texture: { sampleType: 'float' } } ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [cl] });
  const pipe = (e) => device.createComputePipeline({ layout, compute: { module: m, entryPoint: e } });
  const pField = pipe('makeField'), pInit = pipe('initParticles'), pClear = pipe('clearImg'), pFade = pipe('fadeImg'), pMove = pipe('moveAndPaint');

  let eingabe;
  try { eingabe = await bildLaden(device, await beispielStreifen()); }
  catch (e) { meldung('Beispielbild nicht ladbar (' + e.message + '). Bitte „Eigenes Bild“ wählen.'); eingabe = await bildLaden(device, new ImageData(new Uint8ClampedArray([128, 100, 80, 255]), 1, 1)); }

  const U = new Float32Array(32);
  let iter = 0, opacity = 1, nvort = 0, seed = 1, cbg = null, g1 = null;
  const writeU = () => {
    U.set([DIM, VF, COUNT, opacity, P.noiseScale, P.velocityFactor, P.bands, P.bandFactor,
      P.bandPower, P.poleAtt, nvort, P.wOffset, P.octaves, P.falloff, P.fade, seed,
      ...eingabe.dunkel, 1, eingabe.w, eingabe.h, 0, 0]);
    device.queue.writeBuffer(ubuf, 0, U);
  };
  const groups = (n) => { const g = Math.ceil(n / 256); return [Math.min(g, 65535), Math.ceil(g / 65535)]; };
  const neu = () => {
    const w = wirbelErzeugen(P); device.queue.writeBuffer(vortBuf, 0, w.daten); nvort = w.n;
    iter = 0; opacity = 1; seed++;
    cbg = device.createBindGroup({ layout: cl, entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: field } },
      { binding: 2, resource: { buffer: parts } }, { binding: 3, resource: { buffer: img } },
      { binding: 4, resource: { buffer: vortBuf } }, { binding: 5, resource: eingabe.tex.createView() } ] });
    writeU();
    const enc = device.createCommandEncoder(); const p = enc.beginComputePass(); p.setBindGroup(0, cbg);
    p.setPipeline(pField); p.dispatchWorkgroups(Math.ceil(VF / 8), Math.ceil(VF / 8), 6);   // [G3] einmal
    p.setPipeline(pInit); p.dispatchWorkgroups(...groups(COUNT));
    p.setPipeline(pClear); p.dispatchWorkgroups(...groups(6 * DIM * DIM));
    p.end(); device.queue.submit([enc.finish()]);
  };
  neu();

  return {
    farbeWGSL: farbe,
    // Erklärungen und Formeln nach Handbuch und Code des Originals (gaseous-giganticus.1 / .c)
    regler: [
      { typ: 'knopf', label: 'Neu starten', aktion: neu, hilfe: 'Feld neu berechnen, Partikel neu verteilen, Bild schwarz. Nötig nach Reglern, die das Feld ändern.' },
      { typ: 'datei', label: 'Eigenes Bild', aktion: async (f) => { eingabe.tex.destroy(); eingabe = await bildLaden(device, f); neu(); },
        hilfe: 'Farbstreifen, aus dem jedes Partikel beim Start seine Farbe holt [G1]. Im Original etwa 200 × 1200 Pixel und weichgezeichnet.' },
      { typ: 'haken', k: 'stop1000', abschnitt: 'Ablauf', label: 'Nach 1000 Runden anhalten', hilfe: 'Das Original rechnet 1000 Runden und speichert dann die Textur [G12].' },
      { k: 'noiseScale', abschnitt: 'Rauschfeld', label: 'Rauschmaßstab', min: 0.5, max: 8, step: 0.1,
        hilfe: 'Größe der Rausch-Strukturen im Strömungsfeld (--noise-scale, Standard 2,6). Größer = kleinere Wirbel.', fx: 'v = ov · Maßstab;  g = ∇fBm(v, w)' },
      { k: 'velocityFactor', abschnitt: 'Rauschfeld', label: 'Geschwindigkeitsfaktor', min: 0, max: 4000, step: 10,
        hilfe: 'Stärke der Rauschströmung (--velocity-factor, Standard 1200).', fx: 'u = rot90°(proj(g)) · Faktor' },
      { k: 'octaves', abschnitt: 'Rauschfeld', label: 'Oktaven', min: 1, max: 7, step: 1,
        hilfe: 'Anzahl der Rauschebenen (--noise-levels, Standard 4).', fx: 'fBm = Σₖ Abfallᵏ · noise(2ᵏ·x)' },
      { k: 'falloff', abschnitt: 'Rauschfeld', label: 'fBm-Abfall', min: 0.1, max: 0.9, step: 0.05,
        hilfe: 'Gewicht jeder weiteren Oktave (--fbm-falloff, Standard 0,5).', fx: 'Gewicht der Oktave k = Abfallᵏ' },
      { k: 'wOffset', abschnitt: 'Rauschfeld', label: 'w-Versatz', min: 0, max: 300, step: 1,
        hilfe: 'Verschiebung in der 4. Rauschdimension (--w-offset): ein anderer Ausschnitt desselben Rauschens.', fx: 'w = w-Versatz · Maßstab' },
      { k: 'bands', abschnitt: 'Bänder', label: 'Bänder', min: 0, max: 20, step: 0.5,
        hilfe: 'Anzahl der gegenläufigen Bänder (--bands, Standard 6).', fx: 'Tempo(φ) = ((1−a) + a·cos φ) · cos(φ·Bänder)ᵖ · B' },
      { k: 'bandFactor', abschnitt: 'Bänder', label: 'Band-Faktor', min: 0, max: 10, step: 0.1,
        hilfe: 'Geschwindigkeit der Bänder B (--band-vel-factor, Standard 2,9).', fx: 'Tempo ∝ B' },
      { k: 'bandPower', abschnitt: 'Bänder', label: 'Band-Potenz', min: 1, max: 9, step: 2,
        hilfe: 'Ungerade Hochzahl p, macht die Zonen zwischen den Bändern breiter (--band-speed-power, Standard 1).', fx: 'cos(φ·Bänder)ᵖ' },
      { k: 'poleAtt', abschnitt: 'Bänder', label: 'Pol-Dämpfung', min: 0, max: 1, step: 0.01,
        hilfe: 'Wie stark die Bänder zu den Polen hin langsamer werden, a (--pole-attenuation, Standard 0,5).', fx: '(1−a) + a·cos φ' },
      { k: 'vortices', abschnitt: 'Wirbel', label: 'Wirbel', min: 0, max: 200, step: 1,
        hilfe: 'Anzahl künstlicher Wirbel (--vortices, Standard 0).', fx: 'Drehwinkel = ±2,5° · sin(π·d/r)' },
      { k: 'vortexSize', abschnitt: 'Wirbel', label: 'Wirbelgröße', min: 0.005, max: 0.2, step: 0.005,
        hilfe: 'Radius r als Anteil des Planetenradius (--vortex-size, Standard 0,04).', fx: 'r = Größe + (Zufall·Zufall) · Streuung' },
      { k: 'vortexVar', abschnitt: 'Wirbel', label: 'Wirbelgröße-Streuung', min: 0, max: 0.1, step: 0.005,
        hilfe: 'Streuung des Radius (--vortex-size-variance, Standard 0,02).', fx: 'r = Größe + (Zufall·Zufall) · Streuung' },
      { k: 'vortexThresh', abschnitt: 'Wirbel', label: 'Wirbel-Schwelle', min: 0.05, max: 1, step: 0.01,
        hilfe: 'Wirbel nur dort, wo die Bänder langsam sind (--vortex-band-threshold, Code-Standard 0,2).', fx: '|Tempo(φ)| ≤ Schwelle · B' },
      { k: 'fade', abschnitt: 'Malen', label: 'Verblassen', min: 0, max: 0.1, step: 0.001,
        hilfe: 'Jede Runde wird das Bild mit der dunkelsten Farbe des Eingabebilds überblendet (--fade-rate, Standard 0,01) [G9].', fx: 'neu = dunkel · f + alt · (1 − f)' },
      { k: 'opacityLimit', abschnitt: 'Malen', label: 'Deckkraft minimal', min: 0, max: 1, step: 0.01,
        hilfe: 'Deckkraft der Partikel sinkt je Runde um 5 % bis zu diesem Wert (--opacity, Standard 0,2) [G11].', fx: 'Deckkraft ← max(Grenze, 0,95 · Deckkraft)' },
    ],
    // eine Runde [G9][G7][G10][G11]; false = angehalten [G12]
    schritt(enc) {
      if (P.stop1000 && iter >= 1000) return false;
      writeU();
      const p = enc.beginComputePass(); p.setBindGroup(0, cbg);
      p.setPipeline(pFade); p.dispatchWorkgroups(...groups(6 * DIM * DIM));
      p.setPipeline(pMove); p.dispatchWorkgroups(...groups(COUNT));
      p.end();
      iter++;
      if (opacity > P.opacityLimit) opacity *= 0.95;
      return true;
    },
    gruppe1(layout1) { return g1 ??= device.createBindGroup({ layout: layout1, entries: [{ binding: 0, resource: { buffer: img } }] }); },
    rand: () => 0,
    status: () => `Runde ${iter}${P.stop1000 && iter >= 1000 ? ' (fertig)' : ''} · ${(COUNT / 1e6).toFixed(1)} Mio. Partikel · Feld ${VF}²`,
    zerstoeren() { for (const b of [ubuf, field, parts, img, vortBuf]) b.destroy(); eingabe.tex.destroy(); },
  };
}
