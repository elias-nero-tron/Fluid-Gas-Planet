// Stable Fluids (Stam 1999) auf der Kugel.
// Ablauf pro Schritt: advect -> curl -> zonalClear/zonalSum -> forces -> divergence -> jacobi×K -> project.
//
// Ableitungen: Nachbarn sind die echten Nachbarzellen des Würfelgitters. Ihre Richtungen
// kommen aus der Flächenparametrisierung (auch über die Flächenkante hinaus, dann landet
// die Abtastung nahtlos auf der Nachbarfläche). Weil die Zellen des Würfelgitters nicht
// gleich groß und nicht rechtwinklig sind, wird der Gradient aus einem 2×2-System mit den
// tatsächlichen Abstandsvektoren gelöst. Der Laplace-Operator für den Druck ist kompakt
// (direkte Nachbarn, wie in GPU Gems 38) und dämpft dadurch Zickzack-Moden in Gittergröße.

@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcA: texture_cube<f32>;
@group(0) @binding(3) var srcB: texture_cube<f32>;
@group(0) @binding(4) var dst: texture_storage_2d_array<rgba16float, write>;
// Breitenkreis-Mittel des Ostwinds: [2·i] = Summe, [2·i+1] = Gewicht, Festkomma.
@group(0) @binding(5) var<storage, read_write> zonal: array<atomic<i32>>;

const ZBINS = 128u;
const ZSCALE = 10000.0;

fn A(d: vec3f) -> vec4f { return textureSampleLevel(srcA, samp, d, 0.0); }
fn B(d: vec3f) -> vec4f { return textureSampleLevel(srcB, samp, d, 0.0); }

fn outside(id: vec3u) -> bool { return f32(id.x) >= S.velN || f32(id.y) >= S.velN; }

fn put(id: vec3u, v: vec4f) { textureStore(dst, id.xy, id.z, v); }

fn safe(v: vec3f) -> vec3f {
  // NaN/Inf-Schutz und Obergrenze für die Geschwindigkeit (rad/s).
  if (any(v != v) || any(abs(v) > vec3f(1e4))) { return vec3f(0.0); }
  let l = length(v);
  return select(v, v * (1.5 / l), l > 1.5);
}

// Zelle mit ihren vier Gitternachbarn und einer lokalen Orthonormalbasis.
struct Cell {
  p: vec3f,
  pE: vec3f, pW: vec3f, pN: vec3f, pS: vec3f,
  e1: vec3f, e2: vec3f,
  inv: mat2x2f,     // bildet (fE−fW, fN−fS) auf den Gradienten (in e1/e2) ab
  ax: f32, ay: f32, // 1/Abstand² für den Laplace-Operator
  size: f32,        // mittlere Zellgröße (rad)
};

fn cell(id: vec3u) -> Cell {
  let n = S.velN;
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
  // Zeilen: dA und dB in der lokalen Basis. Gradient g erfüllt M·g = (fE−fW, fN−fS).
  let a = dot(dA, c.e1); let b = dot(dA, c.e2);
  let cc = dot(dB, c.e1); let dd = dot(dB, c.e2);
  let det = a * dd - b * cc;
  // Inverse von [[a, b], [cc, dd]] (WGSL-Matrizen sind spaltenweise).
  c.inv = mat2x2f(vec2f(dd, -cc), vec2f(-b, a)) * (1.0 / det);
  let hx = length(dA) * 0.5;
  let hy = length(dB) * 0.5;
  c.ax = 1.0 / (hx * hx);
  c.ay = 1.0 / (hy * hy);
  c.size = 0.5 * (hx + hy);
  return c;
}

fn grad2(c: Cell, dfA: f32, dfB: f32) -> vec2f { return c.inv * vec2f(dfA, dfB); }

@compute @workgroup_size(8, 8, 1)
fn initVel(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let p = cell(id).p;
  var v = east(p) * jetAt(latitude(p)) + curlOnSphere(p, 3.0, S.seed, 3) * 0.01;
  // Stürme als Anfangswirbel einsetzen. Danach leben sie nur noch von der Physik
  // (außer "Stürme festhalten" ist aufgedreht).
  v = mix(v, stormFlow(p), stormMask(p, 1.1).w);
  put(id, vec4f(tangent(p, v), 0.0));
}

@compute @workgroup_size(8, 8, 1)
fn clear(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  put(id, vec4f(0.0));
}

// Semi-Lagrange-Advektion, optional mit BFECC-Korrektur (wie im mofu-Artikel, nur in 3D).
@compute @workgroup_size(8, 8, 1)
fn advect(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let p = cell(id).p;
  let dt = S.dt;
  let u0 = A(p).xyz;
  var src = stepOn(p, -u0 * dt);
  if (S.bfecc > 0.5) {
    let u1 = A(src).xyz;
    let back = stepOn(src, u1 * dt);
    let p3 = normalize(p - (back - p) * 0.5);
    let u2 = A(p3).xyz;
    src = stepOn(p3, -u2 * dt);
  }
  let v = A(src).xyz;
  // Paralleltransport: in die Tangentialebene bei p projizieren, Betrag erhalten.
  var vt = tangent(p, v);
  vt *= length(v) / max(length(vt), 1e-6);
  vt /= 1.0 + S.dissipation * dt;
  put(id, vec4f(safe(vt), 0.0));
}

// Wirbelstärke ζ = ∂v/∂x − ∂u/∂y (Normalkomponente der Rotation) -> x
@compute @workgroup_size(8, 8, 1)
fn curl(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let dA = A(c.pE).xyz - A(c.pW).xyz;
  let dB = A(c.pN).xyz - A(c.pS).xyz;
  let g1 = grad2(c, dot(dA, c.e1), dot(dB, c.e1));   // ∇u₁
  let g2 = grad2(c, dot(dA, c.e2), dot(dB, c.e2));   // ∇u₂
  put(id, vec4f(g2.x - g1.y, 0.0, 0.0, 0.0));
}

