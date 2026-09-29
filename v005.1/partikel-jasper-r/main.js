import uniforms from './shaders/uniforms.wgsl?raw';
import abbildung from './shaders/abbildung.wgsl?raw';
import rauschen from './shaders/rauschen.wgsl?raw';
import fluss from './shaders/fluss.wgsl?raw';
import partikel from './shaders/partikel.wgsl?raw';
import bild from './shaders/bild.wgsl?raw';
import anzeige from './shaders/anzeige.wgsl?raw';

const err = (m) => { document.getElementById('err').textContent = m; };
if (!navigator.gpu) { err('Kein WebGPU in diesem Browser.'); throw 0; }
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { err('Kein WebGPU-Adapter.'); throw 0; }
const device = await adapter.requestDevice({ requiredLimits: {
  maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  maxBufferSize: adapter.limits.maxBufferSize } });
device.lost.then((i) => err('Grafikgerät verloren: ' + i.message));

const q = new URLSearchParams(location.search);
// Quelle: 4 Mio. Partikel. Auf zu kleinem Speicher entsprechend weniger.
const COUNT = Math.min(Number(q.get('n')) || 4194304, Math.floor(device.limits.maxStorageBufferBindingSize / 16));
const W = 2048, H = 1024;       // Texturgröße: Quelle schweigt
const FW = 512, FH = 256;       // Flussfeld-Größe: Quelle schweigt

// Regler (Quelle schweigt) – Platzhalterwerte
const P = { opacity: 0.35, blur: 0.12, fade: 0.05, nBatch: 120, nOct: 4, freq: 3, amp: 0.4, noiseSpeed: 0.02, speed: 1, edge: 0.05, stretch: 6 };
// Verlauf nach Breite [Q4]: 16 Farben GEMESSEN aus jasper-rs eigener Textur (assets/images/gas-giant/mapping.png,
// Spalte außerhalb der Partikelfläche, Nord → Süd). [B1]
const GRAD = [[0.094,0.067,0.063],[0.310,0.263,0.251],[0.431,0.337,0.322],[0.416,0.322,0.302],[0.416,0.365,0.380],[0.341,0.302,0.333],[0.282,0.224,0.251],[0.196,0.173,0.216],[0.137,0.129,0.176],[0.129,0.122,0.169],[0.251,0.212,0.251],[0.431,0.322,0.310],[0.149,0.125,0.149],[0.106,0.106,0.118],[0.118,0.110,0.118],[0.157,0.149,0.157]];
for (const k in P) if (q.has(k)) P[k] = Number(q.get(k));   // Werte per Adresse (zum Prüfen)
const CENTRE = GRAD.reduce((a, c) => a.map((v, i) => v + c[i] / GRAD.length), [0, 0, 0]);

const WGSL = [uniforms, abbildung, rauschen, fluss, partikel, bild].join('');

const RENDER = anzeige;

const mod = device.createShaderModule({ code: WGSL });
const rmod = device.createShaderModule({ code: RENDER });
for (const m of [mod, rmod]) m.getCompilationInfo().then((i) => { const e = i.messages.filter((x) => x.type === 'error'); if (e.length) err(e.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('\n')); });

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
const pipe = (e) => device.createComputePipeline({ layout, compute: { module: mod, entryPoint: e } });
const pFlow = pipe('flowOctave'), pMove = pipe('moveParticles'), pBlur = pipe('blurFade');
const cbg = [0, 1].map((k) => device.createBindGroup({ layout: cl, entries: [
  { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: flow } }, { binding: 2, resource: { buffer: parts } },
  { binding: 3, resource: { buffer: surf[k] } }, { binding: 4, resource: { buffer: surf[1 - k] } } ] }));

const canvas = document.getElementById('c');
const TEST = q.has('test');   // [T7]
const ctx = TEST ? null : canvas.getContext('webgpu');
const format = TEST ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
if (ctx) ctx.configure({ device, format, alphaMode: 'opaque' });
let testTex = null;
if (TEST) { canvas.width = 640; canvas.height = 480; testTex = device.createTexture({ size: [640, 480], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
window.grab = async () => {   // [T7] Testbild als Daten-URL
  const buf = device.createBuffer({ size: 640 * 480 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder();
  e.copyTextureToBuffer({ texture: testTex }, { buffer: buf, bytesPerRow: 640 * 4 }, [640, 480]);
  device.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const c2 = document.createElement('canvas'); c2.width = 640; c2.height = 480;
  c2.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.getMappedRange().slice(0)), 640, 480), 0, 0);
  return c2.toDataURL();
};
const rpipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: rmod, entryPoint: 'vs' },
  fragment: { module: rmod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
// Anzeige liest die Textur, die blurFade gerade geschrieben hat (surf[1-k])
const rbg = [0, 1].map((k) => device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [
  { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: surf[1 - k] } } ] }));

