// [G1] Eingabebild (Farbstreifen) laden; [G9] dunkelste Farbe darin finden.
export async function bildLaden(device, quelle) {
  const bmp = await createImageBitmap(quelle);
  const tex = device.createTexture({ size: [bmp.width, bmp.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
  const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
  const px = cx.getImageData(0, 0, bmp.width, bmp.height).data; let min = 1e9, dunkel = [0, 0, 0];
  for (let k = 0; k < px.length; k += 4) { const s = px[k] + px[k + 1] + px[k + 2]; if (s < min) { min = s; dunkel = [px[k] / 255, px[k + 1] / 255, px[k + 2] / 255]; } }
  return { tex, w: bmp.width, h: bmp.height, dunkel };
}
// [T6] Standard: mittlere Spalte des Beispielbilds aus dem Repo (nicht im Projekt gespeichert), Nord oben.
export async function beispielStreifen() {
  const res = await fetch('https://raw.githubusercontent.com/smcameron/gaseous-giganticus/master/sample-gg-output-1.jpg');
  const bmp = await createImageBitmap(await res.blob());
  const top = 40, h = 910, x = Math.round(bmp.width / 2);
  const cv = new OffscreenCanvas(8, h); const cx = cv.getContext('2d');
  // [G1] y = 0 ist im Original der Südpol: Streifen darum umgedreht, damit Nord oben bleibt
  cx.translate(0, h); cx.scale(1, -1);
  cx.drawImage(bmp, x, top, 1, h, 0, 0, 8, h);
  return cv.transferToImageBitmap();
}
