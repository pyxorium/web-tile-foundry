import * as THREE from "three";
import { buildTrack } from "./track-mesh.js";
import { createCart } from "./cart.js";
import { frameBetween, poseAt, pieceAt } from "./path.js";
import { getTheme, DEFAULT_THEME } from "./themes.js";
import { buildScenery } from "./scenery.js";
import { buildSwitchSigns } from "./switch-sign.js";
import { steelScheme, woodFinish, cartColor, DEFAULT_COLORS } from "./colors.js";

// One Coaster Carnival ride in a canvas: sky, ground, station, track, cart
// and rider, the ride clock and three ways to watch.
//
//   const ride = createCoasterScene(canvas, { onState, onCue });
//   ride.setTrack(generateTrack(...)); ride.setTheme("night"); ride.setRider(image);
//   ride.start();                       // tap to ride: board the cart
//   ride.choose("thrill" | "chill");    // with a track switch: which way (starts the ride)
//   ride.setStyle("steel" | "wood");    // the track's look (the layout is the same)
//   ride.setColors({ steel, wood, cart }); // color scheme ids (colors.js), any of them
//   ride.setView("behind" | "outside" | "side");
//   ride.setRoute("chill" | "thrill");  // with a track switch: which way at the switch
//
// States:
//   "waiting"   the whole coaster, cart in the station; nothing moves
//   "boarding"  after the tap: the camera settles behind the cart, the lap bar
//               locks (onCue "bar"). With a track switch, the cart waits here
//               until choose() is called (the station sign shows the choice;
//               after a few seconds both ways pulse), then the bell rings
//               (onCue "bell") and it rolls out. Without one, a short hold.
//   "riding"    the ride itself (clock runs)
//   "settling"  back in the station: a two second pause under the station
//               sign, the lap bar lets go (onCue "release"); the sign suggests
//               the other way next time. start() during it boards again at once
//   "done"      the camera eases back out to the whole coaster; start() rides again
// None of the boarding or settling time counts as ride time.
//
// Views: "behind" rides along behind and a little above the cart (the main
// view); "outside" watches the whole track with the cart running round it;
// "side" is a level side view of the whole track, for viewers who prefer
// reduced motion. While waiting, every view shows the whole track.
//
// Track switch: the choice is made while boarding (choose), and can still be
// changed (choose or setRoute) until the cart reaches the switch; up to there
// the two routes are the same track. After that it is locked for the ride.

const MAX_PIXELS = 1.6e6; // drawing-buffer budget, as in Glass Lantern
// Behind the cart: the camera rides on the track itself a few meters back
// (so it follows the same curve through loops), a little above the rails.
// The lab can change these (setBehind) while tuning.
export const BEHIND = Object.freeze({ back: 6.5, up: 2.6, ahead: 4, fov: 64 }); // m, m, m, degrees
const DRONE = { distance: 26, height: 12 }; // m, for "Watch from outside"
const FOLLOW = 6; // how quickly a following camera catches up (per second)
const SIDE_VIEW_CART = 4; // the cart is drawn this much bigger in the side view, so it can be followed
const ROOF = 6; // m from the rails up to the middle of the station roof
const HOLD = 0.5; // s in the station before rolling out, without a switch
const DISPATCH = 0.8; // s from choosing to rolling out (the bell rings at once)
const PULSE_AFTER = 5; // s of waiting for a choice before both ways start to pulse
const SETTLE = 2; // s paused in the station at the end (a tap skips it: start() boards again)
const EASE_OUT = 1.2; // s for the camera to ease back out to the whole coaster

