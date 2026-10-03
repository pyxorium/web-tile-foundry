import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, SphereGeometry, MeshBasicMaterial,
  PointLight, DirectionalLight, HemisphereLight, PMREMGenerator, Color, ACESFilmicToneMapping, SRGBColorSpace,
  Matrix3, Vector2,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildPanes, buildCame } from "./meshes.js";
import { makeGlassUniforms, makeGlassMaterial, makeRealGlassMaterial, makeClearGlass, makeMetalMaterial } from "./materials.js";
import { makeLampGlow } from "./lamp.js";
import { makeBackground, BACKGROUNDS } from "./background.js";
import { makeTable, MAX_POOLS } from "./table.js";
import { lightPools } from "./pools.js";
import { DEFAULT_SETTINGS, METALS, kelvinToHex, alternateColours, pixelRatioFor, resolveGlassMethod } from "./settings.js";

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

const TABLE_Y = -1.22; //  just below the lantern (radius 1, plus the came)
export const ZOOM_MIN = 0.6; // viewer zoom limits (1 = the normal framing)
export const ZOOM_MAX = 2.2;
const GEOMETRY_KEYS = ["cameWidth", "cameFlatten", "rivets", "bezelWidth", "bezelDepth"];

/**
 * Options (besides the look settings in `initial`):
 *   fill   how much of the box's shorter side the lantern fills (0..1). Left
 *          out, the lab's framing is kept. The tile uses about 0.84: big, with
 *          a little room round it.
 */
const LANTERN_RADIUS = 1.08; // the shape (radius 1) plus its came

