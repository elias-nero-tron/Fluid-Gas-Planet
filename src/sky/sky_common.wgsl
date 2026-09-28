// Gemeinsamer Sternenhimmel aller Planeten-Seiten (Milchstraße als Würfelkarte + Sterne).
// Eigene Präfixe (sky_…), damit das Modul in jeden Shader passt, ohne Namen zu kollidieren.
// Simplexrauschen: Ashima Arts / Stefan Gustavson (MIT), Hash without Sine: David Hoskins (MIT).
const SKY_QPI = 0.785398163397;
struct SkyBasis { ex: vec3f, ey: vec3f, em: vec3f }
fn sky_basis(f: i32) -> SkyBasis {
  switch f {
    case 0: { return SkyBasis(vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0)); }
    case 1: { return SkyBasis(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), vec3f(-1.0, 0.0, 0.0)); }
    case 2: { return SkyBasis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0)); }
    case 3: { return SkyBasis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0)); }
    case 4: { return SkyBasis(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
    default: { return SkyBasis(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, -1.0)); }
  }
}
fn sky_face(d: vec3f) -> i32 {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return select(1, 0, d.x > 0.0); }
  if (a.y >= a.z) { return select(3, 2, d.y > 0.0); }
  return select(5, 4, d.z > 0.0);
}
fn sky_dir(f: i32, uv: vec2f) -> vec3f {
  let B = sky_basis(f);
  let st = tan((uv * 2.0 - 1.0) * SKY_QPI);
  return normalize(B.em + st.x * B.ex + st.y * B.ey);
}
// Richtung -> (Seite, uv in 0..1)
fn sky_uv(d: vec3f, f: i32) -> vec2f {
  let B = sky_basis(f);
  let m = dot(d, B.em);
  return atan(vec2f(dot(d, B.ex), dot(d, B.ey)) / m) / SKY_QPI * 0.5 + 0.5;
}
fn sky_hash33(q: vec3f) -> vec3f { var p3 = fract(q * vec3f(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
fn sky_hash13(q: vec3f) -> f32 { var p3 = fract(q * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
