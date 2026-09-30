// Kern: Kugel zeichnen. Jeder Pixel schneidet seinen Sichtstrahl mit der Einheitskugel.
// Die Farbe liefert das aktive Modul über  fn modulFarbe(n: vec3f, b: f32) -> vec3f  (Bindungen in Gruppe 1).
// b = Abstand des Strahls zur Kugelmitte; Module mit weichem Rand setzen kern.rand > 0.
struct Kern { rot0: vec4f, rot1: vec4f, rot2: vec4f, aspect: f32, rand: f32, p2: f32, p3: f32 };
@group(0) @binding(0) var<uniform> kern: Kern;
struct VO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) k: u32) -> VO {
  let p = vec2f(f32((k << 1u) & 2u), f32(k & 2u)) * 2.0 - 1.0;
  return VO(vec4f(p, 0.0, 1.0), p);
}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let o = vec3f(0.0, 0.0, 3.0);
  let d = normalize(vec3f(v.ndc.x * kern.aspect * 0.4, v.ndc.y * 0.4, -1.0));
  let tca = -dot(o, d);
  let d2 = dot(o, o) - tca * tca;
  let b = sqrt(max(d2, 0.0));
  if (b >= 1.0 + kern.rand) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let hit = o + d * (tca - sqrt(max(1.0 - d2, 0.0)));
  let n = normalize(vec3f(dot(kern.rot0.xyz, hit), dot(kern.rot1.xyz, hit), dot(kern.rot2.xyz, hit)));
  return vec4f(modulFarbe(n, b), 1.0);
}
