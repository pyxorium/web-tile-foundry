import { Mesh, PlaneGeometry, ShaderMaterial, Color, Vector2 } from "three";

// Placeholder background: a vertical gradient, a warm halo behind the lantern
// and darkened edges, drawn by one full-screen shader (no images).
// The real per-kit backgrounds (parlour, damask, workshop) replace this later.
//
// It is an ordinary opaque mesh drawn first, so "real glass" (transmission)
// can see it through the panes.

export function makeBackground() {
  const uniforms = {
    uTop: { value: new Color("#3a2618") },
    uBottom: { value: new Color("#0e0907") },
    uHaloColor: { value: new Color("#ffb46b") },
    uHalo: { value: 0.55 },
    uVignette: { value: 0.6 },
    uAspect: { value: new Vector2(1, 1) },
  };
  const material = new ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uBottom, uHaloColor;
      uniform float uHalo, uVignette;
      uniform vec2 uAspect;
      varying vec2 vUv;
      void main() {
        vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
        vec2 p = (vUv - 0.5) * uAspect;
        float r = length(p);
        c += uHaloColor * uHalo * 0.35 * exp(-r * r * 9.0);
        c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length((vUv - 0.5) * 1.6));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}
