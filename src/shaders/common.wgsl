// Gemeinsame Bausteine für alle Compute-Shader.
// Alle Felder liegen als Cubemap (6 Ebenen) auf der Einheitskugel.
// Vektoren (Wind) werden als 3D-Tangentialvektoren in Körperkoordinaten gespeichert,
// dadurch gibt es keine Pol-Singularität und keine Sonderfälle an Würfelkanten.

const PI = 3.14159265359;
const MAX_STORMS = 8u;

struct Sim {
  dt: f32, time: f32, frame: f32, velN: f32,
  dyeN: f32, flowN: f32, h: f32, omega: f32,
  jetStrength: f32, jetRelax: f32, turbulence: f32, turbScale: f32,
  confinement: f32, drag: f32, dissipation: f32, bfecc: f32,
  bandRelax: f32, convection: f32, stormStrength: f32, stormCount: f32,
  curlStrength: f32, curlFreq: f32, curlSpeed: f32, curlOctaves: f32,
  particleCount: f32, lifetime: f32, opacity: f32, blur: f32,
  seed: f32, bandWobble: f32, stormTint: f32, particleSize: f32,
  jets: array<vec4f, 16>,       // 64 Stützstellen, Breite −90°..+90°, Einheit rad/s bei jetStrength 1
  bands: array<vec4f, 64>,      // Bandfarbe (linear RGB) je Breite
  storms: array<vec4f, 8>,      // xyz Zentrum (Körperkoordinaten), w Radius in rad
  stormInfo: array<vec4f, 8>,   // x Drehsinn·Stärke, yzw Farbe
};

@group(0) @binding(0) var<uniform> S: Sim;

// ---------- Cubemap-Abbildung (WebGPU-Konvention: +X −X +Y −Y +Z −Z) ----------

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

// Richtung -> (Fläche, Texel) für Schreibzugriffe aus Partikeln.
fn dirToTexel(d: vec3f, n: u32) -> vec3u {
  let ad = abs(d);
  var face = 0u; var sc = 0.0; var tc = 0.0; var ma = 1.0;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    ma = ad.x;
    if (d.x > 0.0) { face = 0u; sc = -d.z; } else { face = 1u; sc = d.z; }
    tc = -d.y;
  } else if (ad.y >= ad.z) {
    ma = ad.y;
    if (d.y > 0.0) { face = 2u; tc = d.z; } else { face = 3u; tc = -d.z; }
    sc = d.x;
  } else {
    ma = ad.z;
    if (d.z > 0.0) { face = 4u; sc = d.x; } else { face = 5u; sc = -d.x; }
    tc = -d.y;
  }
  let st = clamp(vec2f(sc, tc) / ma * 0.5 + 0.5, vec2f(0.0), vec2f(0.99999));
  let px = vec2u(st * f32(n));
  return vec3u(px, face);
}

// Orthonormale Tangentenbasis. Die Wahl darf von Punkt zu Punkt springen,
// weil Divergenz, Laplace und Gradient unabhängig von der Basisdrehung sind.
fn tangentBasis(p: vec3f) -> mat2x3f {
  let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(p.y) < 0.9);
  let e1 = normalize(cross(helper, p));
  let e2 = cross(p, e1);
  return mat2x3f(e1, e2);
}

fn east(p: vec3f) -> vec3f {
  let e = cross(vec3f(0.0, 1.0, 0.0), p);
  let l = length(e);
  return select(vec3f(1.0, 0.0, 0.0), e / l, l > 1e-5);
}

fn latitude(p: vec3f) -> f32 { return asin(clamp(p.y, -1.0, 1.0)); }

fn stepOn(p: vec3f, v: vec3f) -> vec3f { return normalize(p + v); }

fn tangent(p: vec3f, v: vec3f) -> vec3f { return v - p * dot(p, v); }

// ---------- Tabellen ----------

fn jetAt(lat: f32) -> f32 {
  let x = clamp((lat / PI + 0.5) * 63.0, 0.0, 63.0);
  let i = u32(floor(x));
  let j = min(i + 1u, 63u);
  let a = S.jets[i / 4u][i % 4u];
  let b = S.jets[j / 4u][j % 4u];
  return mix(a, b, fract(x)) * S.jetStrength;
}

fn bandAt(lat: f32) -> vec3f {
  let x = clamp((lat / PI + 0.5) * 63.0, 0.0, 63.0);
  let i = u32(floor(x));
  let j = min(i + 1u, 63u);
  return mix(S.bands[i].rgb, S.bands[j].rgb, fract(x));
}

