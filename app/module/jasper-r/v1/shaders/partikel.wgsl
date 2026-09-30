fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(a: u32) -> f32 { return f32(pcg(a)) / 4294967295.0; }

fn gradAt(phi: f32) -> vec3f {   // [Q4] Verlauf nach Breite
  let x = clamp(phi / PI * 16.0 - 0.5, 0.0, 15.0);
  let i = u32(min(floor(x), 14.0));
  return mix(u.grad[i].rgb, u.grad[i + 1u].rgb, x - f32(i));
}

@compute @workgroup_size(256)
fn moveParticles(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (f32(i) >= u.count) { return; }
  var p = parts[i];
  let b = i / u32(u.batch);
  let cur = u32(u.cur);
  let nb = u32(u.nBatch);
  if (u.init > 0.5 || b == cur) {
    // [Q7] Batch neu geboren: gleichverteilt auf der Kugel
    let seed = i * 3u + u32(u.frame) * 9781u;
    let phi = acos(1.0 - 2.0 * rnd(seed));
    let theta = TAU * rnd(seed + 1u);
    var age = 0.0;
    if (u.init > 0.5) { age = f32((cur + nb - b % nb) % nb); }
    p = vec4f(theta, phi, age, phi);
  } else {
    // [Q3] Fluss direkt an der Partikelposition in Polarkoordinaten
    let v = flow[texelOf(p.x, p.y, u.FW, u.FH)].xy;
    p.x = fract((p.x + v.x * u.speed * u.dt) / TAU) * TAU;
    p.y = clamp(p.y + v.y * u.speed * u.dt, 0.001, PI - 0.001);
    p.z += 1.0;
  }
  parts[i] = p;
  // [Q7] ein- und ausblenden über die Lebenszeit; [Q5] mit Deckkraft in die Textur mischen
  let a = u.opacity * sin(PI * clamp(p.z / u.nBatch, 0.0, 1.0));
  let t = texelOf(p.x, p.y, u.W, u.H);
  surfA[t] = vec4f(mix(surfA[t].rgb, gradAt(p.w), a), 1.0);
}

