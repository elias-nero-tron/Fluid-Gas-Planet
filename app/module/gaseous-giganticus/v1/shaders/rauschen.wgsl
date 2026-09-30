// [T1] 4D-Simplex-Rauschen (Stefan Gustavson / Ashima Arts, webgl-noise, MIT-Lizenz)
fn mod289v(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289s(x: f32) -> f32 { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permv(x: vec4f) -> vec4f { return mod289v(((x * 34.0) + 10.0) * x); }
fn perms(x: f32) -> f32 { return mod289s(((x * 34.0) + 10.0) * x); }
fn tis(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
fn grad4(j: f32, ip: vec4f) -> vec4f {
  var p = vec4f(floor(fract(vec3f(j) * ip.xyz) * 7.0) * ip.z - 1.0, 0.0);
  p.w = 1.5 - dot(abs(p.xyz), vec3f(1.0));
  let s = select(vec4f(0.0), vec4f(1.0), p < vec4f(0.0));
  p = vec4f(p.xyz + (s.xyz * 2.0 - 1.0) * s.www, p.w);
  return p;
}
fn snoise(v: vec4f) -> f32 {
  let C = vec4f(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  var i = floor(v + dot(v, vec4f(0.309016994374947451)));
  let x0 = v - i + dot(i, C.xxxx);
  var i0 = vec4f(0.0);
  let isX = step(x0.yzw, x0.xxx);
  let isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0 = vec4f(i0.x, 1.0 - isX);
  i0.y += isYZ.x + isYZ.y;
  i0 = vec4f(i0.xy, i0.zw + 1.0 - isYZ.xy);
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  let i3 = clamp(i0, vec4f(0.0), vec4f(1.0));
  let i2 = clamp(i0 - 1.0, vec4f(0.0), vec4f(1.0));
  let i1 = clamp(i0 - 2.0, vec4f(0.0), vec4f(1.0));
  let x1 = x0 - i1 + C.xxxx;
  let x2 = x0 - i2 + C.yyyy;
  let x3 = x0 - i3 + C.zzzz;
  let x4 = x0 + C.wwww;
  i = mod289v(i);
  let j0 = perms(perms(perms(perms(i.w) + i.z) + i.y) + i.x);
  let j1 = permv(permv(permv(permv(i.w + vec4f(i1.w, i2.w, i3.w, 1.0)) + i.z + vec4f(i1.z, i2.z, i3.z, 1.0))
           + i.y + vec4f(i1.y, i2.y, i3.y, 1.0)) + i.x + vec4f(i1.x, i2.x, i3.x, 1.0));
  let ip = vec4f(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  var p0 = grad4(j0, ip); var p1 = grad4(j1.x, ip); var p2 = grad4(j1.y, ip);
  var p3 = grad4(j1.z, ip); var p4 = grad4(j1.w, ip);
  let nrm = tis(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= nrm.x; p1 *= nrm.y; p2 *= nrm.z; p3 *= nrm.w;
  p4 *= tis(vec4f(dot(p4, p4))).x;
  var m0 = max(0.6 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
  var m1 = max(0.6 - vec2f(dot(x3, x3), dot(x4, x4)), vec2f(0.0));
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3f(dot(p0, x0), dot(p1, x1), dot(p2, x2))) + dot(m1 * m1, vec2f(dot(p3, x3), dot(p4, x4))));
}
