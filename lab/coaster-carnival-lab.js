import GUI from "lil-gui";
import { generateTrack, RANGES, randomSeed } from "../src/tile-types/coaster-carnival/track/index.js";
import { BEHIND } from "../src/tile-types/coaster-carnival/ride/scene.js";
import { mountCoaster } from "../src/tile-types/coaster-carnival/ride/mount.js";
import { THEMES, DEFAULT_THEME } from "../src/tile-types/coaster-carnival/ride/themes.js";
import { DEFAULT_MIX, DEFAULT_TONE, DEFAULT_VOLUME } from "../src/tile-types/coaster-carnival/ride/sound.js";
import { STEEL_SCHEMES, WOOD_FINISHES, CART_COLORS, DEFAULT_COLORS } from "../src/tile-types/coaster-carnival/ride/colors.js";

// Coaster Carnival ride lab (development only; never part of the site).
//   npm run lab   then open  /lab/coaster-carnival.html  (on the phone too)
// The ride itself is the real thing (ride/mount.js: the scene, sound and the
// viewer's controls, as the tile will have them); this panel stands in for the
// Foundry and for tuning. With "Live sync" on, every device with the lab open
// shows the same track (see labSync in vite.config.js; this lab tags its
// messages so the lantern lab ignores them).

const DEFAULT_SPRITE = "/coaster-carnival/default-sprite.png";
const STORE = "coaster-carnival-lab";

const stage = document.getElementById("stage");
const readout = document.getElementById("readout");

const settings = {
  drops: RANGES.drops.default,
  loops: RANGES.loops.default,
  corkscrews: RANGES.corkscrews.default,
  intensity: RANGES.intensity.default,
  seed: 1,
  trackSwitch: true,
  tunnel: true,
  trackStyle: "steel",
  steelColors: DEFAULT_COLORS.steel,
  woodColors: DEFAULT_COLORS.wood,
  cartColors: DEFAULT_COLORS.cart,
  route: "chill",
  theme: DEFAULT_THEME,
  view: "behind",
  camBack: BEHIND.back,
  camUp: BEHIND.up,
  camFov: BEHIND.fov,
  soundOn: true,
  volume: DEFAULT_VOLUME,
  mix: { ...DEFAULT_MIX },
  tone: { ...DEFAULT_TONE },
  liveSync: true,
  readout: true,
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || "{}"));
} catch {
  // Storage blocked: start from the defaults.
}
if (settings.route !== "thrill") settings.route = "chill"; // older saved names ("woods", "water")
if (settings.view === "side") settings.view = "above"; // the view from above used to be the side view
settings.mix = { ...DEFAULT_MIX, ...(settings.mix || {}) };
settings.tone = { ...DEFAULT_TONE, ...(settings.tone || {}) };
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    // Not saved; the lab still works.
  }
}

// The ride, with the viewer's own controls (chips, gear, choosing, end card).
const coaster = mountCoaster(stage, {
  theme: settings.theme,
  view: settings.view,
  style: settings.trackStyle,
  tunnel: settings.tunnel,
  colors: { steel: settings.steelColors, wood: settings.woodColors, cart: settings.cartColors },
  handle: "thunderbirdwine.bsky.social",
  makeUrl: "https://foundry.thunderbird.cafe/",
  sound: settings.soundOn,
  volume: settings.volume,
  mix: settings.mix,
  tone: settings.tone,
  // The viewer's own choices show in this panel too.
  onTheme: (id) => {
    settings.theme = id;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    changed(false);
  },
  onView: (id) => {
    settings.view = id;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    save();
  },
  onSound: (on) => {
    settings.soundOn = on;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    save();
  },
});
const sound = coaster.sound;

/** Picks a way by name (the lab's buttons): the side it leaves on, as a tap would. */
function chooseRoute(route) {
  const ride = coaster.ride;
  if (!track?.trackSwitch || !ride) return;
  const other = ride.thrillSide === "left" ? "right" : "left";
  coaster.choose(route === "thrill" ? ride.thrillSide : other);
}

// ---------- the track ----------

