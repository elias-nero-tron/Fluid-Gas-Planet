// Kern: EINE Grafikkarten-Verbindung für die ganze App (WebGPU-Standardablauf: Adapter → Gerät → Canvas).
// ?test zeichnet in eine Textur statt auf den Bildschirm (Software-Renderer beim Prüfen).
export async function gpuStarten(canvas, test) {
  if (!navigator.gpu) throw new Error('Kein WebGPU in diesem Browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Kein WebGPU-Adapter.');
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const format = test ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  const ctx = test ? null : canvas.getContext('webgpu');
  if (ctx) ctx.configure({ device, format, alphaMode: 'opaque' });
  const testTex = test ? device.createTexture({ size: [640, 480], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }) : null;
  const ziel = () => (test ? testTex : ctx.getCurrentTexture());
  const groesse = () => {
    if (test) return [640, 480];
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
  };
  // Testbild als Daten-URL
  const grab = async () => {
    const buf = device.createBuffer({ size: 640 * 480 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: testTex }, { buffer: buf, bytesPerRow: 640 * 4 }, [640, 480]);
    device.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const c2 = document.createElement('canvas'); c2.width = 640; c2.height = 480;
    c2.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.getMappedRange().slice(0)), 640, 480), 0, 0);
    return c2.toDataURL();
  };
  return { device, format, ziel, groesse, grab, test };
}
// Shader übersetzen und Fehler melden
export function shader(device, label, code, meldung) {
  const m = device.createShaderModule({ label, code });
  m.getCompilationInfo().then((i) => {
    const e = i.messages.filter((x) => x.type === 'error');
    if (e.length) meldung(`Shader ${label}: ` + e.map((x) => `Zeile ${x.lineNum}: ${x.message}`).join('\n'));
  });
  return m;
}
