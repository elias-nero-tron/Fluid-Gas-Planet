// Mipmap-Stufe als 2×2-Mittel (WebGPU hat kein generateMipmap)
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn skyMip(@builtin(global_invocation_id) gid: vec3u) {
  let sz = textureDimensions(dst);
  if (gid.x >= sz.x || gid.y >= sz.y) { return; }
  let p = vec2i(gid.xy) * 2;
  let l = i32(gid.z);
  let c = textureLoad(src, p, l, 0) + textureLoad(src, p + vec2i(1, 0), l, 0) + textureLoad(src, p + vec2i(0, 1), l, 0) + textureLoad(src, p + vec2i(1, 1), l, 0);
  textureStore(dst, gid.xy, l, c * 0.25);
}
