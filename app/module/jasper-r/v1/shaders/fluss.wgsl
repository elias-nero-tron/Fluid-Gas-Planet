// [Q8] eine Oktave pro Aufruf in BA addieren; beim letzten Schritt nach RG [T5]
@compute @workgroup_size(16, 16)
fn flowOctave(@builtin(global_invocation_id) g: vec3u) {
  if (f32(g.x) >= u.FW || f32(g.y) >= u.FH) { return; }
  let i = g.y * u32(u.FW) + g.x;
  let x = f32(g.x); let y = f32(g.y);
  if (!inside(x, y, u.FW, u.FH)) { flow[i] = vec4f(0.0); return; }
  let phi = (y + 0.5) / u.FH * PI;
  let s = sin(phi);
  let theta = ((x + 0.5 - u.FW * 0.5) / (u.FW * s) + 0.5) * TAU;
  let d = dirOf(theta, phi);
  let o = u.octave;
  let c = curl3(d * vec3f(1.0, u.p2, 1.0) * u.freq * pow(2.0, o) + vec3f(o * 17.3, u.ntime, -o * 9.1)) * u.amp * pow(0.5, o);
  // [T3] auf die Tangentialebene, dann Ost/Süd -> dθ/dt, dφ/dt
  let vt = c - d * dot(c, d);
  let east = vec3f(-sin(theta), 0.0, cos(theta));
  let south = vec3f(cos(phi) * cos(theta), -s, cos(phi) * sin(theta));
  var f = flow[i];
  if (o < 0.5) { f.z = 0.0; f.w = 0.0; }
  f.z += dot(vt, east) / max(s, 0.05);
  f.w += dot(vt, south);
  if (o > u.nOct - 1.5) { f.x = f.z; f.y = f.w; }
  flow[i] = f;
}