export function createCoasterScene(canvas, { onState = () => {}, onCue = () => {}, quality = 1 } = {}) {
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
  let sign = null;
  let style = "steel";
  const colors = { ...DEFAULT_COLORS };
  let choice = "chill";
  let chosen = false; // a choice was made this ride
  let phase = 0; // seconds since the state began (boarding, settling, done)
  let dispatchAt = null; // phase at which a boarding cart rolls out
  const ridden = new Set(); // routes ridden on this track, for the end message
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
    box(5.6, 0.25, 17, stationMaterials.roof, 1.1, ROOF, 0); // roof (high enough for the station sign, see switch-sign.js)
    for (const z of [-7.5, 0, 7.5]) box(0.2, ROOF + height, 0.2, stationMaterials.platform, 3.6, ROOF / 2 - height / 2, z); // posts
    const flat = new THREE.Vector3(f.t[0], 0, f.t[2]).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(flat);
    const m = new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), flat);
    m.setPosition(f.p[0], f.p[1], f.p[2]);
    station.matrixAutoUpdate = false;
    station.matrix.copy(m);
    scene.add(station);
  }

  function rebuildSign() {
    if (sign) {
      scene.remove(sign.group);
      sign.dispose();
      sign = null;
    }
    if (!track) return;
    sign = buildSwitchSigns(track, theme);
    if (sign) scene.add(sign.group);
    showSigns();
  }

  function showSigns(pulse = 0) {
    if (!sign) return;
    let top = null;
    if (state === "settling" || state === "done") {
      const other = choice === "thrill" ? "chill" : "thrill";
      top = ridden.size > 1 ? "You rode both!" : `Next time: ${theme.routes[other]}?`;
    }
    sign.show({ chosen: chosen ? choice : null, top, pulse });
  }

  /** The route the cart is following: the main ride, or the thrill route. */
  function route() {
    return choice === "thrill" && track.trackSwitch ? track.trackSwitch.thrill : track;
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
    // The creator's colors, the same in every theme (at night the spine glows a little).
    const c = cartColor(colors.cart);
    cart.setColors(c.body, c.trim);
    if (trackParts) {
      const m = trackParts.materials;
      if (trackParts.style === "wood") {
        const w = woodFinish(colors.wood);
        for (const k of ["rails", "stacks", "ties", "supports"]) m[k].color.set(w[k]);
      } else {
        const st = steelScheme(colors.steel);
        for (const k of ["rails", "spine", "ties", "supports"]) m[k].color.set(st[k]);
        m.spine.emissive.set(st.spine).multiplyScalar(theme.glow * 0.5);
      }
    }
  }

  // ---------- cameras ----------

  /** A camera position that shows the whole track; `side` = level side view. With `into`, only works it out. */
  function wideShot(side, into = null) {
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
    const pos = side ? new THREE.Vector3(0, tall * 0.45 + 2, dist) : new THREE.Vector3(width * 0.08, dist * 0.36 + tall * 0.5, dist * 0.92);
    const look = side ? new THREE.Vector3(0, tall * 0.4, 0) : new THREE.Vector3(0, tall * 0.2, 0);
    if (into) {
      into.pos = pos;
      into.look = look;
      into.fov = camera.fov;
      return;
    }
    camera.position.copy(pos);
    lookAt.copy(look);
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
    const r = route();
    const at = pose.index + pose.fraction - behind.back / r.spacing;
    const back = frameBetween(r, Math.floor(at), at - Math.floor(at));
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
    phase += dt;
    const r = route();
    if (state === "boarding") {
      if (sign && !chosen) showSigns(phase > PULSE_AFTER ? 0.5 + 0.5 * Math.sin((phase - PULSE_AFTER) * 4) : 0);
      if (dispatchAt !== null && phase >= dispatchAt) {
        clock = 0;
        setState("riding");
      }
    } else if (state === "riding") {
      clock += dt;
      if (clock >= r.duration) {
        clock = r.duration;
        ridden.add(choice);
        setState("settling");
        onCue("release");
        showSigns();
      }
    } else if (state === "settling" && phase >= SETTLE) {
      setState("done");
    }
    const moving = state === "boarding" || state === "riding" || state === "settling";
    const pose = poseAt(r, state === "riding" ? clock : 0);
    cart.place(pose, state === "riding" && view === "side" ? SIDE_VIEW_CART : 1);
    if (moving && view === "behind") behindShot(pose, dt);
    else if (moving && view === "outside") droneShot(pose, dt);
    else if (state === "done" && phase < EASE_OUT && camReady && view !== "side") {
      // Ease back out to the whole coaster.
      const target = {};
      wideShot(false, target);
      const k = 1 - Math.exp(-dt * 5);
      lookAt.lerp(target.look, k);
      follow(target.pos, new THREE.Vector3(0, 1, 0), lookAt, dt, camera.fov + (target.fov - camera.fov) * k);
    } else wideShot(view === "side");
    cart.faceCamera(camera);
    renderer.render(scene, camera);
    if (moving || (state === "done" && phase < EASE_OUT)) {
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
    phase = 0;
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
      return { kind: pieceAt(route(), info.pose.index).kind, speed: info.pose.speed, seconds: clock, route: choice };
    },

    /** With a track switch: which side the thrill route leaves on ("left" or "right"), for taps and keys. */
    get thrillSide() {
      return sign ? sign.side : null;
    },

    /**
     * Picks the way at the track switch. While boarding it starts the ride
     * (the bell rings, the cart rolls out shortly after); while riding it can
     * still change the way until the switch. Returns false if there is no
     * switch, or it is too late.
     */
    choose(next) {
      if (!track || !track.trackSwitch || (next !== "chill" && next !== "thrill")) return false;
      if (state === "boarding") {
        if (chosen) return false; // already rolling out
        choice = next;
        chosen = true;
        dispatchAt = phase + DISPATCH;
        onCue("bell");
        showSigns();
        return true;
      }
      return this.setRoute(next);
    },

    /** The route chosen at the switch ("chill" or "thrill"). */
    get route() {
      return choice;
    },

    /**
     * Picks the way at the track switch. Returns false (and changes nothing)
     * if there is no switch, or the cart has already reached it.
     */
    setRoute(next) {
      if (!track || !track.trackSwitch || (next !== "chill" && next !== "thrill")) return false;
      if (state === "riding" && clock >= track.trackSwitch.at - 0.05) return false;
      choice = next;
      if (state === "riding") chosen = true;
      showSigns();
      draw();
      return true;
    },

    /** The track's look: "steel" or "wood" (the layout is the same). */
    setStyle(next) {
      style = next === "wood" ? "wood" : "steel";
      if (track && trackParts && trackParts.style !== style) {
        scene.remove(trackParts.group);
        trackParts.dispose();
        trackParts = buildTrack(track, quality, style);
        scene.add(trackParts.group);
        applyTheme();
        draw();
      }
    },

    get style() {
      return style;
    },

    /** The creator's colors: { steel, wood, cart } scheme ids (colors.js); any left out stay as they are. */
    setColors(next) {
      for (const k of ["steel", "wood", "cart"]) if (typeof next?.[k] === "string") colors[k] = next[k];
      applyTheme();
      draw();
    },

    setTrack(next) {
      track = next;
      if (trackParts) {
        scene.remove(trackParts.group);
        trackParts.dispose();
      }
      trackParts = buildTrack(track, quality, style);
      scene.add(trackParts.group);
      choice = "chill";
      chosen = false;
      ridden.clear();
      buildStation();
      applyTheme();
      rebuildScenery();
      rebuildSign();
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
      if (changed) {
        rebuildScenery();
        rebuildSign();
      }
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

    /** Boards the cart (tap to ride). With a switch it then waits for choose(). */
    start() {
      if (!track) return;
      clock = 0;
      lastTick = 0;
      choice = "chill";
      chosen = false;
      // The camera glides in from where it is.
      camPos.copy(camera.position);
      camUp.copy(camera.up);
      camReady = true;
      setState("boarding");
      dispatchAt = track.trackSwitch ? null : HOLD;
      onCue("bar");
      if (!track.trackSwitch) setTimeout(() => state === "boarding" && onCue("bell"), HOLD * 600);
      showSigns();
      draw();
    },

    stop() {
      clock = 0;
      chosen = false;
      setState("waiting");
      showSigns();
      draw();
    },

    /** Jumps to a moment of the ride (played seconds), riding from there. For the lab. */
    seek(seconds) {
      if (!track) return;
      clock = Math.max(0, Math.min(route().duration - 0.01, seconds));
      camReady = false;
      lastTick = 0;
      if (state !== "riding") setState("riding");
      showSigns();
      draw();
    },

    resize,

    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      if (trackParts) trackParts.dispose();
      if (scenery) scenery.dispose();
      if (sign) sign.dispose();
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
