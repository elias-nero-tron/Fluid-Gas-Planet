// Planeten-Darstellung: ein Vollbild-Dreieck, jeder Pixel schneidet seinen Sichtstrahl
// mit dem abgeplatteten Planeten und der Ringebene. Keine Meshes, keine Bilddateien.

struct R {
  invViewProj: mat4x4f,
  camPos: vec4f,
  body0: vec4f, body1: vec4f, body2: vec4f,   // Welt -> Körper (Zeilen)
  sun: vec4f,       // xyz Richtung (Welt), w Intensität
  atmo: vec4f,      // rgb Farbe, w Stärke
  p0: vec4f,        // x Abplattung, y Relief, z Randverdunkelung, w Ansicht
  p1: vec4f,        // x Kartenmodus, y Ring innen, z Ring außen, w Ring-Deckkraft
  p2: vec4f,        // x Seitenverhältnis, y Zeit, z Belichtung, w Farbstoff-Auflösung
  ringColor: vec4f, // rgb, w Ringfaden-Kontrast
  p3: vec4f,        // x Fluss-Skala für Debug-Ansichten, y Pixelwinkel (rad), z Himmelskarte N, w Milchstraße
  p4: vec4f,        // x Sterne, y Mehrstufig: Grobanteil (0 = aus), z Feinanteil, w Pixel-Anpassung
  p5: vec4f,        // x Tiefe aus Physik an/aus, y Stärke, z Quelle (0 Druck, 1 Wirbelstärke), w Gitter
  p6: vec4f,        // x Parallaxe an/aus, y Höhe, z Eigenschatten, w Größe (Mehrstufig)
  p7: vec4f,        // x Dämmerung (0 wie v0.4, 1 aus, 2 weich), y Randschimmer (0 wie v0.4, 1 weich, 2 aus)
};

@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dyeTex: texture_cube<f32>;
@group(0) @binding(3) var velTex: texture_cube<f32>;
@group(0) @binding(4) var auxTex: texture_cube<f32>;
@group(0) @binding(5) var prsTex: texture_cube<f32>;
@group(0) @binding(6) var skyTex: texture_2d_array<f32>;   // gemeinsamer Himmel (src/sky)

const PI = 3.14159265359;

struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.ndc = xy;
  return o;
}

fn toBody(v: vec3f) -> vec3f { return vec3f(dot(U.body0.xyz, v), dot(U.body1.xyz, v), dot(U.body2.xyz, v)); }

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn tangentBasis(p: vec3f) -> mat2x3f {
  let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(p.y) < 0.9);
  let e1 = normalize(cross(helper, p));
  return mat2x3f(e1, cross(p, e1));
}

fn east(p: vec3f) -> vec3f {
  let e = cross(vec3f(0.0, 1.0, 0.0), p);
  let l = length(e);
  return select(vec3f(1.0, 0.0, 0.0), e / l, l > 1e-5);
}

// Ellipsoid x² + (y/c)² + z² = 1 mit c = 1 − Abplattung. Rückgabe: t oder −1.
fn hitPlanet(o: vec3f, d: vec3f) -> f32 {
  let c = 1.0 - U.p0.x;
  let s = vec3f(1.0, 1.0 / c, 1.0);
  let os = o * s; let ds = d * s;
  let a = dot(ds, ds);
  let b = dot(os, ds);
  let k = dot(os, os) - 1.0;
  let disc = b * b - a * k;
  if (disc < 0.0) { return -1.0; }
  let t = (-b - sqrt(disc)) / a;
  return select(-1.0, t, t > 0.0);
}

fn smoothHash(x: f32, salt: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  return mix(hash21(vec2f(i, salt)), hash21(vec2f(i + 1.0, salt)), f * f * (3.0 - 2.0 * f));
}

