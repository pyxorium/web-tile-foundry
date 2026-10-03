import { Mesh, PlaneGeometry, MeshPhysicalMaterial, Vector3, Color } from "three";

// The tabletop: a dark polished surface under the lantern, lit by pools of
// coloured light from the downward panes (see pools.js). Its far edge fades
// into the background picture, so there is no hard horizon.
//
// It is opaque, so real glass shows it through the lower panes.

export const MAX_POOLS = 8;

export function makeTable(backgroundTexture) {
  const uniforms = {
    uPicture: { value: backgroundTexture },
    uPoolPos: { value: Array.from({ length: MAX_POOLS }, () => new Vector3()) }, // x, z, radius
    uPoolCol: { value: Array.from({ length: MAX_POOLS }, () => new Color(0, 0, 0)) },
    uPoolCount: { value: 0 },
    uPoolStrength: { value: 1.2 },
  };
  // Shine kept faint: seen at this low angle, a normal surface reflects so
  // much light (and the bright studio light that makes the metal glint) that a
  // dark table turns pale grey.
  const material = new MeshPhysicalMaterial({ color: "#24170e", roughness: 0.6, metalness: 0, envMapIntensity: 0.08, specularIntensity: 0.12 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTablePos;\nvarying vec4 vClip;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvTablePos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvClip = gl_Position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uPicture;
uniform vec3 uPoolPos[${MAX_POOLS}];
uniform vec3 uPoolCol[${MAX_POOLS}];
uniform int uPoolCount;
uniform float uPoolStrength;
varying vec3 vTablePos;
varying vec4 vClip;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
for (int i = 0; i < ${MAX_POOLS}; i++) {
  if (i >= uPoolCount) break;
  vec2 d = vTablePos.xz - uPoolPos[i].xy;
  float r = max(uPoolPos[i].z, 0.05);
  totalEmissiveRadiance += uPoolCol[i] * uPoolStrength * exp(-dot(d, d) / (r * r));
}`
      )
      .replace(
        "#include <colorspace_fragment>",
        `// Fade the far table into the wall behind it.
vec2 glScreen = vClip.xy / vClip.w * 0.5 + 0.5;
float glFar = smoothstep(2.5, 7.5, length(vTablePos.xz));
gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uPicture, glScreen).rgb, glFar);
#include <colorspace_fragment>`
      );
  };
  material.customProgramCacheKey = () => "glass-lantern-table-v1";
  const mesh = new Mesh(new PlaneGeometry(40, 40), material);
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, material, uniforms };
}
