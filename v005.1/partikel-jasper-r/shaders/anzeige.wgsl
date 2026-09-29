const PI = 3.14159265359;
const TAU = 6.28318530718;
struct U {
  W: f32, H: f32, FW: f32, FH: f32,
  count: f32, batch: f32, nBatch: f32, cur: f32,
  opacity: f32, blur: f32, fade: f32, dt: f32,
  octave: f32, nOct: f32, freq: f32, amp: f32,
  ntime: f32, init: f32, edge: f32, aspect: f32,
  speed: f32, frame: f32, p2: f32, p3: f32,
  centre: vec4f,
  grad: array<vec4f, 16>,
  rot0: vec4f, rot1: vec4f, rot2: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> surf: array<vec4f>;
struct VO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) k: u32) -> VO {
  let p = vec2f(f32((k << 1u) & 2u), f32(k & 2u)) * 2.0 - 1.0;
  return VO(vec4f(p, 0.0, 1.0), p);
}
fn fetch(x: f32, y: f32) -> vec3f {
  let yy = clamp(y, 0.0, u.H - 1.0);
  let hw = u.W * 0.5 * sin((yy + 0.5) / u.H * PI);
  let xx = clamp(x, floor(u.W * 0.5 - hw), ceil(u.W * 0.5 + hw) - 1.0);
  return surf[u32(yy) * u32(u.W) + u32(clamp(xx, 0.0, u.W - 1.0))].rgb;
}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let o = vec3f(0.0, 0.0, 3.0);
  let d = normalize(vec3f(v.ndc.x * u.aspect * 0.4, v.ndc.y * 0.4, -1.0));
  let tca = -dot(o, d);
  let d2 = dot(o, o) - tca * tca;
  let b = sqrt(max(d2, 0.0));
  if (b >= 1.0 + u.edge) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let hit = o + d * (tca - sqrt(max(1.0 - d2, 0.0)));   // jenseits des Randes: Randfarbe
  let n = normalize(vec3f(dot(u.rot0.xyz, hit), dot(u.rot1.xyz, hit), dot(u.rot2.xyz, hit)));
  let phi = acos(clamp(n.y, -1.0, 1.0));
  let theta = fract(atan2(n.z, n.x) / TAU) * TAU;
  // [Q2] Sinus-Abbildung, bilinear
  let fx = u.W * (theta / TAU - 0.5) * sin(phi) + u.W * 0.5 - 0.5;
  let fy = phi / PI * u.H - 0.5;
  let x0 = floor(fx); let y0 = floor(fy);
  let tx = fx - x0; let ty = fy - y0;
  let c = mix(mix(fetch(x0, y0), fetch(x0 + 1.0, y0), tx), mix(fetch(x0, y0 + 1.0), fetch(x0 + 1.0, y0 + 1.0), tx), ty);
  // [Q9] Rand der Kugel weichzeichnen
  let a = smoothstep(1.0 + u.edge, 1.0 - u.edge, b);   // [B3] über den Rand hinweg weich
  return vec4f(c * a, 1.0);
}
