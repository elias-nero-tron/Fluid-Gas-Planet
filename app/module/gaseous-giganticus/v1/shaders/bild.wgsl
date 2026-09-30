@compute @workgroup_size(256)
fn clearImg(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (i < u32(6.0 * u.dim * u.dim)) { img[i] = 0u; }   // [G8] Start schwarz
}

fn to8(c: vec3f) -> vec3f { return floor(c * 255.0) / 255.0; }   // 8 Bit, abgeschnitten wie im Original

// [G9] Überblenden mit der dunkelsten Farbe
@compute @workgroup_size(256)
fn fadeImg(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (i >= u32(6.0 * u.dim * u.dim)) { return; }
  let oc = unpack4x8unorm(img[i]).rgb;
  let nc = u.dark.rgb * u.fade + oc * (1.0 - u.fade);
  img[i] = pack4x8unorm(vec4f(to8(nc), 1.0));
}

