import common from './sky_common.wgsl?raw';
import gen from './sky_gen.wgsl?raw';
import draw from './sky_draw.wgsl?raw';
import mip from './sky_mip.wgsl?raw';

// Gemeinsamer Sternenhimmel für alle Planeten-Seiten: dieselbe Milchstraße, dieselben Sterne.
// Die Karte entsteht einmal pro Seed im Compute-Shader (eine Würfelseite pro Bild, damit nichts ruckelt)
// und steht fest im Raum; nur der Planet dreht sich.

/** WGSL für den Erzeugungs-Shader (Einstieg `skyGen`, Bindungen 0 = Job-Uniform 128 Byte, 1 = Ziel). */
export const SKY_GEN_WGSL = common + gen;
/** WGSL-Funktionen fürs Zeichnen: `skyColor(tex, sampler, dir, pixelWinkel, N, milchstraße, sterne)`. */
export const SKY_DRAW_WGSL = common + draw;

export interface SkyLook { width: number; core: number; dust: number; hii: number; bright: number; hue: number }
export const SKY_DEFAULT: SkyLook = { width: 1, core: 1, dust: 1, hii: 1, bright: 0.85, hue: 0.5 };

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Parameterblock (8 × vec4) für `skyGen`; Kachel h/g setzt der Aufrufer. */
export function skyParams(seed: string, look: SkyLook = SKY_DEFAULT): Float32Array {
  const R = rng(seed + '|galaxy');
  const pole = norm([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]);
  const core = norm(cross(pole, norm([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1])));
  const p = new Float32Array(32);
  p.set([R() * 400, 0.1 * look.bright, look.width, look.core, ...pole, 0, ...core, 0, (look.hue - 0.5) * 0.3, look.dust, look.hii, 0]);
  return p;
}

/** Fertiger Himmel für Seiten ohne eigene Erzeugungs-Infrastruktur (Gasriese). */
export class Sky {
  readonly tex: GPUTexture;
  readonly view: GPUTextureView;
  ready = false;
  private face = 6;
  private params: Float32Array = new Float32Array(32);
  private genPipe: GPUComputePipeline;
  private mipPipe: GPUComputePipeline;
  private jobBuf: GPUBuffer;
  private levels: number;

  constructor(private device: GPUDevice, readonly n: number) {
    this.levels = Math.floor(Math.log2(n)) + 1;
    this.tex = device.createTexture({ size: [n, n, 6], format: 'rgba16float', mipLevelCount: this.levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    this.view = this.tex.createView({ dimension: '2d-array' });
    this.genPipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SKY_GEN_WGSL }), entryPoint: 'skyGen' } });
    this.mipPipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: mip }), entryPoint: 'skyMip' } });
    this.jobBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** Neuen Himmel anfordern; er entsteht in den nächsten Bildern. */
  generate(seed: string, look: SkyLook = SKY_DEFAULT) {
    this.params = skyParams(seed, look);
    this.face = 0;
  }

  /** Pro Bild aufrufen (vor dem Zeichnen): rechnet höchstens eine Würfelseite, zuletzt die Mipmaps. */
  tick(enc: GPUCommandEncoder) {
    if (this.face > 6) return;
    const d = this.device, n = this.n;
    if (this.face < 6) {
      const p = this.params.slice();
      p.set([n, n, 0, 0], 24);
      p.set([0, 0, this.face, n], 28);
      d.queue.writeBuffer(this.jobBuf, 0, p as Float32Array<ArrayBuffer>);
      const pass = enc.beginComputePass();
      pass.setPipeline(this.genPipe);
      pass.setBindGroup(0, d.createBindGroup({ layout: this.genPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.jobBuf } },
        { binding: 1, resource: this.tex.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8));
      pass.end();
      this.face++;
      return;
    }
    const pass = enc.beginComputePass();
    pass.setPipeline(this.mipPipe);
    for (let l = 1; l < this.levels; l++) {
      const s = Math.max(1, n >> l);
      pass.setBindGroup(0, d.createBindGroup({ layout: this.mipPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: this.tex.createView({ dimension: '2d-array', baseMipLevel: l - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: this.tex.createView({ dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 }) },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(s / 8), Math.ceil(s / 8), 6);
    }
    pass.end();
    this.face = 7;
    this.ready = true;
  }
}
