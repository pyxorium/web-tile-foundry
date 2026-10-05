import * as THREE from "three";
import { buildTrack } from "./track-mesh.js";
import { createCart } from "./cart.js";
import { frameBetween, poseAt, pieceAt } from "./path.js";
import { getTheme, DEFAULT_THEME } from "./themes.js";
import { buildScenery } from "./scenery.js";
import { buildSwitchSigns } from "./switch-sign.js";
import { findTunnel, hillHalfWidth } from "./tunnel.js";
import { buildTunnel } from "./tunnel-mesh.js";
import { steelScheme, woodFinish, cartColor, DEFAULT_COLORS } from "./colors.js";

// One Coaster Carnival ride in a canvas: sky, ground, station, track, cart
// and rider, the ride clock and three ways to watch.
//
//   const ride = createCoasterScene(canvas, { onState, onCue });
//   ride.setTrack(generateTrack(...)); ride.setTheme("night"); ride.setRider(image);
//   ride.start();                       // tap to ride: board the cart
//   ride.choose("thrill" | "chill");    // with a track switch: which way (rings the bell, starts the ride)
//   ride.ring();                        // without one: ring the bell (starts the ride)
//   ride.stop();                        // back to the station, whenever
//   ride.setStyle("steel" | "wood");    // the track's look (the layout is the same)
//   ride.setColors({ steel, wood, cart }); // color scheme ids (colors.js), any of them
//   ride.setView("behind" | "outside" | "above");
//   ride.setRoute("chill" | "thrill");  // with a track switch: which way at the switch
//   ride.setTunnel(true | false);       // "Add a tunnel" (on unless turned off; see tunnel.js)
//
// States:
//   "waiting"   the whole coaster, cart in the station; nothing moves
//   "boarding"  after the tap: the camera settles behind the cart, the lap bar
//               locks (onCue "bar"), and the cart waits for the viewer (no
//               time limit). With a track switch, until choose() is called
//               (the station sign shows the choice); without one, until
//               ring() is called (the sign says "Ring the bell to go"). After
//               a few seconds the sign pulses. Then the bell rings (onCue
//               "bell") and the cart rolls out.
//   "riding"    the ride itself (clock runs)
//   "settling"  back in the station: a two second pause under the station
//               sign, the lap bar lets go (onCue "release"). start() during it
//               boards again at once
//   "done"      the camera eases back out to the whole coaster; start() rides again
// None of the boarding or settling time counts as ride time.
//
// Views: "behind" rides along behind and a little above the cart (the main
// view); "outside" watches the whole track with the cart running round it;
// "above" is the gentle view, for viewers who prefer reduced motion: high up
// and looking down at a slant, always from the same compass direction, with
// a good part of the coaster in view. The cart is drawn bigger; the view
// glides after it to keep it near the middle (it never turns, rolls, cuts or
// fades). While waiting, every view shows the whole track.
//
// Tunnel: scenery round one stretch of the ride (it never changes the track).
// Riding through it behind the cart, the light drops to near dark and the
// lamps inside flick past; from above or outside, the hill fades to let the
// cart show through while the cart is in or near it.
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
// The view from above: how steeply it looks down (degrees), how much of the
// coaster fits across the tile's shorter side (a share of its longer side,
// but at least `least` m), and how the view follows the cart. The cart can
// wander `free` of the way from the middle to the edge before the view moves;
// past that, the view drifts after it gently (`drift`, per second), and at
// `edge` it keeps pace, so the cart never leaves the frame.
const ABOVE = { pitch: 50, fov: 40, span: 0.28, least: 25, free: 0.2, edge: 0.5, drift: 2 };
const ABOVE_CART = 3; // the cart is drawn this much bigger from above, so it can be followed
const ROOF = 6; // m from the rails up to the middle of the station roof
const DISPATCH = 0.8; // s from choosing to rolling out (the bell rings at once)
const PULSE_AFTER = 5; // s of waiting for a choice before both ways start to pulse
const SETTLE = 2; // s paused in the station at the end (a tap skips it: start() boards again)
const EASE_OUT = 1.2; // s for the camera to ease back out to the whole coaster
const TUNNEL_DARK = { ambient: 0.2, sun: 0.12, speed: 8 }; // light left inside the tunnel (share), and how fast it changes
const TUNNEL_FADE = { near: 18, opacity: 0.28, speed: 4 }; // m from the tunnel when the hill starts to fade, how far, how fast

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
  let chosen = false; // the way was chosen (or, without a switch, the bell rung) this ride
  let phase = 0; // seconds since the state began (boarding, settling, done)
  let dispatchAt = null; // phase at which a boarding cart rolls out
  let scenery = null;
  let wantTunnel = true;
  let tunnelSpot = null; // where the tunnel goes on this track (tunnel.js), or null
  let tunnelPart = null; // the built tunnel (tunnel-mesh.js), or null
  let dark = 0; // 0 outside, 1 deep in the tunnel (the riding camera)
  let fade = 1; // the hill's opacity
  let cartInTunnel = false;
  let theme = getTheme(DEFAULT_THEME);
  let view = "behind";
  let state = "waiting";
  let clock = 0;
  let lastTick = 0;
  let running = false;
  let paused = false; // scrolled away or tab hidden (see mount.js): nothing moves or draws
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
    // Back in the station the signs go back to plain (no lit way).
    const lit = chosen && state !== "settling" && state !== "done";
    sign.show({ chosen: lit ? choice : null, pulse });
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
    // Props stay off the tunnel's hill.
    const keepOff = [];
    if (wantTunnel && tunnelSpot) {
      const r = hillHalfWidth(Math.max(...track.points.slice(tunnelSpot.from, tunnelSpot.to + 1).map((p) => p[1]))) + 1.5;
      for (let i = tunnelSpot.from; i <= tunnelSpot.to; i += 3) keepOff.push([track.points[i][0], track.points[i][2], r]);
    }
    scenery = buildScenery(track, theme, keepOff);
    scene.add(scenery.group);
  }

  function rebuildTunnel() {
    if (tunnelPart) {
      scene.remove(tunnelPart.group);
      tunnelPart.dispose();
      tunnelPart = null;
    }
    fade = 1;
    if (!track || !wantTunnel || !tunnelSpot) return;
    tunnelPart = buildTunnel(track, tunnelSpot, theme);
    scene.add(tunnelPart.group);
  }

  /** Horizontal distance from a point to the tunnel's middle line. */
  function fromTunnel(p) {
    let best = Infinity;
    for (const e of tunnelPart.line) best = Math.min(best, Math.hypot(p[0] - e.p[0], p[2] - e.p[2]));
    return best;
  }

  /** Dims the light while the camera is in the tunnel; fades the hill from above and outside. */
  function tunnelEffects(pose, moving, dt) {
    let wantDark = 0;
    let wantFade = 1;
    cartInTunnel = false;
    if (tunnelPart && moving) {
      cartInTunnel = tunnelPart.contains(...pose.p);
      if (tunnelPart.contains(camera.position.x, camera.position.y, camera.position.z)) wantDark = 1;
      if ((view === "above" || view === "outside") && fromTunnel(pose.p) < TUNNEL_FADE.near) wantFade = TUNNEL_FADE.opacity;
    }
    if (!moving) {
      dark = 0;
      fade = 1;
    } else {
      dark += (wantDark - dark) * (1 - Math.exp(-dt * TUNNEL_DARK.speed));
      fade += (wantFade - fade) * (1 - Math.exp(-dt * TUNNEL_FADE.speed));
    }
    hemi.intensity = theme.ambient * (1 - (1 - TUNNEL_DARK.ambient) * dark);
    sun.intensity = theme.sunStrength * (1 - (1 - TUNNEL_DARK.sun) * dark);
    if (tunnelPart) tunnelPart.setFade(fade > 0.985 ? 1 : fade);
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

  /** A camera position that shows the whole track. With `into`, only works it out. */
  function wideShot(into = null) {
    const b = track.bounds;
    const width = b.size[0];
    const depth = b.size[2];
    const tall = b.max[1];
    const aspect = camera.aspect;
    camera.fov = 40;
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // Distance so the whole width fits across and the height fits up.
    const fitWide = (width * 0.55) / Math.tan(hfov / 2);
    const fitTall = ((depth * 0.5 + tall) * 0.6) / Math.tan(vfov / 2);
    const dist = Math.max(fitWide, fitTall) + depth * 0.5;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const pos = new THREE.Vector3(cx + width * 0.08, dist * 0.36 + tall * 0.5, cz + dist * 0.92);
    const look = new THREE.Vector3(cx, tall * 0.2, cz);
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

  // The gentle view from above. It always looks the same way (toward -z, the
  // way the whole-coaster view looks), from high up at a slant. Its middle
  // stays put while the cart moves about near it, then drifts after it.
  const aboveAt = new THREE.Vector2(); // the middle of the view, on the ground (x, z)
  let aboveReady = false;
  function aboveShot(pose, dt) {
    const b = track.bounds;
    const pitch = (ABOVE.pitch * Math.PI) / 180;
    const span = Math.max(ABOVE.least, Math.max(b.size[0], b.size[2]) * ABOVE.span);
    const look = b.max[1] * 0.3; // the height the view centers on (fixed, so the view never bobs)
    // A raised cart shows where a ground point a little further away would:
    // follow that point, so a cart high on a hill stays in frame too.
    const x = pose.p[0];
    const z = pose.p[2] - (pose.p[1] - look) / Math.tan(pitch);
    const half = span / 2;
    if (!aboveReady) {
      aboveAt.set(x, z);
      aboveReady = true;
    }
    const dx = x - aboveAt.x;
    const dz = (z - aboveAt.y) * Math.sin(pitch); // ground depth looks shorter on screen when slanted
    const off = Math.hypot(dx, dz);
    const free = half * ABOVE.free;
    const edge = half * ABOVE.edge;
    if (off > free) {
      // Drift: gently while just past the free zone; never letting the cart past the edge.
      const k = Math.min(1, dt * ABOVE.drift * ((off - free) / (edge - free)));
      let move = (off - free) * k;
      move = Math.max(move, off - edge);
      aboveAt.x += (dx / off) * move;
      aboveAt.y += ((dz / off) * move) / Math.sin(pitch);
    }
    // Keep the view mostly over the coaster (it may look a little past the
    // coaster's edge, so a cart there isn't squeezed against the frame).
    aboveAt.x = clampMid(aboveAt.x, b.min[0], b.max[0], half * 0.6);
    aboveAt.y = clampMid(aboveAt.y, b.min[2], b.max[2], half * 0.6);
    const vfov = (ABOVE.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = half / Math.tan(Math.min(vfov, hfov) / 2) + b.max[1] * 0.5;
    lookAt.set(aboveAt.x, look, aboveAt.y);
    const want = new THREE.Vector3(aboveAt.x, look + dist * Math.sin(pitch), aboveAt.y + dist * Math.cos(pitch));
    follow(want, new THREE.Vector3(0, 1, 0), lookAt, dt, ABOVE.fov);
  }

  /** Close on the cart in the station, from ahead and a little to the side, so the rider faces the camera (the card's icon). */
  function riderShot(pose) {
    const t = new THREE.Vector3(...pose.t);
    const up = new THREE.Vector3(...pose.up);
    const side = new THREE.Vector3(...pose.side);
    const at = new THREE.Vector3(...pose.p).addScaledVector(up, 1.35);
    camera.fov = 34;
    camera.position.copy(at).addScaledVector(t, 6.4).addScaledVector(side, -1.8).addScaledVector(up, 0.8);
    camera.up.set(0, 1, 0);
    camera.lookAt(at);
    camera.updateProjectionMatrix();
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
    if (paused) {
      running = false;
      lastTick = 0;
      return;
    }
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
        setState("settling");
        onCue("release");
        showSigns();
      }
    } else if (state === "settling" && phase >= SETTLE) {
      setState("done");
    }
    const moving = state === "boarding" || state === "riding" || state === "settling";
    const pose = poseAt(r, state === "riding" ? clock : 0);
    const fromAbove = moving && view === "above";
    cart.place(pose, fromAbove ? ABOVE_CART : 1);
    if (moving && view === "behind") behindShot(pose, dt);
    else if (moving && view === "outside") droneShot(pose, dt);
    else if (fromAbove) aboveShot(pose, dt);
    else if (state === "done" && phase < EASE_OUT && camReady) {
      // Ease back out to the whole coaster.
      const target = {};
      wideShot(target);
      const k = 1 - Math.exp(-dt * 5);
      lookAt.lerp(target.look, k);
      follow(target.pos, new THREE.Vector3(0, 1, 0), lookAt, dt, camera.fov + (target.fov - camera.fov) * k);
    } else wideShot();
    tunnelEffects(pose, moving, dt);
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
    if (running || drawQueued || disposed || paused) return;
    drawQueued = true;
    requestAnimationFrame(frame);
  }

  /** The bell rings and the cart rolls out shortly after (the way chosen, or the bell rung). */
  function send() {
    chosen = true;
    dispatchAt = phase + DISPATCH;
    onCue("bell");
    showSigns();
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
      return { kind: pieceAt(route(), info.pose.index).kind, speed: info.pose.speed, seconds: clock, route: choice, tunnel: cartInTunnel };
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
        send();
        return true;
      }
      return this.setRoute(next);
    },

    /** Without a track switch: rings the bell, and the cart rolls out shortly after. Returns false if it can't now. */
    ring() {
      if (!track || track.trackSwitch || state !== "boarding" || chosen) return false;
      send();
      return true;
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
      buildStation();
      applyTheme();
      tunnelSpot = findTunnel(track);
      rebuildScenery();
      rebuildTunnel();
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
        rebuildTunnel();
        rebuildSign();
      }
      draw();
    },

    /** "Add a tunnel": true to build it (where the track has room; see tunnel.js), false for none. */
    setTunnel(on) {
      const next = Boolean(on);
      if (next === wantTunnel) return;
      wantTunnel = next;
      if (track) {
        rebuildScenery();
        rebuildTunnel();
      }
      draw();
    },

    /** Where the tunnel is on this track ({ from, to, length, pass }), or null (none, or turned off). */
    get tunnel() {
      return wantTunnel ? tunnelSpot : null;
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
      view = next === "side" ? "above" : next; // "side" was this view's old name
      aboveReady = false;
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
      aboveReady = false;
      setState("boarding");
      dispatchAt = null; // waits for choose() or ring()
      onCue("bar");
      showSigns();
      draw();
    },

    stop() {
      if (state === "waiting") return;
      clock = 0;
      chosen = false;
      dispatchAt = null;
      camReady = false;
      setState("waiting");
      showSigns();
      draw();
    },

    /** Pauses everything (the ride clock too) while the tile can't be seen; false carries on where it was. */
    setPaused(on) {
      paused = Boolean(on);
      if (!paused) {
        lastTick = 0;
        draw();
      }
    },

    get paused() {
      return paused;
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

    /**
     * Draws one still picture of the coaster waiting in the station, at
     * width x height, right now (for the card pictures; see art.js). Copy it
     * off the canvas straight away, in the same moment. `shot` is "wide" (the
     * whole coaster, as the waiting view shows it) or "rider" (close on the
     * cart and its rider, for the small icon).
     */
    renderStill(width, height, shot = "wide") {
      if (!track) return;
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const pose = poseAt(track, 0);
      cart.place(pose, 1);
      tunnelEffects(pose, false, 0);
      if (shot === "rider") riderShot(pose);
      else wideShot();
      cart.faceCamera(camera);
      renderer.render(scene, camera);
    },

    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      if (trackParts) trackParts.dispose();
      if (scenery) scenery.dispose();
      if (sign) sign.dispose();
      if (tunnelPart) tunnelPart.dispose();
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

/** `mid` kept at least `half` inside [min, max] (or the middle, if the range is narrower than the view). */
function clampMid(mid, min, max, half) {
  if (max - min <= half * 2) return (min + max) / 2;
  return Math.max(min + half, Math.min(max - half, mid));
}
