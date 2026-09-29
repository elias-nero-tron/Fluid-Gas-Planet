const PI = 3.14159265359;
const TAU = 6.28318530718;
struct U {
  W: f32, H: f32, FW: f32, FH: f32,
  count: f32, batch: f32, nBatch: f32, cur: f32,
  opacity: f32, blur: f32, fade: f32, dt: f32,
  octave: f32, nOct: f32, freq: f32, amp: f32,
  ntime: f32, init: f32, edge: f32, aspect: f32,
  speed: f32, frame: f32, p2: f32, p3: f32,
  centre: vec4f,
  grad: array<vec4f, 16>,
  rot0: vec4f, rot1: vec4f, rot2: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;

@group(0) @binding(1) var<storage, read_write> flow: array<vec4f>;   // RG = benutzt, BA = im Aufbau [Q8]
@group(0) @binding(2) var<storage, read_write> parts: array<vec4f>;  // [Q1] theta, phi, Alter, Geburts-phi
@group(0) @binding(3) var<storage, read_write> surfA: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> surfB: array<vec4f>;

