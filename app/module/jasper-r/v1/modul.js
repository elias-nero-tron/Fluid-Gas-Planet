// Modul: Partikel nach jasper-r, „Gas giant particle sim on a sphere“ (2022), Version 1.
// Quelle: https://jasper-r.github.io/gas-giant – Verfahren [Q1]–[Q9] aus dem Text, Werte [B1]–[B4] aus seinen Bildern gemessen,
// Übersetzungen [T1]–[T5] (siehe Shader). Werte, zu denen die Quelle schweigt, sind Regler.
import uniforms from './shaders/uniforms.wgsl?raw';
import abbildung from './shaders/abbildung.wgsl?raw';
import rauschen from './shaders/rauschen.wgsl?raw';
import fluss from './shaders/fluss.wgsl?raw';
import partikel from './shaders/partikel.wgsl?raw';
import bild from './shaders/bild.wgsl?raw';
import farbe from './farbe.wgsl?raw';

export const info = { name: 'Partikel nach jasper-r', quelle: 'jasper-r.github.io/gas-giant (Verfahren aus Text, Werte aus seinen Bildern)', kamera: { pitch: 0.2 } };
export const standard = { opacity: 0.35, blur: 0.12, fade: 0.05, nBatch: 120, nOct: 4, freq: 3, amp: 0.4, noiseSpeed: 0.02, speed: 1, edge: 0.05, stretch: 6 };
// [B1] Verlauf nach Breite: 16 Farben aus jasper-rs mapping.png (Nord → Süd)
const GRAD = [[0.094,0.067,0.063],[0.310,0.263,0.251],[0.431,0.337,0.322],[0.416,0.322,0.302],[0.416,0.365,0.380],[0.341,0.302,0.333],[0.282,0.224,0.251],[0.196,0.173,0.216],[0.137,0.129,0.176],[0.129,0.122,0.169],[0.251,0.212,0.251],[0.431,0.322,0.310],[0.149,0.125,0.149],[0.106,0.106,0.118],[0.118,0.110,0.118],[0.157,0.149,0.157]];
const CENTRE = GRAD.reduce((a, c) => a.map((v, i) => v + c[i] / GRAD.length), [0, 0, 0]);

export async function erstellen(gpu, P, meldung, q) {
  const { device } = gpu;
  const COUNT = Math.min(Number(q.get('n')) || 4194304, Math.floor(device.limits.maxStorageBufferBindingSize / 16));
  const W = 2048, H = 1024, FW = 512, FH = 256;   // Größen: Quelle schweigt
  const m = device.createShaderModule({ label: 'jasper', code: [uniforms, abbildung, rauschen, fluss, partikel, bild].join('') });
  m.getCompilationInfo().then((i) => { const e = i.messages.filter((x) => x.type === 'error'); if (e.length) meldung(e.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('\n')); });
  const S = GPUBufferUsage.STORAGE;
  const ubuf = device.createBuffer({ size: 128 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const flow = device.createBuffer({ size: FW * FH * 16, usage: S });
  const parts = device.createBuffer({ size: COUNT * 16, usage: S });
  const surf = [device.createBuffer({ size: W * H * 16, usage: S }), device.createBuffer({ size: W * H * 16, usage: S })];
  const C = GPUShaderStage.COMPUTE;
  const cl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    ...[1, 2, 3, 4].map((b) => ({ binding: b, visibility: C, buffer: { type: 'storage' } })) ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [cl] });
  const pipe = (e) => device.createComputePipeline({ layout, compute: { module: m, entryPoint: e } });
  const pFlow = pipe('flowOctave'), pMove = pipe('moveParticles'), pBlur = pipe('blurFade');
  const cbg = [0, 1].map((k) => device.createBindGroup({ layout: cl, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: flow } }, { binding: 2, resource: { buffer: parts } },
    { binding: 3, resource: { buffer: surf[k] } }, { binding: 4, resource: { buffer: surf[1 - k] } } ] }));

  const data = new Float32Array(128);
  let frame = 0, octave = 0, ntime = 0, time = 0, k = 0, init = true, g1 = null, gezeigt = 0;
  return {
    farbeWGSL: farbe,
    regler: [
      { k: 'opacity', label: 'Deckkraft', min: 0, max: 1, step: 0.01 }, { k: 'blur', label: 'Weichzeichnen', min: 0, max: 1, step: 0.01 },
      { k: 'fade', label: 'Verblassen /s', min: 0, max: 1, step: 0.005 }, { k: 'nBatch', label: 'Batches (Lebenszeit)', min: 8, max: 600, step: 1 },
      { k: 'nOct', label: 'Oktaven', min: 1, max: 8, step: 1 }, { k: 'freq', label: 'Rausch-Frequenz', min: 0.5, max: 12, step: 0.1 },
      { k: 'amp', label: 'Rausch-Stärke', min: 0, max: 2, step: 0.01 }, { k: 'noiseSpeed', label: 'Rausch-Tempo', min: 0, max: 0.2, step: 0.001 },
      { k: 'speed', label: 'Partikel-Tempo', min: 0, max: 5, step: 0.05 }, { k: 'edge', label: 'Randunschärfe', min: 0.001, max: 0.2, step: 0.001 },
      { k: 'stretch', label: 'Ost-West-Streckung', min: 1, max: 8, step: 0.1 },
    ],
    geaendert(key) { if (key === 'nBatch') init = true; },
    schritt(enc) {
      const dt = 1 / 60;
      const nb = P.nBatch, batch = Math.ceil(COUNT / nb);
      if (octave === 0) ntime = time * P.noiseSpeed;   // [Q8]
      data.set([W, H, FW, FH, COUNT, batch, nb, frame % nb, P.opacity, P.blur, P.fade, dt,
        octave, P.nOct, P.freq, P.amp, ntime, init ? 1 : 0, P.edge, 0, P.speed, frame, P.stretch, 0,
        ...CENTRE, 1, ...GRAD.flatMap((c) => [...c, 1])]);
      device.queue.writeBuffer(ubuf, 0, data);
      const p = enc.beginComputePass();
      p.setBindGroup(0, cbg[k]);
      p.setPipeline(pFlow); p.dispatchWorkgroups(Math.ceil(FW / 16), Math.ceil(FH / 16));
      p.setPipeline(pMove);
      const groups = Math.ceil(COUNT / 256);
      p.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
      p.setPipeline(pBlur); p.dispatchWorkgroups(Math.ceil(W / 16), Math.ceil(H / 16));
      p.end();
      gezeigt = k;   // Anzeige liest surf[1-k], das blurFade gerade geschrieben hat
      k = 1 - k; frame++; time += dt; init = false;
      octave = (octave + 1) % P.nOct;
      return true;
    },
    gruppe1(layout1) {
      g1 ??= [0, 1].map((i) => device.createBindGroup({ layout: layout1, entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: surf[1 - i] } } ] }));
      return g1[gezeigt];
    },
    rand: () => P.edge,
    status: () => `Bild ${frame} · ${(COUNT / 1e6).toFixed(2)} Mio. Partikel`,
    zerstoeren() { for (const b of [ubuf, flow, parts, ...surf]) b.destroy(); },
  };
}