export function createLantern(canvas, initial = {}, { fill = null } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 5);

  const background = makeBackground(renderer);
  scene.add(background.mesh);

  const table = makeTable(background.texture);
  table.mesh.position.y = TABLE_Y;
  scene.add(table.mesh);

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
  // Clear glass: two see-through layers on the same pane geometry, drawn after
  // everything solid (tint first, then the surface).
  const clear = makeClearGlass(glassUniforms);
  const clearTint = new Mesh(undefined, clear.tint);
  const clearSurface = new Mesh(undefined, clear.surface);
  clearTint.renderOrder = 3;
  clearSurface.renderOrder = 4;
  group.add(farPanes, panes, clearTint, clearSurface, came);
  let glassMethod = "real";

  let settings = { ...DEFAULT_SETTINGS, ...initial };
  let overrides = {};
  let effective = settings;
  let pixels = { ratio: 1, capped: false };
  let shape = null;
  let colours = null;
  let faceLinear = []; // each face's colour, linear RGB, for the table's light pools

  function rebuild() {
    if (!shape) return;
    panes.geometry.dispose();
    came.geometry.dispose();
    const faceColours = colours || alternateColours(shape.faces.length, effective.palette);
    faceLinear = faceColours.map((c) => new Color(c).toArray());
    panes.geometry = buildPanes(shape, faceColours, effective);
    farPanes.geometry = panes.geometry;
    clearTint.geometry = panes.geometry;
    clearSurface.geometry = panes.geometry;
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
    u.uOpalAmbient.value = 0.35 * s.envIntensity; // stands in for the surrounding light real glass adds
    glass.material.roughness = s.glassRoughness;
    farGlass.material.roughness = s.glassRoughness;
    realGlass.roughness = s.frost;
    realGlass.thickness = s.thickness;
    realGlass.ior = s.ior;
    realGlass.dispersion = s.dispersion;
    clear.surface.roughness = s.frost;
    clear.surface.ior = s.ior;
    renderer.transmissionResolutionScale = s.glassResolution === "half" ? 0.5 : 1;

    glassMethod = resolveGlassMethod(s);
    const seeThrough = glassMethod !== "backup"; // real and clear glass both show what is behind
    panes.material = glassMethod === "real" ? realGlass : glass.material;
    panes.visible = glassMethod !== "clear";
    clearTint.visible = clearSurface.visible = glassMethod === "clear";
    farPanes.visible = seeThrough && s.farSide;
    lampLight.visible = lampGlow.visible = seeThrough;
    lampBulb.visible = seeThrough && s.showBulb;
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
    b.uStyle.value = (BACKGROUNDS.find((x) => x.id === s.background) || BACKGROUNDS[0]).style;
    b.uMain.value.set(s.bgTop);
    b.uDark.value.set(s.bgBottom);
    b.uAccent.value.set(s.bgAccent);
    b.uLamp.value.copy(lamp);
    b.uHalo.value = s.bgHalo;
    b.uVignette.value = s.bgVignette;
    b.uScale.value = s.bgScale;
    b.uContrast.value = s.bgContrast;
    b.uBrightness.value = s.bgBrightness;
    background.setSoftness(s.bgSoftness);
    background.invalidate();

    table.mesh.visible = s.tabletop;
    table.material.color.set(s.tableColor);
    table.uniforms.uPoolStrength.value = s.poolStrength;
    tableLamp.copy(lamp);
    placeCamera();

    applyPixelRatio();
  }

  // The drawing size in CSS pixels: the canvas's size on the page, or a fixed
  // size given to resize(w, h) (for pictures drawn off screen).
  let fixedSize = null;
  const cssWidth = () => (fixedSize ? fixedSize.w : canvas.clientWidth || 1);
  const cssHeight = () => (fixedSize ? fixedSize.h : canvas.clientHeight || 1);

  function applyPixelRatio() {
    const dpr = typeof window === "undefined" || fixedSize ? 1 : window.devicePixelRatio || 1;
    pixels = pixelRatioFor({ width: cssWidth(), height: cssHeight(), devicePixelRatio: dpr, pixelRatio: effective.pixelRatio, maxPixels: effective.maxPixels });
    if (renderer.getPixelRatio() !== pixels.ratio) renderer.setPixelRatio(pixels.ratio);
  }

  // With a tabletop the camera looks down a little, so the table shows.
  let viewDistance = 5;
  let zoom = 1; // viewer's zoom: above 1 is closer
  function placeCamera() {
    const tilt = effective.tabletop ? 0.24 : 0;
    const d = viewDistance / zoom;
    camera.position.set(0, Math.sin(tilt) * d, Math.cos(tilt) * d);
    // The lab looks a little down at the table; the tile keeps the lantern centred.
    camera.lookAt(0, effective.tabletop && !fill ? -0.15 : 0, 0);
  }

  // Light pools on the table, worked out each frame from the lantern's rotation.
  const tableLamp = new Color();
  const turn = new Matrix3();
  function updatePools() {
    if (!table.mesh.visible || !shape) return;
    turn.setFromMatrix4(group.matrixWorld);
    const pools = lightPools({ normals: shape.normals, centres: shape.centres, areas: shape.areas, colours: faceLinear, rotation: turn.elements, tableY: TABLE_Y, max: MAX_POOLS });
    const u = table.uniforms;
    u.uPoolCount.value = pools.length;
    pools.forEach((p, i) => {
      u.uPoolPos.value[i].set(p.x, p.z, p.radius);
      const k = Math.min(1.5, p.strength * 1.6) * effective.lampBrightness * 0.5;
      u.uPoolCol.value[i].setRGB(p.colour[0] * tableLamp.r * k, p.colour[1] * tableLamp.g * k, p.colour[2] * tableLamp.b * k);
    });
  }

  const bufferSize = new Vector2();

  function resize(width, height) {
    if (width && height) fixedSize = { w: width, h: height };
    const w = cssWidth();
    const h = cssHeight();
    applyPixelRatio();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (fill) {
      // The lantern's width fills `fill` of the shorter side, centred.
      const halfTan = Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, w / h);
      viewDistance = LANTERN_RADIUS / (fill * halfTan);
    } else {
      // The lab's framing. Keep the whole lantern in view on tall, narrow screens.
      viewDistance = Math.max(5, (4 * h) / w);
    }
    placeCamera();
    camera.updateProjectionMatrix();
    background.invalidate();
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
    /** The glass method in use: "real", "clear" or "backup". */
    get glassMethod() {
      return glassMethod;
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
    /** The current shape (stage 2 geometry), for rolling. */
    get shape() {
      return shape;
    },
    /** Unit vector from the lantern towards the camera (world space). */
    viewDirection() {
      return camera.position.clone().normalize();
    },
    get zoom() {
      return zoom;
    },
    setZoom(z) {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      placeCamera();
    },
    /** Lights pane `face` (stage 2 face order) with glow 0..1; face -1 for none. */
    setHighlight(face, amount) {
      glassUniforms.uHighlightFace.value = face;
      glassUniforms.uHighlight.value = amount;
    },
    /** Where the lantern is on screen: centre and radius in CSS pixels (for zooming only over it). */
    screenCircle() {
      const h = cssHeight();
      const w = cssWidth();
      const dist = camera.position.length();
      const r = (LANTERN_RADIUS / dist / Math.tan((camera.fov * Math.PI) / 360)) * (h / 2);
      const centre = group.position.clone().project(camera);
      return { x: ((centre.x + 1) / 2) * w, y: ((1 - centre.y) / 2) * h, r };
    },
    render() {
      renderer.getDrawingBufferSize(bufferSize);
      background.paint(bufferSize.x, bufferSize.y);
      group.updateMatrixWorld();
      updatePools();
      renderer.render(scene, camera);
    },
    dispose() {
      panes.geometry.dispose();
      came.geometry.dispose();
      envTexture.dispose();
      background.dispose();
      renderer.dispose();
    },
  };
}
