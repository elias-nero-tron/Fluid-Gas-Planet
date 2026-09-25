import commonWGSL from './shaders/common.wgsl?raw';
import fluidWGSL from './shaders/fluid.wgsl?raw';
import tracersWGSL from './shaders/tracers.wgsl?raw';
import renderWGSL from './shaders/render.wgsl?raw';
import { presets, randomPreset, windTable, bandTable, hexToLinear, TABLE, type Preset } from './presets';
import { perspective, lookAt, multiply, invert, planetRotation, normalize, type Vec3 } from './math';
import { Panel } from './ui';

// ---------------------------------------------------------------------------
// Einstellungen (alles, was ein Regler verändern kann)
// ---------------------------------------------------------------------------

const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

const S = {
  preset: 'Jupiter',
  seed: 1,
  quality: isPhone ? 'phone' : 'standard',
  flow: 'fluid',          // 'fluid' = Stable Fluids, 'curl' = Curl-Noise
  look: 'dye',            // 'dye' = Farbstoff, 'particles' = Partikel
  timeScale: 1,
  paused: false,
  // Fluid
  velRes: 128,
  iterations: 24,
  bfecc: true,
  jetStrength: 0.06,
  jetRelax: 0.25,
  omega: 0.4,
  turbulence: 0.6,
  turbScale: 4,
  confinement: 6,
  drag: 0.02,
  // Curl-Noise
  curlStrength: 0.5,
  curlFreq: 4,
  curlSpeed: 0.04,
  curlOctaves: 4,
  // Partikel
  particles: isPhone ? 262144 : 1048576,
  lifetime: 6,
  opacity: 0.35,
  blur: 0.12,
  // Farbe und Stürme
  dyeRes: isPhone ? 384 : 768,
  bandRelax: 0.06,
  bandWobble: 1,
  contrast: 1,
  convection: 0.8,
  storms: true,
  stormStrength: 1,
  stormTint: 0.6,
  // Licht und Ansicht
  sunAngle: 35,
  relief: 0.35,
  limb: 1.15,
  atmosphere: 1,
  exposure: 0.95,
  spin: true,
  view: 0,
  map: false,
};
type Key = keyof typeof S;

const QUALITY: Record<string, { velRes: number; dyeRes: number; particles: number; dpr: number }> = {
  phone: { velRes: 96, dyeRes: 384, particles: 262144, dpr: 1.25 },
  standard: { velRes: 128, dyeRes: 768, particles: 1048576, dpr: 1.75 },
  high: { velRes: 192, dyeRes: 1024, particles: 4194304, dpr: 2 },
};

// ---------------------------------------------------------------------------
// WebGPU-Start
// ---------------------------------------------------------------------------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const fpsEl = document.getElementById('fps') as HTMLElement;

function fail(msg: string) {
  statusEl.hidden = false;
  statusEl.innerHTML = msg;
}

async function start() {
  if (!('gpu' in navigator)) {
    fail('<b>WebGPU fehlt in diesem Browser.</b> Nimm Chrome oder Edge ab Version 113, Safari ab 26 oder Firefox ab 141. Auf Android geht Chrome ab Version 121.');
    return;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    fail('<b>Keine WebGPU-Grafikkarte gefunden.</b> Prüfe, ob die Hardwarebeschleunigung im Browser eingeschaltet ist.');
    return;
  }
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  device.lost.then((info) => fail(`<b>Die Grafikkarte wurde getrennt.</b> ${info.message} Lade die Seite neu.`));
  device.addEventListener('uncapturederror', (e) => {
    console.error((e as GPUUncapturedErrorEvent).error.message);
    fail(`<b>GPU-Fehler:</b> ${(e as GPUUncapturedErrorEvent).error.message}`);
  });
  const app = new App(device);
  window.gasPlanet = { settings: S, capture: () => app.capture() };
  app.run();
}

// ---------------------------------------------------------------------------
// Cubemap-Felder
// ---------------------------------------------------------------------------

interface CubeField { tex: GPUTexture; cube: GPUTextureView; store: GPUTextureView; n: number }

const SIM_FLOATS = 32 + TABLE + TABLE * 4 + 8 * 4 + 8 * 4;
const RENDER_FLOATS = 16 + 4 * 11;
const WARM_STEPS = 240;

