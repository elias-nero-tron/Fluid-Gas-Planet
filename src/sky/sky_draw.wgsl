// Himmel im Bild: Milchstraßen-Karte + punktförmige Sterne (Gauß-Scheibchen, pixelgenau, ohne Flimmern).
// n = Kartengröße (0 = Karte noch nicht fertig), neb/stars = Helligkeiten, pix = Pixelwinkel.
fn sky_stars(d: vec3f, pix: f32, dens: f32) -> vec3f {
  var acc = vec3f(0.0);
  let f = sky_face(d);
  let uv = sky_uv(d, f);
  var keeps = array<f32, 3>(0.3, 0.2, 0.12);
  var gains = array<f32, 3>(1.0, 0.55, 0.3);
  for (var L = 0; L < 3; L++) {
    let cells = 70.0 * exp2(f32(L));
    let g = uv * cells;
    let id = floor(g);
    let h = sky_hash33(vec3f(id, f32(f) * 17.0 + f32(L) * 131.0));
    if (h.z > keeps[L] * mix(0.6, 1.6, clamp(dens * 0.6, 0.0, 1.0))) { continue; }
    let pos = id + 0.25 + 0.5 * h.xy;
    let r = length(g - pos) / cells * 1.5708;
    let b = sky_hash13(vec3f(id * 1.37, f32(f) + f32(L) * 7.0));
    let flux = (pow(b, 16.0) * 5.0 + 0.018 * b * b) * gains[L];
    let sig = pix * 0.55;
    let I = flux * exp(-r * r / (2.0 * sig * sig));
    let tc = sky_hash13(vec3f(id, 5.0 + f32(L)));
    acc += I * mix(vec3f(1.0, 0.78, 0.6), vec3f(0.72, 0.82, 1.0), tc);
  }
  return acc;
}
fn skyColor(tx: texture_2d_array<f32>, sm: sampler, d: vec3f, pix: f32, n: f32, neb: f32, stars: f32) -> vec3f {
  var col = vec3f(0.0);
  var dens = 0.4;
  if (n > 0.5) {
    let f = sky_face(d);
    let uv = sky_uv(d, f) * ((n - 1.0) / n) + 0.5 / n;
    let nb = textureSampleLevel(tx, sm, uv, f, 0.0);
    col = nb.rgb * neb;
    dens = nb.a;
  }
  return col + sky_stars(d, pix, dens) * stars;
}
