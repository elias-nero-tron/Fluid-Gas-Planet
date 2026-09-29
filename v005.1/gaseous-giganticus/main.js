import uniforms from './shaders/uniforms.wgsl?raw';
import wuerfel from './shaders/wuerfel.wgsl?raw';
import rauschen from './shaders/rauschen.wgsl?raw';
import feld from './shaders/feld.wgsl?raw';
import partikel from './shaders/partikel.wgsl?raw';
import bild from './shaders/bild.wgsl?raw';
import anzeige from './shaders/anzeige.wgsl?raw';

const err = (m) => { document.getElementById('err').textContent = m; };
if (!navigator.gpu) { err('Kein WebGPU in diesem Browser.'); throw 0; }
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { err('Kein WebGPU-Adapter.'); throw 0; }
const device = await adapter.requestDevice({ requiredLimits: {
  maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
device.lost.then((i) => err('Grafikgerät verloren: ' + i.message));

const q = new URLSearchParams(location.search);
const TEST = q.has('test');
const DIM = 1024;                                    // [G8]
const VF = Number(q.get('vf')) || 1024;              // [T2]
const COUNT = Math.min(Number(q.get('n')) || 8000000, Math.floor(device.limits.maxStorageBufferBindingSize / 16));  // [G2]

// Standardwerte des Originals
const P = { noiseScale: 2.6, velocityFactor: 1200, bands: 6, bandFactor: 2.9, bandPower: 1, poleAtt: 0.5,
  vortices: 0, vortexSize: 0.04, vortexVar: 0.02, vortexThresh: 0.2, fade: 0.01, opacityLimit: 0.2, wOffset: 0,
  octaves: 4, falloff: 0.5 };
for (const k in P) if (q.has(k)) P[k] = Number(q.get(k));

const WGSL = [uniforms, wuerfel, rauschen, feld, partikel, bild].join('');

const RENDER = anzeige;

const mod = device.createShaderModule({ code: WGSL });
const rmod = device.createShaderModule({ code: RENDER });
for (const m of [mod, rmod]) m.getCompilationInfo().then((i) => { const e = i.messages.filter((x) => x.type === 'error'); if (e.length) err(e.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('\n')); });

const S = GPUBufferUsage.STORAGE;
const ubuf = device.createBuffer({ size: 32 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const field = device.createBuffer({ size: 6 * VF * VF * 8, usage: S });
const parts = device.createBuffer({ size: COUNT * 16, usage: S });
const img = device.createBuffer({ size: 6 * DIM * DIM * 4, usage: S });
const vortBuf = device.createBuffer({ size: 200 * 16, usage: S | GPUBufferUsage.COPY_DST });

// ---------- Eingabebild [G1][T6] ----------
let srcTex = null, imgW = 1, imgH = 1, dark = [0, 0, 0];
async function setImage(bitmapSource) {
  const bmp = await createImageBitmap(bitmapSource);
  imgW = bmp.width; imgH = bmp.height;
  srcTex?.destroy();
  srcTex = device.createTexture({ size: [imgW, imgH], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: bmp }, { texture: srcTex }, [imgW, imgH]);
  // [G9] dunkelste Farbe des Eingabebilds (kleinste Summe r+g+b)
  const cv = new OffscreenCanvas(imgW, imgH); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
  const px = cx.getImageData(0, 0, imgW, imgH).data; let min = 1e9;
  for (let k = 0; k < px.length; k += 4) { const s = px[k] + px[k + 1] + px[k + 2]; if (s < min) { min = s; dark = [px[k] / 255, px[k + 1] / 255, px[k + 2] / 255]; } }
}
async function defaultImage() {   // [T6] mittlere Spalte des Beispielbilds (Kugel von Zeile 40 bis 950), Nord oben
  const res = await fetch('https://raw.githubusercontent.com/smcameron/gaseous-giganticus/master/sample-gg-output-1.jpg');
  const bmp = await createImageBitmap(await res.blob());
  const top = 40, h = 910, x = Math.round(bmp.width / 2);
  const cv = new OffscreenCanvas(8, h); const cx = cv.getContext('2d');
  // [G1] y = 0 ist im Original der Südpol: Streifen darum umgedreht, damit Nord oben bleibt
  cx.translate(0, h); cx.scale(1, -1);
  cx.drawImage(bmp, x, top, 1, h, 0, 0, 8, h);
  return cv.transferToImageBitmap();
}

// ---------- Wirbel [G6] ----------
function bandSpeedJS(lat) {
  const c = Math.cos(lat * P.bands);
  return ((1 - P.poleAtt) + P.poleAtt * Math.cos(lat)) * Math.sign(c) * Math.abs(c) ** P.bandPower * P.bandFactor;
}
function makeVortices() {
  const out = new Float32Array(200 * 4);
  const n = Math.min(200, Math.round(P.vortices));
  const rs = () => (2 * Math.random() - 1) * (2 * Math.random() - 1);
  for (let k = 0; k < n; k++) {
    let p, r, lat, tries = 0;
    do {   // Bedingung wörtlich wie im Original
      const z = 1 - 2 * Math.random(), ph = 2 * Math.PI * Math.random(), s = Math.sqrt(1 - z * z);
      p = [s * Math.cos(ph), z, s * Math.sin(ph)];
      r = P.vortexSize + rs() * P.vortexVar;
      lat = Math.asin(p[1]);
    } while (P.bands > 0 && Math.abs(bandSpeedJS(lat)) > P.vortexThresh * P.bandFactor && Math.abs(lat) > 15 * Math.PI / 180 && ++tries < 10000);
    const cw = P.bands > 0 ? bandSpeedJS(lat + 0.05) < bandSpeedJS(lat - 0.05) : Math.random() > 0.5;
    out.set([...p, cw ? Math.abs(r) : -Math.abs(r)], k * 4);
  }
  device.queue.writeBuffer(vortBuf, 0, out);
  return n;
}

// ---------- Pipelines ----------
const C = GPUShaderStage.COMPUTE;
const cl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: C, buffer: { type: 'uniform' } },
  { binding: 1, visibility: C, buffer: { type: 'storage' } },
  { binding: 2, visibility: C, buffer: { type: 'storage' } },
  { binding: 3, visibility: C, buffer: { type: 'storage' } },
  { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } },
  { binding: 5, visibility: C, texture: { sampleType: 'float' } } ] });
