import GUI from "lil-gui";
import { generateTrack, RANGES, randomSeed } from "../src/tile-types/coaster-carnival/track/index.js";
import { createCoasterScene, BEHIND } from "../src/tile-types/coaster-carnival/ride/scene.js";
import { THEMES, DEFAULT_THEME } from "../src/tile-types/coaster-carnival/ride/themes.js";
import { createRideSound, DEFAULT_MIX, DEFAULT_TONE, DEFAULT_VOLUME } from "../src/tile-types/coaster-carnival/ride/sound.js";

// Coaster Carnival ride lab (development only; never part of the site).
//   npm run lab   then open  /lab/coaster-carnival.html  (on the phone too)
// Change the track and theme, ride it, try the three views. With "Live sync"
// on, every device with the lab open shows the same track (see labSync in
// vite.config.js; this lab tags its messages so the lantern lab ignores them).

const DEFAULT_SPRITE = "/coaster-carnival/default-sprite.png";
const STORE = "coaster-carnival-lab";

const canvas = document.getElementById("ride");
const readout = document.getElementById("readout");
const prompt = document.getElementById("prompt");

const settings = {
  drops: RANGES.drops.default,
  loops: RANGES.loops.default,
  corkscrews: RANGES.corkscrews.default,
  intensity: RANGES.intensity.default,
  seed: 1,
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
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || "{}"));
} catch {
  // Storage blocked: start from the defaults.
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    // Not saved; the lab still works.
  }
}

const sound = createRideSound();
sound.setMuted(!settings.soundOn);
sound.setVolume(settings.volume);
sound.setTheme(settings.theme);
settings.mix = { ...DEFAULT_MIX, ...(settings.mix || {}) };
sound.setMix(settings.mix);
settings.tone = { ...DEFAULT_TONE, ...(settings.tone || {}) };
sound.setTone(settings.tone);

const ride = createCoasterScene(canvas, {
  onState: (state) => {
    prompt.textContent = state === "done" ? "Tap to ride again" : "Tap to ride";
    prompt.style.display = state === "riding" ? "none" : "block";
    if (state !== "riding") sound.stop();
  },
});

/** Starts a ride with sound. Only call from a click or tap: browsers block sound otherwise. */
function startRide() {
  sound.start();
  ride.start();
}

// ---------- the track ----------

let track = null;
let buildTimer = null;
function rebuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    const started = performance.now();
    const input = { drops: settings.drops, loops: settings.loops, corkscrews: settings.corkscrews, intensity: settings.intensity, seed: settings.seed };
    try {
      track = generateTrack(input);
    } catch (e) {
      readout.innerHTML = `<b>Could not make that track</b><small>${e.message}</small>`;
      return;
    }
    buildMs = Math.round(performance.now() - started);
    ride.setTrack(track);
    ride.setTheme(settings.theme);
    ride.setView(settings.view);
    showInfo();
  }, 150);
}
let buildMs = 0;

function showInfo(live) {
  if (!track) return;
  const left = Object.entries(track.leftOut).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "") : k}`);
  const lines = [
    `${track.duration.toFixed(1)} s ride, ${Math.round(track.length)} m of track, up to ${Math.round(track.bounds.max[1])} m tall`,
    `top speed ${Math.round(track.topSpeed * 3.6)} km/h, strongest push ${track.peakGs} g`,
    left.length ? `left out: ${left.join(", ")}` : "everything asked for fits",
    `made in ${buildMs} ms`,
  ];
  if (live) lines.unshift(live);
  readout.innerHTML = `<b>${fps ? `${fps} fps` : "Coaster Carnival"}</b>${lines.map((l) => `<small>${l}</small>`).join("")}`;
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
  if (ride.state === "riding") {
    const n = ride.now();
    if (n) {
      sound.update(n);
      showInfo(`${n.kind}, ${Math.round(n.speed * 3.6)} km/h, ${n.seconds.toFixed(1)} s`);
    }
  } else if (fps) {
    fps = 0;
    showInfo();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

canvas.addEventListener("click", () => {
  if (ride.state !== "riding") startRide();
});

// ---------- the rider ----------

function loadRider(url) {
  const image = new Image();
  image.onload = () => ride.setRider(image);
  image.onerror = () => {
    ride.setRider(null);
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
const SHARED = ["drops", "loops", "corkscrews", "intensity", "seed", "theme", "camBack", "camUp", "camFov"];
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
    sound.setTheme(settings.theme);
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
const fTrack = gui.addFolder("Track");
fTrack.add(settings, "drops", RANGES.drops.min, RANGES.drops.max, 1).name("Drops").onFinishChange(() => changed());
fTrack.add(settings, "loops", RANGES.loops.min, RANGES.loops.max, 1).name("Loops").onFinishChange(() => changed());
fTrack.add(settings, "corkscrews", RANGES.corkscrews.min, RANGES.corkscrews.max, 1).name("Corkscrews").onFinishChange(() => changed());
fTrack.add(settings, "intensity", RANGES.intensity.min, RANGES.intensity.max, 1).name("Intensity").onFinishChange(() => changed());
fTrack.add(settings, "seed").name("Layout number").onFinishChange(() => changed());
fTrack.add({ next: () => { settings.seed = randomSeed(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); changed(); } }, "next").name("New layout");

const fLook = gui.addFolder("Look and view");
fLook.add(settings, "theme", Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [t.label, id]))).name("Theme").onChange(() => {
  ride.setTheme(settings.theme);
  sound.setTheme(settings.theme);
  changed(false);
});
fLook.add(settings, "view", { "Behind the cart": "behind", "Watch from outside": "outside", "Side view (reduced motion)": "side" }).name("View").onChange(() => {
  ride.setView(settings.view);
  save();
});
fLook.add({ go: () => startRide() }, "go").name("Ride");
fLook.add({ stop: () => ride.stop() }, "stop").name("Back to the station");
fLook.add({ pick: () => spriteFile.click() }, "pick").name("Try another sprite picture…");

gui.add(settings, "liveSync").name("Live sync with other devices").onChange(() => {
  save();
  if (settings.liveSync && hot) hot.send("lab:hello", { from: deviceId });
});
const fSound = gui.addFolder("Sound");
fSound.add(settings, "soundOn").name("Sound on").onChange(() => {
  sound.setMuted(!settings.soundOn);
  save();
});
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
  ride.setBehind({ back: settings.camBack, up: settings.camUp, fov: settings.camFov });
}

if (window.innerWidth < 700) gui.close();

applyCamera();
rebuild();

// For checking from the browser console (development only).
window.lab = { ride, sound, settings, get track() { return track; } };
