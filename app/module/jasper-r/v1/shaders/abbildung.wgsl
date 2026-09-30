fn dirOf(theta: f32, phi: f32) -> vec3f { return vec3f(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta)); }

// [Q2] Sinus-Abbildung (+[T2] um W/2 verschoben). phi = 0 am Nordpol, pi am Südpol.
fn halfW(y: f32, w: f32, h: f32) -> f32 { return w * 0.5 * sin((y + 0.5) / h * PI); }
fn texelOf(theta: f32, phi: f32, w: f32, h: f32) -> u32 {
  let y = clamp(floor(h * phi / PI), 0.0, h - 1.0);
  let x = clamp(floor(w * (theta / TAU - 0.5) * sin(phi) + w * 0.5), 0.0, w - 1.0);
  return u32(y) * u32(w) + u32(x);
}
fn inside(x: f32, y: f32, w: f32, h: f32) -> bool {
  return y >= 0.0 && y < h && abs(x + 0.5 - w * 0.5) <= halfW(y, w, h);
}

