import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, SphereGeometry, MeshBasicMaterial,
  PointLight, DirectionalLight, HemisphereLight, PMREMGenerator, Color, ACESFilmicToneMapping, SRGBColorSpace,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildPanes, buildCame } from "./meshes.js";
import { makeGlassUniforms, makeGlassMaterial, makeRealGlassMaterial, makeMetalMaterial } from "./materials.js";
import { makeLampGlow } from "./lamp.js";
import { makeBackground } from "./background.js";
import { DEFAULT_SETTINGS, METALS, kelvinToHex, alternateColours, pixelRatioFor } from "./settings.js";

// One lantern on a canvas. Used by the look lab now, and the basis of the
// tile's runtime later (stage 5) and the Foundry's preview (stage 6).
//
//   const lantern = createLantern(canvas);
//   lantern.setShape(shape);          a stage 2 shape: { vertices, faces, edges }
//   lantern.setColours([...]);        one CSS colour per face (optional)
//   lantern.update({ glow: 2 });      any keys from DEFAULT_SETTINGS
//   lantern.setOverrides({...});      automatic quality steps, laid on top
//                                     of the settings without changing them
//   lantern.render();                 draw one frame
//   lantern.group                     the object to turn
//
// Geometry is rebuilt only when a setting that changes its shape changes.

const GEOMETRY_KEYS = ["cameWidth", "cameFlatten", "rivets", "bezelWidth", "bezelDepth"];

export function createLantern(canvas, initial = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 5);

  const background = makeBackground();
  scene.add(background.mesh);

  const room = new PMREMGenerator(renderer);
  const envTexture = room.fromScene(new RoomEnvironment(), 0.04).texture;
  room.dispose();

  const hemi = new HemisphereLight("#fff2dd", "#2a1d14", 0.35);
  const key = new DirectionalLight("#fff1dc", 1.2);
  key.position.set(-2.5, 3, 4);
  scene.add(hemi, key);

  const group = new Group();
  group.rotation.set(0.45, -0.6, 0);
  scene.add(group);

  // The lamp inside: a light for real glass to show, as a soft glow (the old
  // round bulb stays available for comparison). The backup glass fakes it.
  const lampLight = new PointLight("#ffb46b", 5, 4, 1.5);
  const lampGlow = makeLampGlow();
  const lampBulb = new Mesh(new SphereGeometry(0.16, 20, 14), new MeshBasicMaterial({ color: "#ffb46b" }));
  group.add(lampLight, lampGlow, lampBulb);

  const glassUniforms = makeGlassUniforms();
  const glass = makeGlassMaterial(glassUniforms);
  const farGlass = makeGlassMaterial(glassUniforms, { farSide: true });
  const realGlass = makeRealGlassMaterial(glassUniforms);
  const metal = makeMetalMaterial();
  const panes = new Mesh(undefined, glass.material);
  // The far panes, seen from inside through the near ones. They share the
  // panes' geometry; BackSide shows only the faces turned away from the viewer.
  const farPanes = new Mesh(undefined, farGlass.material);
  farPanes.renderOrder = 0;
  const came = new Mesh(undefined, metal);
  group.add(farPanes, panes, came);

  let settings = { ...DEFAULT_SETTINGS, ...initial };
  let overrides = {};
  let effective = settings;
  let pixels = { ratio: 1, capped: false };
  let shape = null;
  let colours = null;

  function rebuild() {
    if (!shape) return;
    panes.geometry.dispose();
    came.geometry.dispose();
    const faceColours = colours || alternateColours(shape.faces.length, effective.palette);
    panes.geometry = buildPanes(shape, faceColours, effective);
    farPanes.geometry = panes.geometry;
    came.geometry = buildCame(shape, effective);
  }

  function apply() {
    const s = effective;
    const lamp = new Color(kelvinToHex(s.lampWarmth));
    const u = glassUniforms;
    u.uGlow.value = s.glow;
    u.uSurface.value = s.surface;
    u.uLamp.value.copy(lamp);
    u.uRipple.value = s.rippleOn ? s.ripple : 0;
    u.uRippleScale.value = s.rippleScale;
    u.uOpal.value = s.opalOn ? s.opal : 0;
    u.uOpalScale.value = s.opalScale;
    u.uOpalGlow.value = s.opalGlow * s.lampBrightness * 0.4;
    glass.material.roughness = s.glassRoughness;
    farGlass.material.roughness = s.glassRoughness;
    realGlass.roughness = s.frost;
    realGlass.thickness = s.thickness;
    realGlass.ior = s.ior;
    realGlass.dispersion = s.dispersion;
    renderer.transmissionResolutionScale = s.glassResolution === "half" ? 0.5 : 1;

    panes.material = s.realGlass ? realGlass : glass.material;
    farPanes.visible = s.realGlass && s.farSide;
    lampLight.visible = lampGlow.visible = s.realGlass;
    lampBulb.visible = s.realGlass && s.showBulb;
    lampLight.color.copy(lamp);
    lampLight.intensity = 2 * s.lampBrightness;
    lampGlow.material.color.copy(lamp).multiplyScalar(s.lampBrightness);
    lampGlow.scale.setScalar(2 * s.lampSize);
    lampBulb.material.color.copy(lamp).multiplyScalar(1 + s.lampBrightness);

    metal.color.set(METALS[s.metal] || METALS.brass);
    metal.roughness = s.metalRoughness;
    key.intensity = s.keyLight;
    scene.environment = s.reflections ? envTexture : null;
    scene.environmentIntensity = s.envIntensity;

    const b = background.uniforms;
    b.uTop.value.set(s.bgTop);
    b.uBottom.value.set(s.bgBottom);
    b.uHalo.value = s.bgHalo;
    b.uVignette.value = s.bgVignette;
    b.uHaloColor.value.copy(lamp);

    applyPixelRatio();
  }

  function applyPixelRatio() {
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    pixels = pixelRatioFor({ width: canvas.clientWidth || 1, height: canvas.clientHeight || 1, devicePixelRatio: dpr, pixelRatio: effective.pixelRatio, maxPixels: effective.maxPixels });
    if (renderer.getPixelRatio() !== pixels.ratio) renderer.setPixelRatio(pixels.ratio);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    applyPixelRatio();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole lantern in view on tall, narrow screens.
    camera.position.z = Math.max(5, (4 * h) / w);
    camera.updateProjectionMatrix();
    background.uniforms.uAspect.value.set(Math.max(1, w / h), Math.max(1, h / w));
  }

  function refresh() {
    const before = effective;
    effective = { ...settings, ...overrides };
    const geometryChanged = GEOMETRY_KEYS.some((k) => before[k] !== effective[k]) || (!colours && before.palette !== effective.palette);
    if (geometryChanged) rebuild();
    apply();
  }

  apply();

  return {
    group,
    renderer,
    get settings() {
      return { ...settings };
    },
    /** What is actually being drawn: settings with automatic overrides on top. */
    get effective() {
      return { ...effective };
    },
    /** { ratio, capped }: the pixel ratio in use, and whether the pixel budget lowered it. */
    get pixels() {
      return { ...pixels };
    },
    setShape(next) {
      shape = next;
      colours = null;
      rebuild();
    },
    setColours(next) {
      colours = next;
      rebuild();
    },
    update(changes) {
      settings = { ...settings, ...changes };
      refresh();
    },
    setOverrides(next) {
      overrides = { ...next };
      refresh();
    },
    resize,
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      panes.geometry.dispose();
      came.geometry.dispose();
      envTexture.dispose();
      renderer.dispose();
    },
  };
}