let track = null;
let buildTimer = null;
function rebuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    const started = performance.now();
    const input = {
      drops: settings.drops,
      loops: settings.loops,
      corkscrews: settings.corkscrews,
      intensity: settings.intensity,
      seed: settings.seed,
      trackSwitch: settings.trackSwitch,
    };
    try {
      track = generateTrack(input);
    } catch (e) {
      readout.innerHTML = `<b>Could not make that track</b><small>${e.message}</small>`;
      return;
    }
    buildMs = Math.round(performance.now() - started);
    coaster.setStyle(settings.trackStyle);
    applyColors();
    coaster.setTrack(track);
    showInfo();
  }, 150);
}
let buildMs = 0;

function showInfo(live) {
  if (!track) return;
  const left = Object.entries(track.leftOut)
    .filter(([k, n]) => n > 0 && k !== "trackSwitch")
    .map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "") : k}`);
  const sw = track.trackSwitch;
  const lines = [
    `${track.duration.toFixed(1)} s ride, ${Math.round(track.length)} m of track, up to ${Math.round(track.bounds.max[1])} m tall`,
    sw
      ? `switch at ${sw.at.toFixed(1)} s; thrill route ${sw.thrill.duration.toFixed(1)} s (${sw.extra.toFixed(1)} s longer), ${sw.feature} of ${Math.abs(sw.depth)} m`
      : settings.trackSwitch
        ? "no room for the switch on this layout"
        : "no switch",
    tunnelLine(),
    `top speed ${Math.round(track.topSpeed * 3.6)} km/h, strongest push ${track.peakGs} g`,
    left.length ? `left out: ${left.join(", ")}` : "everything asked for fits",
    `made in ${buildMs} ms`,
  ];
  if (live) lines.unshift(live);
  readout.style.display = settings.readout ? "" : "none";
  readout.innerHTML = `<b>${fps ? `${fps} fps` : "Coaster Carnival"}</b>${lines.map((l) => `<small>${l}</small>`).join("")}`;
}

/** The readout's line about the tunnel. */
function tunnelLine() {
  if (!settings.tunnel) return "no tunnel";
  const t = coaster.ride?.tunnel;
  if (!t) return "no room for a tunnel on this layout";
  const where = { snug: "low and level", roomy: "a roomier spot", home: "the run back in" }[t.pass];
  return `tunnel ${t.length} m long at ${track.time[t.from].toFixed(1)} s (${where})`;
}

// Frames per second and what the cart is doing, while riding.
let fps = 0;
let frames = 0;
let since = performance.now();
function tick(now) {
  frames++;
  if (now - since >= 1000) {
    fps = Math.round((frames * 1000) / (now - since));
    frames = 0;
    since = now;
  }
  const ride = coaster.ride;
  if (ride?.state === "riding") {
    const n = ride.now();
    if (n) showInfo(`${n.kind}${n.tunnel ? " (in the tunnel)" : ""}, ${Math.round(n.speed * 3.6)} km/h, ${n.seconds.toFixed(1)} s`);
  } else if (fps) {
    fps = 0;
    showInfo();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- the rider ----------

function loadRider(url) {
  const image = new Image();
  image.onload = () => coaster.setRider(image);
  image.onerror = () => {
    coaster.setRider(null);
    console.warn(`No rider picture at ${url} (the default sprite file hasn't been saved yet).`);
  };
  image.src = url;
}
loadRider(DEFAULT_SPRITE);
const spriteFile = document.getElementById("sprite-file");
spriteFile.addEventListener("change", () => {
  const file = spriteFile.files[0];
  if (file) loadRider(URL.createObjectURL(file));
});

// ---------- live sync between devices ----------

const hot = import.meta.hot;
const deviceId = Math.random().toString(36).slice(2);
const SHARED = ["drops", "loops", "corkscrews", "intensity", "seed", "trackSwitch", "tunnel", "trackStyle", "steelColors", "woodColors", "cartColors", "theme", "camBack", "camUp", "camFov"];
let syncReady = false;
let applyingRemote = false;
function sendSync() {
  if (!hot || !settings.liveSync || !syncReady || applyingRemote) return;
  hot.send("lab:update", { lab: "coaster-carnival", from: deviceId, ride: Object.fromEntries(SHARED.map((k) => [k, settings[k]])) });
}
if (hot) {
  hot.on("lab:update", (data) => {
    if (!settings.liveSync || !data || data.lab !== "coaster-carnival" || data.from === deviceId) return;
    applyingRemote = true;
    for (const k of SHARED) if (k in (data.ride || {})) settings[k] = data.ride[k];
    coaster.setTheme(settings.theme);
    coaster.setStyle(settings.trackStyle);
    coaster.setTunnel(settings.tunnel);
    applyColors();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    applyingRemote = false;
    save();
    applyCamera();
    rebuild();
  });
  setTimeout(() => {
    if (settings.liveSync) hot.send("lab:hello", { from: deviceId });
    syncReady = true;
  }, 300);
}

