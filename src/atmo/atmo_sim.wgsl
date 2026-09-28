// Modul „Atmosphäre“: feuchte, thermische Flachwasser-Atmosphäre auf der Kugel.
//
// Gleichungen (Zerroukat & Allen 2015, J. Comput. Phys. 290; umgesetzt wie in Gusto,
// UK Met Office, MIT-Lizenz: ThermalShallowWaterEquations, SWSaturationAdjustment, InstantRain):
//   ∂u/∂t + (u·∇)u + f k×u = −b∇(D + B) − ½·D·∇b                 Impuls
//   ∂D/∂t + ∇·(D u)        = −β₁·C                               Masse (konvektive Rückkopplung, mcRSW)
//   ∂b/∂t + u·∇b           = −β₂·C          mit b = g(1 − θ)      Wärme: Kondensation heizt (θ steigt)
//   ∂q_v/∂t + u·∇q_v = −C + E,   ∂q_c/∂t + u·∇q_c = C − P       Dampf, Wolkenwasser
//   q_sat = q₀/(gD) · exp(ν(1 − b/g)) = q₀/(gD) · exp(ν·θ)          Sättigung (Clausius–Clapeyron-artig)
//   C = γ_v·(q_v − q_sat)/Δt, begrenzt auf [−q_c, q_v]/Δt,  γ_v = 1/(1 + ν·β₂/g·q_sat)
//   P = γ_r·max(0, q_c − q_precip)/Δt
// B ist die „Bodenhöhe“: beim Gasriesen die Wirkung der tiefen Jets (Dowling & Ingersoll 1989:
// die tiefe Strömung wirkt auf die Wetterschicht wie Topografie), beim Gesteinsplaneten später echtes Gelände.
// Antrieb: Newton-Abkühlung zu η_eq, θ_eq (Held & Suarez 1994), Stürme als Massenpulse
// (Showman 2007; Formel wie canoe/exo3 test_injection.cpp, Li & Chen, MIT-Lizenz), Ereignisse (Tippen).
//
// Einheiten: Planetenradius 1, D in Einheiten der mittleren Tiefe H, c² = gH, Zeit in Sim-Sekunden.
// Gespeichert: A = (u.xyz als 3D-Tangentialvektor, η = D − 1), B = (θ, q_v, q_c, Asche).
// Ablauf pro Teilschritt: aAdvect (Semi-Lagrange) → aMass (Kontinuität, Physik) → aMomentum (Druck, Coriolis).

struct Atmo {
  dt: f32, time: f32, n: f32, events: f32,
  omega: f32, c2: f32, relax: f32, drag: f32,
  nu: f32, beta1: f32, beta2: f32, qPrecip: f32,
  rain: f32, evap: f32, rhSurf: f32, diff: f32,
  seed: f32, q0: f32, ashFall: f32, fMin: f32,
  test: f32, nudge: f32, pad0: f32, pad1: f32,
  eq: array<vec4f, 128>,   // je Breite (−90°..90°): x η_eq, y θ_eq, z u_eq (Ostwind, rad/s), w dB/dφ
  ev: array<vec4f, 48>,    // 16 Ereignisse × 3: (Zentrum xyz, Radius) (Δη, Δθ, Δq_v, ΔAsche) (Wind balanciert, radial, 0, 0)
};

@group(0) @binding(0) var<uniform> U: Atmo;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcA: texture_cube<f32>;
@group(0) @binding(3) var srcB: texture_cube<f32>;
@group(0) @binding(4) var dstA: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(5) var dstB: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(6) var arrA: texture_2d_array<f32>;
@group(0) @binding(7) var arrB: texture_2d_array<f32>;

override SEAMLESS: bool = false;
fn A(d: vec3f) -> vec4f {
  if (SEAMLESS) { return sampleCube(arrA, samp, d); }
  return textureSampleLevel(srcA, samp, d, 0.0);
}
fn B(d: vec3f) -> vec4f {
  if (SEAMLESS) { return sampleCube(arrB, samp, d); }
  return textureSampleLevel(srcB, samp, d, 0.0);
}

fn outside(id: vec3u) -> bool { return f32(id.x) >= U.n || f32(id.y) >= U.n; }

fn eqAt(lat: f32) -> vec4f {
  let x = clamp((lat / PI + 0.5) * 127.0, 0.0, 127.0);
  let i = u32(floor(x));
  let j = min(i + 1u, 127u);
  return mix(U.eq[i], U.eq[j], fract(x));
}

fn qsat(D: f32, th: f32) -> f32 { return U.q0 * exp(U.nu * th) / max(D, 0.05); }

fn safe(v: vec3f) -> vec3f {
  if (any(v != v) || any(abs(v) > vec3f(1e4))) { return vec3f(0.0); }
  let l = length(v);
  return select(v, v * (3.0 / l), l > 3.0);
}

// Zelle mit Gitternachbarn und lokaler Basis (wie fluid.wgsl): Gradient aus den echten Abstandsvektoren.
struct Cell {
  p: vec3f, pE: vec3f, pW: vec3f, pN: vec3f, pS: vec3f,
  e1: vec3f, e2: vec3f, inv: mat2x2f, ax: f32, ay: f32, size: f32,
};

