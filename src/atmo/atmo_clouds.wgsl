// Modul „Atmosphäre“: Wolkenschicht als dünne Volumenschale über dem Planeten, als eigener
// Zeichendurchgang über das fertige Planetenbild gemischt (vormultipliziertes Alpha).
// Ausgabe: rgb = Wolkenlicht, a = Faktor für das Bild darunter (Durchlässigkeit × Wolkenschatten).
//
// Verfahren wie takram three-clouds (MIT, clouds.glsl / clouds.frag), das Nubis (Schneider, Guerrilla)
// umsetzt – nur dass die „Wetterkarte“ nicht gemalt ist, sondern aus der Simulation kommt:
//   Bedeckung     w = 1 − exp(−k·q_c)                          (optische Dicke ∝ Wolkenwasser, Stephens 1978)
//   Höhenprofil   1 − (2·h^0,35 − 1)²                           (runde Kuppen, shapeAlteringFunction)
//   Bedeckung → Dichte  remap(mix(w, 1, 0,6), 1 − C·Profil, 1 − C·Profil + 0,6)   (Skybolt, via takram)
//   Form          remap(Dichte, (1 − Perlin-Worley)·Stärke, 1) und Detail-Erosion
//   Licht         Mehrfachstreuung in Oktaven Σ aⁱ·e^(−bⁱ·τ)·p(cⁱ·cosθ), a = b = c = 0,5 (Wrenninge 2013)
//   Phase         zwei Henyey–Greenstein-Keulen g = 0,7 und −0,2, Mischung 0,5
//   Integration   energieerhaltend: S·(1 − e^(−σΔs))/σ (Hillaire 2016, Frostbite)
//   Pulver        1 − 0,8·e^(−2σ) (Schneider 2015)
// Turmhöhe: latente Wärme hebt die Wolkenobergrenze (Auftrieb θ − θ_eq aus der Simulation).

struct CU {
  invViewProj: mat4x4f,
  camPos: vec4f,
  body0: vec4f, body1: vec4f, body2: vec4f,
  sun: vec4f,     // xyz Richtung (Welt), w Intensität
  p0: vec4f,      // x Abplattung, y Belichtung, z Schalendicke H (Radien), w Schritte
  p1: vec4f,      // x optische Dicke K, y Bedeckung k, z θ₀, w Δθ
  p2: vec4f,      // x Zeit, y Formskala, z Detailskala, w Schattenstärke
  p3: vec4f,      // x Asche-Stärke, y Umgebungslicht, z Turm-Auftrieb, w Formstärke
  cloudCol: vec4f,
  ashCol: vec4f,
};

@group(0) @binding(0) var<uniform> C: CU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var fieldB: texture_cube<f32>;
@group(0) @binding(3) var noise: texture_3d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.ndc = xy;
  return o;
}

fn toBody(v: vec3f) -> vec3f { return vec3f(dot(C.body0.xyz, v), dot(C.body1.xyz, v), dot(C.body2.xyz, v)); }

fn remapC(x: f32, a: f32, b: f32) -> f32 { return clamp((x - a) / (b - a), 0.0, 1.0); }

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