function changed(rebuildTrack = true) {
  save();
  sendSync();
  if (rebuildTrack) rebuild();
}

// ---------- controls ----------

const gui = new GUI({ title: "Ride lab" });
// The panel sits at the bottom right, clear of the ride's gear (top right) and chips (top left).
Object.assign(gui.domElement.style, { top: "auto", bottom: "0", maxHeight: "70vh", overflowY: "auto" });
const fTrack = gui.addFolder("Track");
fTrack.add(settings, "drops", RANGES.drops.min, RANGES.drops.max, 1).name("Drops").onFinishChange(() => changed());
fTrack.add(settings, "loops", RANGES.loops.min, RANGES.loops.max, 1).name("Loops").onFinishChange(() => changed());
fTrack.add(settings, "corkscrews", RANGES.corkscrews.min, RANGES.corkscrews.max, 1).name("Corkscrews").onFinishChange(() => changed());
fTrack.add(settings, "intensity", RANGES.intensity.min, RANGES.intensity.max, 1).name("Intensity").onFinishChange(() => changed());
fTrack.add(settings, "seed").name("Layout number").onFinishChange(() => changed());
fTrack.add(settings, "trackSwitch").name("Track switch").onChange(() => changed());
fTrack.add(settings, "tunnel").name("Add a tunnel").onChange(() => {
  coaster.setTunnel(settings.tunnel);
  showInfo();
  changed(false);
});
fTrack.add(settings, "trackStyle", { Steel: "steel", Wood: "wood" }).name("Track style").onChange(() => {
  coaster.setStyle(settings.trackStyle);
  applyColors();
  changed(false);
});
// Colors: the creator's ready-made schemes (the list shown follows the track style).
const options = (list) => Object.fromEntries(list.map((c) => [c.label, c.id]));
const steelPick = fTrack.add(settings, "steelColors", options(STEEL_SCHEMES)).name("Steel colors").onChange(() => {
  applyColors();
  changed(false);
});
const woodPick = fTrack.add(settings, "woodColors", options(WOOD_FINISHES)).name("Wood finish").onChange(() => {
  applyColors();
  changed(false);
});
fTrack.add(settings, "cartColors", options(CART_COLORS)).name("Cart color").onChange(() => {
  applyColors();
  changed(false);
});
function applyColors() {
  coaster.setColors({ steel: settings.steelColors, wood: settings.woodColors, cart: settings.cartColors });
  steelPick?.show(settings.trackStyle !== "wood");
  woodPick?.show(settings.trackStyle === "wood");
}
fTrack.add({ next: () => { settings.seed = randomSeed(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); changed(); } }, "next").name("New layout");

const fLook = gui.addFolder("Look and view");
fLook.add(settings, "theme", Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [t.label, id]))).name("Theme").onChange(() => coaster.setTheme(settings.theme));
fLook.add(settings, "view", { "Behind the cart": "behind", "Watch from outside": "outside", "From above (reduced motion)": "above" }).name("View").onChange(() => coaster.setView(settings.view));
fLook.add({ go: () => coaster.startRide() }, "go").name("Ride");
fLook.add({ thrill: () => chooseRoute("thrill") }, "thrill").name("Choose Frolic (long)");
fLook.add({ chill: () => chooseRoute("chill") }, "chill").name("Choose Detour (short)");
fLook.add(settings, "route", { "Detour (short)": "chill", "Frolic (long)": "thrill" }).name("Route for the jump").onChange(save);
fLook.add({
  jump: () => {
    const ride = coaster.ride;
    if (!track?.trackSwitch || !ride) return;
    ride.setRoute(settings.route);
    ride.seek(Math.max(0, track.trackSwitch.at - 5));
    ride.setRoute(settings.route);
  },
}, "jump").name("Jump to just before the switch");
fLook.add({
  jump: () => {
    const ride = coaster.ride;
    const t = ride?.tunnel;
    if (!t) return;
    ride.setRoute("chill");
    ride.seek(Math.max(0, track.time[t.from] - 4));
  },
}, "jump").name("Jump to just before the tunnel");
fLook.add({ stop: () => coaster.ride?.stop() }, "stop").name("Back to the station");
fLook.add({ pick: () => spriteFile.click() }, "pick").name("Try another sprite picture…");

