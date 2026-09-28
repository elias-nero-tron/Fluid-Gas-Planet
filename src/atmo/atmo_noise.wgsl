// Modul „Atmosphäre“: kachelbares 3D-Rauschen für die Wolkenform, einmal beim Start erzeugt.
// Verfahren: Perlin-Worley nach Schneider (Nubis, Guerrilla Games) in der Fassung von Sébastien
// Hillaire (TileableVolumeNoise, MIT) und takram three-clouds (cloudShape.frag, cloudShapeDetail.frag, MIT).
// r = Grundform (Perlin-Worley), g = Detail (Worley-fBm), beide kachelbar über [0,1]³.

@group(0) @binding(0) var dst: texture_storage_3d<rgba8unorm, write>;

fn hashCell(c: vec3i, period: i32) -> vec3f {
  let w = ((c % period) + period) % period;
  return rand3(bitcast<vec3u>(w) + vec3u(17u, 59u, 101u));
}

// Worley: Abstand² zum nächsten Merkmalspunkt, Zellen periodisch.
fn worley(p: vec3f, cells: f32) -> f32 {
  let q = p * cells;
  let i = vec3i(floor(q));
  let per = i32(cells);
  var d = 1e10;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      for (var z = -1; z <= 1; z++) {
        let c = i + vec3i(x, y, z);
        let fp = vec3f(c) + hashCell(c, per);
        let v = q - fp;
        d = min(d, dot(v, v));
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

fn gradAt(c: vec3i, period: i32) -> vec3f { return normalize(hashCell(c, period) * 2.0 - 1.0 + vec3f(1e-4)); }

// Kachelbares Gradientenrauschen (Perlin), Wertebereich etwa [−1, 1].
fn perlin(p: vec3f, freq: f32) -> f32 {
  let q = p * freq;
  let i = vec3i(floor(q));
  let f = q - floor(q);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let per = i32(freq);
  var v: array<f32, 8>;
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    v[k] = dot(gradAt(i + o, per), f - vec3f(o));
  }
  let x0 = mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y);
  let x1 = mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y);
  return mix(x0, x1, u.z) * 1.6;
}

fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (x - a) / (b - a) * (d - c); }

@compute @workgroup_size(4, 4, 4)
fn noiseGen(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dst).x;
  if (any(id >= vec3u(n))) { return; }
  let p = (vec3f(id) + 0.5) / f32(n);
  // Grundform: Perlin-fBm (3 Oktaven, Frequenz 8) als Untergrenze über Worley-fBm (cloudShape.frag).
  var per = 0.0; var w = 1.0; var ws = 0.0; var fr = 8.0;
  for (var o = 0; o < 3; o++) { per += perlin(p, fr) * w; ws += w; w *= 0.5; fr *= 2.0; }
  per = clamp(per / ws * 0.5 + 0.5, 0.0, 1.0);
  let wf = dot(vec3f(1.0 - worley(p, 8.0), 1.0 - worley(p, 32.0), 1.0 - worley(p, 56.0)), vec3f(0.625, 0.25, 0.125));
  let perlinWorley = remap(per, 0.0, 1.0, wf, 1.0);
  let n4 = vec4f(1.0 - worley(p, 8.0), 1.0 - worley(p, 16.0), 1.0 - worley(p, 32.0), 1.0 - worley(p, 64.0));
  let fb = vec3f(dot(n4.xyz, vec3f(0.625, 0.25, 0.125)), dot(n4.yzw, vec3f(0.625, 0.25, 0.125)), dot(n4.zw, vec2f(0.75, 0.25)));
  let worleyFbm = dot(fb, vec3f(0.625, 0.25, 0.125));
  let shape = clamp(remap(perlinWorley, worleyFbm - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  // Detail (cloudShapeDetail.frag): Worley-fBm mit 2, 4, 8, 16 Zellen.
  let d4 = vec4f(1.0 - worley(p, 2.0), 1.0 - worley(p, 4.0), 1.0 - worley(p, 8.0), 1.0 - worley(p, 16.0));
  let db = vec3f(dot(d4.xyz, vec3f(0.625, 0.25, 0.125)), dot(d4.yzw, vec3f(0.625, 0.25, 0.125)), dot(d4.zw, vec2f(0.75, 0.25)));
  let detail = dot(db, vec3f(0.625, 0.25, 0.125));
  textureStore(dst, id, vec4f(shape, detail, 0.0, 1.0));
}
