import { MeshStandardMaterial, MeshPhysicalMaterial, Color, BackSide } from "three";

// The lantern's materials.
//
// Real glass (the main look since the Oct 3 phone check): three.js's physical
// material with transmission. It draws the scene behind each pane (the lamp's
// glow, the far panes, the background) and bends it through the glass, with
// optional rainbow edges (dispersion). Costs an extra render pass, which the
// phone check showed is affordable on a fast phone.
//
// Backup glass (for slower devices, and the far panes): a standard material
// with a little extra shader code that fakes the lamp's light shining through
// the pane. No extra render passes.
//
// Both share the same extra code for ripple (cathedral glass: the surface is
// bent, so reflections and what you see through it wobble) and opal (a milky
// swirl). Patterns are computed from the object's own coordinates, so they turn
// with the lantern instead of swimming across it.

const NOISE = /* glsl */ `
float glHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float glNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(glHash(i + vec3(0, 0, 0)), glHash(i + vec3(1, 0, 0)), f.x),
                 mix(glHash(i + vec3(0, 1, 0)), glHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(glHash(i + vec3(0, 0, 1)), glHash(i + vec3(1, 0, 1)), f.x),
                 mix(glHash(i + vec3(0, 1, 1)), glHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float glFbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * glNoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
`;

const HEADER = /* glsl */ `
uniform float uGlow, uSurface, uRipple, uRippleScale, uOpal, uOpalScale, uOpalGlow;
uniform vec3 uLamp;
#ifndef USE_NORMALMAP_OBJECTSPACE
uniform mat3 normalMatrix;
#endif
varying vec3 vObjPos;
varying float vRim;
${NOISE}`;

// Milky swirl amount and the glass colour with it mixed in.
const OPAL = /* glsl */ `
float glMilk = 0.0;
if (uOpal > 0.0) glMilk = uOpal * smoothstep(0.35, 0.75, glFbm(vObjPos * uOpalScale));
vec3 glTint = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), 0.6), glMilk);`;

const RIPPLE = /* glsl */ `
float glWave = 0.5;
if (uRipple > 0.0) {
  vec3 q = vObjPos * uRippleScale;
  float e = 0.05;
  float n0 = glFbm(q);
  vec3 grad = vec3(glFbm(q + vec3(e, 0, 0)) - n0, glFbm(q + vec3(0, e, 0)) - n0, glFbm(q + vec3(0, 0, e)) - n0) / e;
  normal = normalize(normal - normalMatrix * grad * uRipple * 0.12);
  glWave = n0;
}`;

/** Uniforms shared by both glass materials, so one slider moves both. */
export function makeGlassUniforms() {
  return {
    uGlow: { value: 1.6 },
    uSurface: { value: 0.22 },
    uLamp: { value: new Color("#ffb46b") },
    uRipple: { value: 0.35 },
    uRippleScale: { value: 9 },
    uOpal: { value: 0 },
    uOpalScale: { value: 3 },
    uOpalGlow: { value: 0.6 },
  };
}

function addCommonCode(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aRim;\nvarying vec3 vObjPos;\nvarying float vRim;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvRim = aRim;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${HEADER}`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${RIPPLE}`);
}

/**
 * The backup glass: fakes the lamp shining through. Used for the front panes
 * when real glass is off, and (seen from inside, BackSide) for the far panes.
 */
export function makeGlassMaterial(uniforms = makeGlassUniforms(), { farSide = false } = {}) {
  const material = new MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.12, ...(farSide ? { side: BackSide } : {}) });
  material.onBeforeCompile = (shader) => {
    addCommonCode(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>\n${OPAL}\ndiffuseColor.rgb = glTint * (uSurface + 0.55 * glMilk);`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float glFacing = abs(dot(normal, normalize(vViewPosition)));
float glLight = uGlow * (0.35 + 0.65 * glFacing) * (1.0 + uRipple * 1.2 * (glWave - 0.5));
glLight *= (1.0 - 0.55 * vRim) * (1.0 - 0.45 * glMilk);
totalEmissiveRadiance += glTint * uLamp * glLight;`
      );
  };
  // Keep three.js from reusing a program compiled without our extra code.
  material.customProgramCacheKey = () => (farSide ? "glass-lantern-backup-far-v2" : "glass-lantern-backup-v2");
  return { material, uniforms };
}

/** The real (transmission) glass, with ripple and opal added. */
export function makeRealGlassMaterial(uniforms = makeGlassUniforms()) {
  const material = new MeshPhysicalMaterial({
    vertexColors: true,
    metalness: 0,
    roughness: 0.08,
    transmission: 1,
    thickness: 0.12,
    ior: 1.52,
    dispersion: 0.25,
    specularIntensity: 1,
  });
  material.onBeforeCompile = (shader) => {
    addCommonCode(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>\n${OPAL}`)
      .replace(
        "#include <transmission_fragment>",
        `#include <transmission_fragment>
// Opal: milky glass lets less through and glows with the lamp's light instead.
totalDiffuse = mix(totalDiffuse, glTint * (uLamp * uOpalGlow + reflectedLight.indirectDiffuse), glMilk);`
      );
  };
  material.customProgramCacheKey = () => "glass-lantern-real-v2";
  return material;
}

export function makeMetalMaterial() {
  return new MeshStandardMaterial({ color: "#b58a3c", metalness: 1, roughness: 0.32 });
}
