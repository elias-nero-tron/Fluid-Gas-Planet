// Modul „Atmosphäre“: gemeinsame Bausteine (Würfelkugel, Abtastung, Zufall).
// Eigenständig, damit das Modul ohne den Gasriesen-Code auskommt (später auch für Gesteinsplaneten).
// Die Würfel-Abbildung ist dieselbe wie in src/shaders/common.wgsl (WebGPU: +X −X +Y −Y +Z −Z).

const PI = 3.14159265359;

fn faceDir(face: u32, st: vec2f) -> vec3f {
  let a = st.x * 2.0 - 1.0;
  let b = st.y * 2.0 - 1.0;
  switch face {
    case 0u: { return normalize(vec3f(1.0, -b, -a)); }
    case 1u: { return normalize(vec3f(-1.0, -b, a)); }
    case 2u: { return normalize(vec3f(a, 1.0, b)); }
    case 3u: { return normalize(vec3f(a, -1.0, -b)); }
    case 4u: { return normalize(vec3f(a, -b, 1.0)); }
    default: { return normalize(vec3f(-a, -b, -1.0)); }
  }
}

fn cubeUV(d: vec3f) -> vec3f {
  let ad = abs(d);
  var face = 0.0; var sc = 0.0; var tc = 0.0; var ma = 1.0;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    ma = ad.x;
    if (d.x > 0.0) { face = 0.0; sc = -d.z; } else { face = 1.0; sc = d.z; }
    tc = -d.y;
  } else if (ad.y >= ad.z) {
    ma = ad.y;
    if (d.y > 0.0) { face = 2.0; tc = d.z; } else { face = 3.0; tc = -d.z; }
    sc = d.x;
  } else {
    ma = ad.z;
    if (d.z > 0.0) { face = 4.0; sc = d.x; } else { face = 5.0; sc = -d.x; }
    tc = -d.y;
  }
  return vec3f(vec2f(sc, tc) / ma * 0.5 + 0.5, face);
}

// Nahtloses bilineares Abtasten (für Grafikkarten ohne nahtlose Cubemap-Filterung, z. B. SwiftShader).
fn loadDir(t: texture_2d_array<f32>, s: sampler, q: vec3f) -> vec4f {
  let u = cubeUV(q);
  return textureSampleLevel(t, s, u.xy, i32(u.z), 0.0);
}

fn sampleCube(t: texture_2d_array<f32>, s: sampler, p: vec3f) -> vec4f {
  let n = f32(textureDimensions(t).x);
  let u = cubeUV(p);
  let x = u.xy * n - 0.5;
  if (all(x >= vec2f(0.0)) && all(x <= vec2f(n - 1.0))) {
    return textureSampleLevel(t, s, u.xy, i32(u.z), 0.0);
  }
  let i0 = floor(x);
  let f = x - i0;
  let face = u32(u.z);
  var c: array<vec4f, 4>;
  for (var k = 0u; k < 4u; k++) {
    let ij = i0 + vec2f(f32(k & 1u), f32(k >> 1u));
    if (all(ij >= vec2f(0.0)) && all(ij <= vec2f(n - 1.0))) {
      c[k] = textureLoad(t, vec2i(ij), i32(face), 0);
    } else {
      c[k] = loadDir(t, s, faceDir(face, (ij + 0.5) / n));
    }
  }
  return mix(mix(c[0], c[1], f.x), mix(c[2], c[3], f.x), f.y);
}

fn east(p: vec3f) -> vec3f {
  let e = cross(vec3f(0.0, 1.0, 0.0), p);
  let l = length(e);
  return select(vec3f(1.0, 0.0, 0.0), e / l, l > 1e-5);
}

fn north(p: vec3f) -> vec3f { return cross(p, east(p)); }

fn latitude(p: vec3f) -> f32 { return asin(clamp(p.y, -1.0, 1.0)); }

fn stepOn(p: vec3f, v: vec3f) -> vec3f { return normalize(p + v); }

fn tangent(p: vec3f, v: vec3f) -> vec3f { return v - p * dot(p, v); }

fn pcg3d(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

fn rand3(a: vec3u) -> vec3f { return vec3f(pcg3d(a)) / 4294967295.0; }
