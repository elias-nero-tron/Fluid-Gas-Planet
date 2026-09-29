struct R { rot0: vec4f, rot1: vec4f, rot2: vec4f, aspect: f32, dim: f32, p2: f32, p3: f32 };
@group(0) @binding(0) var<uniform> r: R;
@group(0) @binding(1) var<storage, read> img: array<u32>;
struct VO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) k: u32) -> VO {
  let p = vec2f(f32((k << 1u) & 2u), f32(k & 2u)) * 2.0 - 1.0;
  return VO(vec4f(p, 0.0, 1.0), p);
}
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
@fragment fn fs(v: VO) -> @location(0) vec4f {   // [T5] unbeleuchtete Kugel
  let o = vec3f(0.0, 0.0, 3.0);
  let d = normalize(vec3f(v.ndc.x * r.aspect * 0.4, v.ndc.y * 0.4, -1.0));
  let tca = -dot(o, d);
  let d2 = dot(o, o) - tca * tca;
  if (d2 >= 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let hit = o + d * (tca - sqrt(1.0 - d2));
  let n = normalize(vec3f(dot(r.rot0.xyz, hit), dot(r.rot1.xyz, hit), dot(r.rot2.xyz, hit)));
  return vec4f(unpack4x8unorm(img[xyzToIdx(n, r.dim)]).rgb, 1.0);
}
