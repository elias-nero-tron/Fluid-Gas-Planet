import commonWGSL from './shaders/common.wgsl?raw';
import fluidWGSL from './shaders/fluid.wgsl?raw';
import tracersWGSL from './shaders/tracers.wgsl?raw';
import renderWGSL from './shaders/render.wgsl?raw';
import { presets, randomPreset, bandsFromImage, windTable, bandTable, hexToLinear, TABLE, type Preset } from './presets';
import { perspective, lookAt, multiply, invert, planetRotation, normalize, type Vec3 } from './math';
import { Panel } from './ui';
import { t, lang, setLang } from './i18n';

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
  timeScale: 1,           // Simulationsschritte pro Bild (fester Zeitschritt)
  paused: false,
  autoQuality: true,       // hält ≥ 60 fps: misst beim Laden, passt Auflösung an
  // Fluid
  velRes: 128,
  iterations: 24,
  bfecc: true,
  jetStrength: 0.06,
  jetRelax: 0.25,
  omega: 0.4,
  turbulence: 0.6,
  turbScale: 4,
  confinement: 6,          // Look von v0.1 (vom Urheber auf Hardware bestätigt)
  drag: 0.02,
  // Curl-Noise
  curlStrength: 0.5,
  curlFreq: 4,
  curlSpeed: 0.04,
  curlOctaves: 4,
  curlRes: isPhone ? 256 : 384,
  vortexCount: 32,
  vortexStrength: 1,
  // Partikel
  particles: isPhone ? 262144 : 1048576,
  lifetime: 6,
  opacity: 0.35,
  blur: 0.12,
  // Farbe und Stürme
  dyeRes: isPhone ? 384 : 768,
  bandRelax: 0.06,
  fineStripes: 0,
  bandWobble: 1,
  contrast: 1,
  convection: 0.8,
  storms: true,
  stormStrength: 1,
  stormTint: 0.6,
  stormHold: 1,
  stormSpawn: 0.3,
  // Licht und Ansicht
  sunAngle: 35,
  relief: 0.35,
  limb: 1.15,
  atmosphere: 1,
  exposure: 0.95,
  spinSpeed: 1,
  view: 0,
  map: false,
};
type Key = keyof typeof S;
const DEFAULTS = { ...S };

const QUALITY: Record<string, { velRes: number; dyeRes: number; curlRes: number; particles: number; dpr: number }> = {
  phone: { velRes: 96, dyeRes: 384, curlRes: 256, particles: 262144, dpr: 1 },
  standard: { velRes: 128, dyeRes: 768, curlRes: 384, particles: 1048576, dpr: 1.25 },
  high: { velRes: 192, dyeRes: 1024, curlRes: 768, particles: 4194304, dpr: 1.75 },
};

// ---------------------------------------------------------------------------
// WebGPU-Start
// ---------------------------------------------------------------------------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const fpsEl = document.getElementById('fps') as HTMLElement;
const loadEl = document.getElementById('loading') as HTMLElement;
const loadBar = document.getElementById('load-bar') as HTMLElement;
const loadNote = document.getElementById('load-note') as HTMLElement;
function showLoading(on: boolean) { loadEl.classList.toggle('done', !on); if (on) loadBar.style.width = '0%'; }

function fail(msg: string) {
  statusEl.hidden = false;
  statusEl.innerHTML = msg;
}

async function start() {
  if (!('gpu' in navigator)) {
    fail(t('<b>WebGPU fehlt in diesem Browser.</b> Nimm Chrome oder Edge ab Version 113, Safari ab 26 oder Firefox ab 141. Auf Android geht Chrome ab Version 121.', '<b>This browser has no WebGPU.</b> Use Chrome or Edge 113+, Safari 26+ or Firefox 141+. On Android, Chrome 121+.'));
    return;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    fail(t('<b>Keine WebGPU-Grafikkarte gefunden.</b> Prüfe, ob die Hardwarebeschleunigung im Browser eingeschaltet ist.', '<b>No WebGPU graphics adapter found.</b> Check that hardware acceleration is enabled in the browser.'));
    return;
  }
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  device.lost.then((info) => fail(`${t('<b>Die Grafikkarte wurde getrennt.</b>', '<b>The GPU was disconnected.</b>')} ${info.message} ${t('Lade die Seite neu.', 'Reload the page.')}`));
  device.addEventListener('uncapturederror', (e) => {
    console.error((e as GPUUncapturedErrorEvent).error.message);
    fail(`<b>GPU-Fehler:</b> ${(e as GPUUncapturedErrorEvent).error.message}`);
  });
  const app = new App(device);
  window.gasPlanet = { settings: S, capture: () => app.capture(), readRow: (w, f, y) => app.readRow(w, f, y) };
  document.getElementById('lang')?.addEventListener('click', () => app.toggleLang());
  app.run();
}

// ---------------------------------------------------------------------------
// Cubemap-Felder
// ---------------------------------------------------------------------------

interface CubeField { tex: GPUTexture; cube: GPUTextureView; store: GPUTextureView; n: number }

// Aufbau des Sim-Uniforms (in floats), muss zu struct Sim in common.wgsl passen.
const MAX_STORMS = 16;
const OFF_CLOUD = 32;
const OFF_JETS = OFF_CLOUD + 4;
const OFF_BANDS = OFF_JETS + TABLE;
const OFF_STORMS = OFF_BANDS + TABLE * 4;
const OFF_INFO = OFF_STORMS + MAX_STORMS * 4;
const OFF_WEIGHT = OFF_INFO + MAX_STORMS * 4;
const SIM_FLOATS = OFF_WEIGHT + MAX_STORMS;
const RENDER_FLOATS = 16 + 4 * 11;
// Fester Zeitschritt: Zeitraffer und Einschwingen machen mehr Schritte, nicht größere.
const DT = 1 / 60;
// Vorrechnen beim Start (unsichtbar, hinter dem Ladebild): 20 s Simulationszeit, damit der
// Planet "mitten im Geschehen" erscheint statt sichtbar bei null anzufangen.
const WARM_STEPS = 1200;
// Stufen für die automatische Qualität: [Windgitter, Farbauflösung]
const AUTO_TIERS: [number, number][] = [[192, 1024], [128, 768], [128, 512], [96, 384], [64, 256]];
// Budget für einen Simulationsschritt, damit neben dem Rendern 60 fps bleiben (16,7 ms pro Bild)
const STEP_BUDGET_MS = 8;
const MAX_LOAD_MS = 5000;
const KICK_LIFE = 2.5;

