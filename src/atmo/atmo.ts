import commonWGSL from './atmo_common.wgsl?raw';
import simWGSL from './atmo_sim.wgsl?raw';
import noiseWGSL from './atmo_noise.wgsl?raw';
import cloudsWGSL from './atmo_clouds.wgsl?raw';

// Modul „Atmosphäre“: feuchte, thermische Flachwasser-Atmosphäre auf der Würfelkugel plus
// Wolkenschicht als Volumenschale. Eigenständig (eigene Felder, eigene Uniforms, eigene Shader),
// damit es neben den bestehenden Rechenmodellen läuft, abschaltbar ist und später auch über einem
// Gesteinsplaneten liegen kann. Quellen und Formeln stehen in atmo_sim.wgsl und atmo_clouds.wgsl.

export interface AtmoField { tex: GPUTexture; cube: GPUTextureView; store: GPUTextureView; n: number }

/** Physikalische Stellgrößen (dimensionslos, Radius 1, Zeit in Sim-Sekunden). */
export interface AtmoParams {
  omega: number;     // Rotation Ω (mit Vorzeichen)
  c2: number;        // Schwerewellen-Geschwindigkeit², c² = gH
  relax: number;     // 1/τ Newton-Abkühlung
  drag: number;      // 1/τ Reibung
  nu: number;        // Exponent der Sättigung (Zerroukat & Allen: 20)
  beta1: number;     // Kondensation → Massenverlust (mcRSW)
  beta2: number;     // Kondensation → Erwärmung (latente Wärme)
  qPrecip: number;   // Regen-Schwelle für Wolkenwasser
  rain: number;      // 1/τ Ausregnen
  evap: number;      // 1/τ Feuchte-Nachschub
  rhSurf: number;    // relative Feuchte des Nachschubs
  diff: number;      // Glättung der Schichtdicke (ν·Δt/Δx²)
  q0: number;        // Sättigungs-Skala
  ashFall: number;   // 1/τ Asche sinkt aus
  nudge: number;     // 1/τ Zug zum Gleichgewichts-Jet (0 = frei)
  theta0: number;    // θ am Äquator
  dTheta: number;    // θ-Gefälle Äquator → Pol (θ_eq = θ₀ − Δθ·sin²φ)
  deepJets: boolean; // Gasriese: Jets als tiefe Strömung („Bodenhöhe“ B, Dowling & Ingersoll 1989)
  test: boolean;     // Galewsky-Test: Jet nur durch η balanciert, Beule als Störung
}

export type AtmoEventKind = 'anticyclone' | 'cyclone' | 'impact' | 'volcano' | 'explosion';

export interface AtmoEvent {
  dir: [number, number, number]; radius: number;
  dEta: number; dTheta: number; dQv: number; dAsh: number;
  balanced: number; radial: number;
  /** > 0: Quelle wirkt so viele Sim-Sekunden (Raten pro Sekunde), sonst einmalig. */
  duration?: number;
}

const EQ = 128;
const MAX_EVENTS = 16;
const HEAD = 24;
const U_FLOATS = HEAD + EQ * 4 + MAX_EVENTS * 12;

export class Atmosphere {
  n = 0;
  private A: AtmoField[] = [];
  private B: AtmoField[] = [];
  private ca = 0;   // Index des aktuellen Zustands in A (3 Felder) und B (2 Felder)
  private cb = 0;
  private layout: GPUBindGroupLayout;
  private pipes: Record<string, GPUComputePipeline> = {};
  private seamless: boolean | null = null;
  private module: GPUShaderModule;
  private ubuf: GPUBuffer;
  private u = new Float32Array(U_FLOATS);
  private sampler: GPUSampler;
  private pending: AtmoEvent[] = [];
  private active: (AtmoEvent & { left: number })[] = [];
  private stormClock = 0;
  eqTable = new Float32Array(EQ * 4);
  /** Anzahl Teilschritte im letzten Schritt (CFL der Schwerewellen). */
  substeps = 1;

