import commonWGSL from './shaders/common.wgsl?raw';
import fluidWGSL from './shaders/fluid.wgsl?raw';
import tracersWGSL from './shaders/tracers.wgsl?raw';
import renderWGSL from './shaders/render.wgsl?raw';
import { presets, randomPreset, newSeed, bandsFromImage, windTable, bandTable, hexToLinear, TABLE, type Preset, type RandomOptions } from './presets';
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
  // Schiene (Verfahren). Die Schienen teilen sich nur Kugelgeometrie und Darstellung:
  // 'fluid' = Stable Fluids + Farbstoff (mofu), 'particles' = Curl-Noise + reine Partikel (jasper-r),
  // 'hybrid' = Strömung und Darstellung frei kombinieren (Stand v0.2).
  track: 'fluid',
  flow: 'fluid',          // nur bei Schiene 'hybrid': 'fluid' = Stable Fluids, 'curl' = Curl-Noise
  look: 'dye',            // nur bei Schiene 'hybrid': 'dye' = Farbstoff, 'particles' = Partikel
  timeScale: 1,           // Simulationszeit pro Sekunde Echtzeit (fester Zeitschritt, mehr Schritte)
  retro: false,           // Drehrichtung rückläufig: spiegelt Rotation, Jets und Sturm-Drehsinn
  seamless: false,        // nahtlos exakte Abtastung an Würfelkanten (für GPUs ohne nahtlose Cubemaps)
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
  fade: 0.05,             // Partikel-Schiene: Verblassen zur Mittelfarbe (1/s)
  viewFocus: 0,           // Anteil der Partikel, die im Sichtfeld geboren werden
  // Zufallsplanet
  rndFamily: '',
  rndBands: 0,
  rndStorms: 'auto',
  rndRings: 'auto',
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
  kickLife: 2.5,          // Sekunden, die ein neuer Sturm angetrieben wird, danach lebt er frei
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

// Geräteklassen: Startwerte und Obergrenzen der Regler. "ultra" schaltet die großen Werte frei.
const QUALITY: Record<string, { velRes: number; dyeRes: number; curlRes: number; particles: number; dpr: number;
  max: { velRes: number; dyeRes: number; curlRes: number; particles: number } }> = {
  phone: { velRes: 96, dyeRes: 384, curlRes: 256, particles: 262144, dpr: 1,
    max: { velRes: 128, dyeRes: 768, curlRes: 512, particles: 1048576 } },
  standard: { velRes: 128, dyeRes: 768, curlRes: 384, particles: 1048576, dpr: 1.25,
    max: { velRes: 192, dyeRes: 1024, curlRes: 768, particles: 4194304 } },
  high: { velRes: 192, dyeRes: 1024, curlRes: 768, particles: 4194304, dpr: 1.75,
    max: { velRes: 256, dyeRes: 1536, curlRes: 1024, particles: 8388608 } },
  ultra: { velRes: 256, dyeRes: 1536, curlRes: 1024, particles: 8388608, dpr: 3,
    max: { velRes: 384, dyeRes: 2048, curlRes: 2048, particles: 33554432 } },
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
  window.gasPlanet = {
    settings: S, capture: () => app.capture(), readRow: (w, f, y) => app.readRow(w, f, y),
    filmstrip: (o) => app.filmstrip(o), selftest: () => app.selftest(), frame: () => app.frameCount(),
  };
  document.getElementById('lang')?.addEventListener('click', () => app.toggleLang());
  // ⓘ: Erklärungen unter den Reglern zeigen oder verbergen (gemerkt im Browser).
  const hintsBtn = document.getElementById('hints');
  const setHints = (on: boolean) => {
    document.body.classList.toggle('hints-off', !on);
    hintsBtn?.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('fgp-hints', on ? '1' : '0'); } catch { /* gesperrt */ }
  };
  let hintsOn = true;
  try { hintsOn = localStorage.getItem('fgp-hints') !== '0'; } catch { /* gesperrt */ }
  setHints(hintsOn);
  hintsBtn?.addEventListener('click', () => { hintsOn = !hintsOn; setHints(hintsOn); });
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); app.redo(); }
  });
  app.run();
}

// ---------------------------------------------------------------------------
// Cubemap-Felder
// ---------------------------------------------------------------------------

interface CubeField { tex: GPUTexture; cube: GPUTextureView; store: GPUTextureView; n: number }

interface FilmOptions { frames?: number; cols?: number; scale?: number; everySeconds?: number; everySteps?: number }
interface Filmstrip { image: string; stats: { t: number; frame: number; fps: number; detail: number; change: number }[] }

// Aufbau des Sim-Uniforms (in floats), muss zu struct Sim in common.wgsl passen.
const MAX_STORMS = 16;
const OFF_CLOUD = 32;
const OFF_CENTRE = OFF_CLOUD + 4;
const OFF_VIEW = OFF_CENTRE + 4;
const OFF_MODE = OFF_VIEW + 4;
const OFF_JETS = OFF_MODE + 4;
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
const AUTO_TIERS: [number, number][] = [[256, 1536], [192, 1024], [128, 768], [128, 512], [96, 384], [64, 256]];
// Budget für einen Simulationsschritt, damit neben dem Rendern 60 fps bleiben (16,7 ms pro Bild)
const STEP_BUDGET_MS = 8;
const MAX_LOAD_MS = 5000;

interface Storm {
  lat: number; lon: number; radius: number; sign: number; strength: number;
  color: [number, number, number];
  kick: number;   // 0 = Sturm aus der Vorlage, >0 = restliche Antriebszeit eines neu entstehenden Sturms
  life: number;   // gesamte Antriebszeit eines neuen Sturms
}

class App {
  // Testmodus #offscreen: rendert in eine Textur statt auf den Canvas (für Headless-Browser).
  private offscreen = location.hash.startsWith('#offscreen');
  // Testmodus: #offscreen&warm=300 verkürzt das Vorrechnen (Software-Renderer sind langsam).
  private warmSteps = Number(new URLSearchParams(location.hash.slice(1)).get('warm')) || WARM_STEPS;
  private format: GPUTextureFormat = this.offscreen ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  private target: GPUTexture | null = null;
  private ctx = canvas.getContext('webgpu') as GPUCanvasContext;
  private sampler: GPUSampler;
  private simBuf: GPUBuffer;
  private renderBuf: GPUBuffer;
  private simData = new Float32Array(SIM_FLOATS);
  private renderData = new Float32Array(RENDER_FLOATS);

