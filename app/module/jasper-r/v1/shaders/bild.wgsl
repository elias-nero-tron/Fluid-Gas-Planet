fn surfAt(x: f32, y: f32, c: vec4f) -> vec4f {
  if (!inside(x, y, u.W, u.H)) { return c; }
  return surfA[u32(y) * u32(u.W) + u32(x)];
}

// [Q6] weichzeichnen und langsam zur Mittelfarbe verblassen
@compute @workgroup_size(16, 16)
fn blurFade(@builtin(global_invocation_id) g: vec3u) {
  if (f32(g.x) >= u.W || f32(g.y) >= u.H) { return; }
  let x = f32(g.x); let y = f32(g.y);
  let i = g.y * u32(u.W) + g.x;
  if (!inside(x, y, u.W, u.H)) { surfB[i] = u.centre; return; }
  if (u.init > 0.5) { let gc = vec4f(gradAt((y + 0.5) / u.H * PI), 1.0); surfA[i] = gc; surfB[i] = gc; return; }   // [B2]
  let c = surfA[i];
  let avg = (surfAt(x + 1.0, y, c) + surfAt(x - 1.0, y, c) + surfAt(x, y + 1.0, c) + surfAt(x, y - 1.0, c)) * 0.25;
  let bl = mix(c, avg, u.blur);
  surfB[i] = vec4f(mix(bl.rgb, u.centre.rgb, 1.0 - exp(-u.fade * u.dt)), 1.0);
}
