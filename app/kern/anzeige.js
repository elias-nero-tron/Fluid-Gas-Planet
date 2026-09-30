// Kern: baut die Zeichen-Pipeline aus Kern-Kugel + Farbfunktion des aktiven Moduls.
import kugel from './kugel.wgsl?raw';
import { shader } from './gpu.js';
export function anzeigeBauen(gpu, farbeWGSL, meldung) {
  const { device, format } = gpu;
  const m = shader(device, 'anzeige', kugel + farbeWGSL, meldung);
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' },
    fragment: { module: m, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const kbuf = device.createBuffer({ size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const kbg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: kbuf } }] });
  const daten = new Float32Array(16);
  return {
    layout1: pipeline.getBindGroupLayout(1),
    zeichnen(enc, zeilen, aspect, rand, gruppe1) {
      daten.set([...zeilen[0], 0, ...zeilen[1], 0, ...zeilen[2], 0, aspect, rand, 0, 0]);
      device.queue.writeBuffer(kbuf, 0, daten);
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: gpu.ziel().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      rp.setPipeline(pipeline); rp.setBindGroup(0, kbg); rp.setBindGroup(1, gruppe1); rp.draw(3); rp.end();
    },
  };
}
