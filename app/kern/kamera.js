// Kern: Kamera. Drehen mit Maus/Finger; liefert die Drehung Welt → Körper als drei Zeilen.
export function kameraStarten(canvas) {
  const k = { yaw: 0, pitch: 0.15 };
  let drag = null;
  canvas.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointerup = () => { drag = null; };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    k.yaw += (e.clientX - drag[0]) * 0.005;
    k.pitch = Math.max(-1.5, Math.min(1.5, k.pitch + (e.clientY - drag[1]) * 0.005));
    drag = [e.clientX, e.clientY];
  };
  // erst um x (pitch), dann um y (yaw)
  k.zeilen = () => {
    const cy = Math.cos(k.yaw), sy = Math.sin(k.yaw), cp = Math.cos(k.pitch), sp = Math.sin(k.pitch);
    return [[cy, sy * sp, -sy * cp], [0, cp, sp], [sy, -cy * sp, cy * cp]];
  };
  return k;
}