class App {
  // Testmodus #offscreen: rendert in eine Textur statt auf den Canvas (für Headless-Browser).
  private offscreen = location.hash === '#offscreen';
  private format: GPUTextureFormat = this.offscreen ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  private target: GPUTexture | null = null;
  private ctx = canvas.getContext('webgpu') as GPUCanvasContext;
  private sampler: GPUSampler;
  private simBuf: GPUBuffer;
  private renderBuf: GPUBuffer;
  private simData = new Float32Array(SIM_FLOATS);
  private renderData = new Float32Array(RENDER_FLOATS);

  private computeLayout: GPUBindGroupLayout;
  private pipes: Record<string, GPUComputePipeline> = {};
  private renderPipe: GPURenderPipeline;

  private vel: CubeField[] = [];
  private prs: CubeField[] = [];
  private aux!: CubeField;
  private div!: CubeField;
  private dye: CubeField[] = [];
  private flow!: CubeField;
  private dummy: CubeField;
  private parts!: GPUBuffer;
  private zonal: GPUBuffer;
  private partCapacity = 0;
  private vc = 0; private pc = 0; private dc = 0;

  private preset: Preset = presets[0];
  private stormPos: { lat: number; lon: number }[] = [];
  private time = 0;
  private frame = 0;
  private spin = 0;
  private needsInit = true;
  private warm = 0;
  private cam = { yaw: -0.35, pitch: 0.12, dist: 4.3 };
  private dpr = 1.75;
  private panel!: Panel;