  constructor(private device: GPUDevice, n: number, onError?: (msg: string) => void) {
    const C = GPUShaderStage.COMPUTE;
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, sampler: { type: 'filtering' } },
        { binding: 2, visibility: C, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 3, visibility: C, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
        { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
        { binding: 6, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 7, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      ],
    });
    this.module = device.createShaderModule({ label: 'atmo-sim', code: commonWGSL + simWGSL });
    this.module.getCompilationInfo().then((info) => {
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length && onError) onError(errs.map((x) => `atmo_sim ${x.lineNum}: ${x.message}`).join('<br>'));
    });
    this.ubuf = device.createBuffer({ size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.build(false);
    this.resize(n);
  }

  build(seamless: boolean) {
    if (this.seamless === seamless) return;
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    for (const e of ['aInit', 'aAdvect', 'aMass', 'aMomentum'])
      this.pipes[e] = this.device.createComputePipeline({ layout, compute: { module: this.module, entryPoint: e, constants: { SEAMLESS: seamless ? 1 : 0 } } });
    this.seamless = seamless;
  }

  private field(n: number): AtmoField {
    const tex = this.device.createTexture({
      size: [n, n, 6], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    return { tex, n, cube: tex.createView({ dimension: 'cube' }), store: tex.createView({ dimension: '2d-array' }) };
  }

  resize(n: number) {
    if (n === this.n) return;
    for (const f of [...this.A, ...this.B]) f.tex.destroy();
    this.n = n;
    this.A = [this.field(n), this.field(n), this.field(n)];
    this.B = [this.field(n), this.field(n)];
    this.ca = 0; this.cb = 0;
  }

  /** Wind (xyz) und Schichtdicke η (w): passt direkt als Windfeld für Farbstoff und Partikel. */
  get velocity(): AtmoField { return this.A[this.ca]; }
  /** θ, Dampf q_v, Wolkenwasser q_c, Asche. */
  get tracers(): AtmoField { return this.B[this.cb]; }

  /**
   * Gleichgewicht je Breite: Ostwind u(φ), Temperatur θ_eq(φ) = θ₀ − Δθ·sin²φ und die passende
   * Schichtdicke bzw. „Bodenhöhe“ aus dem Gradientwind-Gleichgewicht
   *   (f + u·tanφ)·u = −c²·[b̃·∂(η + B)/∂φ + ½·D·∂b̃/∂φ],   b̃ = 1 − θ.
   * deepJets: die Jets gehören zur tiefen Strömung (B), die Wetterschicht selbst bleibt fast flach.
   */
  setEquilibrium(uAt: (lat: number) => number, p: AtmoParams) {
    const M = 4096;
    const th = (phi: number) => p.theta0 - p.dTheta * Math.sin(phi) ** 2;
    const dth = (phi: number) => -2 * p.dTheta * Math.sin(phi) * Math.cos(phi);
    const lim = Math.PI / 2 - 1e-4;
    const force = (phi: number) => {
      const u = uAt(phi);
      const tan = Math.max(-20, Math.min(20, Math.tan(phi)));
      return (2 * p.omega * Math.sin(phi) + u * tan) * u;
    };
    const lats = new Float64Array(M + 1), D0 = new Float64Array(M + 1), D1 = new Float64Array(M + 1), dB = new Float64Array(M + 1);
    for (let i = 0; i <= M; i++) lats[i] = -lim + (2 * lim * i) / M;
    // D = Ds·D1 + D0 (die Gleichung ist linear in D); Ds so, dass der Flächenmittelwert 1 ist.
    D0[0] = 0; D1[0] = 1;
    for (let i = 0; i <= M; i++) {
      const phi = lats[i], bt = 1 - th(phi);
      dB[i] = p.deepJets ? -force(phi) / (p.c2 * bt) : 0;
      if (i === M) break;
      const h = lats[i + 1] - phi;
      const step = (phi2: number, d0: number, d1: number) => {
        const b2 = 1 - th(phi2), db = -dth(phi2);
        const a = p.deepJets ? 0 : force(phi2) / p.c2;
        return [-(a + 0.5 * d0 * db) / b2, -(0.5 * d1 * db) / b2];
      };
      const k1 = step(phi, D0[i], D1[i]);
      const k2 = step(phi + h / 2, D0[i] + (h / 2) * k1[0], D1[i] + (h / 2) * k1[1]);
      D0[i + 1] = D0[i] + h * k2[0];
      D1[i + 1] = D1[i] + h * k2[1];
    }
    let s0 = 0, s1 = 0, w = 0;
    for (let i = 0; i <= M; i++) { const c = Math.cos(lats[i]); s0 += D0[i] * c; s1 += D1[i] * c; w += c; }
    const Ds = (w - s0) / s1;
    for (let k = 0; k < EQ; k++) {
      const phi = -Math.PI / 2 + (Math.PI * k) / (EQ - 1);
      const x = Math.min(M, Math.max(0, ((phi + lim) / (2 * lim)) * M));
      const i = Math.min(M - 1, Math.floor(x)), f = x - i;
      const D = (Ds * D1[i] + D0[i]) * (1 - f) + (Ds * D1[i + 1] + D0[i + 1]) * f;
      const b = dB[i] * (1 - f) + dB[i + 1] * f;
      this.eqTable.set([D - 1, th(phi), uAt(phi), b], k * 4);
    }
  }

  private writeUniform(dt: number, time: number, p: AtmoParams, seed: number, events: AtmoEvent[], scale: number) {
    const u = this.u;
    u.set([
      dt, time, this.n, events.length,
      p.omega, p.c2, p.relax, p.drag,
      p.nu, p.beta1, p.beta2, p.qPrecip,
      p.rain, p.evap, p.rhSurf, p.diff,
      seed, p.q0, p.ashFall, Math.abs(2 * p.omega * Math.sin((10 * Math.PI) / 180)) + 1e-3,
      p.test ? 1 : 0, p.nudge, 0, 0,
    ], 0);
    u.set(this.eqTable, HEAD);
    events.forEach((e, i) => {
      const o = HEAD + EQ * 4 + i * 12;
      u.set([...e.dir, e.radius, e.dEta * scale, e.dTheta * scale, e.dQv * scale, e.dAsh * scale, e.balanced, e.radial * scale, 0, 0], o);
    });
    this.device.queue.writeBuffer(this.ubuf, 0, u);
  }

  private bind(a: AtmoField, b: AtmoField, outA: AtmoField, outB: AtmoField, ub: GPUBuffer = this.ubuf): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: ub } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: a.cube },
        { binding: 3, resource: b.cube },
        { binding: 4, resource: outA.store },
        { binding: 5, resource: outB.store },
        { binding: 6, resource: a.store },
        { binding: 7, resource: b.store },
      ],
    });
  }

  private run(pass: GPUComputePassEncoder, pipe: string, bg: GPUBindGroup) {
    pass.setPipeline(this.pipes[pipe]);
    pass.setBindGroup(0, bg);
    const g = Math.ceil(this.n / 8);
    pass.dispatchWorkgroups(g, g, 6);
  }

  /** Anfangszustand: Gleichgewicht (setEquilibrium vorher aufrufen). */
  init(enc: GPUCommandEncoder, p: AtmoParams, seed: number) {
    this.pending = []; this.active = []; this.stormClock = 0;
    this.writeUniform(0, 0, p, seed, [], 1);
    this.ca = 0; this.cb = 0;
    const pass = enc.beginComputePass();
    this.run(pass, 'aInit', this.bind(this.A[1], this.B[1], this.A[0], this.B[0]));
    pass.end();
  }

  addEvent(e: AtmoEvent) { this.pending.push(e); }

  /**
   * Stürme als zufällige Massenpulse (Showman 2007; canoe/exo3: Poisson-Zeitpunkte, Gauß-Profil
   * exp(−½d²/r²), geostrophisch balancierter Wind, Anteil Zyklone = polarity).
   */
  spawnStorms(dt: number, perSecond: number, amp: number, radius: number, moist: number, rnd: () => number = Math.random) {
    if (perSecond <= 0 || amp <= 0) return;
    this.stormClock -= dt;
    while (this.stormClock <= 0) {
      this.stormClock += -Math.log(1 - rnd()) / perSecond;
      const z = rnd() * 2 - 1, phi = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
      if (Math.abs(z) < Math.sin((8 * Math.PI) / 180)) continue;   // am Äquator gibt es keine Geostrophie
      const sign = rnd() < 0.5 ? 1 : -1;
      this.pending.push({ dir: [s * Math.cos(phi), z, s * Math.sin(phi)], radius, dEta: sign * amp, dTheta: 0, dQv: moist, dAsh: 0, balanced: 1, radial: 0 });
    }
  }

  /** Ein Zeitschritt dt (Sim-Sekunden), aufgeteilt in Teilschritte für die Schwerewellen-CFL. */
  step(enc: GPUCommandEncoder, dt: number, time: number, p: AtmoParams, seed: number) {
    // Einmalige Ereignisse jetzt, andauernde Quellen (Vulkan) anteilig pro Schritt.
    const evs: AtmoEvent[] = [];
    for (const e of this.pending.splice(0)) {
      if (e.duration && e.duration > 0) this.active.push({ ...e, left: e.duration }); else evs.push(e);
    }
    for (const a of this.active) {
      const k = Math.min(dt, a.left);
      a.left -= dt;
      evs.push({ ...a, dEta: a.dEta * k, dTheta: a.dTheta * k, dQv: a.dQv * k, dAsh: a.dAsh * k, radial: a.radial * k });
    }
    this.active = this.active.filter((a) => a.left > 0);
    while (evs.length > MAX_EVENTS) this.pending.push(evs.pop()!);

    const c = Math.sqrt(Math.max(p.c2, 0));
    const sub = Math.max(1, Math.min(32, Math.ceil((c * dt * this.n) / 0.45)));
    this.substeps = sub;
    // Aufteilung wie bei Split-Explicit-Lösern: langsame Advektion einmal mit dem vollen Schritt
    // (Semi-Lagrange ist CFL-frei; jede Interpolation verschmiert etwas, darum nur einmal),
    // schnelle Schwerewellen (Masse, Druck) und Physik in Teilschritten.
    this.writeUniform(dt, time, p, seed, evs, 1 / sub);
    const next = (i: number, m: number) => (i + 1) % m;
    const adv = enc.beginComputePass();
    const a1 = next(this.ca, 3), b1 = next(this.cb, 2);
    this.run(adv, 'aAdvect', this.bind(this.A[this.ca], this.B[this.cb], this.A[a1], this.B[b1]));
    adv.end();
    this.ca = a1; this.cb = b1;
    // Teilschritte lesen einen zweiten Uniform-Puffer mit Δt = dt/sub.
    this.writeSubUniform(dt / sub);
    const pass = enc.beginComputePass();
    for (let k = 0; k < sub; k++) {
      const a2 = next(this.ca, 3), b2 = next(this.cb, 2);
      this.run(pass, 'aMass', this.bind(this.A[this.ca], this.B[this.cb], this.A[a2], this.B[b2], this.subBuf));
      this.ca = a2; this.cb = b2;
      const a3 = next(this.ca, 3);
      this.run(pass, 'aMomentum', this.bind(this.A[this.ca], this.B[this.cb], this.A[a3], this.B[next(this.cb, 2)], this.subBuf));
      this.ca = a3;
    }
    pass.end();
  }

  /** Zweiter Uniform-Puffer für die Teilschritte: gleicher Inhalt, nur Δt = dt/sub. */
  private subBuf!: GPUBuffer;
  private writeSubUniform(h: number) {
    this.subBuf ??= this.device.createBuffer({ size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const u = this.u.slice();
    u[0] = h;
    this.device.queue.writeBuffer(this.subBuf, 0, u);
  }

  /** Nur für Tests: alle sechs Flächen eines Felds als Zahlen (rgba je Texel). */
  async dump(which: 'A' | 'B'): Promise<{ n: number; data: Float32Array }> {
    const f = which === 'A' ? this.A[this.ca] : this.B[this.cb];
    const n = f.n, bpr = Math.ceil((n * 8) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * n * 6, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: f.tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: n }, [n, n, 6]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(buf.getMappedRange().slice(0));
    buf.destroy();
    const f16 = (b: number) => { const s = b >> 15 ? -1 : 1, e = (b >> 10) & 31, m = b & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
    const out = new Float32Array(n * n * 6 * 4);
    for (let face = 0; face < 6; face++) for (let y = 0; y < n; y++) for (let x = 0; x < n * 4; x++)
      out[((face * n + y) * n) * 4 + x] = f16(h[(face * n + y) * (bpr / 2) + x]);
    return { n, data: out };
  }
}

/** Ereignis-Vorlagen für Tippen (Stärke s skaliert alles). c = Schwerewellen-Geschwindigkeit. */
export function eventAt(kind: AtmoEventKind, dir: [number, number, number], s: number, c: number, q0: number): AtmoEvent {
  switch (kind) {
    case 'anticyclone': return { dir, radius: 0.045, dEta: 0.1 * s, dTheta: 0, dQv: 0.3 * q0 * s, dAsh: 0, balanced: 1, radial: 0 };
    case 'cyclone': return { dir, radius: 0.045, dEta: -0.1 * s, dTheta: 0, dQv: 0.3 * q0 * s, dAsh: 0, balanced: 1, radial: 0 };
    // Einschlag wie Shoemaker-Levy 9: Masse und Hitze ohne Gleichgewicht → Schwerewellen-Ring, dunkle Trümmer.
    case 'impact': return { dir, radius: 0.03, dEta: 0.25 * s, dTheta: 0.05 * s, dQv: 0.2 * q0 * s, dAsh: 1.5 * s, balanced: 0, radial: 0.5 * c * s };
    // Vulkan: 10 s lang Wärme, Dampf, Asche und aufsteigende Masse (Raten pro Sekunde).
    case 'volcano': return { dir, radius: 0.02, dEta: 0.03 * s, dTheta: 0.02 * s, dQv: 0.5 * q0 * s, dAsh: 0.6 * s, balanced: 0, radial: 0, duration: 10 };
    // Explosion: kurzer, heißer Puls mit Druckwelle und Feuerwolke (Pyrocumulus).
    case 'explosion': return { dir, radius: 0.015, dEta: 0.15 * s, dTheta: 0.12 * s, dQv: 0.6 * q0 * s, dAsh: 0.4 * s, balanced: 0, radial: 0.8 * c * s };
  }
}

// ---------------------------------------------------------------------------
// Wolkenschicht (Zeichnen)
// ---------------------------------------------------------------------------

export interface CloudLook {
  thickness: number;   // Schalendicke H in Planetenradien
  steps: number;       // Raymarching-Schritte
  optical: number;     // optische Dicke bei Dichte 1 über die ganze Schale
  coverage: number;    // Bedeckung aus Wolkenwasser: w = 1 − exp(−k·q_c)
  shapeScale: number;  // Wiederholungen der Formtextur pro Radius
  detailScale: number;
  shadow: number;      // Stärke des Wolkenschattens auf dem Planeten
  ash: number;         // Stärke der Asche
  ambient: number;
  tower: number;       // Auftrieb θ − θ_eq hebt die Wolkenobergrenze
  shape: number;       // Formstärke (Erosion)
  cloud: [number, number, number];
  ashColor: [number, number, number];
}

export interface CloudCamera {
  /** 36 floats: invViewProj (16), Kamera (4), Welt→Körper-Zeilen (12), Sonne xyz + Intensität (4). */
  base: Float32Array;
  oblateness: number; exposure: number; time: number; theta0: number; dTheta: number;
}

export class CloudLayer {
  private pipe: GPURenderPipeline;
  private ubuf: GPUBuffer;
  private u = new Float32Array(16 + 4 + 12 + 4 + 4 * 6);
  private sampler: GPUSampler;
  private noise: GPUTexture;
  private noiseReady = false;

  constructor(private device: GPUDevice, format: GPUTextureFormat, noiseSize = 128) {
    const mod = device.createShaderModule({ label: 'atmo-clouds', code: commonWGSL + cloudsWGSL });
    this.pipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod, entryPoint: 'fs',
        targets: [{
          format,
          // Ergebnis = Wolkenlicht + Bild darunter × (Durchlässigkeit × Schatten)
          blend: { color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.ubuf = device.createBuffer({ size: this.u.length * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    this.noise = device.createTexture({ size: [noiseSize, noiseSize, noiseSize], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  }

  /** Formtextur einmal erzeugen (in Scheiben, damit nichts ruckelt). */
  private makeNoise() {
    if (this.noiseReady) return;
    const mod = this.device.createShaderModule({ label: 'atmo-noise', code: commonWGSL + noiseWGSL });
    const pipe = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'noiseGen' } });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.noise.createView() }] }));
    const g = Math.ceil(this.noise.width / 4);
    pass.dispatchWorkgroups(g, g, g);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.noiseReady = true;
  }

  draw(enc: GPUCommandEncoder, target: GPUTextureView, tracers: AtmoField, cam: CloudCamera, look: CloudLook) {
    this.makeNoise();
    const u = this.u;
    u.set(cam.base.subarray(0, 36), 0);
    u.set([
      cam.oblateness, cam.exposure, look.thickness, look.steps,
      look.optical, look.coverage, cam.theta0, cam.dTheta,
      cam.time, look.shapeScale, look.detailScale, look.shadow,
      look.ash, look.ambient, look.tower, look.shape,
      ...look.cloud, 1,
      ...look.ashColor, 1,
    ], 36);
    this.device.queue.writeBuffer(this.ubuf, 0, u);
    const bg = this.device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: tracers.cube },
        { binding: 3, resource: this.noise.createView() },
      ],
    });
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
    rp.setPipeline(this.pipe);
    rp.setBindGroup(0, bg);
    rp.draw(3);
    rp.end();
  }
}
