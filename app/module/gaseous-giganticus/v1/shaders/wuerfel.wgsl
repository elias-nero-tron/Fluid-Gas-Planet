// [G3][G8] Würfelabbildung mit derselben Flächenlage wie fij_to_xyz im Original (Gaseous Giganticus).
// Würfelfläche/Pixel -> Richtung, gleiche Flächenlage wie im Original
fn fijToXyz(f: u32, i: f32, j: f32, d: f32) -> vec3f {
  let a = (i - d * 0.5) / d; let b = -(j - d * 0.5) / d; let c = (j - d * 0.5) / d;
  var v: vec3f;
  switch f {
    case 0u: { v = vec3f(a, b, 0.5); }
    case 1u: { v = vec3f(0.5, b, -a); }
    case 2u: { v = vec3f(-a, b, -0.5); }
    case 3u: { v = vec3f(-0.5, b, a); }
    case 4u: { v = vec3f(a, 0.5, c); }
    default: { v = vec3f(a, -0.5, -c); }
  }
  return normalize(v);
}
// Umkehrung: Richtung -> Index in einem Würfelfeld der Kantenlänge d
fn xyzToIdx(p: vec3f, d: f32) -> u32 {
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