const layout = device.createPipelineLayout({ bindGroupLayouts: [cl] });
const pipe = (e) => device.createComputePipeline({ layout, compute: { module: mod, entryPoint: e } });
const pField = pipe('makeField'), pInit = pipe('initParticles'), pClear = pipe('clearImg'), pFade = pipe('fadeImg'), pMove = pipe('moveAndPaint');
let cbg = null;

const canvas = document.getElementById('c');
const ctx = TEST ? null : canvas.getContext('webgpu');
const format = TEST ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
if (ctx) ctx.configure({ device, format, alphaMode: 'opaque' });
let testTex = null;
if (TEST) testTex = device.createTexture({ size: [640, 480], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const rbuf = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const rpipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: rmod, entryPoint: 'vs' },
  fragment: { module: rmod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
const rbg = device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [
  { binding: 0, resource: { buffer: rbuf } }, { binding: 1, resource: { buffer: img } } ] });
window.grab = async () => {   // [T8]
  const buf = device.createBuffer({ size: 640 * 480 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder();
  e.copyTextureToBuffer({ texture: testTex }, { buffer: buf, bytesPerRow: 640 * 4 }, [640, 480]);
  device.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const c2 = document.createElement('canvas'); c2.width = 640; c2.height = 480;
  c2.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.getMappedRange().slice(0)), 640, 480), 0, 0);
  return c2.toDataURL();
};

// ---------- Ablauf ----------
const U = new Float32Array(32);
let iter = 0, opacity = 1, nvort = 0, seed = 1;
function writeU() {
  U.set([DIM, VF, COUNT, opacity, P.noiseScale, P.velocityFactor, P.bands, P.bandFactor,
    P.bandPower, P.poleAtt, nvort, P.wOffset, P.octaves, P.falloff, P.fade, seed,
    ...dark, 1, imgW, imgH, 0, 0]);
  device.queue.writeBuffer(ubuf, 0, U);
}
const groups = (n) => { const g = Math.ceil(n / 256); return [Math.min(g, 65535), Math.ceil(g / 65535)]; };
function restart() {
  nvort = makeVortices(); iter = 0; opacity = 1; seed++;
  cbg = device.createBindGroup({ layout: cl, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: field } },
    { binding: 2, resource: { buffer: parts } }, { binding: 3, resource: { buffer: img } },
    { binding: 4, resource: { buffer: vortBuf } }, { binding: 5, resource: srcTex.createView() } ] });
  writeU();
  const enc = device.createCommandEncoder(); const p = enc.beginComputePass(); p.setBindGroup(0, cbg);
  p.setPipeline(pField); p.dispatchWorkgroups(Math.ceil(VF / 8), Math.ceil(VF / 8), 6);   // [G3] einmal
  p.setPipeline(pInit); p.dispatchWorkgroups(...groups(COUNT));
  p.setPipeline(pClear); p.dispatchWorkgroups(...groups(6 * DIM * DIM));
  p.end(); device.queue.submit([enc.finish()]);
}