// Schnittpunkte mit einer Kugel um den Ursprung: (t0, t1), t0 > t1 = kein Treffer.
fn sphere(o: vec3f, d: vec3f, r: f32) -> vec2f {
  let b = dot(o, d);
  let k = dot(o, o) - r * r;
  let disc = b * b - k;
  if (disc < 0.0) { return vec2f(1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

fn hg(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5));
}

fn phase(c: f32, att: f32) -> f32 { return 0.5 * hg(0.7 * att, c) + 0.5 * hg(-0.2 * att, c); }

fn multiScatter(tau: f32, c: f32) -> f32 {
  var s = 0.0;
  var k = vec3f(1.0);   // a: Beitrag, b: Abschwächung, c: Phasen-Abschwächung
  for (var i = 0; i < 6; i++) {
    s += k.x * exp(-tau * k.y) * phase(c, k.z);
    k *= 0.5;
  }
  return s;
}

struct Media { cloud: f32, ash: f32 };

// Dichte an Punkt x (Einheitskugel-Raum), r = |x|.
fn media(x: vec3f, r: f32, detail: bool) -> Media {
  var m: Media;
  m.cloud = 0.0; m.ash = 0.0;
  let H = C.p0.z;
  let h = (r - 1.0) / H;
  if (h < 0.0 || h > 1.0) { return m; }
  let q = x / r;
  let w = textureSampleLevel(fieldB, samp, q, 0.0);   // θ, q_v, q_c, Asche
  let cov = 1.0 - exp(-C.p1.y * w.z);
  let ash = 1.0 - exp(-C.p3.x * w.w);
  if (cov < 0.01 && ash < 0.01) { return m; }
  let thEq = C.p1.z - C.p1.w * q.y * q.y;
  let top = clamp(0.3 + 0.5 * cov + C.p3.z * max(w.x - thEq, 0.0), 0.15, 1.0);
  let hf = h / top;
  if (hf >= 1.0) { return m; }
  let bias = clamp(pow(hf, 0.35) * 2.0 - 1.0, -1.0, 1.0);
  let hs = 1.0 - bias * bias;
  let factor = 1.0 - 0.4 * hs;
  var dens = remapC(mix(cov, 1.0, 0.6), factor, factor + 0.6);
  var dash = ash * hs;
  let sp = x * C.p2.y + vec3f(C.p2.x * 0.003, 0.0, 0.0);
  let nz = textureSampleLevel(noise, samp, sp, 0.0);
  dens = remapC(dens, (1.0 - nz.r) * C.p3.w, 1.0);
  dash = remapC(dash, (1.0 - nz.r) * 0.6, 1.0);
  if (detail && dens > 0.0) {
    let dn = textureSampleLevel(noise, samp, x * C.p2.z, 0.0).g;
    let mod_ = mix(pow(dn, 6.0), 1.0 - dn, remapC(hf, 0.2, 0.4));
    dens = remapC(dens * 2.0, mod_ * 0.5, 1.0);
  }
  // Dichteprofil wie takram (linear 0,75·h + 0,25)
  m.cloud = clamp(dens * (0.75 * hf + 0.25), 0.0, 1.0);
  m.ash = clamp(dash, 0.0, 1.0);
  return m;
}

fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@fragment
fn fs(vin: VOut) -> @location(0) vec4f {
  let wp = C.invViewProj * vec4f(vin.ndc, 1.0, 1.0);
  let dirW = normalize(wp.xyz / wp.w - C.camPos.xyz);
  let c = 1.0 - C.p0.x;
  let sc = vec3f(1.0, 1.0 / c, 1.0);
  // Raum, in dem der abgeplattete Planet eine Einheitskugel ist.
  let o = toBody(C.camPos.xyz) * sc;
  let d = normalize(toBody(dirW) * sc);
  let sun = normalize(toBody(C.sun.xyz) * sc);
  let H = C.p0.z;

  let shell = sphere(o, d, 1.0 + H);
  if (shell.x > shell.y || shell.y < 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let ground = sphere(o, d, 1.0);
  let hitGround = ground.x <= ground.y && ground.x > 0.0;
  let t0 = max(shell.x, 0.0);
  var t1 = shell.y;
  if (hitGround) { t1 = ground.x; }

  let steps = i32(C.p0.w);
  let dt = (t1 - t0) / f32(steps);
  let jitter = ign(vin.pos.xy);
  let K = C.p1.x / H;          // Extinktion pro Radius bei Dichte 1
  let cosT = dot(d, sun);
  let sunI = C.sun.w;
  var T = 1.0;
  var L = vec3f(0.0);
  var t = t0 + dt * jitter;
  for (var i = 0; i < steps; i++) {
    if (T < 0.01) { break; }
    let x = o + d * t;
    let r = length(x);
    let m = media(x, r, true);
    let sig = (m.cloud + m.ash * 1.2) * K;
    if (sig > 1e-4) {
      // Licht zur Sonne: optische Tiefe über 4 Schritte, Planetenschatten.
      var tau = 0.0;
      let ps = sphere(x, sun, 1.0);
      if (ps.x <= ps.y && ps.x > 0.0) { tau = 1e3; }
      else {
        var ls = H * 0.12;
        var lt = ls * 0.5;
        for (var j = 0; j < 4; j++) {
          let y = x + sun * lt;
          let mm = media(y, length(y), false);
          tau += (mm.cloud + mm.ash * 1.2) * K * ls;
          lt += ls * 1.5; ls *= 1.8;
        }
      }
      let up = x / r;
      let day = smoothstep(-0.15, 0.25, dot(up, sun));
      let hf = (r - 1.0) / H;
      let lightC = sunI * multiScatter(tau, cosT) * 4.0 * PI + C.p3.y * sunI * day * (0.5 + 0.5 * hf);
      let powder = 1.0 - 0.8 * exp(-2.0 * sig * H);
      let frac = m.cloud * K / sig;
      let alb = mix(C.ashCol.rgb, C.cloudCol.rgb, frac);
      let S = alb * lightC * mix(1.0, powder, 0.7);
      let tr = exp(-sig * dt);
      L += T * S * (1.0 - tr);   // = T · S·σ·(1 − e^(−σΔs))/σ
      T *= tr;
    }
    t += dt;
  }

  // Wolkenschatten auf dem Planeten.
  var shade = 1.0;
  if (hitGround) {
    let g = o + d * ground.x;
    if (dot(g, sun) > -0.05) {
      var tau = 0.0;
      let out_ = sphere(g, sun, 1.0 + H).y;
      let ls = out_ / 6.0;
      for (var j = 0; j < 6; j++) {
        let y = g + sun * ls * (f32(j) + 0.5);
        let mm = media(y, length(y), false);
        tau += (mm.cloud + mm.ash * 1.2) * K * ls;
      }
      shade = mix(1.0, 0.25 + 0.75 * exp(-tau), C.p2.w);
    }
  }

  let alpha = 1.0 - T;
  var col = vec3f(0.0);
  if (alpha > 1e-4) {
    let avg = L / alpha;
    col = pow(aces(avg * C.p0.y), vec3f(1.0 / 2.2)) * alpha;
  }
  return vec4f(col, T * shade);
}
