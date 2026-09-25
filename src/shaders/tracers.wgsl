// Sichtbare Wolkenfelder: Farbstoff-Advektion, Curl-Noise-Flussfeld und Partikel.

@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcA: texture_cube<f32>;
@group(0) @binding(3) var srcB: texture_cube<f32>;
@group(0) @binding(4) var dst: texture_storage_2d_array<rgba16float, write>;

struct Particle {
  pos: vec4f,   // xyz Richtung auf der Kugel, w Alter
  info: vec4f,  // x Lebensdauer, yzw Farbe
};
@group(0) @binding(5) var<storage, read_write> parts: array<Particle>;

fn A(d: vec3f) -> vec4f { return textureSampleLevel(srcA, samp, d, 0.0); }
fn B(d: vec3f) -> vec4f { return textureSampleLevel(srcB, samp, d, 0.0); }

fn texDir(id: vec3u, n: f32) -> vec3f { return faceDir(id.z, (vec2f(id.xy) + 0.5) / n); }

// Bänder mit mäandernden Rändern: die Breite wird leicht verrauscht, bevor die
// Bandfarbe nachgeschlagen wird.
fn bandTarget(p: vec3f) -> vec3f {
  let w = noised(p * 4.0 + vec3f(S.seed, S.time * 0.01, 0.0)).x;
  return bandAt(latitude(p) + w * S.bandWobble * 0.04);
}

fn convectionSpot(p: vec3f) -> f32 {
  let n = noised(p * 13.0 + vec3f(S.seed * 3.1, 0.0, S.time * 0.04)).x;
  // Aufsteigende Wolkentürme vor allem in niedrigen und mittleren Breiten.
  return smoothstep(0.5, 0.66, n) * smoothstep(1.15, 0.8, abs(latitude(p)));
}

fn relaxColor(p: vec3f, c0: vec3f) -> vec3f {
  let dt = S.dt;
  var c = mix(c0, bandTarget(p), 1.0 - exp(-S.bandRelax * dt));
  let sm = stormMask(p, 0.55);
  c = mix(c, sm.rgb, (1.0 - exp(-S.stormTint * dt)) * sm.w);
  c = mix(c, S.cloud.rgb, (1.0 - exp(-S.convection * dt)) * convectionSpot(p));
  return c;
}

@compute @workgroup_size(8, 8, 1)
fn initDye(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= S.dyeN || f32(id.y) >= S.dyeN) { return; }
  let p = texDir(id, S.dyeN);
  let sm = stormMask(p, 0.55);
  textureStore(dst, id.xy, id.z, vec4f(mix(bandTarget(p), sm.rgb, sm.w), 1.0));
}

// Farbstoff mit dem Wind (B) mitführen, A = Farbstoff.
@compute @workgroup_size(8, 8, 1)
fn advectDye(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= S.dyeN || f32(id.y) >= S.dyeN) { return; }
  let p = texDir(id, S.dyeN);
  let dt = S.dt;
  let u0 = B(p).xyz;
  var src = stepOn(p, -u0 * dt);
  if (S.bfecc > 0.5) {
    let u1 = B(src).xyz;
    let back = stepOn(src, u1 * dt);
    let p3 = normalize(p - (back - p) * 0.5);
    let u2 = B(p3).xyz;
    src = stepOn(p3, -u2 * dt);
  }
  var c = A(src).rgb;
  if (any(c != c)) { c = bandTarget(p); }
  textureStore(dst, id.xy, id.z, vec4f(relaxColor(p, c), 1.0));
}

// Flussfeld für den Partikel-Modus: Jets + Curl-Noise + Stürme.
@compute @workgroup_size(8, 8, 1)
fn flowField(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= S.flowN || f32(id.y) >= S.flowN) { return; }
  let p = texDir(id, S.flowN);
  var v = east(p) * jetAt(latitude(p));
  v += curlOnSphere(p, S.curlFreq, S.time * S.curlSpeed + S.seed, i32(S.curlOctaves)) * S.curlStrength;
  v += stormFlow(p);
  textureStore(dst, id.xy, id.z, vec4f(tangent(p, v), 0.0));
}

fn spawn(i: u32, stagger: bool) -> Particle {
  let r = rand4(i, u32(S.frame) * 747796405u + u32(S.seed * 1000.0));
  let z = r.x * 2.0 - 1.0;
  let phi = r.y * 2.0 * PI;
  let s = sqrt(max(0.0, 1.0 - z * z));
  let p = vec3f(s * cos(phi), z, s * sin(phi));
  var col = bandTarget(p) * (0.9 + 0.2 * r.w);
  let sm = stormMask(p, 0.55);
  col = mix(col, sm.rgb, sm.w * clamp(S.stormTint * 0.5, 0.0, 1.0));
  if (fract(r.w * 97.0) < S.convection * 0.02) { col = S.cloud.rgb; }
  let life = S.lifetime * (0.5 + r.z);
  var age = 0.0;
  if (stagger) { age = fract(r.z * 31.7) * life; }
  return Particle(vec4f(p, age), vec4f(life, col));
}

// Partikel bewegen und in die Farbtextur mischen (Verfahren nach jasper-r).
// A = Farbstoff vorher, B = Flussfeld, dst = Farbstoff nachher (vorher per Kopie befüllt).
@compute @workgroup_size(64, 1, 1)
fn moveParticles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + gid.y * 65535u * 64u;
  if (f32(i) >= S.particleCount) { return; }
  var pt = parts[i];
  if (pt.info.x <= 0.0) {
    pt = spawn(i, true);
  } else if (pt.pos.w >= pt.info.x) {
    pt = spawn(i, false);
  } else {
    let dt = S.dt;
    var p = pt.pos.xyz;
    let v1 = B(p).xyz;
    let mid = stepOn(p, v1 * dt * 0.5);
    let v2 = B(mid).xyz;
    p = stepOn(p, v2 * dt);
    pt.pos = vec4f(p, pt.pos.w + dt);
  }
  parts[i] = pt;

  let life = max(pt.info.x, 1e-3);
  let fade = sin(PI * clamp(pt.pos.w / life, 0.0, 1.0));
  let a = S.opacity * fade;
  let t = dirToTexel(pt.pos.xyz, u32(S.dyeN));
  let old = A(pt.pos.xyz).rgb;
  textureStore(dst, t.xy, t.z, vec4f(mix(old, pt.info.yzw, a), 1.0));
}

// Weichzeichnen und zur Bandfarbe zurückblenden. A = Farbstoff nach Partikeln.
@compute @workgroup_size(8, 8, 1)
fn blurRelax(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= S.dyeN || f32(id.y) >= S.dyeN) { return; }
  let p = texDir(id, S.dyeN);
  let tb = tangentBasis(p);
  let h = 1.6 / S.dyeN;
  let c = A(p).rgb;
  let avg = (A(stepOn(p, tb[0] * h)).rgb + A(stepOn(p, -tb[0] * h)).rgb
           + A(stepOn(p, tb[1] * h)).rgb + A(stepOn(p, -tb[1] * h)).rgb) * 0.25;
  let blurred = mix(c, avg, S.blur);
  textureStore(dst, id.xy, id.z, vec4f(relaxColor(p, blurred), 1.0));
}