// ---------- Zufall und Rauschen ----------

fn pcg3d(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

fn hash3(i: vec3f) -> vec3f {
  let h = pcg3d(bitcast<vec3u>(vec3i(i)));
  return vec3f(h) * (2.0 / 4294967295.0) - 1.0;
}

fn rand4(a: u32, b: u32) -> vec4f {
  let h = pcg3d(vec3u(a, b, 0x9e3779b9u));
  let g = pcg3d(h.zxy ^ vec3u(b, a, 7u));
  return vec4f(vec3f(h), f32(g.x)) / 4294967295.0;
}

// Gradientenrauschen mit analytischer Ableitung: x = Wert, yzw = Gradient.
fn noised(x: vec3f) -> vec4f {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  let ga = hash3(i + vec3f(0.0, 0.0, 0.0));
  let gb = hash3(i + vec3f(1.0, 0.0, 0.0));
  let gc = hash3(i + vec3f(0.0, 1.0, 0.0));
  let gd = hash3(i + vec3f(1.0, 1.0, 0.0));
  let ge = hash3(i + vec3f(0.0, 0.0, 1.0));
  let gf = hash3(i + vec3f(1.0, 0.0, 1.0));
  let gg = hash3(i + vec3f(0.0, 1.0, 1.0));
  let gh = hash3(i + vec3f(1.0, 1.0, 1.0));

  let va = dot(ga, f - vec3f(0.0, 0.0, 0.0));
  let vb = dot(gb, f - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, f - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, f - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, f - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, f - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, f - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, f - vec3f(1.0, 1.0, 1.0));

  let k0 = va;
  let k1 = vb - va;
  let k2 = vc - va;
  let k3 = ve - va;
  let k4 = va - vb - vc + vd;
  let k5 = va - vc - ve + vg;
  let k6 = va - vb - ve + vf;
  let k7 = -va + vb + vc - vd + ve - vf - vg + vh;

  let value = k0 + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5
            + u.z * u.x * k6 + u.x * u.y * u.z * k7;

  let grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
           + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
           + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
           + du * (vec3f(k1, k2, k3) + u.yzx * vec3f(k4, k5, k6) + u.zxy * vec3f(k6, k4, k5)
                   + u.yzx * u.zxy * k7);
  return vec4f(value, grad);
}

// Divergenzfreies Rauschfeld auf der Kugel: v = p × ∇ψ (ψ = FBM-Rauschen als Stromfunktion).
fn curlOnSphere(p: vec3f, freq: f32, t: f32, octaves: i32) -> vec3f {
  var g = vec3f(0.0);
  var amp = 1.0;
  var fr = freq;
  for (var o = 0; o < octaves; o++) {
    let off = vec3f(f32(o) * 17.3, t * (1.0 + 0.37 * f32(o)), f32(o) * -9.1);
    g += noised(p * fr + off).yzw * amp * fr / freq;
    amp *= 0.5;
    fr *= 2.03;
  }
  return cross(p, g);
}

// Drehfeld eines Sturms: Rotation um das Zentrum, Gauß-Profil.
fn stormFlow(p: vec3f) -> vec3f {
  var v = vec3f(0.0);
  let n = u32(S.stormCount);
  for (var i = 0u; i < min(n, MAX_STORMS); i++) {
    let c = S.storms[i].xyz;
    let r = S.storms[i].w;
    let d = acos(clamp(dot(c, p), -1.0, 1.0));
    let x = d / r;
    // Geschwindigkeit ~ x·exp(−x²): null im Kern, Maximum am Rand, dann Abfall.
    let prof = x * exp(-x * x) * 2.33;
    v += cross(c, p) / max(sin(d), 1e-4) * prof * S.stormInfo[i].x;
  }
  return v * S.stormStrength;
}

// scale: Maskenradius relativ zum Sturmradius
fn stormMask(p: vec3f, scale: f32) -> vec4f {
  var tint = vec3f(0.0);
  var w = 0.0;
  let n = u32(S.stormCount);
  for (var i = 0u; i < min(n, MAX_STORMS); i++) {
    let c = S.storms[i].xyz;
    let r = S.storms[i].w;
    let d = acos(clamp(dot(c, p), -1.0, 1.0));
    let m = exp(-pow(d / (r * scale), 2.0));
    tint += S.stormInfo[i].yzw * m;
    w += m;
  }
  return vec4f(tint / max(w, 1e-4), min(w, 1.0));
}
