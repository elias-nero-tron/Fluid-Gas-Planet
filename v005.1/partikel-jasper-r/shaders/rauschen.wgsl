// [T4] Hash without Sine (David Hoskins, MIT) + Gradientenrauschen
fn hash33(pin: vec3f) -> vec3f {
  var p3 = fract(pin * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx) * 2.0 - 1.0;
}
fn gnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var r = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let o = vec3f(f32(k & 1u), f32((k >> 1u) & 1u), f32((k >> 2u) & 1u));
    let g = dot(hash33(i + o), f - o);
    let s = mix(1.0 - w, w, o);
    r += g * s.x * s.y * s.z;
  }
  return r;
}
fn potential(p: vec3f) -> vec3f {
  return vec3f(gnoise(p), gnoise(p + vec3f(31.4, 17.1, 5.9)), gnoise(p + vec3f(-12.7, 41.3, 23.2)));
}
// Curl eines Vektorpotentials (zentrale Differenzen)
fn curl3(p: vec3f) -> vec3f {
  let e = 0.01;
  let dx = potential(p + vec3f(e, 0, 0)) - potential(p - vec3f(e, 0, 0));
  let dy = potential(p + vec3f(0, e, 0)) - potential(p - vec3f(0, e, 0));
  let dz = potential(p + vec3f(0, 0, e)) - potential(p - vec3f(0, 0, e));
  return vec3f(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
}