// footprint: Breite eines Bildschirmpixels auf der Ringebene (in Planetenradien).
// Feinstruktur, die schmaler als ein Pixel ist, wird ausgeblendet statt zu flimmern.
fn ringDensity(r: f32, footprint: f32) -> f32 {
  let inner = U.p1.y; let outer = U.p1.z;
  if (r < inner || r > outer || outer <= inner) { return 0.0; }
  let x = (r - inner) / (outer - inner);
  // Grobe Struktur: dichter Hauptring, Lücke wie die Cassini-Teilung, schwacher Außenring.
  var d = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.93, 1.0, x));
  d *= mix(0.35, 1.0, smoothstep(0.18, 0.35, x));
  d *= 1.0 - 0.9 * (smoothstep(0.60, 0.62, x) - smoothstep(0.66, 0.68, x));
  d *= 1.0 - 0.6 * (smoothstep(0.86, 0.865, x) - smoothstep(0.87, 0.875, x));
  let span = footprint / (outer - inner);
  let fineW = 1.0 - smoothstep(0.5 / 420.0, 2.0 / 420.0, span);
  let coarseW = 1.0 - smoothstep(0.5 / 90.0, 2.0 / 90.0, span);
  let fine = mix(0.5, smoothHash(x * 420.0, 3.0), fineW) * 0.5 + mix(0.5, smoothHash(x * 90.0, 7.0), coarseW) * 0.5;
  d *= mix(1.0, fine * 1.4 + 0.3 * (1.0 - fineW), U.ringColor.w);
  return clamp(d, 0.0, 1.0) * U.p1.w;
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn diverging(v: f32) -> vec3f {
  let t = clamp(v, -1.0, 1.0);
  let neg = vec3f(0.15, 0.45, 0.95);
  let pos = vec3f(0.95, 0.35, 0.15);
  return mix(vec3f(0.06), select(neg, pos, t > 0.0), abs(t));
}

// Farbe einer Stelle auf der Kugel je nach Ansicht.
fn surface(q: vec3f, mode: i32) -> vec3f {
  let fs = U.p3.x;
  if (mode == 1) {
    let v = textureSampleLevel(velTex, samp, q, 0.0).xyz;
    let tb = mat2x3f(east(q), cross(q, east(q)));
    let e = dot(v, tb[0]) * fs;
    let n = dot(v, tb[1]) * fs;
    return vec3f(0.5 + 0.5 * clamp(e, -1.0, 1.0), 0.5 + 0.5 * clamp(n, -1.0, 1.0), 0.6) * min(1.0, length(vec2f(e, n)) * 1.5 + 0.15);
  }
  if (mode == 2) { return diverging(textureSampleLevel(auxTex, samp, q, 0.0).x * fs * 0.015); }
  // Gespeichert ist die Druckkorrektur pro Schritt (Δt·P); P ≈ f·U·L, daher Skala 60·fs²/4.
  if (mode == 3) { return diverging(textureSampleLevel(prsTex, samp, q, 0.0).x * 60.0 * fs * fs * 0.25); }
  return textureSampleLevel(dyeTex, samp, q, 0.0).rgb;
}

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }

// ---------- Relief-Module (alle aus = Verhalten wie v0.4) ----------
fn lumAt(q: vec3f) -> f32 { return luminance(textureSampleLevel(dyeTex, samp, q, 0.0).rgb); }
// Helligkeit, über ein Kreuz der Breite s gemittelt (grobe Stufe ohne Mipmaps)
fn lumBlur(q: vec3f, tb: mat2x3f, s: f32) -> f32 {
  return 0.25 * (lumAt(normalize(q + tb[0] * s)) + lumAt(normalize(q - tb[0] * s)) + lumAt(normalize(q + tb[1] * s)) + lumAt(normalize(q - tb[1] * s)));
}
// Wirbelstärke ζ aus dem Wind (geht in beiden Rechenmodellen)
fn zetaAt(q: vec3f, e: f32) -> f32 {
  let tb = tangentBasis(q);
  let a = dot(textureSampleLevel(velTex, samp, normalize(q + tb[0] * e), 0.0).xyz, tb[1]);
  let b = dot(textureSampleLevel(velTex, samp, normalize(q - tb[0] * e), 0.0).xyz, tb[1]);
  let c = dot(textureSampleLevel(velTex, samp, normalize(q + tb[1] * e), 0.0).xyz, tb[0]);
  let d = dot(textureSampleLevel(velTex, samp, normalize(q - tb[1] * e), 0.0).xyz, tb[0]);
  return (a - b - c + d) / (2.0 * e);
}
// Tiefe aus der Physik: Hochdruck-Wirbel wölben sich, Tiefdruck-Wirbel sind Senken.
// Druck (nur Stable Fluids) oder Wirbelstärke geteilt durch Coriolis (geostrophisch, beide Modelle).
fn depthAt(q: vec3f) -> f32 {
  let fs = U.p3.x;
  if (U.p5.z < 0.5) { return textureSampleLevel(prsTex, samp, q, 0.0).x * 60.0 * fs * fs * 0.25; }
  let f = select(-1.0, 1.0, q.y >= 0.0) * max(abs(q.y), 0.15);
  return -zetaAt(q, 1.5 / U.p5.w) * fs * 0.015 / f * 0.3;
}
// Höhe 0..1 für die Parallaxe: Helligkeit (wie Relief) plus Tiefe aus der Physik, falls an
fn pomHeight(q: vec3f) -> f32 {
  var h = (lumAt(q) - 0.55) * 3.0 * min(U.p0.y, 1.0);
  if (U.p5.x > 0.5) { h += depthAt(q) * U.p5.y; }
  return clamp(0.5 + 0.5 * h, 0.0, 1.0);
}