  private computeLayout: GPUBindGroupLayout;
  private fluidModule: GPUShaderModule;
  private tracerModule: GPUShaderModule;
  private pipes: Record<string, GPUComputePipeline> = {};
  private pipesBuilt: boolean | null = null;
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
  private runSeed = 0;         // "Neu starten": neuer Lauf, gleicher Planet
  private achieved = 1;        // tatsächlich erreichter Zeitraffer
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
        { binding: 6, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 7, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      ],
    });
    this.fluidModule = this.module('fluid', commonWGSL + fluidWGSL);
    this.tracerModule = this.module('tracers', commonWGSL + tracersWGSL);
    this.buildPipes(false);

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
    this.remember();
  }

  /** Compute-Pipelines, wahlweise mit nahtlos exakter Abtastung an Würfelkanten (SEAMLESS). */
  private buildPipes(seamless: boolean) {
    if (this.pipesBuilt === seamless) return;
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.computeLayout] });
    const constants = { SEAMLESS: seamless ? 1 : 0 };
    for (const e of ['initVel', 'clear', 'advect', 'curl', 'zonalClear', 'zonalSum', 'forces', 'divergence', 'jacobi', 'project'])
      this.pipes[e] = this.device.createComputePipeline({ layout, compute: { module: this.fluidModule, entryPoint: e, constants } });
    for (const e of ['initDye', 'advectDye', 'flowField', 'moveParticles', 'blurRelax', 'blurFade'])
      this.pipes[e] = this.device.createComputePipeline({ layout, compute: { module: this.tracerModule, entryPoint: e, constants } });
    this.pipesBuilt = seamless;
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

  /** Strömung und Darstellung, die die gewählte Schiene tatsächlich benutzt. */
  private flowMode(): 'fluid' | 'curl' { return S.track === 'fluid' ? 'fluid' : S.track === 'particles' ? 'curl' : S.flow as 'fluid' | 'curl'; }
  private lookMode(): 'dye' | 'particles' | 'pure' { return S.track === 'fluid' ? 'dye' : S.track === 'particles' ? 'pure' : S.look as 'dye' | 'particles'; }
  private dir(): number { return S.retro ? -1 : 1; }

  private randomOptions(): RandomOptions {
    return { family: S.rndFamily, bands: S.rndBands, storms: S.rndStorms as RandomOptions['storms'], rings: S.rndRings as RandomOptions['rings'] };
  }

  private applyPreset() {
    const p = S.preset === 'Zufall' ? randomPreset(S.seed, this.randomOptions()) : presets.find((x) => x.name === S.preset) ?? presets[0];
    const t = p.tune;
    S.turbulence = t.turbulence; S.convection = t.convection; S.bandWobble = t.bandWobble;
    S.stormTint = t.stormTint; S.relief = t.relief;
    this.usePreset(p);
    this.needsInit = true;
  }

  /** Planetendaten übernehmen, ohne die Regler zu verändern (für Laden und Rückgängig). */
  private usePreset(p: Preset) {
    this.preset = p;
    this.storms = this.preset.storms.map((s) => ({
      lat: s.lat, lon: s.lon, radius: s.radius, strength: s.strength, kick: 0, life: 0,
      sign: (s.kind === 'cyclone' ? 1 : -1) * (s.lat >= 0 ? 1 : -1) * this.dir(),
      color: hexToLinear(s.color),
    }));
    // Rückläufige Drehung = Spiegelbild: Jets und Drehsinn der Stürme kehren sich um.
    this.jets = windTable(this.preset).map((v) => v * this.dir());
    this.writeTables();
    this.panel?.refresh();
    this.updateInfo();
  }

  // ---------- Verlauf, Speichern, Planeten-Code ----------

  private history: string[] = [];
  private hIndex = -1;
  private hTimer = 0;

  private snapshot(): string {
    const { paused: _paused, ...rest } = S;
    return JSON.stringify({ v: 1, s: rest, preset: this.preset });
  }

  /** Nach jeder Änderung (kurz verzögert) einen Stand merken. */
  private remember() {
    clearTimeout(this.hTimer);
    this.hTimer = window.setTimeout(() => {
      const snap = this.snapshot();
      if (this.history[this.hIndex] === snap) return;
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push(snap);
      if (this.history.length > 100) this.history.shift();
      this.hIndex = this.history.length - 1;
      this.updateUndoButtons();
    }, 400);
  }

  undo() { if (this.hIndex > 0) { this.hIndex--; this.restore(this.history[this.hIndex]); this.updateUndoButtons(); } }
  redo() { if (this.hIndex < this.history.length - 1) { this.hIndex++; this.restore(this.history[this.hIndex]); this.updateUndoButtons(); } }

  private updateUndoButtons() {
    const u = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const r = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (u) u.disabled = this.hIndex <= 0;
    if (r) r.disabled = this.hIndex >= this.history.length - 1;
  }

  /** Einen gespeicherten Stand anwenden; nur neu starten, wenn sich der Planet geändert hat. */
  private restore(json: string) {
    const snap = JSON.parse(json) as { v: number; s: Partial<typeof S>; preset: Preset };
    const prev = { ...S };
    const prevPreset = JSON.stringify(this.preset);
    // Codes aus v0.2 kennen keine Schienen: dort galten Strömung und Darstellung frei kombiniert.
    const compat: Partial<typeof S> = 'track' in snap.s ? {} : { track: 'hybrid' };
    Object.assign(S, snap.s, compat, { paused: prev.paused });
    this.buildPipes(S.seamless);
    if (prev.retro !== S.retro) this.spin = -this.spin;
    this.usePreset(snap.preset);
    if (prev.velRes !== S.velRes || prev.curlRes !== S.curlRes) this.allocVel();
    if (prev.dyeRes !== S.dyeRes) this.allocDye();
    if (prev.particles !== S.particles) this.allocParticles();
    if (prevPreset !== JSON.stringify(snap.preset) || prev.retro !== S.retro) this.needsInit = true;
    if (prev.track !== S.track || prev.flow !== S.flow || prev.look !== S.look) this.needsDye = true;
    if (prev.quality !== S.quality) { this.buildUI(); return; }
    canvas.classList.toggle('map', S.map);
    this.updateVisibility();
    this.panel.refresh();
  }

  private encode(json: string): string {
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return 'FGP1:' + btoa(bin);
  }

  private decode(code: string): string {
    const raw = code.trim().replace(/^FGP1:/, '');
    const bin = atob(raw);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  private loadSaves(): { name: string; code: string }[] {
    try { return JSON.parse(localStorage.getItem('fgp-saves') || '[]'); } catch { return []; }
  }

  private storeSaves(list: { name: string; code: string }[]) {
    try { localStorage.setItem('fgp-saves', JSON.stringify(list)); } catch { /* Speicher gesperrt */ }
  }

  /** Abschnitt "Speichern": Verlauf, benannte Speicherplätze, Code zum Weitergeben. */
  private buildSaveSection() {
    const box = document.createElement('div');
    box.className = 'save-box';
    box.innerHTML = `
      <div class="row row-buttons">
        <button id="btn-undo" type="button">${t('↶ Rückgängig', '↶ Undo')}</button>
        <button id="btn-redo" type="button">${t('↷ Wiederholen', '↷ Redo')}</button>
      </div>
      <div class="row row-save">
        <input id="save-name" type="text" maxlength="40" placeholder="${t('Name, z. B. Mein Jupiter', 'Name, e.g. My Jupiter')}">
        <button id="btn-save" type="button">${t('Speichern', 'Save')}</button>
      </div>
      <div class="row row-save">
        <select id="save-list"></select>
        <button id="btn-load" type="button">${t('Laden', 'Load')}</button>
        <button id="btn-delete" type="button" aria-label="${t('Gespeicherten Stand löschen', 'Delete saved state')}">✕</button>
      </div>
      <div class="row row-save">
        <input id="code-in" type="text" placeholder="${t('Planeten-Code einfügen', 'Paste planet code')}">
        <button id="btn-code-load" type="button">${t('Laden', 'Load')}</button>
      </div>
      <div class="row row-buttons">
        <button id="btn-code-copy" type="button">${t('Planeten-Code kopieren', 'Copy planet code')}</button>
      </div>
      <p class="note" id="save-msg" aria-live="polite"></p>`;
    this.panel.custom(box);
    const $ = <T extends HTMLElement>(id: string) => box.querySelector('#' + id) as T;
    const msg = (text: string) => { $('save-msg').textContent = text; };
    const fill = () => {
      const sel = $<HTMLSelectElement>('save-list');
      const list = this.loadSaves();
      sel.innerHTML = list.length ? '' : `<option value="">${t('noch nichts gespeichert', 'nothing saved yet')}</option>`;
      list.forEach((e, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = e.name; sel.append(o); });
    };
    fill();
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-redo').addEventListener('click', () => this.redo());
    $('btn-save').addEventListener('click', () => {
      const input = $<HTMLInputElement>('save-name');
      const name = input.value.trim() || `${this.preset.name} · ${new Date().toLocaleString()}`;
      const list = this.loadSaves().filter((e) => e.name !== name);
      list.unshift({ name, code: this.encode(this.snapshot()) });
      this.storeSaves(list.slice(0, 50));
      fill();
      input.value = '';
      msg(t(`Gespeichert: ${name} (nur in diesem Browser).`, `Saved: ${name} (in this browser only).`));
    });
    $('btn-load').addEventListener('click', () => {
      const i = Number($<HTMLSelectElement>('save-list').value);
      const e = this.loadSaves()[i];
      if (!e) return;
      this.restore(this.decode(e.code));
      this.remember();
      msg(t(`Geladen: ${e.name}`, `Loaded: ${e.name}`));
    });
    $('btn-delete').addEventListener('click', () => {
      const i = Number($<HTMLSelectElement>('save-list').value);
      const list = this.loadSaves();
      if (!list[i]) return;
      const [gone] = list.splice(i, 1);
      this.storeSaves(list);
      fill();
      msg(t(`Gelöscht: ${gone.name}`, `Deleted: ${gone.name}`));
    });
    $('btn-code-copy').addEventListener('click', () => {
      const code = this.encode(this.snapshot());
      const input = $<HTMLInputElement>('code-in');
      navigator.clipboard.writeText(code)
        .then(() => msg(t('Code kopiert. Einfügen und „Laden“ stellt genau diesen Planeten wieder her.', 'Code copied. Paste it and press “Load” to restore exactly this planet.')))
        .catch(() => { input.value = code; input.select(); msg(t('Code steht im Feld oben, markiert zum Kopieren.', 'The code is in the field above, selected for copying.')); });
    });
    $('btn-code-load').addEventListener('click', () => {
      try {
        this.restore(this.decode($<HTMLInputElement>('code-in').value));
        this.remember();
        msg(t('Planet aus Code geladen.', 'Planet loaded from code.'));
      } catch {
        msg(t('Das ist kein gültiger Planeten-Code. Er beginnt mit FGP1:', 'That is not a valid planet code. It starts with FGP1:'));
      }
    });
    this.updateUndoButtons();
  }

  private jets: Float32Array = new Float32Array(TABLE);

  private centre: [number, number, number] = [0.5, 0.5, 0.5];

  private writeTables() {
    const d = this.simData;
    d.set(this.jets, OFF_JETS);
    const bands = bandTable(this.preset, S.contrast);
    d.set(bands, OFF_BANDS);
    d.set([...hexToLinear(this.preset.cloud), 1], OFF_CLOUD);
    // Mittelfarbe für die Partikel-Schiene, flächengewichtet (cos Breite)
    const c = [0, 0, 0]; let wsum = 0;
    for (let i = 0; i < TABLE; i++) {
      const w = Math.cos((-0.5 + i / (TABLE - 1)) * Math.PI) + 1e-3;
      for (let k = 0; k < 3; k++) c[k] += bands[i * 4 + k] * w;
      wsum += w;
    }
    this.centre = [c[0] / wsum, c[1] / wsum, c[2] / wsum];
  }

  /** Kamerarichtung in Körperkoordinaten (für Partikel im Sichtfeld). */
  private camBody(): Vec3 {
    const cy = Math.cos(this.cam.pitch);
    const eye: Vec3 = [Math.sin(this.cam.yaw) * cy, Math.sin(this.cam.pitch), Math.cos(this.cam.yaw) * cy];
    const m = planetRotation((this.preset.tilt * Math.PI) / 180, this.spin);
    return normalize([
      m[0][0] * eye[0] + m[1][0] * eye[1] + m[2][0] * eye[2],
      m[0][1] * eye[0] + m[1][1] * eye[1] + m[2][1] * eye[2],
      m[0][2] * eye[0] + m[1][2] * eye[1] + m[2][2] * eye[2],
    ]);
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
      S.dyeRes, this.flow.n, S.vortexStrength, S.omega * this.dir(),
      js, S.jetRelax, S.turbulence * js * 0.05, S.turbScale,
      S.confinement, S.drag, S.fineStripes, S.bfecc ? 1 : 0,
      S.bandRelax, S.convection, js * S.stormStrength, list.length,
      S.curlStrength * js, S.curlFreq, S.curlSpeed, S.curlOctaves,
      S.particles, S.lifetime, S.opacity, S.blur,
      // Shader-Rauschen: Planeten-Seed plus Lauf-Seed ("Neu starten" würfelt nur den Lauf neu).
      (S.seed + this.runSeed) % 100000, S.bandWobble, S.stormTint, S.vortexCount,
    ], 0);
    d.set([...this.centre, S.fade], OFF_CENTRE);
    d.set([...this.camBody(), this.lookMode() === 'dye' ? 0 : S.viewFocus], OFF_VIEW);
    d.set([this.lookMode() === 'pure' ? 1 : 0, 0, 0, 0], OFF_MODE);
    list.forEach((s, i) => {
      const la = (s.lat * Math.PI) / 180, lo = (s.lon * Math.PI) / 180;
      d.set([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo), (s.radius * Math.PI) / 180], OFF_STORMS + i * 4);
      d.set([s.sign * s.strength, ...s.color], OFF_INFO + i * 4);
      // Antrieb: Vorlagen-Stürme nur so stark wie "Stürme festhalten" (Curl-Noise hat keine
      // eigene Dynamik, dort immer voll). Neue Stürme: kurzer Stoß, der an- und abschwillt.
      let w = s.kick > 0 ? Math.sin(Math.PI * (1 - s.kick / Math.max(s.life, 1e-3))) : this.flowMode() === 'curl' ? 1 : S.stormHold;
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
    // Konvektion stößt neue Wirbel an. Der Drehsinn folgt der Scherung der Jets an dieser Breite
    // (Hintergrund-Wirbelstärke ζ ≈ −∂U/∂φ): nur ein Wirbel, der mit der Scherung dreht, überlebt
    // sie. Ob daraus ein Antizyklon (weißes Oval) oder Zyklon (dunkle Barke) wird, ergibt sich
    // also aus Windprofil, Halbkugel und Drehrichtung des Planeten, nicht aus einem Würfelwurf.
    if (this.flowMode() === 'fluid' && Math.random() < S.stormSpawn * dt && this.activeStorms().length < MAX_STORMS) {
      const lat = (Math.random() * 2 - 1) * 65;
      const la = (lat * Math.PI) / 180;
      const zeta = -(this.jetAt(la + 0.01) - this.jetAt(la - 0.01));
      const spin = zeta === 0 ? (Math.random() < 0.5 ? 1 : -1) : Math.sign(zeta);
      // Antizyklon: dreht entgegen der Planetenrotation (Nord: im Uhrzeigersinn).
      const anti = spin * (lat >= 0 ? 1 : -1) * this.dir() < 0;
      const band = bandTable(this.preset, S.contrast);
      const row = Math.round(((lat + 90) / 180) * (TABLE - 1)) * 4;
      const color: [number, number, number] = anti
        ? hexToLinear(this.preset.cloud)
        : [band[row] * 0.55, band[row + 1] * 0.5, band[row + 2] * 0.45];
      this.storms.push({
        lat, lon: Math.random() * 360, radius: 1.2 + Math.random() * 2.8,
        sign: spin, strength: 0.5 + Math.random() * 0.6,
        color, kick: S.kickLife, life: S.kickLife,
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
        { binding: 6, resource: (a ?? this.dummy).store },
        { binding: 7, resource: (b ?? this.dummy).store },
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
    if (this.flowMode() === 'fluid') {
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

    const look = this.lookMode();
    if (look === 'dye') {
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
      this.run2D(p2, look === 'pure' ? 'blurFade' : 'blurRelax', nxt, null, cur);
      p2.end();
    }
    return flowSrc;
  }

  // ---------- Hauptschleife ----------

  private last = performance.now();
  private grab: (() => Promise<void>) | null = null;
  private fpsNow = 0;

  frameCount() { return this.frame; }

  /** Das nächste gezeichnete Bild als Canvas (Testmodus: aus der Offscreen-Textur). */
  private grabFrame(): Promise<HTMLCanvasElement> {
    return new Promise((resolve) => {
      this.grab = async () => {
        const c = document.createElement('canvas');
        c.width = canvas.width; c.height = canvas.height;
        const g = c.getContext('2d')!;
        if (this.offscreen) {
          const url = await this.capture();
          const img = new Image();
          img.src = url;
          await img.decode();
          g.drawImage(img, 0, 0);
        } else {
          // Direkt nach dem Zeichnen im selben Task ist der WebGPU-Canvas noch lesbar.
          g.drawImage(canvas, 0, 0);
        }
        resolve(c);
      };
    });
  }

  /**
   * Filmstreifen: mehrere Bilder im Abstand nebeneinander, dazu einfache Messwerte.
   * detail = mittlere |Laplace| der Helligkeit (Feinstruktur), change = mittlere Änderung zum
   * vorigen Bild (Bewegung). Damit lassen sich Bewegung und Schärfe vergleichen, ohne dass
   * jemand Einzelbilder beschreiben muss.
   */
  async filmstrip(o: FilmOptions = {}): Promise<Filmstrip> {
    const frames = o.frames ?? 8, cols = o.cols ?? 4, scale = o.scale ?? 0.5;
    const shots: HTMLCanvasElement[] = [];
    const stats: { t: number; frame: number; fps: number; detail: number; change: number }[] = [];
    let prev: Uint8ClampedArray | null = null;
    let w = 0, h = 0;   // Zellgröße aus dem ersten Bild, auch wenn sich die Render-Auflösung ändert
    for (let k = 0; k < frames; k++) {
      if (k > 0) {
        if (o.everySteps) { const target = this.frame + o.everySteps; while (this.frame < target) await new Promise((r) => setTimeout(r, 30)); }
        else await new Promise((r) => setTimeout(r, (o.everySeconds ?? 2) * 1000));
      }
      const c = await this.grabFrame();
      if (!w) { w = Math.max(1, Math.round(c.width * scale)); h = Math.max(1, Math.round(c.height * scale)); }
      const small = document.createElement('canvas');
      small.width = w; small.height = h;
      const g = small.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(c, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      const L = (i: number) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
      let lap = 0, cnt = 0, diff = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const v = L(i);
        if (v < 8) continue;               // Weltraum nicht mitzählen
        lap += Math.abs(4 * v - L(i - 4) - L(i + 4) - L(i - w * 4) - L(i + w * 4));
        if (prev) diff += Math.abs(v - (0.3 * prev[i] + 0.59 * prev[i + 1] + 0.11 * prev[i + 2]));
        cnt++;
      }
      prev = new Uint8ClampedArray(px);
      stats.push({ t: +this.time.toFixed(2), frame: this.frame, fps: this.fpsNow, detail: +(lap / Math.max(cnt, 1)).toFixed(3), change: +(diff / Math.max(cnt, 1)).toFixed(3) });
      shots.push(small);
    }
    // Kontaktbogen mit Beschriftung
    const rows = Math.ceil(frames / cols), foot = 54;
    const sheet = document.createElement('canvas');
    sheet.width = w * cols; sheet.height = h * rows + foot;
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '13px monospace';
    shots.forEach((c, k) => {
      const x = (k % cols) * w, y = Math.floor(k / cols) * h;
      g.drawImage(c, x, y);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, 230, 20);
      g.fillStyle = '#eee';
      g.fillText(`t=${stats[k].t}s  detail ${stats[k].detail}  Δ ${stats[k].change}`, x + 5, y + 14);
    });
    g.fillStyle = '#ccc';
    const line1 = `${this.preset.name} · ${t('Schiene', 'track')} ${S.track} · ${S.quality} · ${S.velRes}²/${S.dyeRes}² · ${S.particles} ${t('Partikel', 'particles')} · ${this.fpsNow} fps · ${t('Zeitraffer', 'time lapse')} ${S.timeScale}×`;
    const line2 = `jet ${S.jetStrength} · Ω ${S.omega}${S.retro ? ' retro' : ''} · conf ${S.confinement} · turb ${S.turbulence} · bandRelax ${S.bandRelax} · spawn ${S.stormSpawn}/${S.kickLife}s · relief ${S.relief} · v0.3.0`;
    g.fillText(line1, 8, h * rows + 20);
    g.fillText(line2, 8, h * rows + 42);
    return { image: sheet.toDataURL('image/png'), stats };
  }

  private async recordFilmstrip() {
    const msg = (x: string) => { const el = document.getElementById('diag-msg'); if (el) el.textContent = x; };
    const btn = document.getElementById('btn-film') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    msg(t('Nehme 8 Bilder in 14 s auf …', 'Recording 8 frames over 14 s …'));
    try {
      const f = await this.filmstrip({ frames: 8, everySeconds: 2 });
      const a = document.createElement('a');
      a.href = f.image;
      a.download = `fluid-gas-planet-${this.preset.name.replace(/[^\w-]+/g, '-')}-${Date.now()}.png`;
      a.click();
      msg(t('Gespeichert. Das PNG enthält die wichtigsten Einstellungen in der Fußzeile.', 'Saved. The PNG lists the key settings in its footer.'));
    } catch (e) {
      msg(`${t('Aufnahme fehlgeschlagen:', 'Recording failed:')} ${e instanceof Error ? e.message : String(e)}`);
    }
    if (btn) btn.disabled = false;
  }

  /**
   * Misst, ob die Cubemap-Abtastung der Grafikkarte an Würfelkanten nahtlos ist: ein glattes
   * Testfeld wird geschrieben und zwischen den Texelzentren wieder abgetastet.
   */
  async selftest(): Promise<{ edge: number; interior: number; seamless: boolean }> {
    const d = this.device, n = 256;
    const common = commonWGSL.slice(0, commonWGSL.indexOf('// Richtung -> (st in [0,1]²'));
    const fld = 'fn fld(p: vec3f) -> f32 { return sin(p.x * 9.0) * 0.5 + p.y * 0.3; }';
    const strip = common.replace(/@group\(0\) @binding\(0\) var<uniform> S: Sim;/, '');
    const tex = d.createTexture({ size: [n, n, 6], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    const fill = d.createComputePipeline({ layout: 'auto', compute: { entryPoint: 'main', module: d.createShaderModule({ code: strip + fld + `
      @group(0) @binding(0) var dst: texture_storage_2d_array<rgba16float, write>;
      @compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) id: vec3u) {
        textureStore(dst, id.xy, id.z, vec4f(fld(faceDir(id.z, (vec2f(id.xy) + 0.5) / ${n}.0)), 0.0, 0.0, 1.0));
      }` }) } });
    const test = d.createComputePipeline({ layout: 'auto', compute: { entryPoint: 'main', module: d.createShaderModule({ code: strip + fld + `
      @group(0) @binding(0) var t: texture_cube<f32>;
      @group(0) @binding(1) var s: sampler;
      @group(0) @binding(2) var<storage, read_write> o: array<atomic<u32>, 4>;
      @compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) id: vec3u) {
        let st = (vec2f(id.xy) + vec2f(0.37, 0.61)) / ${n}.0;
        let p = faceDir(id.z, st);
        let e = u32(abs(textureSampleLevel(t, s, p, 0.0).r - fld(p)) * 1e6);
        if (min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y)) * ${n}.0 < 1.5) { atomicMax(&o[0], e); } else { atomicMax(&o[1], e); }
      }` }) } });
    const out = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rd = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    const ps = e.beginComputePass();
    ps.setPipeline(fill);
    ps.setBindGroup(0, d.createBindGroup({ layout: fill.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView({ dimension: '2d-array' }) }] }));
    ps.dispatchWorkgroups(n / 8, n / 8, 6);
    ps.setPipeline(test);
    ps.setBindGroup(0, d.createBindGroup({ layout: test.getBindGroupLayout(0), entries: [
      { binding: 0, resource: tex.createView({ dimension: 'cube' }) },
      { binding: 1, resource: d.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
      { binding: 2, resource: { buffer: out } }] }));
    ps.dispatchWorkgroups(n / 8, n / 8, 6);
    ps.end();
    e.copyBufferToBuffer(out, 0, rd, 0, 16);
    d.queue.submit([e.finish()]);
    await rd.mapAsync(GPUMapMode.READ);
    const r = new Uint32Array(rd.getMappedRange().slice(0));
    rd.destroy(); out.destroy(); tex.destroy();
    const edge = r[0] / 1e6, interior = r[1] / 1e6;
    // Bilineare Interpolation hat an Kanten natürlicherweise etwas mehr Fehler (gekrümmte Fläche);
    // eine echte Naht liegt um Größenordnungen darüber (SwiftShader: 0,139 gegen 0,0003).
    return { edge, interior, seamless: edge < Math.max(0.01, interior * 20) };
  }

  private async runSelftest() {
    const el = document.getElementById('diag-msg');
    const r = await this.selftest();
    if (!r.seamless && !S.seamless) { S.seamless = true; this.buildPipes(true); this.panel.refresh(); this.remember(); }
    if (el) el.textContent = r.seamless
      ? t(`Nahtlos: Fehler an Kanten ${r.edge.toFixed(4)}, innen ${r.interior.toFixed(4)}. „Exakte Kanten“ ist nicht nötig. Sichtbare Übergänge kommen dann nicht von der Abtastung (siehe docs/STATUS.md).`,
        `Seamless: error at edges ${r.edge.toFixed(4)}, inside ${r.interior.toFixed(4)}. “Exact edges” is not needed. Visible transitions then do not come from sampling (see docs/STATUS.md).`)
      : t(`Naht gefunden: Fehler an Kanten ${r.edge.toFixed(4)}, innen ${r.interior.toFixed(4)}. „Exakte Kanten“ ist jetzt an.`,
        `Seam found: error at edges ${r.edge.toFixed(4)}, inside ${r.interior.toFixed(4)}. “Exact edges” is now on.`);
  }
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
          const lapse = S.timeScale !== 1 ? ` · ${t('Zeitraffer', 'time lapse')} ${this.achieved.toFixed(1)}×` : '';
          this.fpsNow = Math.round(this.fpsFrames / this.fpsAcc);
          fpsEl.textContent = `${this.fpsNow} fps${lapse}`;
          this.fpsAcc = 0; this.fpsFrames = 0;
        }
        this.frameOnce(real);
        this.adaptScale(real);
        // Filmstreifen: das eben gezeichnete Bild abgreifen, solange es noch gültig ist.
        if (this.grab) { const g = this.grab; this.grab = null; await g(); }
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
    this.warm = this.needsInit ? this.warmSteps : Math.max(this.warm, Math.min(300, this.warmSteps));
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
    // Schnelle GPU erkannt (Schritt < 2 ms bei Laptop/Desktop-Stufe): Reglergrenzen der
    // High-End-Klasse freischalten, ohne die aktuellen Werte (und damit den Look) zu ändern.
    if (!isPhone && !this.offscreen && this.stepMs < 2 && (S.quality === 'standard' || S.quality === 'high')) {
      S.quality = 'ultra';
      this.dpr = QUALITY.ultra.dpr;
      this.buildUI();
      loadNote.textContent = t('Schnelle Grafikkarte erkannt: High-End-Grenzen freigeschaltet (bis 32 Mio. Partikel).', 'Fast GPU detected: high-end limits unlocked (up to 32 M particles).');
      return;
    }
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
    let flowSrc = this.flowMode() === 'fluid' ? this.vel[this.vc] : this.flow;
    let n = 0;
    if (!S.paused) {
      // Die Simulation läuft in Echtzeit: 60 Schritte pro Sekunde mal Zeitraffer, unabhängig von
      // der Bildrate (bis v0.2.3 war es ein Schritt pro Bild, bei 240 fps lief alles viermal so
      // schnell). Jeder Schritt ist gleich groß, der Zeitraffer ändert also nicht die Physik,
      // sondern nur, wie viel Simulationszeit pro Sekunde vergeht. Im Testmodus: fester Takt.
      this.stepAcc += this.offscreen ? S.timeScale : real * 60 * S.timeScale;
      // Obergrenze aus der gemessenen Schrittzeit, damit das Bild flüssig bleibt.
      const cap = Math.max(1, Math.min(64, Math.floor(12 / Math.max(this.stepMs, 0.1))));
      n = Math.min(Math.floor(this.stepAcc), cap);
      this.stepAcc = Math.min(this.stepAcc - n, 2);
      for (let k = 0; k < n; k++) flowSrc = this.submitStep();
    }
    this.achieved = this.achieved * 0.97 + (real > 0 ? (n / 60 / real) : 0) * 0.03;
    // Sichtbare Drehung in Simulationszeit: Zeitraffer beschleunigt Wolken und Drehung gleich.
    this.spin += n * DT * 0.08 * S.spinSpeed * (9.93 / this.preset.rotationHours) * this.dir();
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
    const n = (v: number) => (v >= 1e6 ? `${(v / 1048576).toFixed(v % 1048576 ? 2 : 0)} ${t('Mio.', 'M')}` : v >= 1e3 ? `${Math.round(v / 1024)} k` : String(v));
    // Formel unter dem Erklärtext: was im Code wirklich gerechnet wird.
    const fx = (f: string) => `<code class="fx">${f}</code>`;
    const presetName = (name: string) => ({ Neptun: t('Neptun', 'Neptune'), 'Heißer Jupiter': t('Heißer Jupiter', 'Hot Jupiter') } as Record<string, string>)[name] ?? name;
    const lim = (QUALITY[S.quality] ?? QUALITY.standard).max;

    this.panel = new Panel(root, S as unknown as Record<string, number | string | boolean>, on, DEFAULTS as unknown as Record<string, number | string | boolean>);
    this.panel
      .section('Planet')
      .select('preset', t('Vorlage', 'Preset'), [...presets.map((p) => [p.name, presetName(p.name)] as [string, string]), ['Zufall', t('Zufallsplanet', 'Random planet')]],
        t('Lädt Windprofil, Farbbänder, Stürme, Abplattung und Ringe eines Planeten. Alles sind Zahlen, keine Bilder.',
          'Loads a planet’s wind profile, colour bands, storms, oblateness and rings. All numbers, no images.'))
      .select('quality', t('Gerät', 'Device'), [
        ['phone', t('Smartphone', 'Smartphone')],
        ['standard', t('Laptop / integrierte GPU', 'Laptop / integrated GPU')],
        ['high', t('Desktop-GPU', 'Desktop GPU')],
        ['ultra', t('High-End-GPU (z. B. RTX 4080/5080)', 'High-end GPU (e.g. RTX 4080/5080)')],
      ],
        t('Setzt Gitter, Farbauflösung, Partikelzahl und Pixeldichte passend zum Gerät und legt fest, wie weit die Regler gehen. „High-End“ schaltet bis 32 Mio. Partikel, 2048² Farbauflösung und volle Bildschirmauflösung frei.',
          'Sets grid, colour resolution, particle count and pixel density for the device, and how far the controls go. “High-end” unlocks up to 32 M particles, 2048² colour resolution and full screen resolution.'))
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
          this.remember();
          const info = document.getElementById('planet-info');
          if (info) info.textContent = `${this.preset.name} · ${t('Farben aus', 'colours from')} ${f.name}`;
        }).catch(() => fail(t('<b>Das Bild ließ sich nicht lesen.</b> Nimm ein JPG, PNG oder WebP.', '<b>Could not read the image.</b> Use a JPG, PNG or WebP.'))))
      .buttons([
        ['btn-reset', t('Neuer Lauf', 'New run'), () => { this.runSeed = Math.floor(Math.random() * 100000); this.needsInit = true; }],
        ['btn-warm', t('⏩ 20 s vorspulen', '⏩ Skip 20 s'), () => { this.warm = WARM_STEPS; this.warmTotal = WARM_STEPS; showLoading(true); }],
        ['btn-defaults', t('Regler zurücksetzen', 'Reset controls'), () => this.resetSettings()],
        ['btn-pause', S.paused ? t('Weiter', 'Resume') : 'Pause', () => { S.paused = !S.paused; (document.getElementById('btn-pause') as HTMLButtonElement).textContent = S.paused ? t('Weiter', 'Resume') : 'Pause'; }],
      ], {
        'btn-reset': t('Gleicher Planet, gleiche Regler, aber neu gewürfelte Turbulenz: ein neuer Anlauf der Simulation. So siehst du, was an einem Bild Zufall ist und was aus den Reglern folgt.',
          'Same planet, same controls, freshly rolled turbulence: a new run of the simulation. Shows what in a picture is chance and what follows from the controls.'),
        'btn-warm': t('Rechnet 20 Sekunden Simulationszeit ohne Bild voraus (hinter dem Ladebalken). Nach dem Verstellen eines Reglers ist so sofort der eingeschwungene Zustand zu sehen.',
          'Computes 20 seconds of simulation time without drawing (behind the loading bar). After changing a control you see the settled state right away.'),
        'btn-defaults': t('Alle Regler auf die Standardwerte, Planet und Gerät bleiben.', 'All controls back to defaults; planet and device stay.'),
      })
      .section(t('Zufallsplanet', 'Random planet'), t('Würfelt einen neuen Planeten. Mit den Vorgaben lenkst du den Zufall; „egal“ lässt ihn frei. Gleicher Seed und gleiche Vorgaben ergeben immer denselben Planeten.',
        'Rolls a new planet. The options steer the dice; “any” leaves them free. Same seed and same options always give the same planet.'), S.preset === 'Zufall')
      .select('rndFamily', t('Familie', 'Family'), [['', t('egal', 'any')], ['jovian', t('jupiterartig', 'Jupiter-like')], ['saturnian', t('saturnartig', 'Saturn-like')], ['ice', t('Eisriese', 'ice giant')], ['hot', t('heißer Jupiter', 'hot Jupiter')], ['exotic', t('exotisch', 'exotic')]],
        t('Bestimmt Farbraum, Bandzahl, Stärke des Äquatorjets und Stimmung.', 'Sets colour range, band count, equatorial jet strength and mood.'))
      .range('rndBands', t('Bänder', 'Bands'), 0, 30, 1,
        t('Anzahl der Farbbänder und Jets. 0 = würfeln. Physikalisch hängt sie von Rotation, Größe und Windstärke ab (Rhines-Skala).',
          'Number of colour bands and jets. 0 = roll. Physically it depends on rotation, size and wind speed (Rhines scale).') + fx('L<sub>β</sub> = π·√(2U/β),  β = 2Ω·cos φ / R'), (v) => (v === 0 ? t('Zufall', 'roll') : String(v)))
      .select('rndStorms', t('Stürme', 'Storms'), [['auto', t('egal', 'any')], ['none', t('keine', 'none')], ['few', t('wenige', 'few')], ['many', t('viele', 'many')]],
        t('Wie viele Stürme die Vorlage mitbringt. Neue entstehen zusätzlich über „Neue Stürme“.', 'How many storms the preset brings. More can form via “New storms”.'))
      .select('rndRings', t('Ringe', 'Rings'), [['auto', t('egal', 'any')], ['yes', t('ja', 'yes')], ['no', t('nein', 'no')]], t('Ringe erzwingen oder verbieten.', 'Force or forbid rings.'))
      .buttons([
        ['btn-seed', t('🎲 Neuer Zufallsplanet', '🎲 New random planet'), () => { S.preset = 'Zufall'; S.seed = newSeed(); this.applyPreset(); this.panel.refresh(); this.remember(); }],
      ])
      .section(t('Verfahren', 'Method'), t('Drei getrennte Schienen. Sie teilen sich nur Kugel und Licht; was du an einer Schiene verstellst, verändert die anderen nicht.',
        'Three separate tracks. They share only the sphere and the lighting; tuning one track does not change the others.'))
      .select('track', t('Schiene', 'Track'), [
        ['fluid', t('Flüssigkeit: Stable Fluids + Farbstoff (mofu)', 'Fluid: Stable Fluids + dye (mofu)')],
        ['particles', t('Partikel: Curl-Noise + Partikel (jasper-r)', 'Particles: curl noise + particles (jasper-r)')],
        ['hybrid', t('Mischform: frei kombinieren (Experiment)', 'Hybrid: combine freely (experiment)')],
      ],
        t('Flüssigkeit: löst die Strömungsgleichung (Druck, Coriolis, Wirbel), die Wolkenfarbe wird mitgeführt und zur Bandfarbe zurückgezogen. Partikel: wie jasper-r, Millionen Partikel fliegen durch ein Curl-Noise-Feld, tragen die Farbe ihres Geburtsbreitengrads und malen sie in eine Textur, die zu einer Mittelfarbe verblasst. Keine Physik, dafür feine Schlieren. Mischform: Strömung und Darstellung einzeln wählbar (Stand v0.2).',
          'Fluid: solves the flow equations (pressure, Coriolis, vortices); cloud colour is carried along and pulled back to the band colour. Particles: as in jasper-r, millions of particles fly through a curl-noise field, carry the colour of their birth latitude and paint it into a texture that fades to one mean colour. No physics, but fine streaks. Hybrid: flow and look chosen separately (v0.2 behaviour).'))
      .select('flow', t('Strömung', 'Flow'), [['fluid', 'Stable Fluids (mofu)'], ['curl', 'Curl noise (jasper-r)']],
        t('Nur Mischform. Woher der Wind kommt: aus der Strömungsgleichung oder aus dem Rauschfeld.', 'Hybrid only. Where the wind comes from: the flow equations or the noise field.'))
      .select('look', t('Darstellung', 'Look'), [['dye', t('Farbstoff', 'Dye')], ['particles', t('Partikel', 'Particles')]],
        t('Nur Mischform. Wie die Wolken dem Wind folgen. „Partikel“ hier nutzt die Band-Rückstellung des Farbstoffs und sieht deshalb nicht wie jasper-r aus; das reine Verfahren ist die Schiene „Partikel“.',
          'Hybrid only. How clouds follow the wind. “Particles” here uses the dye’s band restoring and therefore does not look like jasper-r; the pure method is the “Particles” track.'))
      .range('timeScale', t('Zeitraffer', 'Time lapse'), 0.25, 16, 0.25,
        t('Wie viel Simulationszeit pro echter Sekunde vergeht. Die Schrittweite bleibt fest, es werden nur mehr Schritte gerechnet: gleiche Physik, gleicher Endzustand, nur schneller erreicht. Wolken und Drehung laufen gemeinsam schneller. Die Anzeige oben links zeigt, wie viel deine GPU schafft.',
          'How much simulated time passes per real second. The step size stays fixed; only more steps are computed: same physics, same settled state, just reached sooner. Clouds and spin speed up together. The readout top left shows what your GPU achieves.') + fx(t('Δt = 1/60 s fest · Schritte pro Sekunde = 60 · Zeitraffer', 'Δt = 1/60 s fixed · steps per second = 60 · time lapse')), (v) => `${v.toFixed(2)}×`)
      .section(t('Wind und Physik', 'Wind and physics'), t('Schiene „Flüssigkeit“. Die Gleichung dahinter (2D, inkompressibel, auf der Kugel):', 'Track “Fluid”. The equation behind it (2D, incompressible, on the sphere):') )
      .custom(this.formulaNote(t('∂u/∂t + (u·∇)u = −∇p − f k̂×u + F<sub>Jet</sub> + F<sub>Sturm</sub> + ε·F<sub>Wirbel</sub> − r·u,   ∇·u = 0', '∂u/∂t + (u·∇)u = −∇p − f k̂×u + F<sub>jet</sub> + F<sub>storm</sub> + ε·F<sub>vortex</sub> − r·u,   ∇·u = 0')))
      .range('jetStrength', t('Jet-Stärke', 'Jet strength'), 0, 0.2, 0.002,
        t('Spitzengeschwindigkeit der Ost-West-Winde in Planetenradien pro Sekunde. Skaliert auch Stürme und Turbulenz.',
          'Peak east–west wind speed in planet radii per second. Also scales storms and turbulence.') + fx(t('U(φ) = U<sub>max</sub> · Profil(φ)', 'U(φ) = U<sub>max</sub> · profile(φ)')), f3)
      .range('jetRelax', t('Jet-Rückstellung', 'Jet restoring'), 0, 2, 0.01,
        t('Zieht nur das Breitenkreis-Mittel des Ostwinds zum Windprofil zurück; Wirbel bleiben frei. 0 = die Bänder zerfallen mit der Zeit.',
          'Pulls only the latitude-circle mean of the east wind back to the profile; vortices stay free. 0 = bands decay over time.') + fx('u += ê<sub>E</sub> · (U(φ) − ⟨u·ê<sub>E</sub>⟩<sub>φ</sub>) · k·Δt'), f2)
      .range('omega', t('Coriolis (Rotation)', 'Coriolis (rotation)'), 0, 30, 0.05,
        t('Planetenrotation Ω in der Strömungsgleichung. Wirksam ist vor allem ihr Nord-Süd-Gefälle β: es erzeugt Rossby-Wellen und ordnet Turbulenz zu Bändern. Das Verhältnis Wind zu Rotation (Rossby-Zahl) entscheidet, ob es wie eine Teetasse (groß) oder wie ein Planet (klein) aussieht: Jupiter hat Ro ≈ 0,01 bis 0,1, Standard 0,4 ergibt Ro ≈ 0,15 im großen Maßstab.',
          'Planet rotation Ω in the flow equation. What matters most is its north–south gradient β: it creates Rossby waves and organises turbulence into bands. The ratio of wind to rotation (Rossby number) decides whether it looks like a teacup (large) or a planet (small): Jupiter has Ro ≈ 0.01 to 0.1; the default 0.4 gives Ro ≈ 0.15 at planet scale.') + fx('u′ = u·cos a + (p×u)·sin a,  a = −2Ω·sin φ·Δt;  Ro = U / (2Ω·L)'), f2)
      .toggle('retro', t('Rückläufige Drehung', 'Retrograde spin'),
        t('Dreht Planet und Physik andersherum (wie Venus). Dann drehen Zyklone auf der Nordhalbkugel im Uhrzeigersinn, alle Jets und Stürme spiegeln sich. Normal (aus): von Norden gesehen gegen den Uhrzeigersinn, Nord-Zyklone gegen den Uhrzeigersinn, Süd-Zyklone im Uhrzeigersinn. (Bei Toiletten ist Coriolis dagegen viel zu schwach: Ro ≈ 1000.)',
          'Spins planet and physics the other way (like Venus). Then northern cyclones turn clockwise, and all jets and storms are mirrored. Normal (off): counter-clockwise seen from the north, northern cyclones counter-clockwise, southern ones clockwise. (For toilets Coriolis is far too weak: Ro ≈ 1000.)') + fx(t('Ω → −Ω,  U(φ) → −U(φ),  Drehsinn → −Drehsinn', 'Ω → −Ω,  U(φ) → −U(φ),  spin → −spin')))
      .range('turbulence', t('Turbulenz', 'Turbulence'), 0, 3, 0.01,
        t('Kleine, langsam wandernde Anstöße (divergenzfreies Rauschen). Sie lösen die Scherinstabilitäten an den Jet-Rändern aus.',
          'Small, slowly drifting kicks (divergence-free noise). They trigger shear instabilities at jet edges.') + fx(t('u += (p × ∇ψ<sub>Rauschen</sub>) · Stärke · Δt', 'u += (p × ∇ψ<sub>noise</sub>) · strength · Δt')), f2)
      .range('turbScale', t('Turbulenz-Größe', 'Turbulence scale'), 1, 20, 0.5,
        t('Frequenz des Anstoß-Rauschens: klein = wenige große Wirbel, groß = viele feine.', 'Frequency of the kick noise: low = a few big eddies, high = many fine ones.'), (v) => v.toFixed(1))
      .range('confinement', t('Wirbelverstärkung', 'Vorticity confinement'), 0, 8, 0.05,
        t('Gibt Wirbeln die Energie zurück, die das grobe Gitter wegschmiert, vor allem den kleinsten. Standard 6 = lebendiger Look von v0.1; physikalisch sauberer ist etwa 0,5.',
          'Gives vortices back the energy the coarse grid smears away, mostly the smallest. Default 6 = lively v0.1 look; physically cleaner is about 0.5.') + fx('F = ε·Δx·(N × ζp̂),  N = ∇|ζ| / |∇|ζ||'), f2)
      .range('drag', t('Reibung', 'Drag'), 0, 0.5, 0.005, t('Bremst den ganzen Wind gleichmäßig ab.', 'Slows the whole wind field uniformly.') + fx('u ← u / (1 + r·Δt)'), f3)
      .range('iterations', t('Druck-Iterationen', 'Pressure iterations'), 2, 80, 1,
        t('Jacobi-Schritte für die Druckgleichung. Mehr = sauberer divergenzfrei, aber teurer. Der wichtigste Leistungsregler.',
          'Jacobi steps for the pressure equation. More = closer to divergence-free, but slower. The most important performance control.') + fx('∇²p = ∇·u,  u ← u − ∇p'))
      .range('velRes', t('Gitter je Würfelfläche', 'Grid per cube face'), 32, lim.velRes, 16,
        t('Auflösung des Windgitters: 6 × N × N Zellen auf der Kugel. Kosten wachsen mit N².', 'Wind grid resolution: 6 × N × N cells on the sphere. Cost grows with N².'), (v) => `${v}²`)
      .toggle('bfecc', t('BFECC-Advektion', 'BFECC advection'),
        t('Fehlerkorrektur beim Mitführen: vor, zurück, halben Fehler abziehen. Schärfere Wirbel und Kanten.',
          'Error correction during transport: back, forth, subtract half the error. Sharper vortices and edges.') + fx('x̃ = x − ½(back(forth(x)) − x)'))
      .section('Curl noise', t('Schiene „Partikel“ (und Mischform). Rezept von jasper-r und Gaseous Giganticus: Wind = Jets + Curl-Noise + Wirbel.',
        'Track “Particles” (and hybrid). Recipe from jasper-r and Gaseous Giganticus: wind = jets + curl noise + vortices.'), false)
      .custom(this.formulaNote(t('v = ê<sub>Ost</sub>·U(φ) + p × ∇ψ + Σ Wirbel,   ψ = Σ<sub>k</sub> ½<sup>k</sup> · Rauschen(2<sup>k</sup> f · p, t)', 'v = ê<sub>E</sub>·U(φ) + p × ∇ψ + Σ vortices,   ψ = Σ<sub>k</sub> ½<sup>k</sup> · noise(2<sup>k</sup> f · p, t)')))
      .range('curlStrength', t('Stärke', 'Strength'), 0, 3, 0.01, t('Wie stark das Rauschfeld gegenüber den Jets ist.', 'Strength of the noise field relative to the jets.'), f2)
      .range('curlFreq', t('Frequenz', 'Frequency'), 1, 16, 0.1, t('Grundfrequenz f des Rauschens: hoch = viele kleine Wirbel.', 'Base frequency f of the noise: high = many small swirls.'), (v) => v.toFixed(1))
      .range('curlSpeed', t('Veränderung', 'Evolution'), 0, 0.5, 0.005, t('Wie schnell sich das Rauschfeld mit der Zeit umbaut.', 'How fast the noise field changes over time.'), f3)
      .range('curlOctaves', t('Oktaven', 'Octaves'), 1, 6, 1, t('Anzahl überlagerter Rausch-Ebenen k. Mehr = feinere Details.', 'Number of stacked noise layers k. More = finer detail.'))
      .range('vortexCount', t('Wirbel', 'Vortices'), 0, 128, 1,
        t('Eingestreute Wirbel (Gaseous Giganticus). Nur wo die Jets schwach sind, und nur mit dem Drehsinn der lokalen Scherung, sonst würden sie zerrissen.',
          'Seeded vortices (Gaseous Giganticus). Only where jets are weak, and only with the spin of the local shear, otherwise they would be torn apart.') + fx(t('ω(d) = ω₀·sin(π·d/r),  Drehsinn = sign(−∂U/∂φ)', 'ω(d) = ω₀·sin(π·d/r),  spin = sign(−∂U/∂φ)')))
      .range('vortexStrength', t('Wirbel-Stärke', 'Vortex strength'), 0, 4, 0.05, t('Drehgeschwindigkeit ω₀ der eingestreuten Wirbel relativ zur Jet-Stärke.', 'Spin ω₀ of the seeded vortices relative to jet strength.'), f2)
      .range('curlRes', t('Feinheit Strömungsfeld', 'Flow field resolution'), 64, lim.curlRes, 64,
        t('Auflösung des Strömungsfelds je Würfelfläche. Gaseous Giganticus nutzt 2048. Feiner = feinere Filamente.',
          'Flow field resolution per cube face. Gaseous Giganticus uses 2048. Finer = finer filaments.'), (v) => `${v}²`)
      .section(t('Partikel', 'Particles'), t('Schiene „Partikel“ (und Mischform „Partikel“). Jeder Partikel bewegt sich mit dem Wind und mischt seine Farbe in die Textur:',
        'Track “Particles” (and hybrid “Particles”). Each particle moves with the wind and blends its colour into the texture:'), false)
      .custom(this.formulaNote(t('p ← normalize(p + v(p + v·Δt/2)·Δt),   c<sub>Texel</sub> ← mix(c<sub>Texel</sub>, c<sub>Partikel</sub>, α·sin(π·Alter/Lebensdauer))', 'p ← normalize(p + v(p + v·Δt/2)·Δt),   c<sub>texel</sub> ← mix(c<sub>texel</sub>, c<sub>particle</sub>, α·sin(π·age/lifetime))')))
      .range('particles', t('Anzahl', 'Count'), 16384, lim.particles, 16384,
        t('Anzahl der Partikel. jasper-r: 4 Mio. bei 80 fps. Handys schaffen etwa 0,25 bis 1 Mio., eine RTX 5080 deutlich über 16 Mio. Obergrenze je nach „Gerät“.',
          'Number of particles. jasper-r: 4 M at 80 fps. Phones manage about 0.25 to 1 M, an RTX 5080 well over 16 M. Upper limit depends on “Device”.'), n)
      .range('lifetime', t('Lebensdauer', 'Lifetime'), 0.5, 60, 0.5,
        t('Sekunden bis zur Neugeburt. Lang = lange Schlieren. Bei 60 leben Partikel ewig (Gaseous Giganticus).',
          'Seconds until rebirth. Long = long streaks. At 60 particles live forever (Gaseous Giganticus).'), (v) => (v >= 60 ? t('ewig', 'forever') : `${v.toFixed(1)} s`))
      .range('opacity', t('Deckkraft', 'Opacity'), 0.01, 1, 0.01, t('α: wie stark ein Partikel seine Farbe in die Textur schreibt.', 'α: how strongly a particle writes its colour into the texture.'), pct)
      .range('blur', t('Weichzeichnen', 'Blur'), 0, 1, 0.01, t('Verwischt die Textur jedes Bild ein wenig, damit aus Punkten Wolken werden.', 'Blurs the texture slightly every frame so points become clouds.') + fx(t('c ← mix(c, Mittel der 4 Nachbarn, b)', 'c ← mix(c, mean of 4 neighbours, b)')), pct)
      .range('fade', t('Verblassen', 'Fade'), 0, 1, 0.005,
        t('Nur Schiene „Partikel“: wie schnell die Textur zu einer einzigen Mittelfarbe verblasst (jasper-r). Die Bänder entstehen dann allein aus den Partikeln.',
          'Track “Particles” only: how fast the texture fades to one mean colour (jasper-r). Bands then come from the particles alone.') + fx(t('c ← mix(c, c<sub>Mittel</sub>, 1 − e<sup>−k·Δt</sup>)', 'c ← mix(c, c<sub>mean</sub>, 1 − e<sup>−k·Δt</sup>)')), f3)
      .range('viewFocus', t('Sichtfeld-Anteil', 'View focus'), 0, 0.95, 0.05,
        t('Anteil der Partikel, die auf der sichtbaren Seite geboren werden. Bei 0,8 landen 80 % der Rechenarbeit dort, wo du hinschaust: schärfer beim Heranzoomen, gleiche Kosten. Die Rückseite verblasst dann langsamer als sie bemalt wird; zu hoch gewählt wirkt sie beim Drehen blasser.',
          'Share of particles born on the visible side. At 0.8, 80 % of the work lands where you look: sharper when zooming in, same cost. The far side then gets painted less; set too high it looks paler when it turns into view.'), pct)
      .section(t('Wolken und Stürme', 'Clouds and storms'), t('Schiene „Flüssigkeit“ (Farbe) und Stürme. Die Farbe folgt dem Wind und kehrt langsam zur Bandfarbe zurück:',
        'Track “Fluid” (colour) and storms. Colour follows the wind and slowly returns to the band colour:'))
      .custom(this.formulaNote(t('c(p) ← mix(c(p − u·Δt), c<sub>Band</sub>(φ + Mäander), 1 − e<sup>−k·Δt</sup>)', 'c(p) ← mix(c(p − u·Δt), c<sub>band</sub>(φ + meander), 1 − e<sup>−k·Δt</sup>)')))
      .range('bandRelax', t('Band-Rückstellung', 'Band restoring'), 0, 0.5, 0.005,
        t('k: wie schnell die Farbe zum Band ihrer Breite zurückkehrt. 0 = alles vermischt sich zu Brei, hoch = starre Streifen. Zeitkonstante 1/k: bei 0,06 etwa 17 s, so lange dauert es auch, bis eine Änderung eingeschwungen ist.',
          'k: how fast colour returns to its latitude’s band. 0 = everything mixes into mush, high = rigid stripes. Time constant 1/k: about 17 s at 0.06, which is also how long a change takes to settle.'), f3)
      .range('fineStripes', t('Feinstreifen', 'Fine stripes'), 0, 2, 0.05,
        t('Feine Farbstreifen innerhalb der Bänder. Erst sie machen sichtbar, wie die Strömung Farbe zu Filamenten zieht.',
          'Fine colour stripes inside the bands. They make it visible how the flow pulls colour into filaments.'), f2)
      .range('bandWobble', t('Band-Mäander', 'Band meander'), 0, 3, 0.05, t('Verbiegt die Bandgrenzen mit Rauschen.', 'Bends band edges with noise.') + fx(t('φ′ = φ + Rauschen(4p) · m · 0,04', 'φ′ = φ + noise(4p) · m · 0.04')), f2)
      .range('contrast', t('Band-Kontrast', 'Band contrast'), 0, 2.5, 0.05, t('Farbunterschied zwischen hellen Zonen und dunklen Gürteln.', 'Colour difference between bright zones and dark belts.') + fx(t('c = c̄ + (c − c̄) · Kontrast', 'c = c̄ + (c − c̄) · contrast')), f2)
      .range('convection', t('Konvektion', 'Convection'), 0, 4, 0.05, t('Helle Wolkentürme, die aus der Tiefe aufsteigen (Ammoniak-Eis).', 'Bright cloud towers rising from below (ammonia ice).'), f2)
      .toggle('storms', t('Vorlagen-Stürme', 'Preset storms'),
        t('Setzt die bekannten Stürme der Vorlage (z. B. Großer Roter Fleck) beim Start als Wirbel ein.',
          'Seeds the preset’s known storms (e.g. the Great Red Spot) as vortices at start.') + fx(t('v(d) = 2,33 · x·e<sup>−x²</sup>,  x = d / r', 'v(d) = 2.33 · x·e<sup>−x²</sup>,  x = d / r')))
      .range('stormHold', t('Stürme festhalten', 'Hold storms'), 0, 1, 0.01,
        t('Treibt die Vorlagen-Stürme dauerhaft an. 0 = reine Physik (sie dürfen treiben, verschmelzen, vergehen), 1 = wie ein Beobachtungsdatum festgehalten.',
          'Keeps driving the preset storms. 0 = pure physics (they may drift, merge, fade), 1 = enforced like observation data.') + fx(t('u += (v<sub>Sturm</sub> − u) · 2·w·Maske·Δt', 'u += (v<sub>storm</sub> − u) · 2·w·mask·Δt')), pct)
      .range('stormSpawn', t('Neue Stürme', 'New storms'), 0, 2, 0.01,
        t('Wie oft Konvektion einen neuen Wirbel anstößt (pro Sekunde Simulationszeit). Der Drehsinn folgt der Scherung an der Stelle, denn nur ein mitdrehender Wirbel überlebt sie. In antizyklonalen Zonen entstehen so weiße Ovale, in zyklonalen Gürteln dunkle Barken.',
          'How often convection kicks off a new vortex (per second of simulated time). Its spin follows the local shear, because only a co-rotating vortex survives it. Anticyclonic zones grow white ovals, cyclonic belts dark barges.') + fx(t('Drehsinn = sign(ζ<sub>Hintergrund</sub>),  ζ ≈ −∂U/∂φ', 'spin = sign(ζ<sub>background</sub>),  ζ ≈ −∂U/∂φ')), f2)
      .range('kickLife', t('Anstoß-Dauer', 'Kick duration'), 0.5, 30, 0.5,
        t('Wie lange ein neuer Sturm angetrieben wird, bevor er frei ist. Kurz = kurzes Aufflackern. Lang = er wächst zu einem großen Wirbel heran und lebt dann von der Physik: er treibt mit dem Jet, verschmilzt oder zerfällt.',
          'How long a new storm is driven before it is free. Short = a brief flicker. Long = it grows into a big vortex and then lives on physics: drifts with the jet, merges or decays.') + fx(t('w(t) = sin(π · t / Dauer)', 'w(t) = sin(π · t / duration)')), (v) => `${v.toFixed(1)} s`)
      .range('stormStrength', t('Sturm-Stärke', 'Storm strength'), 0, 4, 0.05, t('Drehgeschwindigkeit der Stürme relativ zur Jet-Stärke.', 'Storm spin relative to jet strength.'), f2)
      .range('stormTint', t('Sturm-Farbe', 'Storm colour'), 0, 4, 0.05, t('Wie stark ein angetriebener Sturm seine Farbe in die Wolken gibt.', 'How strongly a driven storm tints the clouds.'), f2)
      .range('dyeRes', t('Farbauflösung', 'Colour resolution'), 128, lim.dyeRes, 64,
        t('Auflösung der Wolkentextur je Würfelfläche. Bestimmt die Schärfe beim Heranzoomen. Kosten wachsen mit N².', 'Cloud texture resolution per cube face. Sets sharpness when zooming in. Cost grows with N².'), (v) => `${v}²`)
      .section(t('Licht und Ansicht', 'Light and view'))
      .range('sunAngle', t('Sonnenstand', 'Sun angle'), -180, 180, 1,
        t('Richtung der Sonne. 0° = Sonne hinter der Kamera (voller Planet), 90° = Halbphase.', 'Sun direction. 0° = sun behind the camera (full disc), 90° = half phase.'), (v) => `${v}°`)
      .range('relief', 'Relief', 0, 2, 0.01,
        t('Neigt die Flächennormale nach der Helligkeit: helle Wolken wirken höher und werfen weiche Schatten. Das ist eine Beleuchtungs-Täuschung, keine echte Höhe (keine Parallaxe, keine Silhouette).',
          'Tilts the surface normal by brightness: bright clouds look higher and cast soft shading. This is a lighting trick, not real height (no parallax, no silhouette).') + fx(t('n′ = normalize(n − ∇Helligkeit · Relief · 3)', 'n′ = normalize(n − ∇brightness · relief · 3)')), f2)
      .range('limb', t('Randverdunkelung', 'Limb darkening'), 0.8, 2, 0.01,
        t('Minnaert-Exponent k. 1 = matte Kugel; höher = dunkler Rand wie bei echten Gasplaneten.', 'Minnaert exponent k. 1 = matte sphere; higher = darker limb, as on real gas giants.') + fx('I = (n·l)<sup>k</sup> · (n·v)<sup>k−1</sup>'), f2)
      .range('atmosphere', t('Dunstsaum', 'Haze rim'), 0, 3, 0.05, t('Helligkeit des Atmosphärensaums am Planetenrand.', 'Brightness of the atmospheric rim at the planet’s edge.') + fx(t('Saum = e<sup>−h/0,025</sup>', 'rim = e<sup>−h/0.025</sup>')), f2)
      .range('exposure', t('Belichtung', 'Exposure'), 0.3, 3, 0.05, t('Gesamthelligkeit vor der ACES-Tonwertkurve.', 'Overall brightness before the ACES tone curve.'), f2)
      .range('spinSpeed', t('Drehgeschwindigkeit', 'Spin speed'), 0, 5, 0.05,
        t('Sichtbare Eigendrehung, läuft in Simulationszeit (Zeitraffer beschleunigt sie mit). 1 = Tempo passend zur Tageslänge der Vorlage. Ändert nur die Ansicht, nicht die Physik.',
          'Visible spin, runs in simulation time (time lapse speeds it up too). 1 = matches the preset’s day length. Affects the view only, not the physics.'), (v) => `${v.toFixed(2)}×`)
      .toggle('map', t('Kartenansicht', 'Map view'),
        t('Zeigt die ganze Kugel als flache Weltkarte (Längen- und Breitengrade).', 'Shows the whole sphere as a flat map (longitude/latitude).'))
      .select('view', t('Feld anzeigen', 'Show field'), [['0', t('Wolken', 'Clouds')], ['1', t('Wind (Richtung)', 'Wind (direction)')], ['2', t('Wirbelstärke', 'Vorticity')], ['3', t('Druck', 'Pressure')]],
        t('Debug-Ansichten. Wind: Rot = Ost, Grün = Nord. Wirbelstärke: Rot = gegen den Uhrzeigersinn, Blau = im Uhrzeigersinn. Druck nur bei Stable Fluids.',
          'Debug views. Wind: red = east, green = north. Vorticity: red = counter-clockwise, blue = clockwise. Pressure only with Stable Fluids.'));
    this.panel.section(t('Speichern und Rückgängig', 'Save and undo'), t('Strg+Z / Strg+Y machen Änderungen rückgängig. Doppelklick auf einen Reglernamen setzt nur diesen zurück.', 'Ctrl+Z / Ctrl+Y undo and redo. Double-click a control name to reset just that control.'));
    this.buildSaveSection();
    this.panel.section(t('Diagnose', 'Diagnostics'), t('Werkzeuge, mit denen du Beobachtungen belegen kannst, statt sie beschreiben zu müssen.', 'Tools to back up observations instead of having to describe them.'), false)
      .buttons([
        ['btn-film', t('🎞 Filmstreifen aufnehmen', '🎞 Record film strip'), () => this.recordFilmstrip()],
        ['btn-selftest', t('Kanten-Selbsttest', 'Seam self-test'), () => this.runSelftest()],
      ], {
        'btn-film': t('Nimmt 8 Bilder im Abstand von 2 s auf und speichert sie als ein PNG mit Einstellungen und fps. Zeigt Bewegung, die ein einzelnes Standbild nicht zeigt. Gut zum Anhängen an ein GitHub-Issue.',
          'Takes 8 frames 2 s apart and saves them as one PNG with settings and fps. Shows motion a single still cannot. Good for attaching to a GitHub issue.'),
        'btn-selftest': t('Misst auf deiner Grafikkarte, ob die Cubemap-Abtastung an Würfelkanten nahtlos ist. Wenn nicht, schaltet er die exakte Abtastung ein.',
          'Measures on your GPU whether cube-map sampling is seamless at cube edges. If not, it turns on exact sampling.'),
      })
      .toggle('seamless', t('Exakte Kanten', 'Exact edges'),
        t('Tastet an Würfelkanten die Nachbartexel einzeln ab, statt der Hardware zu vertrauen. Nur nötig, wenn der Selbsttest eine Naht findet; kostet etwas Leistung.',
          'Samples neighbouring texels one by one at cube edges instead of trusting the hardware. Only needed if the self-test finds a seam; costs some performance.'))
      .custom(this.diagNote());
    this.updateVisibility();
    this.applyStaticText();
  }

  private formulaNote(f: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'note formula';
    p.innerHTML = `<code class="fx">${f}</code>`;
    return p;
  }

  private diagNote(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'note';
    p.id = 'diag-msg';
    p.setAttribute('aria-live', 'polite');
    return p;
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
    const fluid = this.flowMode() === 'fluid', look = this.lookMode(), hybrid = S.track === 'hybrid';
    this.panel.visible('flow', hybrid);
    this.panel.visible('look', hybrid);
    for (const k of ['jetRelax', 'omega', 'turbulence', 'turbScale', 'confinement', 'drag', 'iterations', 'velRes', 'bfecc', 'stormSpawn', 'kickLife']) this.panel.visible(k, fluid);
    for (const k of ['curlStrength', 'curlFreq', 'curlSpeed', 'curlOctaves', 'vortexCount', 'vortexStrength', 'curlRes']) this.panel.visible(k, !fluid);
    for (const k of ['particles', 'lifetime', 'opacity', 'blur', 'viewFocus']) this.panel.visible(k, look !== 'dye');
    this.panel.visible('fade', look === 'pure');
    // Farbrückstellung, Feinstreifen, Konvektion, Sturmfarbe gibt es nur beim Farbstoff-Look.
    for (const k of ['bandRelax', 'fineStripes', 'convection', 'stormTint']) this.panel.visible(k, look !== 'pure');
    this.panel.visible('stormHold', fluid);
  }

  private resetSettings() {
    const keep = { preset: S.preset, quality: S.quality, velRes: S.velRes, dyeRes: S.dyeRes, curlRes: S.curlRes, particles: S.particles, seed: S.seed,
      rndFamily: S.rndFamily, rndBands: S.rndBands, rndStorms: S.rndStorms, rndRings: S.rndRings };
    const retroChanged = S.retro !== DEFAULTS.retro;
    Object.assign(S, DEFAULTS, keep);
    this.applyPreset();
    if (retroChanged) this.spin = -this.spin;
    canvas.classList.toggle('map', S.map);
    this.updateVisibility();
    this.panel.refresh();
    const pause = document.getElementById('btn-pause');
    if (pause) pause.textContent = 'Pause';
    this.remember();
  }

  /** Sprache wechseln: Panel neu aufbauen, feste Texte ersetzen. */
  toggleLang() {
    setLang(lang === 'de' ? 'en' : 'de');
    this.buildUI();
  }

  private onChange(key: Key) {
    this.remember();
    switch (key) {
      case 'preset': if (S.preset === 'Zufall') S.seed = newSeed(); this.applyPreset(); this.buildUI(); break;
      case 'rndFamily': case 'rndBands': case 'rndStorms': case 'rndRings':
        if (S.preset === 'Zufall') this.applyPreset();
        break;
      case 'quality': {
        // Geräteklasse: Startwerte und Reglergrenzen neu, Panel neu aufbauen.
        this.downgrades = 0; this.renderScale = 1;
        this.applyQuality(true);
        this.buildUI();
        break;
      }
      case 'contrast': this.writeTables(); break;
      case 'fineStripes': this.needsDye = true; break;
      case 'velRes': case 'curlRes': this.allocVel(); break;
      case 'dyeRes': this.allocDye(); break;
      case 'particles': this.allocParticles(); break;
      case 'track': case 'flow': case 'look': this.updateVisibility(); this.needsDye = true; break;
      case 'retro': this.usePreset(this.preset); this.needsInit = true; break;
      case 'seamless': this.buildPipes(S.seamless); break;
      case 'map': canvas.classList.toggle('map', S.map); break;
      case 'autoQuality': this.renderScale = 1; break;
    }
  }
}

// Für automatische Tests und die Konsole
declare global {
  interface Window {
    gasPlanet?: {
      settings: typeof S;
      capture: () => Promise<string>;
      readRow: (w: 'dye' | 'flow' | 'vel', face: number, y: number) => Promise<number[][]>;
      filmstrip: (o?: FilmOptions) => Promise<Filmstrip>;
      selftest: () => Promise<{ edge: number; interior: number; seamless: boolean }>;
      frame: () => number;
    };
  }
}

start().catch((e) => fail(`${t('<b>Start fehlgeschlagen:</b>', '<b>Start failed:</b>')} ${e instanceof Error ? e.message : String(e)}`));
