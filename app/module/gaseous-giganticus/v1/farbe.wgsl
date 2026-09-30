// [T5] Farbe der Kugel = Ausgabetextur [G8] (6 Würfelflächen, rgba8), gleiche Flächenlage wie [G3][G8].
@group(1) @binding(0) var<storage, read> ggBild: array<u32>;
fn ggIdx(p: vec3f, d: f32) -> u32 {
  let ap = abs(p);
  var f = 0u; var a = 0.0; var jj = 0.0;
  if (ap.z >= ap.x && ap.z >= ap.y) {
    let s = 0.5 / ap.z;
    if (p.z > 0.0) { f = 0u; a = p.x * s; } else { f = 2u; a = -p.x * s; }
    jj = -p.y * s;
  } else if (ap.x >= ap.y) {
    let s = 0.5 / ap.x;
    if (p.x > 0.0) { f = 1u; a = -p.z * s; } else { f = 3u; a = p.z * s; }
    jj = -p.y * s;
  } else {
    let s = 0.5 / ap.y;
    a = p.x * s;
    if (p.y > 0.0) { f = 4u; jj = p.z * s; } else { f = 5u; jj = -p.z * s; }
  }
  let i = u32(clamp(floor(a * d + d * 0.5), 0.0, d - 1.0));
  let j = u32(clamp(floor(jj * d + d * 0.5), 0.0, d - 1.0));
  return (f * u32(d) + j) * u32(d) + i;
}
fn modulFarbe(n: vec3f, b: f32) -> vec3f { return unpack4x8unorm(ggBild[ggIdx(n, 1024.0)]).rgb; }
