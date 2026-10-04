import * as THREE from "three";
import { buildTrack } from "./track-mesh.js";
import { createCart } from "./cart.js";
import { frameBetween, poseAt, pieceAt } from "./path.js";
import { getTheme, DEFAULT_THEME } from "./themes.js";
import { buildScenery } from "./scenery.js";

// One Coaster Carnival ride in a canvas: sky, ground, station, track, cart
// and rider, the ride clock and three ways to watch.
//
//   const ride = createCoasterScene(canvas, { onState });
//   ride.setTrack(generateTrack(...)); ride.setTheme("night"); ride.setRider(image);
//   ride.start();                       // tap to ride
//   ride.setView("behind" | "outside" | "side");
//
// States: "waiting" (cart in the station, nothing moving, nothing drawn after
// the first frame), "riding", "done" (back in the station; start() rides again).
//
// Views: "behind" rides along behind and a little above the cart (the main
// view); "outside" watches the whole track with the cart running round it;
// "side" is a level side view of the whole track, for viewers who prefer
// reduced motion. While waiting, every view shows the whole track.

const MAX_PIXELS = 1.6e6; // drawing-buffer budget, as in Glass Lantern
// Behind the cart: the camera rides on the track itself a few meters back
// (so it follows the same curve through loops), a little above the rails.
// The lab can change these (setBehind) while tuning.
export const BEHIND = Object.freeze({ back: 6.5, up: 2.6, ahead: 4, fov: 64 }); // m, m, m, degrees
const DRONE = { distance: 26, height: 12 }; // m, for "Watch from outside"
const FOLLOW = 6; // how quickly a following camera catches up (per second)
const SIDE_VIEW_CART = 4; // the cart is drawn this much bigger in the side view, so it can be followed