// Regler
const ctl = document.getElementById('ctl');
const sliders = [['opacity', 'Deckkraft', 0, 1, 0.01], ['blur', 'Weichzeichnen', 0, 1, 0.01], ['fade', 'Verblassen /s', 0, 1, 0.005],
  ['nBatch', 'Batches (Lebenszeit)', 8, 600, 1], ['nOct', 'Oktaven', 1, 8, 1], ['freq', 'Rausch-Frequenz', 0.5, 12, 0.1],
  ['amp', 'Rausch-Stärke', 0, 2, 0.01], ['noiseSpeed', 'Rausch-Tempo', 0, 0.2, 0.001], ['speed', 'Partikel-Tempo', 0, 5, 0.05],
  ['edge', 'Randunschärfe', 0.001, 0.2, 0.001], ['stretch', 'Ost-West-Streckung', 1, 8, 0.1]];
for (const [k, label, min, max, step] of sliders) {
  const l = document.createElement('label');
  l.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${P[k]}"><output>${P[k]}</output>`;
  const [inp, out] = [l.querySelector('input'), l.querySelector('output')];
  inp.oninput = () => { P[k] = Number(inp.value); out.textContent = inp.value; if (k === 'nBatch') init = true; };
  ctl.appendChild(l);
}

// Drehen mit der Maus [T6]
let yaw = 0, pitch = 0.2, drag = null;
canvas.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); };
canvas.onpointerup = () => { drag = null; };
canvas.onpointermove = (e) => { if (!drag) return; yaw += (e.clientX - drag[0]) * 0.005; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; };

const data = new Float32Array(128);
let frame = 0, octave = 0, ntime = 0, time = 0, k = 0, init = true;
let fpsT = performance.now(), fpsN = 0;
function tick() {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = TEST ? 640 : Math.round(canvas.clientWidth * dpr), h = TEST ? 480 : Math.round(canvas.clientHeight * dpr);
  if (!TEST && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
  const dt = 1 / 60;
  const nb = P.nBatch, batch = Math.ceil(COUNT / nb);
  if (octave === 0) ntime = time * P.noiseSpeed;   // [Q8] Rauschen bewegt sich über die Zeit
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Welt -> Kugel: erst um x (pitch), dann um y (yaw)
  const r = [[cy, sy * sp, -sy * cp], [0, cp, sp], [sy, -cy * sp, cy * cp]];
  data.set([W, H, FW, FH, COUNT, batch, nb, frame % nb, P.opacity, P.blur, P.fade, dt,
    octave, P.nOct, P.freq, P.amp, ntime, init ? 1 : 0, P.edge, w / h, P.speed, frame, P.stretch, 0,
    ...CENTRE, 1, ...GRAD.flatMap((c) => [...c, 1]), ...r[0], 0, ...r[1], 0, ...r[2], 0]);
  device.queue.writeBuffer(ubuf, 0, data);
  const enc = device.createCommandEncoder();
  const p = enc.beginComputePass();
  p.setBindGroup(0, cbg[k]);
  p.setPipeline(pFlow); p.dispatchWorkgroups(Math.ceil(FW / 16), Math.ceil(FH / 16));
  p.setPipeline(pMove);
  const groups = Math.ceil(COUNT / 256);
  p.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
  p.setPipeline(pBlur); p.dispatchWorkgroups(Math.ceil(W / 16), Math.ceil(H / 16));
  p.end();
  const rp = enc.beginRenderPass({ colorAttachments: [{ view: (TEST ? testTex : ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  rp.setPipeline(rpipe); rp.setBindGroup(0, rbg[k]); rp.draw(3); rp.end();
  device.queue.submit([enc.finish()]);
  k = 1 - k; frame++; time += dt; init = false;
  octave = (octave + 1) % P.nOct;
  fpsN++;
  const now = performance.now();
  window.frames_ = frame;
  if (now - fpsT > 500) { document.getElementById('fps').textContent = `${Math.round(fpsN * 1000 / (now - fpsT))} fps · ${(COUNT / 1e6).toFixed(2)} Mio. Partikel`; fpsT = now; fpsN = 0; }
  if (TEST) device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(tick));   // [T7] nicht vorauslaufen
  else requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