// ---------- Breitenkreis-Mittel des Ostwinds ----------

@compute @workgroup_size(64, 1, 1)
fn zonalClear(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < ZBINS * 2u) { atomicStore(&zonal[id.x], 0); }
}

fn zbin(p: vec3f) -> u32 { return min(u32((latitude(p) / PI + 0.5) * f32(ZBINS)), ZBINS - 1u); }

@compute @workgroup_size(8, 8, 1)
fn zonalSum(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let u = A(c.p).xyz;
  // Gewicht = Zellfläche, damit kleine Zellen an Würfelkanten nicht überzählen.
  let w = c.size * c.size * S.velN * S.velN;
  let b = zbin(c.p);
  atomicAdd(&zonal[2u * b], i32(dot(u, east(c.p)) * w * ZSCALE));
  atomicAdd(&zonal[2u * b + 1u], i32(w * 1000.0));
}

fn zonalMean(p: vec3f) -> f32 {
  // Linear zwischen den Nachbarbändern interpolieren, sonst entstehen Stufen.
  let x = (latitude(p) / PI + 0.5) * f32(ZBINS) - 0.5;
  let i0 = u32(clamp(floor(x), 0.0, f32(ZBINS - 1u)));
  let i1 = min(i0 + 1u, ZBINS - 1u);
  let m0 = f32(atomicLoad(&zonal[2u * i0])) / ZSCALE / max(f32(atomicLoad(&zonal[2u * i0 + 1u])) / 1000.0, 1e-6);
  let m1 = f32(atomicLoad(&zonal[2u * i1])) / ZSCALE / max(f32(atomicLoad(&zonal[2u * i1 + 1u])) / 1000.0, 1e-6);
  return mix(m0, m1, clamp(x - floor(x), 0.0, 1.0));
}

// Kräfte. A = Geschwindigkeit, B = Wirbelstärke.
@compute @workgroup_size(8, 8, 1)
fn forces(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let p = c.p;
  let dt = S.dt;
  var u = A(p).xyz;

  // Jets: nur das Breitenkreis-Mittel wird zum gemessenen Profil gezogen.
  // Wirbel (Abweichungen vom Mittel) bleiben unberührt und können wachsen.
  let e = east(p);
  u += e * (jetAt(latitude(p)) - zonalMean(p)) * min(S.jetRelax * dt, 1.0);

  // Coriolis: Drehung des Windvektors um die Flächennormale, f = 2Ω·sin(Breite).
  let a = -2.0 * S.omega * p.y * dt;
  u = u * cos(a) + cross(p, u) * sin(a);

  // Stürme: Windfeld im Sturmgebiet zum Drehprofil ziehen.
  let sf = stormFlow(p);
  let sw = stormMask(p, 1.1).w;
  u += (sf - u) * clamp(sw * 2.0 * dt, 0.0, 1.0);

  // Langsam wandernde Anregung: stößt Instabilitäten an. Die Reibung begrenzt die Energie.
  u += curlOnSphere(p, S.turbScale, S.time * 0.3 + S.seed, 2) * S.turbulence * dt;

  // Vorticity Confinement (Fedkiw 2001): f = ε·Δx·(N × ω), N = ∇|ω| / |∇|ω||
  if (S.confinement > 0.0) {
    let g = grad2(c, abs(B(c.pE).x) - abs(B(c.pW).x), abs(B(c.pN).x) - abs(B(c.pS).x));
    let gl = length(g);
    if (gl > 1e-6) {
      let nvec = (c.e1 * g.x + c.e2 * g.y) / gl;
      u += cross(nvec, p) * B(p).x * S.confinement * c.size * dt;
    }
  }

  u /= 1.0 + S.drag * dt;
  put(id, vec4f(safe(tangent(p, u)), 0.0));
}

// Divergenz ∇·u -> x
@compute @workgroup_size(8, 8, 1)
fn divergence(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let dA = A(c.pE).xyz - A(c.pW).xyz;
  let dB = A(c.pN).xyz - A(c.pS).xyz;
  let g1 = grad2(c, dot(dA, c.e1), dot(dB, c.e1));
  let g2 = grad2(c, dot(dA, c.e2), dot(dB, c.e2));
  put(id, vec4f(g1.x + g2.y, 0.0, 0.0, 0.0));
}

// Jacobi-Schritt für ∇²p = ∇·u mit kompaktem 5-Punkt-Stern. A = Druck, B = Divergenz.
@compute @workgroup_size(8, 8, 1)
fn jacobi(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let s = c.ax * (A(c.pE).x + A(c.pW).x) + c.ay * (A(c.pN).x + A(c.pS).x);
  let pr = (s - B(c.p).x) / (2.0 * (c.ax + c.ay));
  put(id, vec4f(pr, 0.0, 0.0, 0.0));
}

// Druckgradient abziehen -> divergenzfreier Wind. A = Geschwindigkeit, B = Druck.
@compute @workgroup_size(8, 8, 1)
fn project(@builtin(global_invocation_id) id: vec3u) {
  if (outside(id)) { return; }
  let c = cell(id);
  let g = grad2(c, B(c.pE).x - B(c.pW).x, B(c.pN).x - B(c.pS).x);
  let u = A(c.p).xyz - (c.e1 * g.x + c.e2 * g.y);
  put(id, vec4f(safe(tangent(c.p, u)), 0.0));
}