export function createCoasterScene(canvas, { onState = () => {}, quality = 1 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality >= 1, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);

  // Light: sky and ground fill, plus one sun.
  const hemi = new THREE.HemisphereLight("#bfe3ff", "#6f8f4c", 1);
  const sun = new THREE.DirectionalLight("#ffffff", 2);
  sun.position.set(60, 220, 160);
  scene.add(hemi, sun);

  // Ground.
  const groundMaterial = new THREE.MeshStandardMaterial({ color: "#7dbb5c", roughness: 1 });
  const groundGeometry = new THREE.CircleGeometry(1400, 48);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  scene.add(ground);

  // Station (built when a track arrives).
  const stationMaterials = {
    platform: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: "#e23d2e", roughness: 0.6 }),
  };
  const stationGeometries = [];
  let station = null;

  const cart = createCart();
  scene.add(cart.group);

  let track = null;
  let trackParts = null;
  let scenery = null;
  let theme = getTheme(DEFAULT_THEME);
  let view = "behind";
  let state = "waiting";
  let clock = 0;
  let lastTick = 0;
  let running = false;
  let drawQueued = false;
  let disposed = false;

  // Smoothed riding-camera position and up.
  const camPos = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);
  const lookAt = new THREE.Vector3();
  let camReady = false;
  const behind = { ...BEHIND };

  // ---------- building ----------

  function buildStation() {
    if (station) {
      scene.remove(station);
      stationGeometries.splice(0).forEach((g) => g.dispose());
    }
    const f = frameBetween(track, 0, 0);
    station = new THREE.Group();
    const box = (w, h, d, material, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      stationGeometries.push(g);
      const m = new THREE.Mesh(g, material);
      m.position.set(x, y, z);
      station.add(m);
    };
    // x = across (toward the platform side), y = up, z = along the track.
    const height = f.p[1];
    box(3, height, 16, stationMaterials.platform, 2.2, -height / 2 + 0.05, 0); // platform
    box(5.6, 0.25, 17, stationMaterials.roof, 1.1, 4.4, 0); // roof
    for (const z of [-7.5, 0, 7.5]) box(0.2, 4.4 + height, 0.2, stationMaterials.platform, 3.6, 2.2 - height / 2, z); // posts
    const flat = new THREE.Vector3(f.t[0], 0, f.t[2]).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(flat);
    const m = new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), flat);
    m.setPosition(f.p[0], f.p[1], f.p[2]);
    station.matrixAutoUpdate = false;
    station.matrix.copy(m);
    scene.add(station);
  }

  function rebuildScenery() {
    if (scenery) {
      scene.remove(scenery.group);
      scenery.dispose();
      scenery = null;
    }
    if (!track) return;
    scenery = buildScenery(track, theme);
    scene.add(scenery.group);
  }

  function applyTheme() {
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.sky, theme.fog[0], theme.fog[1]);
    hemi.color.set(theme.skyLight);
    hemi.groundColor.set(theme.groundLight);
    hemi.intensity = theme.ambient;
    sun.color.set(theme.sunColor);
    sun.intensity = theme.sunStrength;
    groundMaterial.color.set(theme.ground);
    stationMaterials.platform.color.set(theme.station);
    stationMaterials.roof.color.set(theme.stationRoof);
    stationMaterials.roof.emissive.set(theme.stationRoof).multiplyScalar(theme.glow * 0.6);
    cart.setColors(theme.cart, theme.cartTrim);
    if (trackParts) {
      const m = trackParts.materials;
      m.rails.color.set(theme.rails);
      m.spine.color.set(theme.spine);
      m.spine.emissive.set(theme.spine).multiplyScalar(theme.glow * 0.5);
      m.ties.color.set(theme.ties);
      m.supports.color.set(theme.supports);
    }
  }

  // ---------- cameras ----------

  /** A camera position that shows the whole track; `side` = level side view. */
  function wideShot(side) {
    const b = track.bounds;
    const width = b.size[0];
    const depth = b.size[2];
    const tall = b.max[1];
    const aspect = camera.aspect;
    camera.fov = side ? 32 : 40;
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // Distance so the whole width fits across and the height fits up.
    const fitWide = (width * 0.55) / Math.tan(hfov / 2);
    const fitTall = ((side ? tall : depth * 0.5 + tall) * 0.6) / Math.tan(vfov / 2);
    const dist = Math.max(fitWide, fitTall) + depth * 0.5;
    if (side) {
      camera.position.set(0, tall * 0.45 + 2, dist);
      lookAt.set(0, tall * 0.4, 0);
    } else {
      camera.position.set(width * 0.08, dist * 0.36 + tall * 0.5, dist * 0.92);
      lookAt.set(0, tall * 0.2, 0);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
  }

  function follow(want, up, look, dt, fov) {
    const k = camReady ? 1 - Math.exp(-dt * FOLLOW) : 1;
    camPos.lerp(want, k);
    camUp.lerp(up, k).normalize();
    camReady = true;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.copy(camPos);
    camera.up.copy(camUp);
    camera.lookAt(look);
  }

  function behindShot(pose, dt) {
    const at = pose.index + pose.fraction - behind.back / track.spacing;
    const back = frameBetween(track, Math.floor(at), at - Math.floor(at));
    const want = new THREE.Vector3(...back.p).addScaledVector(new THREE.Vector3(...back.up), behind.up);
    lookAt.set(...pose.p).addScaledVector(new THREE.Vector3(...pose.t), behind.ahead).addScaledVector(new THREE.Vector3(...pose.up), 0.9);
    follow(want, new THREE.Vector3(...back.up), lookAt, dt, behind.fov);
  }

  function droneShot(pose, dt) {
    // Off to the outside of the circuit and above, looking at the cart.
    const p = new THREE.Vector3(...pose.p);
    const out = new THREE.Vector3(p.x, 0, p.z);
    if (out.lengthSq() < 1) out.set(0, 0, 1);
    out.normalize();
    const want = p.clone().addScaledVector(out, DRONE.distance);
    want.y = Math.max(p.y, 0) + DRONE.height;
    lookAt.copy(p);
    follow(want, new THREE.Vector3(0, 1, 0), lookAt, dt, 50);
  }

  // ---------- drawing ----------

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (w * h)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  }

  function frame(now) {
    drawQueued = false;
    if (disposed || !track) return;
    const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0;
    lastTick = now;
    if (state === "riding") {
      clock += dt;
      if (clock >= track.duration) {
        clock = track.duration;
        setState("done");
      }
    }
    const pose = poseAt(track, state === "riding" ? clock : 0);
    const riding = state === "riding";
    cart.place(pose, riding && view === "side" ? SIDE_VIEW_CART : 1);
    if (riding && view === "behind") behindShot(pose, dt);
    else if (riding && view === "outside") droneShot(pose, dt);
    else wideShot(view === "side");
    cart.faceCamera(camera);
    renderer.render(scene, camera);
    if (state === "riding") {
      running = true;
      requestAnimationFrame(frame);
    } else {
      running = false;
      lastTick = 0;
    }
    info.pose = pose;
  }

  function draw() {
    if (running || drawQueued || disposed) return;
    drawQueued = true;
    requestAnimationFrame(frame);
  }

  function setState(next) {
    state = next;
    onState(next);
  }

  const info = { pose: null };
  window.addEventListener("resize", resize);

  return {
    get state() {
      return state;
    },
    get clock() {
      return clock;
    },
    /** What the cart is doing now: { kind, speed, seconds } (for sound, readouts). */
    now() {
      if (!track || !info.pose) return null;
      return { kind: pieceAt(track, info.pose.index).kind, speed: info.pose.speed, seconds: clock };
    },

    setTrack(next) {
      track = next;
      if (trackParts) {
        scene.remove(trackParts.group);
        trackParts.dispose();
      }
      trackParts = buildTrack(track, quality);
      scene.add(trackParts.group);
      buildStation();
      applyTheme();
      rebuildScenery();
      clock = 0;
      camReady = false;
      if (state !== "waiting") setState("waiting");
      resize();
    },

    setTheme(id) {
      const next = getTheme(id);
      const changed = next !== theme;
      theme = next;
      applyTheme();
      if (changed) rebuildScenery();
      draw();
    },

    setRider(image) {
      cart.setRider(image);
      draw();
    },

    /** Changes the behind-the-cart camera: { back, up, fov } (any of them). */
    setBehind(settings) {
      for (const k of ["back", "up", "ahead", "fov"]) if (Number.isFinite(settings[k])) behind[k] = settings[k];
      camReady = false;
      draw();
    },

    setView(next) {
      view = next;
      camReady = false;
      draw();
    },

    start() {
      if (!track) return;
      clock = 0;
      camReady = false;
      lastTick = 0;
      setState("riding");
      draw();
    },

    stop() {
      clock = 0;
      setState("waiting");
      draw();
    },

    /** Jumps to a moment of the ride (played seconds), riding from there. For the lab. */
    seek(seconds) {
      if (!track) return;
      clock = Math.max(0, Math.min(track.duration - 0.01, seconds));
      camReady = false;
      lastTick = 0;
      if (state !== "riding") setState("riding");
      draw();
    },

    resize,

    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      if (trackParts) trackParts.dispose();
      if (scenery) scenery.dispose();
      stationGeometries.forEach((g) => g.dispose());
      Object.values(stationMaterials).forEach((m) => m.dispose());
      groundGeometry.dispose();
      groundMaterial.dispose();
      cart.dispose();
      renderer.dispose();
    },

    // For the lab's readouts.
    renderer,
  };
}