interface Storm {
  lat: number; lon: number; radius: number; sign: number; strength: number;
  color: [number, number, number];
  kick: number;   // 0 = Sturm aus der Vorlage, >0 = Restlebensdauer eines neu entstehenden Sturms
}

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
  private storms: Storm[] = [];
  private stepAcc = 0;
  private needsDye = false;
  private time = 0;
  private frame = 0;
  private spin = 0;
  private needsInit = true;
  private warm = 0;
  // Vorrechnen: Schritte pro Auftrag, so bemessen, dass ein Auftrag ~40 ms GPU-Zeit braucht.
  private warmRate = 4;
  private warmTotal = WARM_STEPS;
  private stepMs = 0;          // gemessene GPU-Zeit pro Simulationsschritt
  private warmStart = 0;
  private calibrated = false;
  private downgrades = 0;
  private renderScale = 1;     // dynamische Render-Auflösung für ≥ 60 fps
  private scaleAcc = 0; private scaleFrames = 0; private goodSeconds = 0;
  private cam = { yaw: -0.35, pitch: 0.12, dist: 4.3 };
  private dpr = 1.75;
  private panel!: Panel;

  constructor(private device: GPUDevice) {
    if (!this.offscreen) this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    // clamp-to-edge: im Flächeninneren wird nie über den Rand hinaus gefiltert (das übernimmt sampleCube).
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
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
    if (fromUI && q) { S.velRes = q.velRes; S.dyeRes = q.dyeRes; S.curlRes = q.curlRes; S.particles = q.particles; }
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
    this.flow = this.cubeField(S.curlRes);
    this.needsInit = true;
  }

  private allocDye() {
    for (const f of this.dye) f.tex.destroy();
    this.dye = [this.cubeField(S.dyeRes), this.cubeField(S.dyeRes)];
    // Nur die Wolkenfarbe neu aufsetzen, der Wind läuft weiter.
    this.needsDye = true;
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
    this.storms = this.preset.storms.map((s) => ({
      lat: s.lat, lon: s.lon, radius: s.radius, strength: s.strength, kick: 0,
      sign: (s.kind === 'cyclone' ? 1 : -1) * (s.lat >= 0 ? 1 : -1),
      color: hexToLinear(s.color),
    }));
    this.jets = windTable(this.preset);
    this.writeTables();
    this.needsInit = true;
    this.panel?.refresh();
    this.updateInfo();
  }

  private jets: Float32Array = new Float32Array(TABLE);

  private writeTables() {
    const d = this.simData;
    d.set(this.jets, OFF_JETS);
    d.set(bandTable(this.preset, S.contrast), OFF_BANDS);
    d.set([...hexToLinear(this.preset.cloud), 1], OFF_CLOUD);
  }

  private jetAt(latRad: number): number {
    const x = Math.min(Math.max((latRad / Math.PI + 0.5) * (TABLE - 1), 0), TABLE - 1);
    const i = Math.floor(x), j = Math.min(i + 1, TABLE - 1);
    return (this.jets[i] + (this.jets[j] - this.jets[i]) * (x - i)) * S.jetStrength;
  }

  // ---------- Uniforms ----------

  /** init: alle Stürme mit voller Stärke, damit sie beim Start als Wirbel eingesetzt werden. */
  private writeSim(dt: number, init = false) {
    const d = this.simData;
    const js = S.jetStrength;
    const list = this.activeStorms();
    d.set([
      dt, this.time, this.frame, S.velRes,
      S.dyeRes, this.flow.n, S.vortexStrength, S.omega,
      js, S.jetRelax, S.turbulence * js * 0.05, S.turbScale,
      S.confinement, S.drag, S.fineStripes, S.bfecc ? 1 : 0,
      S.bandRelax, S.convection, js * S.stormStrength, list.length,
      S.curlStrength * js, S.curlFreq, S.curlSpeed, S.curlOctaves,
      S.particles, S.lifetime, S.opacity, S.blur,
      S.seed, S.bandWobble, S.stormTint, S.vortexCount,
    ], 0);
    list.forEach((s, i) => {
      const la = (s.lat * Math.PI) / 180, lo = (s.lon * Math.PI) / 180;
      d.set([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo), (s.radius * Math.PI) / 180], OFF_STORMS + i * 4);
      d.set([s.sign * s.strength, ...s.color], OFF_INFO + i * 4);
      // Antrieb: Vorlagen-Stürme nur so stark wie "Stürme festhalten" (Curl-Noise hat keine
      // eigene Dynamik, dort immer voll). Neue Stürme: kurzer Stoß, der an- und abschwillt.
      let w = s.kick > 0 ? Math.sin(Math.PI * (1 - s.kick / KICK_LIFE)) : S.flow === 'curl' ? 1 : S.stormHold;
      if (init && s.kick === 0) w = 1;
      d[OFF_WEIGHT + i] = w;
    });
    this.device.queue.writeBuffer(this.simBuf, 0, d);
  }

  private activeStorms(): Storm[] {
    return this.storms.filter((s) => s.kick > 0 || S.storms).slice(0, MAX_STORMS);
  }

  /** Stürme bewegen, neue entstehen lassen, abgelaufene entfernen. */
  private updateStorms(dt: number) {
    for (const s of this.storms) {
      if (s.kick > 0) { s.kick = Math.max(0, s.kick - dt); continue; }
      // Festgehaltene Stürme treiben mit dem Jet ihrer Breite (Länge wächst nach Westen).
      const la = (s.lat * Math.PI) / 180;
      s.lon -= ((this.jetAt(la) * dt) / Math.max(Math.cos(la), 0.2)) * (180 / Math.PI);
    }
    // Vorlagen-Stürme stehen vorne in der Liste; abgelaufene neue Stürme fallen heraus.
    this.storms = this.storms.filter((s, i) => i < this.preset.storms.length || s.kick > 0);
    // Konvektion stößt neue Wirbel an: meist Antizyklone (weiße Ovale), manchmal Zyklone (dunkle Barken).
    if (S.flow === 'fluid' && Math.random() < S.stormSpawn * dt && this.activeStorms().length < MAX_STORMS) {
      const lat = (Math.random() * 2 - 1) * 65;
      const anti = Math.random() < 0.75;
      const band = bandTable(this.preset, S.contrast);
      const row = Math.round(((lat + 90) / 180) * (TABLE - 1)) * 4;
      const color: [number, number, number] = anti
        ? hexToLinear(this.preset.cloud)
        : [band[row] * 0.55, band[row + 1] * 0.5, band[row + 2] * 0.45];
      this.storms.push({
        lat, lon: Math.random() * 360, radius: 1.2 + Math.random() * 2.8,
        sign: (anti ? -1 : 1) * (lat >= 0 ? 1 : -1), strength: 0.5 + Math.random() * 0.6,
        color, kick: KICK_LIFE,
      });
    }
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
      1 / Math.max(S.jetStrength, 1e-4), (2 * Math.tan((16 * Math.PI) / 180)) / h, 0, 0,
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

  /** all = Wind, Druck, Partikel und Farbe; sonst nur die Farbe. */
  private initFields(enc: GPUCommandEncoder, all: boolean) {
    const pass = enc.beginComputePass();
    if (all) {
      this.run2D(pass, 'initVel', null, null, this.vel[0]);
      this.run2D(pass, 'clear', null, null, this.prs[0]);
      this.run2D(pass, 'clear', null, null, this.aux);
      this.vc = 0; this.pc = 0;
    }
    this.run2D(pass, 'initDye', null, null, this.dye[0]);
    this.dc = 0;
    pass.end();
    if (all) enc.clearBuffer(this.parts);
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
    const loop = async (now: number) => {
      const real = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.resize();
      this.initIfNeeded();
      if (this.warm > 0 && !S.paused) {
        await this.warmBatch();
      } else {
        this.fpsAcc += real; this.fpsFrames++;
        if (this.fpsAcc > 0.5) {
          fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} fps`;
          this.fpsAcc = 0; this.fpsFrames = 0;
        }
        this.frameOnce(real);
        this.adaptScale(real);
        // Im Testmodus bremst kein Canvas die Bildrate, also auf die GPU warten.
        if (this.offscreen) await this.device.queue.onSubmittedWorkDone();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private initIfNeeded() {
    if (!this.needsInit && !this.needsDye) return;
    const init = this.device.createCommandEncoder();
    if (this.needsInit) { this.time = 0; this.stepAcc = 0; }
    this.writeSim(0, true);
    this.initFields(init, this.needsInit);
    this.device.queue.submit([init.finish()]);
    // Neue Farbe braucht etwas Zeit, bis die Strömung sie verwirbelt hat.
    this.warm = this.needsInit ? WARM_STEPS : Math.max(this.warm, 300);
    this.warmTotal = this.warm;
    this.warmStart = performance.now();
    if (this.needsInit) this.calibrated = false;
    this.needsInit = false;
    this.needsDye = false;
    showLoading(true);
  }

  /** Vorrechnen: viele Schritte ohne Rendern, GPU-Zeit messen, Qualität kalibrieren. */
  private async warmBatch() {
    const n = this.warmRate;
    const t0 = performance.now();
    for (let k = 0; k < n && this.warm > 0; k++, this.warm--) this.submitStep();
    await this.device.queue.onSubmittedWorkDone();
    const ms = (performance.now() - t0) / Math.max(n, 1);
    this.stepMs = this.stepMs > 0 ? this.stepMs * 0.7 + ms * 0.3 : ms;
    this.warmRate = Math.min(128, Math.max(1, Math.round(40 / this.stepMs)));
    const done = this.warmTotal - this.warm;
    if (S.autoQuality && !this.calibrated && done >= 90) this.calibrate();
    // Ladezeit begrenzen: nicht länger als ~5 s vorrechnen, auch auf langsamen GPUs.
    if (done >= 90 && !this.offscreen) {
      const left = Math.max(0, Math.floor((MAX_LOAD_MS - (performance.now() - this.warmStart)) / this.stepMs));
      if (this.warm > left) { this.warm = left; this.warmTotal = done + left; }
    }
    loadBar.style.width = `${Math.round((100 * (this.warmTotal - this.warm)) / Math.max(this.warmTotal, 1))}%`;
    fpsEl.textContent = '– fps';
    if (this.warm === 0) showLoading(false);
  }

  /** Einmal pro Start: passt ein Simulationsschritt nicht ins Budget, eine Stufe herunter. */
  private calibrate() {
    this.calibrated = true;
    if (this.stepMs <= STEP_BUDGET_MS || this.downgrades >= 3) return;
    const idx = AUTO_TIERS.findIndex(([, dye]) => dye < S.dyeRes);
    if (idx < 0) return;
    [S.velRes, S.dyeRes] = AUTO_TIERS[idx];
    this.downgrades++;
    this.allocVel();
    this.allocDye();
    this.panel.refresh();
    this.warmStart = performance.now();
    loadNote.textContent = t(`Qualität für 60 fps angepasst (${S.velRes}² / ${S.dyeRes}²)`, `Quality adjusted for 60 fps (${S.velRes}² / ${S.dyeRes}²)`);
  }

  /** Dynamische Render-Auflösung: unter 56 fps kleiner, bei stabilen 60 fps langsam wieder größer. */
  private adaptScale(real: number) {
    if (!S.autoQuality) { this.renderScale = 1; return; }
    this.scaleAcc += real; this.scaleFrames++;
    if (this.scaleAcc < 1) return;
    const fps = this.scaleFrames / this.scaleAcc;
    this.scaleAcc = 0; this.scaleFrames = 0;
    if (fps < 56) { this.renderScale = Math.max(0.5, this.renderScale - 0.1); this.goodSeconds = 0; }
    else if (++this.goodSeconds >= 3 && this.renderScale < 1) { this.renderScale = Math.min(1, this.renderScale + 0.05); this.goodSeconds = 0; }
  }

  private simStep(enc: GPUCommandEncoder): CubeField {
    this.time += DT;
    this.frame++;
    this.updateStorms(DT);
    this.writeSim(DT);
    return this.step(enc);
  }

  /** Ein einzelner Schritt als eigener Auftrag, damit jeder Schritt seine eigenen Uniforms sieht. */
  private submitStep(): CubeField {
    const e = this.device.createCommandEncoder();
    const f = this.simStep(e);
    this.device.queue.submit([e.finish()]);
    return f;
  }

  /** Ein Bild: Simulationsschritt(e) und Darstellung. */
  frameOnce(real: number) {
    this.initIfNeeded();
    let flowSrc = S.flow === 'fluid' ? this.vel[this.vc] : this.flow;
    if (!S.paused) {
      // Zeitraffer: mehr Schritte pro Bild, jeder Schritt bleibt gleich groß (gleiche Physik).
      this.stepAcc += S.timeScale;
      const n = Math.min(Math.floor(this.stepAcc), 8);
      this.stepAcc -= n;
      for (let k = 0; k < n; k++) flowSrc = this.submitStep();
    }
    this.spin += S.paused ? 0 : real * 0.08 * S.spinSpeed * (9.93 / this.preset.rotationHours);
    const enc = this.device.createCommandEncoder();
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

  /** Nur für Tests: eine Texelzeile eines Felds auslesen (rgba als Zahlen). */
  async readRow(which: 'dye' | 'flow' | 'vel', face: number, y: number): Promise<number[][]> {
    const f = which === 'dye' ? this.dye[this.dc] : which === 'flow' ? this.flow : this.vel[this.vc];
    const bpr = Math.ceil((f.n * 8) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: f.tex, origin: [0, y, face] }, { buffer: buf, bytesPerRow: bpr }, [f.n, 1, 1]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(buf.getMappedRange().slice(0));
    buf.destroy();
    const f16 = (b: number) => { const s = b >> 15 ? -1 : 1, e = (b >> 10) & 31, m = b & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
    const out: number[][] = [];
    for (let x = 0; x < f.n; x++) out.push([0, 1, 2, 3].map((k) => f16(h[x * 4 + k])));
    return out;
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
    const dpr = Math.min(devicePixelRatio || 1, this.dpr) * (S.autoQuality ? this.renderScale : 1);
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
    root.innerHTML = '';
    const on = (key: string) => this.onChange(key as Key);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const f2 = (v: number) => v.toFixed(2);
    const f3 = (v: number) => v.toFixed(3);
    const n = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v % 1e6 ? 2 : 0)} ${t('Mio.', 'M')}` : v >= 1e3 ? `${Math.round(v / 1024)} k` : String(v));
    const presetName = (name: string) => ({ Neptun: t('Neptun', 'Neptune'), 'Heißer Jupiter': t('Heißer Jupiter', 'Hot Jupiter') } as Record<string, string>)[name] ?? name;

    this.panel = new Panel(root, S as unknown as Record<string, number | string | boolean>, on);
    this.panel
      .section('Planet')
      .select('preset', t('Vorlage', 'Preset'), [...presets.map((p) => [p.name, presetName(p.name)] as [string, string]), ['Zufall', t('Zufallsplanet', 'Random planet')]],
        t('Lädt Windprofil, Farbbänder, Stürme, Abplattung und Ringe eines Planeten. Alles sind Zahlen, keine Bilder.',
          'Loads a planet’s wind profile, colour bands, storms, oblateness and rings. All numbers, no images.'))
      .select('quality', t('Qualität', 'Quality'), [['phone', t('Handy', 'Phone')], ['standard', 'Standard'], ['high', t('Hoch (4 Mio. Partikel)', 'High (4 M particles)')]],
        t('Setzt Gitterauflösung, Farbauflösung, Partikelzahl und Pixeldichte auf einmal. „Handy“ ist für Smartphones gedacht.',
          'Sets grid resolution, colour resolution, particle count and pixel density at once. “Phone” is meant for smartphones.'))
      .toggle('autoQuality', t('60 fps halten', 'Hold 60 fps'),
        t('Misst beim Laden, wie schnell deine Grafikkarte einen Simulationsschritt rechnet, und senkt bei Bedarf die Auflösung. Danach passt sich die Render-Auflösung laufend an, damit die Bildrate über 58 fps bleibt.',
          'Measures during loading how fast your GPU computes a simulation step and lowers the resolution if needed. Afterwards the render resolution adapts continuously to keep the frame rate above 58 fps.'))
      .file('image', t('Farben aus Bild', 'Colours from image'),
        t('Lade ein Planetenfoto oder eine flache Karte. Für jeden Breitengrad wird die mittlere Farbe gemessen und als Bandfarbe übernommen. Das Bild wird nicht als Textur benutzt, die Wolken entstehen weiter aus der Simulation.',
          'Load a planet photo or a flat map. The average colour of each latitude becomes that band’s colour. The image is not used as a texture; the clouds still come from the simulation.'),
        (f) => bandsFromImage(f).then((bands) => {
          this.preset = { ...this.preset, name: `${this.preset.name} (${t('Farben aus Bild', 'colours from image')})`, bands };
          this.writeTables();
          this.needsDye = true;
          const info = document.getElementById('planet-info');
          if (info) info.textContent = `${this.preset.name} · ${t('Farben aus', 'colours from')} ${f.name}`;
        }).catch(() => fail(t('<b>Das Bild ließ sich nicht lesen.</b> Nimm ein JPG, PNG oder WebP.', '<b>Could not read the image.</b> Use a JPG, PNG or WebP.'))))
      .buttons([
        ['btn-reset', t('Neu starten', 'Restart'), () => { this.needsInit = true; }],
        ['btn-warm', t('Einschwingen', 'Spin up'), () => { this.warm = WARM_STEPS; this.warmTotal = WARM_STEPS; showLoading(true); }],
        ['btn-defaults', t('Regler zurücksetzen', 'Reset controls'), () => this.resetSettings()],
        ['btn-seed', t('Neuer Zufall', 'New seed'), () => { S.seed = (S.seed % 9973) + 1; if (S.preset === 'Zufall') this.applyPreset(); this.needsInit = true; }],
        ['btn-pause', S.paused ? t('Weiter', 'Resume') : 'Pause', () => { S.paused = !S.paused; (document.getElementById('btn-pause') as HTMLButtonElement).textContent = S.paused ? t('Weiter', 'Resume') : 'Pause'; }],
      ])
      .section(t('Verfahren', 'Method'), t('Strömung bestimmt, woher der Wind kommt. Darstellung bestimmt, wie die Wolken ihm folgen. Alle vier Kombinationen laufen.',
        'Flow decides where the wind comes from. Look decides how the clouds follow it. All four combinations work.'))
      .select('flow', t('Strömung', 'Flow'), [['fluid', 'Stable Fluids (mofu)'], ['curl', 'Curl noise (jasper-r)']],
        t('Stable Fluids löst die Strömungsgleichung mit Druck, Coriolis und Wirbeln (physikalisch). Curl-Noise ist ein verwirbeltes Rauschfeld plus Jets (schnell, aber ohne Physik).',
          'Stable Fluids solves the flow equations with pressure, Coriolis and vortices (physical). Curl noise is a swirling noise field plus jets (fast, but no physics).'))
      .select('look', t('Darstellung', 'Look'), [['dye', t('Farbstoff', 'Dye')], ['particles', t('Partikel', 'Particles')]],
        t('Farbstoff: jede Zelle der Farbtextur wird mit dem Wind verschoben. Partikel: Millionen Punkte fliegen mit dem Wind und färben die Textur, die langsam verblasst.',
          'Dye: every cell of the colour texture is carried by the wind. Particles: millions of points ride the wind and paint the texture, which slowly fades.'))
      .range('timeScale', t('Zeitraffer', 'Time lapse'), 0.25, 8, 0.25,
        t('Simulationsschritte pro Bild. Jeder Schritt ist gleich groß, die Physik bleibt also dieselbe, sie läuft nur schneller ab. Kostet entsprechend mehr Rechenleistung. Zum schnellen Erreichen des stabilen Zustands gibt es den Knopf „Einschwingen“.',
          'Simulation steps per frame. Every step has the same size, so the physics stay the same and just run faster. Costs more GPU time. To reach a settled state quickly, use “Spin up”.'), (v) => `${v.toFixed(2)}×`)
      .section(t('Wind und Physik', 'Wind and physics'), t('Wirkt bei Strömung „Stable Fluids“. Jet-Stärke wirkt überall.', 'Applies to the “Stable Fluids” flow. Jet strength applies everywhere.'))
      .range('jetStrength', t('Jet-Stärke', 'Jet strength'), 0, 0.2, 0.002,
        t('Spitzengeschwindigkeit der Ost-West-Winde in Radiant pro Sekunde. Bei Jupiter wären das echte 150 m/s. Skaliert auch Stürme und Turbulenz.',
          'Peak east–west wind speed in radians per second (on Jupiter the real value is 150 m/s). Also scales storms and turbulence.'), f3)
      .range('jetRelax', t('Jet-Rückstellung', 'Jet restoring'), 0, 2, 0.01,
        t('Wie stark das Breitenkreis-Mittel der Ost-West-Winde zum gemessenen Windprofil zurückgezogen wird. Wirbel bleiben unberührt. 0 = die Strömung ist frei und die Bänder zerfallen mit der Zeit.',
          'How strongly the latitude-circle mean of the east–west wind is pulled back to the measured profile. Vortices are left alone. 0 = free flow, bands decay over time.'), f2)
      .range('omega', t('Coriolis (Rotation)', 'Coriolis (rotation)'), 0, 3, 0.01,
        t('Physikalische Planetenrotation in der Strömungsgleichung. Lenkt Winde ab (Nordhalbkugel nach rechts) und erzeugt über den β-Effekt Rossby-Wellen und langlebige Wirbel. 0 = nicht rotierender Planet. Die sichtbare Drehung stellst du unter „Drehgeschwindigkeit“ ein.',
          'Physical planet rotation in the flow equations. Deflects winds (to the right in the north) and, through the β-effect, creates Rossby waves and long-lived vortices. 0 = non-rotating planet. The visible spin is set under “Spin speed”.'), f2)
      .range('turbulence', t('Turbulenz', 'Turbulence'), 0, 3, 0.01,
        t('Kleine zufällige Anstöße im Wind. Sie lösen die Scherinstabilitäten an den Jet-Rändern aus (Kelvin-Helmholtz-Wellen).',
          'Small random kicks in the wind. They trigger shear instabilities at jet edges (Kelvin–Helmholtz waves).'), f2)
      .range('turbScale', t('Turbulenz-Größe', 'Turbulence scale'), 1, 20, 0.5,
        t('Größe der Anstöße: klein = viele feine Wirbel, groß = wenige große.', 'Size of the kicks: small = many fine eddies, large = a few big ones.'), (v) => v.toFixed(1))
      .range('confinement', t('Wirbelverstärkung', 'Vorticity confinement'), 0, 8, 0.05,
        t('Vorticity Confinement: gibt Wirbeln die Energie zurück, die das grobe Gitter wegschmiert. Wirkt vor allem auf die kleinsten Wirbel. Standard 6 ist der lebendige Look von v0.1; physikalisch sauberer ist etwa 0,5, das beruhigt das kleinskalige Rauschen.',
          'Gives vortices back the energy the coarse grid smears away, mostly for the smallest eddies. Default 6 is the v0.1 look with lively curls; physically cleaner is about 0.5, which calms the small-scale noise.'), f2)
      .range('drag', t('Reibung', 'Drag'), 0, 0.5, 0.005, t('Bremst den ganzen Wind gleichmäßig ab.', 'Slows the whole wind field uniformly.'), f3)
      .range('iterations', t('Druck-Iterationen', 'Pressure iterations'), 2, 80, 1,
        t('Jacobi-Schritte für die Druckgleichung. Mehr = sauberer divergenzfrei, aber teurer. Der wichtigste Leistungsregler.',
          'Jacobi steps for the pressure equation. More = closer to divergence-free, but slower. The most important performance control.'))
      .range('velRes', t('Gitter je Würfelfläche', 'Grid per cube face'), 32, 256, 16,
        t('Auflösung des Windgitters. 128 heißt 6 × 128 × 128 Zellen auf der Kugel.', 'Wind grid resolution. 128 means 6 × 128 × 128 cells on the sphere.'), (v) => `${v}²`)
      .toggle('bfecc', t('BFECC-Advektion', 'BFECC advection'),
        t('Fehlerkorrektur beim Mitführen (vor, zurück, halben Fehler abziehen). Macht Wirbel und Farbkanten schärfer, kostet zwei zusätzliche Abtastungen.',
          'Error correction during transport (back, forth, subtract half the error). Sharper vortices and colour edges for two extra samples.'))
      .section('Curl noise', t('Wirkt bei Strömung „Curl-Noise“.', 'Applies to the “Curl noise” flow.'), false)
      .range('curlStrength', t('Stärke', 'Strength'), 0, 3, 0.01, t('Wie stark das Rauschfeld gegenüber den Jets ist.', 'Strength of the noise field relative to the jets.'), f2)
      .range('curlFreq', t('Frequenz', 'Frequency'), 1, 16, 0.1, t('Größe der Wirbel im Rauschfeld: hoch = viele kleine.', 'Size of the swirls in the noise: high = many small ones.'), (v) => v.toFixed(1))
      .range('curlSpeed', t('Veränderung', 'Evolution'), 0, 0.5, 0.005, t('Wie schnell sich das Rauschfeld mit der Zeit umbaut.', 'How fast the noise field changes over time.'), f3)
      .range('curlOctaves', t('Oktaven', 'Octaves'), 1, 6, 1, t('Anzahl überlagerter Rausch-Ebenen. Mehr = feinere Details.', 'Number of stacked noise layers. More = finer detail.'))
      .range('vortexCount', t('Wirbel', 'Vortices'), 0, 128, 1,
        t('Anzahl eingestreuter Wirbel (Rezept aus Gaseous Giganticus). Sie werden nur dort gesetzt, wo die Jets schwach sind, und drehen mit der lokalen Scherung, damit sie nicht zerrissen werden.',
          'Number of seeded vortices (Gaseous Giganticus recipe). Placed only where jets are weak, spinning with the local shear so they are not torn apart.'))
      .range('vortexStrength', t('Wirbel-Stärke', 'Vortex strength'), 0, 4, 0.05, t('Drehgeschwindigkeit der eingestreuten Wirbel relativ zur Jet-Stärke.', 'Spin of the seeded vortices relative to jet strength.'), f2)
      .range('curlRes', t('Feinheit Strömungsfeld', 'Flow field resolution'), 64, 1024, 64,
        t('Auflösung des Curl-Noise-Strömungsfelds je Würfelfläche. Gaseous Giganticus nutzt 2048. Feiner = feinere Filamente, kostet Rechenzeit.',
          'Resolution of the curl noise flow field per cube face. Gaseous Giganticus uses 2048. Finer = finer filaments, more GPU time.'), (v) => `${v}²`)
      .section(t('Partikel', 'Particles'), t('Wirkt bei Darstellung „Partikel“.', 'Applies to the “Particles” look.'), false)
      .range('particles', t('Anzahl', 'Count'), 16384, 4194304, 16384,
        t('Anzahl der Partikel. jasper-r nutzte 4 Mio. bei 80 fps auf einem PC. Handys schaffen etwa 0,25 bis 1 Mio.', 'Number of particles. jasper-r used 4 M at 80 fps on a PC. Phones manage roughly 0.25 to 1 M.'), n)
      .range('lifetime', t('Lebensdauer', 'Lifetime'), 0.5, 60, 0.5,
        t('Sekunden, bis ein Partikel neu geboren wird. Lang = lange Schlieren. Ganz rechts (60) leben Partikel ewig wie bei Gaseous Giganticus und ziehen immer feinere Fäden.',
          'Seconds until a particle respawns. Long = long streaks. At the far right (60) particles live forever, as in Gaseous Giganticus, and draw ever finer threads.'), (v) => (v >= 60 ? t('ewig', 'forever') : `${v.toFixed(1)} s`))
      .range('opacity', t('Deckkraft', 'Opacity'), 0.01, 1, 0.01, t('Wie stark ein Partikel seine Farbe in die Textur schreibt.', 'How strongly a particle writes its colour into the texture.'), pct)
      .range('blur', t('Weichzeichnen', 'Blur'), 0, 1, 0.01, t('Verwischt die Textur jedes Bild ein wenig, damit aus Punkten Wolken werden.', 'Blurs the texture slightly every frame so points become clouds.'), pct)
      .section(t('Wolken und Stürme', 'Clouds and storms'))
      .range('bandRelax', t('Band-Rückstellung', 'Band restoring'), 0, 0.5, 0.005,
        t('Wie schnell die Farbe zum Band ihrer Breite zurückkehrt. 0 = alles vermischt sich irgendwann zu Brei, hoch = starre Streifen.',
          'How fast colour returns to its latitude’s band. 0 = everything eventually mixes into mush, high = rigid stripes.'), f3)
      .range('fineStripes', t('Feinstreifen', 'Fine stripes'), 0, 2, 0.05,
        t('Feine Farbstreifen innerhalb der Bänder. Erst sie machen sichtbar, wie die Strömung Farbe zu Filamenten zieht, wie auf den Juno-Nahaufnahmen.',
          'Fine colour stripes inside the bands. They make it visible how the flow pulls colour into filaments, as in Juno close-ups.'), f2)
      .range('bandWobble', t('Band-Mäander', 'Band meander'), 0, 3, 0.05, t('Verbiegt die Bandgrenzen mit Rauschen, damit sie nicht wie mit dem Lineal gezogen sind.', 'Bends band edges with noise so they are not ruler-straight.'), f2)
      .range('contrast', t('Band-Kontrast', 'Band contrast'), 0, 2.5, 0.05, t('Verstärkt oder dämpft den Farbunterschied zwischen hellen Zonen und dunklen Gürteln.', 'Raises or lowers the colour difference between bright zones and dark belts.'), f2)
      .range('convection', t('Konvektion', 'Convection'), 0, 4, 0.05, t('Helle Wolkentürme, die aus der Tiefe aufsteigen (Ammoniak-Eis).', 'Bright cloud towers rising from below (ammonia ice).'), f2)
      .toggle('storms', t('Vorlagen-Stürme', 'Preset storms'),
        t('Setzt beim Start die bekannten Stürme der Vorlage als Wirbel ein (z. B. Großer Roter Fleck). Danach leben sie von der Physik allein: Sie treiben, verformen sich, verschmelzen oder zerfallen.',
          'Seeds the preset’s known storms as vortices at start (e.g. the Great Red Spot). After that they live on physics alone: they drift, deform, merge or decay.'))
      .range('stormHold', t('Stürme festhalten', 'Hold storms'), 0, 1, 0.01,
        t('Treibt die Vorlagen-Stürme dauerhaft an und färbt sie nach. 0 = reine Physik (Stürme dürfen vergehen), 1 = der Sturm wird ständig nachgeführt wie ein Beobachtungsdatum. Bei Curl-Noise immer voll, weil das Rauschfeld keine eigene Dynamik hat.',
          'Keeps driving and recolouring the preset storms. 0 = pure physics (storms may fade), 1 = the storm is enforced like observation data. Always full in curl noise mode, which has no dynamics of its own.'), pct)
      .range('stormSpawn', t('Neue Stürme', 'New storms'), 0, 2, 0.01,
        t('Wie oft aufsteigende Konvektion einen neuen Wirbel anstößt (pro Sekunde Simulationszeit). Meist Antizyklone (weiße Ovale), manchmal Zyklone (dunkle Barken). Nur bei Stable Fluids.',
          'How often rising convection kicks off a new vortex (per second of simulated time). Mostly anticyclones (white ovals), sometimes cyclones (dark barges). Stable Fluids only.'), f2)
      .range('stormStrength', t('Sturm-Stärke', 'Storm strength'), 0, 4, 0.05, t('Drehgeschwindigkeit der Stürme relativ zur Jet-Stärke.', 'Storm spin relative to jet strength.'), f2)
      .range('stormTint', t('Sturm-Farbe', 'Storm colour'), 0, 4, 0.05, t('Wie stark ein angetriebener Sturm seine eigene Farbe in die Wolken gibt.', 'How strongly a driven storm tints the clouds with its own colour.'), f2)
      .range('dyeRes', t('Farbauflösung', 'Colour resolution'), 128, 1536, 64,
        t('Auflösung der Wolkentextur je Würfelfläche. Bestimmt die Schärfe beim Heranzoomen.', 'Cloud texture resolution per cube face. Sets sharpness when zooming in.'), (v) => `${v}²`)
      .section(t('Licht und Ansicht', 'Light and view'))
      .range('sunAngle', t('Sonnenstand', 'Sun angle'), -180, 180, 1,
        t('Richtung der Sonne. 0° = Sonne hinter der Kamera (voller Planet), 90° = Halbphase.', 'Sun direction. 0° = sun behind the camera (full disc), 90° = half phase.'), (v) => `${v}°`)
      .range('relief', 'Relief', 0, 2, 0.01,
        t('Hebt helle Wolken optisch an und wirft weiche Schatten, wie bei den Juno-Nahaufnahmen.', 'Lifts bright clouds visually and casts soft shadows, as in Juno close-ups.'), f2)
      .range('limb', t('Randverdunkelung', 'Limb darkening'), 0.8, 2, 0.01,
        t('Minnaert-Exponent. 1 = matte Kugel; höher = dunkler Rand wie bei echten Gasplaneten.', 'Minnaert exponent. 1 = matte sphere; higher = darker limb, as on real gas giants.'), f2)
      .range('atmosphere', t('Dunstsaum', 'Haze rim'), 0, 3, 0.05, t('Helligkeit des Atmosphärensaums am Planetenrand.', 'Brightness of the atmospheric rim at the planet’s edge.'), f2)
      .range('exposure', t('Belichtung', 'Exposure'), 0.3, 3, 0.05, t('Gesamthelligkeit.', 'Overall brightness.'), f2)
      .range('spinSpeed', t('Drehgeschwindigkeit', 'Spin speed'), 0, 5, 0.05,
        t('Sichtbare Eigendrehung. Von Norden gesehen gegen den Uhrzeigersinn, mit Norden oben laufen die Wolken also von links nach rechts. 1 = Tempo passend zur Tageslänge der Vorlage, 0 = steht still. Ändert nur die Ansicht, nicht die Physik.',
          'Visible spin. Counter-clockwise seen from the north, so with north up the clouds move left to right. 1 = matches the preset’s day length, 0 = still. Affects the view only, not the physics.'), (v) => `${v.toFixed(2)}×`)
      .toggle('map', t('Kartenansicht', 'Map view'),
        t('Zeigt die ganze Kugel als flache Weltkarte (Längen- und Breitengrade). Gut, um Jets und Stürme zu vergleichen.', 'Shows the whole sphere as a flat map (longitude/latitude). Good for comparing jets and storms.'))
      .select('view', t('Feld anzeigen', 'Show field'), [['0', t('Wolken', 'Clouds')], ['1', t('Wind (Richtung)', 'Wind (direction)')], ['2', t('Wirbelstärke', 'Vorticity')], ['3', t('Druck', 'Pressure')]],
        t('Debug-Ansichten. Wind: Rot = Ost, Grün = Nord. Wirbelstärke: Rot = gegen den Uhrzeigersinn, Blau = im Uhrzeigersinn. Druck gibt es nur bei Stable Fluids.',
          'Debug views. Wind: red = east, green = north. Vorticity: red = counter-clockwise, blue = clockwise. Pressure exists only with Stable Fluids.'));
    this.updateVisibility();
    this.applyStaticText();
  }

  /** Feste Texte der Seite in der aktuellen Sprache. */
  private applyStaticText() {
    const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('hint', t('ziehen zum Drehen, Mausrad oder zwei Finger zum Zoomen', 'drag to rotate, scroll or pinch to zoom'));
    set('load-title', t('Atmosphäre wird eingeschwungen', 'Spinning up the atmosphere'));
    set('panel-title', t('Regler', 'Controls'));
    set('lang', lang === 'de' ? 'EN' : 'DE');
    const lb = document.getElementById('lang');
    if (lb) lb.setAttribute('aria-label', t('Sprache: Englisch', 'Language: German'));
    const credits = document.getElementById('credits');
    if (credits) credits.innerHTML = t(
      'Echtzeit-WebGPU, keine Bilddateien. Idee: elias-nero-tron. Verfahren nach <a href="https://mofu-dev.com/en/blog/stable-fluids/" target="_blank" rel="noopener">mofu</a>, <a href="https://jasper-r.github.io/gas-giant" target="_blank" rel="noopener">jasper-r</a> und Gaseous Giganticus. <a href="https://github.com/elias-nero-tron/Fluid-Gas-Planet" target="_blank" rel="noopener">Quellcode</a>',
      'Real-time WebGPU, no image files. Idea: elias-nero-tron. Methods after <a href="https://mofu-dev.com/en/blog/stable-fluids/" target="_blank" rel="noopener">mofu</a>, <a href="https://jasper-r.github.io/gas-giant" target="_blank" rel="noopener">jasper-r</a> and Gaseous Giganticus. <a href="https://github.com/elias-nero-tron/Fluid-Gas-Planet" target="_blank" rel="noopener">Source code</a>');
    this.updateInfo();
  }

  private updateInfo() {
    const info = document.getElementById('planet-info');
    if (!info) return;
    const p = this.preset;
    info.textContent = `${p.name} · ${t('Abplattung', 'oblateness')} ${p.oblateness.toFixed(3)} · ${t('Achse', 'tilt')} ${p.tilt.toFixed(1)}° · ${t('Tag', 'day')} ${p.rotationHours.toFixed(1)} h · ${p.storms.length} ${t('Stürme', 'storms')}`;
  }

  private updateVisibility() {
    const fluid = S.flow === 'fluid', parts = S.look === 'particles';
    for (const k of ['jetRelax', 'omega', 'turbulence', 'turbScale', 'confinement', 'drag', 'iterations', 'velRes', 'stormSpawn']) this.panel.visible(k, fluid);
    for (const k of ['curlStrength', 'curlFreq', 'curlSpeed', 'curlOctaves', 'vortexCount', 'vortexStrength', 'curlRes']) this.panel.visible(k, !fluid);
    for (const k of ['particles', 'lifetime', 'opacity', 'blur']) this.panel.visible(k, parts);
  }

  private resetSettings() {
    const keep = { preset: S.preset, quality: S.quality, velRes: S.velRes, dyeRes: S.dyeRes, curlRes: S.curlRes, particles: S.particles, seed: S.seed };
    Object.assign(S, DEFAULTS, keep);
    this.applyPreset();
    canvas.classList.toggle('map', S.map);
    this.updateVisibility();
    this.panel.refresh();
    const pause = document.getElementById('btn-pause');
    if (pause) pause.textContent = 'Pause';
  }

  /** Sprache wechseln: Panel neu aufbauen, feste Texte ersetzen. */
  toggleLang() {
    setLang(lang === 'de' ? 'en' : 'de');
    this.buildUI();
  }

  private onChange(key: Key) {
    switch (key) {
      case 'preset': this.applyPreset(); break;
      case 'quality': this.downgrades = 0; this.applyQuality(true); this.panel.refresh(); break;
      case 'contrast': this.writeTables(); break;
      case 'fineStripes': this.needsDye = true; break;
      case 'velRes': case 'curlRes': this.allocVel(); break;
      case 'dyeRes': this.allocDye(); break;
      case 'particles': this.allocParticles(); break;
      case 'flow': case 'look': this.updateVisibility(); break;
      case 'map': canvas.classList.toggle('map', S.map); break;
      case 'autoQuality': this.renderScale = 1; break;
    }
  }
}

// Für automatische Tests und die Konsole
declare global { interface Window { gasPlanet?: { settings: typeof S; capture: () => Promise<string>; readRow: (w: 'dye' | 'flow' | 'vel', face: number, y: number) => Promise<number[][]> } } }

start().catch((e) => fail(`${t('<b>Start fehlgeschlagen:</b>', '<b>Start failed:</b>')} ${e instanceof Error ? e.message : String(e)}`));