@fragment
fn fs(vin: VOut) -> @location(0) vec4f {
  let mode = i32(U.p0.w);

  // Kartenansicht: flache Weltkarte (equirektangulär) des ganzen Planeten.
  if (U.p1.x > 0.5) {
    let uv = vin.ndc * 0.5 + 0.5;
    let lon = (uv.x - 0.5) * 2.0 * PI;
    let lat = (uv.y - 0.5) * PI;
    let q = vec3f(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    var c = surface(q, mode);
    if (mode == 0) { c = aces(c * U.p2.z * 0.9); }
    return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
  }

  let wp = U.invViewProj * vec4f(vin.ndc, 1.0, 1.0);
  let dir = normalize(wp.xyz / wp.w - U.camPos.xyz);
  let o = toBody(U.camPos.xyz);
  let d = toBody(dir);
  let sun = normalize(toBody(U.sun.xyz));
  let c = 1.0 - U.p0.x;

  var col = skyColor(skyTex, samp, dir, U.p3.y, U.p3.z, U.p3.w, U.p4.x);
  var tPlanet = hitPlanet(o, d);

  // Atmosphärensaum außerhalb der Planetenscheibe.
  if (tPlanet < 0.0) {
    let tc = max(-dot(o, d), 0.0);
    let cp = o + d * tc;
    let ce = cp * vec3f(1.0, 1.0 / c, 1.0);
    let h = length(ce) - 1.0;
    let lit = smoothstep(-0.3, 0.4, dot(normalize(cp), sun));
    col += U.atmo.rgb * exp(-max(h, 0.0) / 0.025) * U.atmo.w * lit * U.sun.w;
  } else {
    let hp = o + d * tPlanet;
    let hs = hp * vec3f(1.0, 1.0 / c, 1.0);
    let q0 = normalize(hs);
    var n = normalize(hp * vec3f(1.0, 1.0 / (c * c), 1.0));

    // Modul Parallaxe: Sichtstrahl in die Höhenkarte hinein verfolgen (Parallax Occlusion Mapping, Tatarchuk 2006)
    var q = q0;
    var pomShadow = 1.0;
    if (mode == 0 && U.p6.x > 0.5) {
      let v0 = -d;
      let nv = max(dot(v0, n), 0.15);
      let H = U.p6.y * 0.003;
      let dirT = -(v0 - n * dot(v0, n)) / nv;
      for (var i = 1; i <= 24; i++) {
        let rd = H * f32(i) / 24.0;
        let qi = normalize(q0 + dirT * rd);
        if (rd >= H * (1.0 - pomHeight(qi))) { q = qi; break; }
      }
      // Eigenschatten: vom Treffer Richtung Sonne laufen. Der Strahl steigt mit der Sonnenhöhe (tan) UND die Kugel
      // krümmt sich unter ihm weg (t²/2 bei Radius 1). Ohne Krümmung würde nahe der Tag-Nacht-Grenze alles
      // abgeschattet (flache Scheibe statt Kugel) – das war die harte Linie. Schattenlänge höchstens H/tan.
      let nl = dot(sun, n);
      if (U.p6.z > 0.0 && nl > 0.0) {
        let sd = sun - n * nl;
        let sl = length(sd);
        if (sl > 1e-4) {
          let sT = sd / sl;
          let tanE = nl / max(sl, 1e-3);
          let maxT = min(H / max(tanE, 0.02), 0.03);
          let h0 = pomHeight(q) * H;
          var occ = 0.0;
          for (var j = 1; j <= 12; j++) {
            let t = maxT * f32(j) / 12.0;
            let ray = h0 + t * tanE + 0.5 * t * t;
            let hs = pomHeight(normalize(q + sT * t)) * H;
            // weicher Halbschatten: je tiefer der Strahl unter dem Gelände, desto dunkler
            occ = max(occ, clamp((hs - ray) / (0.25 * H), 0.0, 1.0));
          }
          pomShadow = 1.0 - 0.7 * clamp(occ * U.p6.z, 0.0, 1.0);
        }
      }
    }
    var albedo = surface(q, mode);
    if (mode == 0) {
      // Modul Tiefe aus der Physik: Normale nach dem Gefälle von Druck bzw. ζ/f
      if (U.p5.x > 0.5) {
        let tb = tangentBasis(q);
        let e = 2.0 / U.p5.w;
        let gx = depthAt(normalize(q + tb[0] * e)) - depthAt(normalize(q - tb[0] * e));
        let gy = depthAt(normalize(q + tb[1] * e)) - depthAt(normalize(q - tb[1] * e));
        n = normalize(n - (tb[0] * gx + tb[1] * gy) * U.p5.y * 0.5);
      }
      // Modul Mehrstufiges Relief: große Strukturen tief, feine Krümel schwach, Schrittweite nach Pixelgröße
      if (U.p0.y > 0.0 && U.p4.y > 0.0) {
        let tb = tangentBasis(q);
        let foot = tPlanet * U.p3.y / max(dot(-d, n), 0.2);
        let e0 = max(3.0 / U.p2.w, foot * 1.5 * U.p4.w);
        let fx = lumAt(normalize(q + tb[0] * e0)) - lumAt(normalize(q - tb[0] * e0));
        let fy = lumAt(normalize(q + tb[1] * e0)) - lumAt(normalize(q - tb[1] * e0));
        var gx = fx * U.p4.z;
        var gy = fy * U.p4.z;
        for (var k = 0; k < 2; k++) {
          let s = e0 * U.p6.w * select(16.0, 4.0, k == 0);
          // Unterschied über die breitere Strecke auf die Steigung der feinen Stufe umrechnen (×e₀/s), mit √ statt linear,
          // damit große Strukturen etwas mehr Tiefe behalten als ihre reine Steigung
          let w = U.p4.y * 0.5 * sqrt(e0 / s);
          gx += (lumBlur(normalize(q + tb[0] * s), tb, s * 0.5) - lumBlur(normalize(q - tb[0] * s), tb, s * 0.5)) * w;
          gy += (lumBlur(normalize(q + tb[1] * s), tb, s * 0.5) - lumBlur(normalize(q - tb[1] * s), tb, s * 0.5)) * w;
        }
        n = normalize(n - (tb[0] * gx + tb[1] * gy) * U.p0.y * 3.0);
      }
      // Relief aus der Helligkeit: helle Wolken liegen höher (Ammoniak-Eis), dunkle tiefer.
      else if (U.p0.y > 0.0) {
        let tb = tangentBasis(q);
        let e = 3.0 / U.p2.w;
        let lx = luminance(surface(normalize(q + tb[0] * e), 0)) - luminance(surface(normalize(q - tb[0] * e), 0));
        let ly = luminance(surface(normalize(q + tb[1] * e), 0)) - luminance(surface(normalize(q - tb[1] * e), 0));
        n = normalize(n - (tb[0] * lx + tb[1] * ly) * U.p0.y * 3.0);
      }
      let v = -d;
      let ndl = dot(n, sun);
      let ndv = max(dot(n, v), 1e-3);
      let k = U.p0.z;
      // Minnaert-Randverdunkelung, k = 1 ist Lambert.
      var light = pow(max(ndl, 0.0), k) * pow(ndv, k - 1.0);
      light *= pomShadow;
      // Dämmerungssaum (Modul „Dämmerung“; 0 = wie v0.4)
      if (U.p7.x < 0.5) { light += smoothstep(0.12, -0.05, ndl) * smoothstep(-0.25, 0.0, ndl) * 0.05; }
      // weich: fällt nur ab, ohne Buckel (Maximum zweier steigender Kurven), Stärke nach Atmosphäre
      else if (U.p7.x > 1.5) { light = max(light, smoothstep(-0.25, 0.12, ndl) * 0.05 * U.atmo.w / 0.35); }
      // Schatten der Ringe auf dem Planeten
      if (U.p1.w > 0.0 && abs(sun.y) > 1e-4) {
        let tr = -hp.y / sun.y;
        if (tr > 0.0) {
          let rp = hp + sun * tr;
          light *= 1.0 - 0.85 * ringDensity(length(rp.xz), 0.02);
        }
      }
      var rim = pow(1.0 - ndv, 3.0) * U.atmo.w * smoothstep(-0.2, 0.3, ndl);
      // Modul „Randschimmer“: weich = schmaler, folgt dem Sonnenlicht stetig; aus = kein Schimmer
      if (U.p7.y > 1.5) { rim = 0.0; }
      else if (U.p7.y > 0.5) { rim = pow(1.0 - ndv, 5.0) * U.atmo.w * sqrt(clamp(ndl + 0.1, 0.0, 1.0)); }
      col = albedo * light * U.sun.w + U.atmo.rgb * rim * U.sun.w;
    } else {
      col = albedo;
    }
  }

  // Ringe: vor dem Planeten drübermischen, dahinter verdeckt.
  if (U.p1.w > 0.0 && abs(d.y) > 1e-5 && mode == 0) {
    let tr = -o.y / d.y;
    if (tr > 0.0 && (tPlanet < 0.0 || tr < tPlanet)) {
      let rp = o + d * tr;
      let footprint = tr * U.p3.y / max(abs(d.y), 0.02);
      let dens = ringDensity(length(rp.xz), footprint);
      if (dens > 0.0) {
        var lit = 0.35 + 0.65 * abs(sun.y);
        if (hitPlanet(rp + sun * 1e-3, sun) > 0.0) { lit *= 0.08; }
        let rc = U.ringColor.rgb * lit * U.sun.w;
        col = mix(col, rc, dens);
      }
    }
  }

  var outc = col;
  if (mode == 0) { outc = aces(col * U.p2.z); }
  return vec4f(pow(outc, vec3f(1.0 / 2.2)), 1.0);
}
