const PI = 3.14159265359;
struct U {
  dim: f32, vf: f32, count: f32, opacity: f32,
  ns: f32, vfac: f32, bands: f32, bfac: f32,
  bpow: f32, patt: f32, nvort: f32, woff: f32,
  octaves: f32, falloff: f32, fade: f32, seed: f32,
  dark: vec4f,
  imgW: f32, imgH: f32, p2: f32, p3: f32,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> field: array<vec2u>;   // Geschwindigkeit, halbe Genauigkeit
@group(0) @binding(2) var<storage, read_write> parts: array<vec4f>;   // xyz Ort, w Farbe (rgba8)
@group(0) @binding(3) var<storage, read_write> img: array<u32>;       // [G8] 6·1024², rgba8
@group(0) @binding(4) var<storage, read> vort: array<vec4f>;          // xyz Mitte, w Radius; Drehsinn im Vorzeichen des Radius
@group(0) @binding(5) var src: texture_2d<f32>;                       // Eingabebild [G1]

