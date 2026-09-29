// [G3] fBm: Oktave k mit Frequenz 2^k und Gewicht Abfall^k
fn fbm(p: vec4f) -> f32 {
  var r = 0.0; var a = 1.0; var f = 1.0;
  for (var k = 0; k < i32(u.octaves); k++) { r += a * snoise(p * f); a *= u.falloff; f *= 2.0; }
  return r;
}
fn bandSpeed(lat: f32) -> f32 {   // [G5]
  let c = cos(lat * u.bands);
  let pw = sign(c) * pow(abs(c), u.bpow);   // Potenz ist ungerade ganze Zahl
  return ((1.0 - u.patt) + u.patt * cos(lat)) * pw * u.bfac;
}
fn rotAbout(v: vec3f, k: vec3f, ang: f32) -> vec3f {  // Drehung von v um Achse k (Rodrigues)
  return v * cos(ang) + cross(k, v) * sin(ang) + k * dot(k, v) * (1.0 - cos(ang));
}

@compute @workgroup_size(8, 8, 1)
fn makeField(@builtin(global_invocation_id) g: vec3u) {
  let d = u.vf;
  if (f32(g.x) >= d || f32(g.y) >= d) { return; }
  let ov = fijToXyz(g.z, f32(g.x), f32(g.y), d);
  let v = ov * u.ns;
  let w = u.woff * u.ns;
  let h = u.ns * (0.05 / 1024.0);
  // [G3] Gradient per Differenz (ohne Division, wie im Original)
  let gr = vec3f(fbm(vec4f(v + vec3f(h, 0, 0), w)) - fbm(vec4f(v - vec3f(h, 0, 0), w)),
                 fbm(vec4f(v + vec3f(0, h, 0), w)) - fbm(vec4f(v - vec3f(0, h, 0), w)),
                 fbm(vec4f(v + vec3f(0, 0, h), w)) - fbm(vec4f(v - vec3f(0, 0, h), w)));
  // [G4] curl2
  let proj = normalize(v + gr) * u.ns - v;
  var vel = rotAbout(proj, ov, PI * 0.5) * u.vfac;
  // [G5] Bänder
  let lat = asin(clamp(ov.y, -1.0, 1.0));
  let bv = vec3f(ov.z, 0.0, -ov.x);
  if (length(bv) > 1e-20) { vel += normalize(bv) * bandSpeed(lat); }
  // [G6] Wirbel
  for (var k = 0u; k < u32(u.nvort); k++) {
    let c = vort[k].xyz; let r = abs(vort[k].w); let av = select(-2.5, 2.5, vort[k].w > 0.0);
    let dist = length(c - ov);
    if (dist > r) { continue; }
    let ang = (av * PI / 180.0) * sin(PI * dist / r);
    let rv = rotAbout(ov, c, ang);
    vel += 1024.0 * (rv - ov);
  }
  // [G7] in Einheiten des Kugelradius (Radius = 1024 Feldpunkte)
  vel = vel / 1024.0;
  let idx = (g.z * u32(d) + g.y) * u32(d) + g.x;
  field[idx] = vec2u(pack2x16float(vel.xy), pack2x16float(vec2f(vel.z, 0.0)));
}