gui.add(settings, "readout").name("Show the readout").onChange(() => {
  save();
  showInfo();
});
gui.add(settings, "liveSync").name("Live sync with other devices").onChange(() => {
  save();
  if (settings.liveSync && hot) hot.send("lab:hello", { from: deviceId });
});
const fSound = gui.addFolder("Sound");
fSound.add(settings, "soundOn").name("Sound on").onChange(() => coaster.setSound(settings.soundOn));
fSound.add(settings, "volume", 0, 1, 0.05).name("Volume").onChange(() => {
  sound.setVolume(settings.volume);
  save();
});
// Mix: each layer as a share of normal (0 off, 1 normal, 2 double). Tune by ear, then "Show settings to copy".
const mixNames = { roar: "Wheel roar", clicks: "Track clicks", rumble: "Deep rumble", wind: "Wind", effects: "Effects (clack, whoosh, thump, brakes)", drone: "Spooky drone" };
for (const [key, label] of Object.entries(mixNames)) {
  fSound.add(settings.mix, key, 0, 2, 0.05).name(label).onChange(() => {
    sound.setMix(settings.mix);
    save();
  });
}
// The wheel roar's character.
const toneChanged = () => {
  sound.setTone(settings.tone);
  save();
};
fSound.add(settings.tone, "pitch", 0.5, 2, 0.05).name("Roar pitch").onChange(toneChanged);
fSound.add(settings.tone, "brightness", 0.5, 2, 0.05).name("Roar brightness").onChange(toneChanged);
fSound.add(settings.tone, "rise", 0, 2, 0.05).name("Pitch rise with speed").onChange(toneChanged);
fSound.add({ reset: () => {
  Object.assign(settings.mix, DEFAULT_MIX);
  Object.assign(settings.tone, DEFAULT_TONE);
  settings.volume = DEFAULT_VOLUME;
  sound.setVolume(settings.volume);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  sound.setMix(settings.mix);
  sound.setTone(settings.tone);
  save();
} }, "reset").name("Back to the starting sound");

const fCam = gui.addFolder("Behind-the-cart camera");
fCam.add(settings, "camBack", 2, 14, 0.25).name("Distance behind (m)").onChange(cameraChanged);
fCam.add(settings, "camUp", 0.5, 5, 0.1).name("Height above (m)").onChange(cameraChanged);
fCam.add(settings, "camFov", 35, 100, 1).name("View width (degrees)").onChange(cameraChanged);
fCam.add({ reset: () => {
  settings.camBack = BEHIND.back;
  settings.camUp = BEHIND.up;
  settings.camFov = BEHIND.fov;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  cameraChanged();
} }, "reset").name("Back to the starting camera");
function cameraChanged() {
  applyCamera();
  changed(false);
}

const box = document.getElementById("settings-box");
const text = document.getElementById("settings-text");
gui.add({ show: () => {
  text.value = JSON.stringify({ settings, duration: track?.duration, leftOut: track?.leftOut, fingerprint: track?.fingerprint }, null, 2);
  box.style.display = "block";
  text.focus();
  text.select();
} }, "show").name("Show settings to copy");
document.getElementById("settings-close").onclick = () => (box.style.display = "none");

function applyCamera() {
  coaster.setBehind({ back: settings.camBack, up: settings.camUp, fov: settings.camFov });
}

if (window.innerWidth < 700) gui.close();

applyCamera();
applyColors();
rebuild();

// For checking from the browser console (development only).
window.lab = { coaster, get ride() { return coaster.ride; }, sound, settings, get track() { return track; } };