// Regler (Standard = Original)
const ctl = document.getElementById('ctl');
for (const [k, label, min, max, step] of [['noiseScale', 'Rauschmaßstab', 0.5, 8, 0.1], ['velocityFactor', 'Geschw.-Faktor', 0, 4000, 10],
  ['bands', 'Bänder', 0, 20, 0.5], ['bandFactor', 'Band-Faktor', 0, 10, 0.1], ['bandPower', 'Band-Potenz (ungerade)', 1, 9, 2],
  ['poleAtt', 'Pol-Dämpfung', 0, 1, 0.01], ['vortices', 'Wirbel', 0, 200, 1], ['vortexSize', 'Wirbelgröße', 0.005, 0.2, 0.005],
  ['vortexVar', 'Wirbelgröße ±', 0, 0.1, 0.005], ['vortexThresh', 'Wirbel-Schwelle', 0.05, 1, 0.01], ['fade', 'Verblassen', 0, 0.1, 0.001],
  ['opacityLimit', 'Deckkraft min.', 0, 1, 0.01], ['wOffset', 'w-Versatz', 0, 300, 1], ['octaves', 'Oktaven', 1, 7, 1], ['falloff', 'fBm-Abfall', 0.1, 0.9, 0.05]]) {
  const l = document.createElement('label'); l.className = 'r';
  l.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${P[k]}"><output>${P[k]}</output>`;
  const [inp, out] = [l.querySelector('input'), l.querySelector('output')];
  inp.oninput = () => { P[k] = Number(inp.value); out.textContent = inp.value; };
  ctl.appendChild(l);
}
document.getElementById('restart').onclick = restart;
document.getElementById('pick').onclick = () => document.getElementById('file').click();
document.getElementById('file').onchange = async (e) => { const f = e.target.files[0]; if (f) { await setImage(f); restart(); } };

let yaw = 0, pitch = 0.15, drag = null;
canvas.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); };
canvas.onpointerup = () => { drag = null; };
canvas.onpointermove = (e) => { if (!drag) return; yaw += (e.clientX - drag[0]) * 0.005; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; };

try { await setImage(await defaultImage()); }
catch (e) { err('Beispielbild nicht ladbar (' + e.message + '). Bitte „Eigenes Bild“ wählen.'); await setImage(new ImageData(new Uint8ClampedArray([128, 100, 80, 255]), 1, 1)); }
restart();

const RU = new Float32Array(16);
let fpsT = performance.now(), fpsN = 0, fps = 0;
function tick() {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = TEST ? 640 : Math.round(canvas.clientWidth * dpr), h = TEST ? 480 : Math.round(canvas.clientHeight * dpr);
  if (!TEST && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
  const enc = device.createCommandEncoder();
  const running = !(document.getElementById('stop').checked && iter >= 1000);   // [G12]
  if (running) {
    writeU();
    const p = enc.beginComputePass(); p.setBindGroup(0, cbg);
    p.setPipeline(pFade); p.dispatchWorkgroups(...groups(6 * DIM * DIM));   // [G9]
    p.setPipeline(pMove); p.dispatchWorkgroups(...groups(COUNT));           // [G7][G10]
    p.end();
    iter++;
    if (opacity > P.opacityLimit) opacity *= 0.95;                          // [G11]
  }
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  RU.set([cy, sy * sp, -sy * cp, 0, 0, cp, sp, 0, sy, -cy * sp, cy * cp, 0, w / h, DIM, 0, 0]);
  device.queue.writeBuffer(rbuf, 0, RU);
  const rp = enc.beginRenderPass({ colorAttachments: [{ view: (TEST ? testTex : ctx.getCurrentTexture()).createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  rp.setPipeline(rpipe); rp.setBindGroup(0, rbg); rp.draw(3); rp.end();
  device.queue.submit([enc.finish()]);
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsT = now; fpsN = 0; }
  window.iter_ = iter;
  document.getElementById('st').textContent = `Runde ${iter}${running ? '' : ' (fertig)'} · ${fps} fps · ${(COUNT / 1e6).toFixed(1)} Mio. Partikel · Feld ${VF}²`;
  if (TEST) device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(tick));
  else requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