fn cell(id: vec3u) -> Cell {
  let n = U.n;
  let st = (vec2f(id.xy) + 0.5) / n;
  let d = 1.0 / n;
  var c: Cell;
  c.p = faceDir(id.z, st);
  c.pE = faceDir(id.z, st + vec2f(d, 0.0));
  c.pW = faceDir(id.z, st - vec2f(d, 0.0));
  c.pN = faceDir(id.z, st + vec2f(0.0, d));
  c.pS = faceDir(id.z, st - vec2f(0.0, d));
  let dA = c.pE - c.pW;
  let dB = c.pN - c.pS;
  c.e1 = normalize(tangent(c.p, dA));
  c.e2 = cross(c.p, c.e1);
  let a = dot(dA, c.e1); let b = dot(dA, c.e2);
  let cc = dot(dB, c.e1); let dd = dot(dB, c.e2);
  c.inv = mat2x2f(vec2f(dd, -cc), vec2f(-b, a)) * (1.0 / (a * dd - b * cc));
  let hx = length(dA) * 0.5;
  let hy = length(dB) * 0.5;
  c.ax = 1.0 / (hx * hx);
  c.ay = 1.0 / (hy * hy);
  c.size = 0.5 * (hx + hy);
  return c;
}

fn grad(c: Cell, fE: f32, fW: f32, fN: f32, fS: f32) -> vec3f {
  let g = c.inv * vec2f(fE - fW, fN - fS);
  return c.e1 * g.x + c.e2 * g.y;
}

// Ereignis k: Zentrum, Radius, Gauß-Gewicht exp(−½ d²/r²) und Abstand d (rad).
fn evPos(k: u32) -> vec4f { return U.ev[3u * k]; }
fn evSrc(k: u32) -> vec4f { return U.ev[3u * k + 1u]; }
fn evVel(k: u32) -> vec4f { return U.ev[3u * k + 2u]; }
fn evDist(k: u32, p: vec3f) -> f32 { return acos(clamp(dot(evPos(k).xyz, p), -1.0, 1.0)); }

// Paralleltransport eines Tangentialvektors v von a nach b entlang des Großkreises (Rodrigues).
fn transport(a: vec3f, b: vec3f, v: vec3f) -> vec3f {
  let k = cross(a, b);
  let s = length(k);
  if (s < 1e-7) { return tangent(b, v); }
  let kk = k / s;
  let c = dot(a, b);
  return tangent(b, v * c + cross(kk, v) * s + kk * dot(kk, v) * (1.0 - c));
}

@compute @workgroup_size(8, 8, 1)
fn aInit(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let p = faceDir(id.z, (vec2f(id.xy) + 0.5) / U.n);
  let lat = latitude(p);
  let e = eqAt(lat);
  var eta = e.x;
  if (U.test > 0.5) {
    // Galewsky, Scott & Polvani 2004: Beule ĥ = 120 m auf H = 10 km, α = 1/3, β = 1/15, φ₂ = π/4.
    let lon = atan2(-p.z, p.x);
    eta += 0.012 * cos(lat) * exp(-pow(lon * 3.0, 2.0)) * exp(-pow((PI / 4.0 - lat) * 15.0, 2.0));
  } else {
    // Winzige Unordnung, damit Instabilitäten einen Anfang haben.
    eta += (rand3(vec3u(id.xy, id.z + u32(U.seed) * 8u)).x - 0.5) * 0.002;
  }
  let u = east(p) * e.z;
  let th = e.y;
  let qv = U.rhSurf * qsat(1.0 + eta, th);
  textureStore(dstA, id.xy, id.z, vec4f(tangent(p, u), eta));
  textureStore(dstB, id.xy, id.z, vec4f(th, qv, 0.0, 0.0));
}

// 1) Semi-Lagrange: alle Größen vom Abfahrtspunkt holen (Mittelpunktregel), Wind parallel transportieren.
@compute @workgroup_size(8, 8, 1)
fn aAdvect(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let p = faceDir(id.z, (vec2f(id.xy) + 0.5) / U.n);
  let dt = U.dt;
  let mid = stepOn(p, -A(p).xyz * dt * 0.5);
  let src = stepOn(p, -transport(mid, p, A(mid).xyz) * dt);
  let a = A(src);
  var b = B(src);
  if (any(b != b)) { b = vec4f(eqAt(latitude(p)).y, 0.0, 0.0, 0.0); }
  textureStore(dstA, id.xy, id.z, vec4f(safe(transport(src, p, a.xyz)), select(a.w, 0.0, a.w != a.w)));
  textureStore(dstB, id.xy, id.z, b);
}

