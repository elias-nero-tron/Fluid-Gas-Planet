fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(a: u32) -> f32 { return f32(pcg(a)) / 4294967295.0; }

// [G1][G2] Partikel zufällig auf die Kugel, Farbe einmal aus dem Eingabebild
@compute @workgroup_size(256)
fn initParticles(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (f32(i) >= u.count) { return; }
  let sd = i * 2u + u32(u.seed) * 7919u;
  let z = 1.0 - 2.0 * rnd(sd);
  let ph = 6.28318530718 * rnd(sd + 1u);
  let s = sqrt(max(0.0, 1.0 - z * z));
  let p = vec3f(s * cos(ph), z, s * sin(ph));
  let lat = asin(clamp(p.y, -1.0, 1.0));
  let lon = atan2(p.z, p.x);
  let yo = (lat + 0.5 * PI) / PI;
  let cl = abs(cos(lat));
  let xo = cos(lon) * cl * 0.5 * cl + 0.5;
  let px = i32(clamp(xo * u.imgW, 0.0, u.imgW - 1.0));
  let py = i32(clamp(yo * u.imgH, 0.0, u.imgH - 1.0));
  let c = textureLoad(src, vec2i(px, py), 0);
  parts[i] = vec4f(p, bitcast<f32>(pack4x8unorm(vec4f(c.rgb, 1.0))));
}

// [G7][G10] Pixel VOR der Bewegung merken, bewegen, dann an der gemerkten Stelle malen
@compute @workgroup_size(256)
fn moveAndPaint(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (f32(i) >= u.count) { return; }
  var pt = parts[i];
  let pix = xyzToIdx(pt.xyz, u.dim);
  let fv = field[xyzToIdx(pt.xyz, u.vf)];
  let vel = vec3f(unpack2x16float(fv.x), unpack2x16float(fv.y).x);
  parts[i] = vec4f(normalize(pt.xyz + vel), pt.w);
  let c = unpack4x8unorm(bitcast<u32>(pt.w)).rgb;
  let oc = unpack4x8unorm(img[pix]).rgb;
  img[pix] = pack4x8unorm(vec4f(to8(c * u.opacity + oc * (1.0 - u.opacity)), 1.0));
}