  constructor(private device: GPUDevice) {
    if (!this.offscreen) this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.simBuf = device.createBuffer({ size: SIM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renderBuf = device.createBuffer({ size: RENDER_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const C = GPUShaderStage.COMPUTE;
    this.computeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, sampler: { type: 'filtering' } },
        { binding: 2, visibility: C, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 3, visibility: C, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
        { binding: 5, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.computeLayout] });
    const fluid = this.module('fluid', commonWGSL + fluidWGSL);
    const tracers = this.module('tracers', commonWGSL + tracersWGSL);
    for (const e of ['initVel', 'clear', 'advect', 'curl', 'zonalClear', 'zonalSum', 'forces', 'divergence', 'jacobi', 'project'])
      this.pipes[e] = device.createComputePipeline({ layout, compute: { module: fluid, entryPoint: e } });
    for (const e of ['initDye', 'advectDye', 'flowField', 'moveParticles', 'blurRelax'])
      this.pipes[e] = device.createComputePipeline({ layout, compute: { module: tracers, entryPoint: e } });

    const render = this.module('render', renderWGSL);
    this.renderPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: render, entryPoint: 'vs' },
      fragment: { module: render, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.dummy = this.cubeField(8);
    this.zonal = device.createBuffer({ size: 128 * 2 * 4, usage: GPUBufferUsage.STORAGE });
    this.applyQuality(false);
    this.applyPreset();
    this.buildUI();
    this.bindInput();
  }

  private module(label: string, code: string): GPUShaderModule {
    const m = this.device.createShaderModule({ label, code });
    m.getCompilationInfo().then((info) => {
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length) fail(`<b>Shader ${label}:</b> ` + errs.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('<br>'));
    });
    return m;
  }

  private cubeField(n: number): CubeField {
    const tex = this.device.createTexture({
      size: [n, n, 6],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    return {
      tex, n,
      cube: tex.createView({ dimension: 'cube' }),
      store: tex.createView({ dimension: '2d-array' }),
    };
  }

  // ---------- Ressourcen passend zu den Reglern ----------

  private applyQuality(fromUI: boolean) {
    const q = QUALITY[S.quality];
    if (fromUI && q) { S.velRes = q.velRes; S.dyeRes = q.dyeRes; S.particles = q.particles; }
    this.dpr = q ? q.dpr : 1.5;
    this.allocVel();
    this.allocDye();
    this.allocParticles();
  }

  private allocVel() {
    for (const f of [...this.vel, ...this.prs]) f.tex.destroy();
    this.aux?.tex.destroy(); this.div?.tex.destroy(); this.flow?.tex.destroy();
    const n = S.velRes;
    this.vel = [this.cubeField(n), this.cubeField(n)];
    this.prs = [this.cubeField(n), this.cubeField(n)];
    this.aux = this.cubeField(n);
    this.div = this.cubeField(n);
    this.flow = this.cubeField(Math.min(n, 128));
    this.needsInit = true;
  }

  private allocDye() {
    for (const f of this.dye) f.tex.destroy();
    this.dye = [this.cubeField(S.dyeRes), this.cubeField(S.dyeRes)];
    this.needsInit = true;
  }

  private allocParticles() {
    const want = Math.min(S.particles, Math.floor(this.device.limits.maxStorageBufferBindingSize / 32));
    S.particles = want;
    if (want <= this.partCapacity) return;
    this.parts?.destroy();
    this.parts = this.device.createBuffer({ size: want * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.partCapacity = want;
  }

  private applyPreset() {
    this.preset = S.preset === 'Zufall' ? randomPreset(S.seed * 7919) : presets.find((p) => p.name === S.preset) ?? presets[0];
    const t = this.preset.tune;
    S.turbulence = t.turbulence; S.convection = t.convection; S.bandWobble = t.bandWobble;
    S.stormTint = t.stormTint; S.relief = t.relief;
    this.stormPos = this.preset.storms.map((s) => ({ lat: s.lat, lon: s.lon }));
    this.jets = windTable(this.preset);
    this.writeTables();
    this.needsInit = true;
    this.panel?.refresh();
    const info = document.getElementById('planet-info');
    if (info) {
      const p = this.preset;
      info.textContent = `${p.name} · Abplattung ${p.oblateness.toFixed(3)} · Achse ${p.tilt.toFixed(1)}° · Tag ${p.rotationHours.toFixed(1)} h · ${p.storms.length} Stürme`;
    }
  }

  private jets: Float32Array = new Float32Array(TABLE);

  private writeTables() {
    const d = this.simData;
    d.set(this.jets, 32);
    d.set(bandTable(this.preset, S.contrast), 32 + TABLE);
  }

  private jetAt(latRad: number): number {
    const x = Math.min(Math.max((latRad / Math.PI + 0.5) * (TABLE - 1), 0), TABLE - 1);
    const i = Math.floor(x), j = Math.min(i + 1, TABLE - 1);
    return (this.jets[i] + (this.jets[j] - this.jets[i]) * (x - i)) * S.jetStrength;
  }

  // ---------- Uniforms ----------

  private writeSim(dt: number) {
    const d = this.simData;
    const js = S.jetStrength;
    const vals = [
      dt, this.time, this.frame, S.velRes,
      S.dyeRes, this.flow.n, 1.5 / S.velRes, S.omega,
      js, S.jetRelax, S.turbulence * js * 0.05, S.turbScale,
      S.confinement, S.drag, 0, S.bfecc ? 1 : 0,
      S.bandRelax, S.convection, S.storms ? js * S.stormStrength : 0, S.storms ? Math.min(this.preset.storms.length, 8) : 0,
      S.curlStrength * js, S.curlFreq, S.curlSpeed, S.curlOctaves,
      S.particles, S.lifetime, S.opacity, S.blur,
      S.seed, S.bandWobble, S.stormTint, 1,
    ];
    d.set(vals, 0);
    const base = 32 + TABLE + TABLE * 4;
    this.preset.storms.slice(0, 8).forEach((s, i) => {
      const pos = this.stormPos[i];
      const la = (pos.lat * Math.PI) / 180, lo = (pos.lon * Math.PI) / 180;
      d.set([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo), (s.radius * Math.PI) / 180], base + i * 4);
      const sign = (s.kind === 'cyclone' ? 1 : -1) * (s.lat >= 0 ? 1 : -1);
      const c = hexToLinear(s.color);
      d.set([sign * s.strength, c[0], c[1], c[2]], base + 32 + i * 4);
    });
    this.device.queue.writeBuffer(this.simBuf, 0, d);
  }

  private writeRender() {
    const w = canvas.width, h = canvas.height;
    const cy = Math.cos(this.cam.pitch), sy = Math.sin(this.cam.pitch);
    const eye: Vec3 = [Math.sin(this.cam.yaw) * cy * this.cam.dist, sy * this.cam.dist, Math.cos(this.cam.yaw) * cy * this.cam.dist];
    const proj = perspective((32 * Math.PI) / 180, w / h, 0.05, 100);
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const inv = invert(multiply(proj, view));
    // Welt -> Körper = Transponierte von (Neigung · Drehung)
    const m = planetRotation((this.preset.tilt * Math.PI) / 180, this.spin);
    const a = (S.sunAngle * Math.PI) / 180;
    const sun = normalize([Math.sin(a), 0.18, Math.cos(a)]);
    const atmo = hexToLinear(this.preset.atmosphere);
    const ring = this.preset.rings;
    const rc = ring ? hexToLinear(ring.color) : [0, 0, 0];
    const d = this.renderData;
    d.set(inv, 0);
    d.set([
      ...eye, 1,
      m[0][0], m[1][0], m[2][0], 0,
      m[0][1], m[1][1], m[2][1], 0,
      m[0][2], m[1][2], m[2][2], 0,
      ...sun, 1.7,
      atmo[0], atmo[1], atmo[2], this.preset.atmosphereStrength * S.atmosphere,
      this.preset.oblateness, S.relief, S.limb, S.view,
      S.map ? 1 : 0, ring ? ring.inner : 0, ring ? ring.outer : 0, ring ? ring.opacity : 0,
      w / h, this.time, S.exposure, S.dyeRes,
      rc[0], rc[1], rc[2], 0.6,
      1 / Math.max(S.jetStrength, 1e-4), 0, 0, 0,
    ], 16);
    this.device.queue.writeBuffer(this.renderBuf, 0, d);
  }

  // ---------- Compute-Helfer ----------

  /** buf: Puffer an Bindung 5 – Partikel für die Tracer-Shader, Breitenkreis-Mittel für den Fluid-Löser. */
  private bind(a: CubeField | null, b: CubeField | null, dst: CubeField, buf: GPUBuffer = this.zonal): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.simBuf } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: (a ?? this.dummy).cube },
        { binding: 3, resource: (b ?? this.dummy).cube },
        { binding: 4, resource: dst.store },
        { binding: 5, resource: { buffer: buf } },
      ],
    });
  }

  private run2D(pass: GPUComputePassEncoder, pipe: string, a: CubeField | null, b: CubeField | null, dst: CubeField) {
    pass.setPipeline(this.pipes[pipe]);
    pass.setBindGroup(0, this.bind(a, b, dst));
    const g = Math.ceil(dst.n / 8);
    pass.dispatchWorkgroups(g, g, 6);
  }

  private initFields(enc: GPUCommandEncoder) {
    const pass = enc.beginComputePass();
    this.run2D(pass, 'initVel', null, null, this.vel[0]);
    this.run2D(pass, 'clear', null, null, this.prs[0]);
    this.run2D(pass, 'clear', null, null, this.aux);
    this.run2D(pass, 'initDye', null, null, this.dye[0]);
    pass.end();
    enc.clearBuffer(this.parts);
    this.vc = 0; this.pc = 0; this.dc = 0;
  }

  private step(enc: GPUCommandEncoder) {
    const pass = enc.beginComputePass();
    let flowSrc: CubeField;
    if (S.flow === 'fluid') {
      // 1. Advektion  2. Wirbelstärke  3. Breitenkreis-Mittel  4. Kräfte  5. Divergenz  6. Druck  7. Projektion
      this.run2D(pass, 'advect', this.vel[this.vc], null, this.vel[1 - this.vc]); this.vc = 1 - this.vc;
      this.run2D(pass, 'curl', this.vel[this.vc], null, this.aux);
      pass.setPipeline(this.pipes.zonalClear);
      pass.setBindGroup(0, this.bind(null, null, this.div));
      pass.dispatchWorkgroups(4);
      this.run2D(pass, 'zonalSum', this.vel[this.vc], null, this.div);
      this.run2D(pass, 'forces', this.vel[this.vc], this.aux, this.vel[1 - this.vc]); this.vc = 1 - this.vc;
      this.run2D(pass, 'divergence', this.vel[this.vc], null, this.div);
      for (let i = 0; i < S.iterations; i++) {
        this.run2D(pass, 'jacobi', this.prs[this.pc], this.div, this.prs[1 - this.pc]); this.pc = 1 - this.pc;
      }
      this.run2D(pass, 'project', this.vel[this.vc], this.prs[this.pc], this.vel[1 - this.vc]); this.vc = 1 - this.vc;
      flowSrc = this.vel[this.vc];
    } else {
      this.run2D(pass, 'flowField', null, null, this.flow);
      flowSrc = this.flow;
    }

    if (S.look === 'dye') {
      this.run2D(pass, 'advectDye', this.dye[this.dc], flowSrc, this.dye[1 - this.dc]); this.dc = 1 - this.dc;
      pass.end();
    } else {
      pass.end();
      const cur = this.dye[this.dc], nxt = this.dye[1 - this.dc];
      enc.copyTextureToTexture({ texture: cur.tex }, { texture: nxt.tex }, [cur.n, cur.n, 6]);
      const p2 = enc.beginComputePass();
      p2.setPipeline(this.pipes.moveParticles);
      p2.setBindGroup(0, this.bind(cur, flowSrc, nxt, this.parts));
      const groups = Math.ceil(S.particles / 64);
      p2.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
      this.run2D(p2, 'blurRelax', nxt, null, cur);
      p2.end();
    }
    return flowSrc;
  }

  // ---------- Hauptschleife ----------

  private last = performance.now();
  private fpsAcc = 0; private fpsFrames = 0;

  run() {
    const loop = (now: number) => {
      const real = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.fpsAcc += real; this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} fps`;
        this.fpsAcc = 0; this.fpsFrames = 0;
      }
      this.resize();
      this.frameOnce(real);
      // Im Testmodus bremst kein Canvas die Bildrate, also auf die GPU warten.
      if (this.offscreen) this.device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(loop));
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private simStep(enc: GPUCommandEncoder, dt: number): CubeField {
    this.time += dt;
    this.frame++;
    // Stürme treiben mit dem Jet ihrer Breite (Länge wächst nach Westen).
    this.stormPos.forEach((p) => {
      const la = (p.lat * Math.PI) / 180;
      p.lon -= ((this.jetAt(la) * dt) / Math.max(Math.cos(la), 0.2)) * (180 / Math.PI);
    });
    this.writeSim(dt);
    return this.step(enc);
  }

  /** Ein Bild: Simulationsschritt(e) und Darstellung. */
  frameOnce(real: number) {
    if (this.needsInit) {
      const init = this.device.createCommandEncoder();
      this.time = 0;
      this.writeSim(0);
      this.initFields(init);
      this.device.queue.submit([init.finish()]);
      this.needsInit = false;
      this.warm = WARM_STEPS;
    }
    // Einschwingen: nach dem Start ein paar hundert Schritte im Schnelldurchlauf,
    // damit Wirbel und Mäander schon da sind, statt mit glatten Streifen zu beginnen.
    for (let k = 0; k < 4 && this.warm > 0 && !S.paused; k++, this.warm--) {
      const w = this.device.createCommandEncoder();
      this.simStep(w, 3 / 60);
      this.device.queue.submit([w.finish()]);
    }
    const enc = this.device.createCommandEncoder();
    const dt = S.paused ? 0 : (1 / 60) * S.timeScale;
    const flowSrc = dt > 0 ? this.simStep(enc, dt) : S.flow === 'fluid' ? this.vel[this.vc] : this.flow;
    if (S.spin && !S.paused) this.spin += real * 0.08 * (9.93 / this.preset.rotationHours);
    this.writeRender();

    const rbg = this.device.createBindGroup({
      layout: this.renderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderBuf } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.dye[this.dc].cube },
        { binding: 3, resource: flowSrc.cube },
        { binding: 4, resource: this.aux.cube },
        { binding: 5, resource: this.prs[this.pc].cube },
      ],
    });
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: this.targetView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    rp.setPipeline(this.renderPipe);
    rp.setBindGroup(0, rbg);
    rp.draw(3);
    rp.end();
    this.device.queue.submit([enc.finish()]);
  }

  private targetView(): GPUTextureView {
    if (!this.offscreen) return this.ctx.getCurrentTexture().createView();
    if (!this.target || this.target.width !== canvas.width || this.target.height !== canvas.height) {
      this.target?.destroy();
      this.target = this.device.createTexture({
        size: [canvas.width, canvas.height], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    return this.target.createView();
  }

  /** Nur im Testmodus: letztes Bild als PNG-Data-URL. */
  async capture(): Promise<string> {
    if (!this.target) return '';
    const w = this.target.width, h = this.target.height;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.target }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap(); buf.destroy();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.dpr);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // ---------- Bedienung ----------

  private bindInput() {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    const end = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom(pinch / d);
        pinch = d;
        return;
      }
      if (S.map) return;
      this.cam.yaw -= (e.clientX - prev.x) * 0.006;
      this.cam.pitch = Math.max(-1.45, Math.min(1.45, this.cam.pitch + (e.clientY - prev.y) * 0.006));
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
  }

  private zoom(f: number) { this.cam.dist = Math.max(1.25, Math.min(8, this.cam.dist * f)); }

  private buildUI() {
    const root = document.getElementById('panel-body') as HTMLElement;
    const on = (key: string) => this.onChange(key as Key);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const f2 = (v: number) => v.toFixed(2);
    const f3 = (v: number) => v.toFixed(3);
    const n = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v % 1e6 ? 2 : 0)} Mio.` : v >= 1e3 ? `${Math.round(v / 1024)} k` : String(v));

    this.panel = new Panel(root, S as unknown as Record<string, number | string | boolean>, on);
    this.panel
      .section('Planet')
      .select('preset', 'Vorlage', [...presets.map((p) => [p.name, p.name] as [string, string]), ['Zufall', 'Zufallsplanet']],
        'Lädt Windprofil, Farbbänder, Stürme, Abplattung und Ringe eines Planeten. Alles sind Zahlen, keine Bilder.')
      .select('quality', 'Qualität', [['phone', 'Handy'], ['standard', 'Standard'], ['high', 'Hoch (4 Mio. Partikel)']],
        'Setzt Gitterauflösung, Farbauflösung, Partikelzahl und Pixeldichte auf einmal. „Handy“ ist für Smartphones gedacht.')
      .buttons([
        ['btn-reset', 'Neu starten', () => { this.needsInit = true; }],
        ['btn-seed', 'Neuer Zufall', () => { S.seed = (S.seed % 9973) + 1; if (S.preset === 'Zufall') this.applyPreset(); this.needsInit = true; }],
        ['btn-pause', 'Pause', () => { S.paused = !S.paused; (document.getElementById('btn-pause') as HTMLButtonElement).textContent = S.paused ? 'Weiter' : 'Pause'; }],
      ])
      .section('Verfahren', 'Strömung bestimmt, woher der Wind kommt. Darstellung bestimmt, wie die Wolken ihm folgen. Alle vier Kombinationen laufen.')
      .select('flow', 'Strömung', [['fluid', 'Stable Fluids (mofu)'], ['curl', 'Curl-Noise (jasper-r)']],
        'Stable Fluids löst die Strömungsgleichung mit Druck, Coriolis und Wirbeln (physikalisch). Curl-Noise ist ein verwirbeltes Rauschfeld plus Jets (schnell, aber ohne Physik).')
      .select('look', 'Darstellung', [['dye', 'Farbstoff'], ['particles', 'Partikel']],
        'Farbstoff: jede Zelle der Farbtextur wird mit dem Wind verschoben. Partikel: Millionen Punkte fliegen mit dem Wind und färben die Textur, die langsam verblasst.')
      .range('timeScale', 'Zeitraffer', 0, 6, 0.1, 'Wie viel Simulationszeit pro Bild vergeht. Höher = schneller, aber ungenauer.', (v) => `${v.toFixed(1)}×`)
      .section('Wind und Physik', 'Wirkt bei Strömung „Stable Fluids“. Jet-Stärke wirkt überall.')
      .range('jetStrength', 'Jet-Stärke', 0, 0.2, 0.002, 'Spitzengeschwindigkeit der Ost-West-Winde in Radiant pro Sekunde. Bei Jupiter wären das echte 150 m/s. Skaliert auch Stürme und Turbulenz.', f3)
      .range('jetRelax', 'Jet-Rückstellung', 0, 2, 0.01, 'Wie stark die Ost-West-Winde zum gemessenen Windprofil zurückgezogen werden. 0 = die Strömung ist frei und die Bänder zerfallen mit der Zeit.', f2)
      .range('omega', 'Coriolis (Rotation)', 0, 3, 0.01, 'Planetenrotation. Lenkt Winde ab (Nordhalbkugel nach rechts) und erzeugt über den β-Effekt Rossby-Wellen und langlebige Wirbel. 0 = nicht rotierender Planet.', f2)
      .range('turbulence', 'Turbulenz', 0, 3, 0.01, 'Kleine zufällige Anstöße im Wind. Sie lösen die Scherinstabilitäten an den Jet-Rändern aus (Kelvin-Helmholtz-Wellen).', f2)
      .range('turbScale', 'Turbulenz-Größe', 1, 20, 0.5, 'Größe der Anstöße: klein = viele feine Wirbel, groß = wenige große.', (v) => v.toFixed(1))
      .range('confinement', 'Wirbelverstärkung', 0, 60, 0.5, 'Vorticity Confinement: gibt Wirbeln die Energie zurück, die das grobe Gitter wegschmiert. Zu hoch wird es unruhig.', (v) => v.toFixed(1))
      .range('drag', 'Reibung', 0, 0.5, 0.005, 'Bremst den ganzen Wind gleichmäßig ab.', f3)
      .range('iterations', 'Druck-Iterationen', 2, 80, 1, 'Jacobi-Schritte für die Druckgleichung. Mehr = sauberer divergenzfrei, aber teurer. Der wichtigste Leistungsregler.')
      .range('velRes', 'Gitter je Würfelfläche', 32, 256, 16, 'Auflösung des Windgitters. 128 heißt 6 × 128 × 128 Zellen auf der Kugel.', (v) => `${v}²`)
      .toggle('bfecc', 'BFECC-Advektion', 'Fehlerkorrektur beim Mitführen (vor, zurück, halben Fehler abziehen). Macht Wirbel und Farbkanten schärfer, kostet zwei zusätzliche Abtastungen.')
      .section('Curl-Noise', 'Wirkt bei Strömung „Curl-Noise“.', false)
      .range('curlStrength', 'Stärke', 0, 3, 0.01, 'Wie stark das Rauschfeld gegenüber den Jets ist.', f2)
      .range('curlFreq', 'Frequenz', 1, 16, 0.1, 'Größe der Wirbel im Rauschfeld: hoch = viele kleine.', (v) => v.toFixed(1))
      .range('curlSpeed', 'Veränderung', 0, 0.5, 0.005, 'Wie schnell sich das Rauschfeld mit der Zeit umbaut.', f3)
      .range('curlOctaves', 'Oktaven', 1, 6, 1, 'Anzahl überlagerter Rausch-Ebenen. Mehr = feinere Details.')
      .section('Partikel', 'Wirkt bei Darstellung „Partikel“.', false)
      .range('particles', 'Anzahl', 16384, 4194304, 16384, 'Anzahl der Partikel. jasper-r nutzte 4 Mio. bei 80 fps auf einem PC. Handys schaffen etwa 0,25 bis 1 Mio.', n)
      .range('lifetime', 'Lebensdauer', 0.5, 30, 0.5, 'Sekunden, bis ein Partikel neu geboren wird. Lang = lange Schlieren.', (v) => `${v.toFixed(1)} s`)
      .range('opacity', 'Deckkraft', 0.01, 1, 0.01, 'Wie stark ein Partikel seine Farbe in die Textur schreibt.', pct)
      .range('blur', 'Weichzeichnen', 0, 1, 0.01, 'Verwischt die Textur jedes Bild ein wenig, damit aus Punkten Wolken werden.', pct)
      .section('Wolken und Stürme')
      .range('bandRelax', 'Band-Rückstellung', 0, 0.5, 0.005, 'Wie schnell die Farbe zum Band ihrer Breite zurückkehrt. 0 = alles vermischt sich irgendwann zu Brei, hoch = starre Streifen.', f3)
      .range('bandWobble', 'Band-Mäander', 0, 3, 0.05, 'Verbiegt die Bandgrenzen mit Rauschen, damit sie nicht wie mit dem Lineal gezogen sind.', f2)
      .range('contrast', 'Band-Kontrast', 0, 2.5, 0.05, 'Verstärkt oder dämpft den Farbunterschied zwischen hellen Zonen und dunklen Gürteln.', f2)
      .range('convection', 'Konvektion', 0, 4, 0.05, 'Helle Wolkentürme, die aus der Tiefe aufsteigen (Ammoniak-Eis).', f2)
      .toggle('storms', 'Stürme', 'Schaltet die Stürme der Vorlage an/aus (z. B. Großer Roter Fleck). Sie treiben mit dem Jet ihrer Breite.')
      .range('stormStrength', 'Sturm-Stärke', 0, 4, 0.05, 'Drehgeschwindigkeit der Stürme relativ zur Jet-Stärke.', f2)
      .range('stormTint', 'Sturm-Farbe', 0, 4, 0.05, 'Wie stark ein Sturm seine eigene Farbe in die Wolken gibt.', f2)
      .range('dyeRes', 'Farbauflösung', 128, 1536, 64, 'Auflösung der Wolkentextur je Würfelfläche. Bestimmt die Schärfe beim Heranzoomen.', (v) => `${v}²`)
      .section('Licht und Ansicht')
      .range('sunAngle', 'Sonnenstand', -180, 180, 1, 'Richtung der Sonne. 0° = Sonne hinter der Kamera (voller Planet), 90° = Halbphase.', (v) => `${v}°`)
      .range('relief', 'Relief', 0, 2, 0.01, 'Hebt helle Wolken optisch an und wirft weiche Schatten, wie bei den Juno-Nahaufnahmen.', f2)
      .range('limb', 'Randverdunkelung', 0.8, 2, 0.01, 'Minnaert-Exponent. 1 = matte Kugel; höher = dunkler Rand wie bei echten Gasplaneten.', f2)
      .range('atmosphere', 'Dunstsaum', 0, 3, 0.05, 'Helligkeit des Atmosphärensaums am Planetenrand.', f2)
      .range('exposure', 'Belichtung', 0.3, 3, 0.05, 'Gesamthelligkeit.', f2)
      .toggle('spin', 'Planet dreht sich', 'Eigenrotation, Tempo relativ zur echten Tageslänge der Vorlage.')
      .toggle('map', 'Kartenansicht', 'Zeigt die ganze Kugel als flache Weltkarte (Längen- und Breitengrade). Gut, um Jets und Stürme zu vergleichen.')
      .select('view', 'Feld anzeigen', [['0', 'Wolken'], ['1', 'Wind (Richtung)'], ['2', 'Wirbelstärke'], ['3', 'Druck']],
        'Debug-Ansichten. Wind: Rot = Ost, Grün = Nord. Wirbelstärke: Rot = gegen den Uhrzeigersinn, Blau = im Uhrzeigersinn. Druck gibt es nur bei Stable Fluids.');
    this.updateVisibility();
  }

  private updateVisibility() {
    const fluid = S.flow === 'fluid', parts = S.look === 'particles';
    for (const k of ['jetRelax', 'omega', 'turbulence', 'turbScale', 'confinement', 'drag', 'iterations', 'velRes']) this.panel.visible(k, fluid);
    for (const k of ['curlStrength', 'curlFreq', 'curlSpeed', 'curlOctaves']) this.panel.visible(k, !fluid);
    for (const k of ['particles', 'lifetime', 'opacity', 'blur']) this.panel.visible(k, parts);
  }

  private onChange(key: Key) {
    switch (key) {
      case 'preset': this.applyPreset(); break;
      case 'quality': this.applyQuality(true); this.panel.refresh(); break;
      case 'contrast': this.writeTables(); break;
      case 'velRes': this.allocVel(); break;
      case 'dyeRes': this.allocDye(); break;
      case 'particles': this.allocParticles(); break;
      case 'flow': case 'look': this.updateVisibility(); break;
      case 'map': canvas.classList.toggle('map', S.map); break;
    }
  }
}

// Für automatische Tests und die Konsole
declare global { interface Window { gasPlanet?: { settings: typeof S; capture: () => Promise<string> } } }

start().catch((e) => fail(`<b>Start fehlgeschlagen:</b> ${e instanceof Error ? e.message : String(e)}`));