// 2) Kontinuität D ← D·exp(−Δt·∇·u) (Lagrange-Form, bleibt positiv), Glättung, Strahlung,
//    Ereignisse, Sättigungsausgleich, Regen. A = nach Advektion, B = nach Advektion.
@compute @workgroup_size(8, 8, 1)
fn aMass(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let dt = U.dt;
  let aC = A(c.p); let aE = A(c.pE); let aW = A(c.pW); let aN = A(c.pN); let aS = A(c.pS);
  let dA = aE.xyz - aW.xyz;
  let dB = aN.xyz - aS.xyz;
  let g1 = c.inv * vec2f(dot(dA, c.e1), dot(dB, c.e1));
  let g2 = c.inv * vec2f(dot(dA, c.e2), dot(dB, c.e2));
  let div = g1.x + g2.y;
  var D = (1.0 + aC.w) * exp(-div * dt);
  // Schwache Diffusion der Schichtdicke gegen Gitterrauschen (ν·Δt/Δx² = U.diff).
  let lap = (aE.w + aW.w - 2.0 * aC.w) * c.ax + (aN.w + aS.w - 2.0 * aC.w) * c.ay;
  D += U.diff * lap / (c.ax + c.ay);

  let eq = eqAt(latitude(c.p));
  var b = B(c.p);
  // Newton-Abkühlung (Held & Suarez 1994): Dicke und Temperatur kehren zum Gleichgewicht zurück.
  let k = 1.0 - exp(-U.relax * dt);
  D += (1.0 + eq.x - D) * k;
  b.x += (eq.y - b.x) * k;

  // Ereignisse: Gauß-Pulse in Masse, Wärme, Dampf, Asche.
  for (var i = 0u; i < u32(U.events); i++) {
    let r = evPos(i).w;
    let d = evDist(i, c.p);
    if (d > 4.0 * r) { continue; }
    let g = exp(-0.5 * d * d / (r * r));
    let s = evSrc(i);
    D += s.x * g; b.x += s.y * g; b.y += s.z * g; b.w += s.w * g;
  }
  D = max(D, 0.05);

  // Feuchte (Zerroukat & Allen 2015): Nachschub aus der Tiefe, Sättigungsausgleich, Regen.
  var qs = qsat(D, b.x);
  b.y += max(U.rhSurf * qs - b.y, 0.0) * (1.0 - exp(-U.evap * dt));
  let gv = 1.0 / (1.0 + U.nu * U.beta2 * qs);
  let cq = clamp(gv * (b.y - qs), -max(b.z, 0.0), max(b.y, 0.0));   // > 0 Kondensation, < 0 Wolke verdunstet
  b.y -= cq;
  b.z += cq;
  b.x += U.beta2 * cq;          // latente Wärme
  D = max(D - U.beta1 * cq, 0.05);
  b.z -= max(b.z - U.qPrecip, 0.0) * (1.0 - exp(-U.rain * dt));
  b.w *= exp(-U.ashFall * dt);

  textureStore(dstA, id.xy, id.z, vec4f(aC.xyz, D - 1.0));
  textureStore(dstB, id.xy, id.z, vec4f(b.x, max(b.y, 0.0), max(b.z, 0.0), max(b.w, 0.0)));
}

// 3) Impuls: Druckkraft −c²·[b̃∇(η + B) − ½·D·∇θ] (b̃ = 1 − θ), Ereignis-Wind, Coriolis als exakte Drehung.
//    A = nach aMass (η neu), B = Tracer nach aMass.
@compute @workgroup_size(8, 8, 1)
fn aMomentum(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let p = c.p;
  let dt = U.dt;
  let aC = A(p);
  var u = aC.xyz;
  let D = 1.0 + aC.w;
  let th = B(p).x;
  let lat = latitude(p);
  let eq = eqAt(lat);
  let gEta = grad(c, A(c.pE).w, A(c.pW).w, A(c.pN).w, A(c.pS).w) + north(p) * eq.w;
  let gTh = grad(c, B(c.pE).x, B(c.pW).x, B(c.pN).x, B(c.pS).x);
  u -= U.c2 * ((1.0 - th) * gEta - 0.5 * D * gTh) * dt;

  let f = 2.0 * U.omega * p.y;
  // Ereignisse: geostrophisch balancierter Wind zum Massenpuls (u = c²/f · k×∇η, wie canoe/exo3)
  // und radialer Stoß (Explosion, Einschlag).
  for (var i = 0u; i < u32(U.events); i++) {
    let pos = evPos(i);
    let r = pos.w;
    let d = evDist(i, p);
    if (d > 4.0 * r || d < 1e-6) { continue; }
    let g = exp(-0.5 * d * d / (r * r));
    let er = normalize(tangent(p, p - pos.xyz));
    let vel = evVel(i);
    if (vel.x != 0.0) {
      let gradEv = -evSrc(i).x * g * d / (r * r) * er;
      let fb = select(-1.0, 1.0, f >= 0.0) * max(abs(f), U.fMin);
      u += vel.x * U.c2 / fb * cross(p, gradEv);
    }
    u += er * vel.y * (d / r) * g;
  }

  let a = -f * dt;
  u = u * cos(a) + cross(p, u) * sin(a);
  u /= 1.0 + U.drag * dt;
  // Optional: sanft zum Gleichgewichts-Jet ziehen (0 = frei).
  u += (east(p) * eq.z - u) * (1.0 - exp(-U.nudge * dt));
  textureStore(dstA, id.xy, id.z, vec4f(safe(tangent(p, u)), aC.w));
}
