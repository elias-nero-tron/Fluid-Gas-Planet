// Milchstraße erzeugen: Scheibe, Kern (Bulge), Staubbahnen, rote H-alpha-Wolken; Alpha = Sterndichte.
struct SkyJob { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f, f: vec4f, g: vec4f, h: vec4f }
@group(0) @binding(0) var<uniform> J: SkyJob;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
fn sky_m289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn sky_m289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn sky_perm(x: vec4f) -> vec4f { return sky_m289v4(((x * 34.0) + 10.0) * x); }
fn sky_snoise(v: vec3f) -> f32 {
  let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
  let D = vec4f(0.0, 0.5, 1.0, 2.0);
  var i = floor(v + dot(v, C.yyy));
  let x0 = v - i + dot(i, C.xxx);
  let g = step(x0.yzx, x0.xyz);
  let l = 1.0 - g;
  let i1 = min(g.xyz, l.zxy);
  let i2 = max(g.xyz, l.zxy);
  let x1 = x0 - i1 + C.xxx;
  let x2 = x0 - i2 + C.yyy;
  let x3 = x0 - D.yyy;
  i = sky_m289v3(i);
  let p = sky_perm(sky_perm(sky_perm(i.z + vec4f(0.0, i1.z, i2.z, 1.0)) + i.y + vec4f(0.0, i1.y, i2.y, 1.0)) + i.x + vec4f(0.0, i1.x, i2.x, 1.0));
  let ns = 0.142857142857 * D.wyz - D.xzx;
  let j = p - 49.0 * floor(p * ns.z * ns.z);
  let x_ = floor(j * ns.z);
  let y_ = floor(j - 7.0 * x_);
  let x = x_ * ns.x + ns.yyyy;
  let y = y_ * ns.x + ns.yyyy;
  let h = 1.0 - abs(x) - abs(y);
  let b0 = vec4f(x.xy, y.xy);
  let b1 = vec4f(x.zw, y.zw);
  let s0 = floor(b0) * 2.0 + 1.0;
  let s1 = floor(b1) * 2.0 + 1.0;
  let sh = -step(h, vec4f(0.0));
  let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  let a1 = b1.xzyw + s1.xzyw * sh.zzww;
  let p0 = normalize(vec3f(a0.xy, h.x));
  let p1 = normalize(vec3f(a0.zw, h.y));
  let p2 = normalize(vec3f(a1.xy, h.z));
  let p3 = normalize(vec3f(a1.zw, h.w));
  let m = max(0.5 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
  let m4 = m * m * m * m;
  return 105.0 * dot(m4, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
fn sky_fbm(p0: vec3f, oct: i32) -> f32 {
  var n = 0.0;
  var a = 0.5;
  var p = p0;
  for (var i = 0; i < 12; i++) { if (i >= oct) { break; } n += a * sky_snoise(p); p = p * 2.02 + vec3f(1.7, 9.2, 3.1); a *= 0.5; }
  return n;
}
fn sky_sq(x: f32) -> f32 { return x * x; }
// a = (Seed, Helligkeit, Bandbreite, Kern), b = Pol, c = Kernrichtung, d = (Tönung, Staub, H-alpha)
// h = (Kachel-Anfang x, y, Seite, N), g = Kachel-Ende
@compute @workgroup_size(8, 8)
fn skyGen(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2f(gid.xy) + J.h.xy;
  if (px.x >= J.g.x || px.y >= J.g.y) { return; }
  let seed = J.a.x;
  let face = i32(J.h.z);
  let d = sky_dir(face, px / (J.h.w - 1.0));
  let pole = J.b.xyz;
  let core = J.c.xyz;
  // galaktische Breite, leicht verbogen, damit das Band nicht wie mit dem Lineal gezogen aussieht
  let warp = sky_fbm(d * 2.2 + seed, 4) * 0.07;
  let b = asin(clamp(dot(d, pole), -1.0, 1.0)) + warp;
  let toCore = acos(clamp(dot(d, core), -1.0, 1.0));
  let wd = J.a.z;
  let disk = exp(-sky_sq(b / (0.16 * wd)));
  let thin = exp(-sky_sq(b / (0.045 * wd)));
  let bulge = exp(-sky_sq(toCore / 0.42)) * exp(-sky_sq(b / (0.3 * wd))) * J.a.w;
  let glowN = sky_fbm(d * 5.0 + seed + 3.0, 6) * 0.5 + 0.5;
  let grain = sky_fbm(d * 28.0 + seed + 9.0, 4) * 0.5 + 0.5;
  var lum = disk * (0.25 + 0.75 * glowN) * (0.7 + 0.6 * grain) * (0.55 + 0.45 * exp(-sky_sq(toCore / 1.4)));
  lum += bulge * 1.6 * (0.8 + 0.4 * glowN);
  lum += 0.02;
  // Staubbahnen: verzweigte dunkle Adern in der Mittelebene
  let q = d * 7.0 + vec3f(sky_fbm(d * 3.0 + seed + 21.0, 4), sky_fbm(d * 3.0 + seed + 37.0, 4), 0.0) * 1.2;
  let lanes = smoothstep(-0.1, 0.45, sky_fbm(q + seed, 6));
  let dust = clamp(lanes * (thin * 1.2 + disk * 0.35) * J.d.y, 0.0, 0.8);
  lum *= 1.0 - dust;
  let tint = J.d.x;
  var col = mix(vec3f(0.78, 0.84, 1.0), vec3f(1.0, 0.82, 0.6), clamp(bulge * 1.4 + tint, 0.0, 1.0)) * lum;
  let hii = pow(max(sky_fbm(d * 9.0 + seed + 51.0, 5) - 0.18, 0.0) * 3.0, 3.0) * disk * (1.0 - dust);
  col += vec3f(1.0, 0.22, 0.28) * hii * 0.35 * J.d.z;
  col *= J.a.y;
  let dens = clamp(0.15 + disk * (1.0 - 0.7 * dust) + bulge, 0.0, 2.0);
  textureStore(dst, vec2u(px), face, vec4f(col, dens));
}
