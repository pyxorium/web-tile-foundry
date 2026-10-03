import GUI from "lil-gui";
import { getShape, GEM_FACETS, randomSeed } from "../src/tile-types/glass-lantern/geometry/index.js";
import { createLantern } from "../src/tile-types/glass-lantern/lantern/scene.js";
import { createInteraction } from "../src/tile-types/glass-lantern/lantern/interaction.js";
import { createGearMenu } from "../src/tile-types/glass-lantern/lantern/gear.js";
import { DEFAULT_SETTINGS, METALS, PIXEL_RATIOS, GLASS_RESOLUTIONS } from "../src/tile-types/glass-lantern/lantern/settings.js";
import { createQualityGovernor, overridesFor, SAFE_SETTINGS, stepIsUseful } from "../src/tile-types/glass-lantern/lantern/quality.js";
import { KITS, kitLook, DEVICE_KEYS } from "../src/tile-types/glass-lantern/lantern/kits.js";
import { BACKGROUNDS } from "../src/tile-types/glass-lantern/lantern/background.js";

// Glass Lantern look lab (development only, never part of the live site).
// Run `npm run lab`: it opens this page on the computer, and prints a
// "Network" address. On a phone on the same Wi-Fi, open that address
// followed by /lab/glass-lantern.html.

const STORE = "glass-lantern-lab-v2"; // v2: real glass became the default, so old saved settings were set aside
const SHAPES = ["d4", "d6", "d8", "d10", "d12", "d20", "chestahedron", "gem"];

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}
function save(state) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* private window or blocked storage: the lab still works, it just forgets */
  }
}

const saved = loadSaved();
const look = { ...DEFAULT_SETTINGS, ...(saved.look || {}) };
look.palette = [...(look.palette || DEFAULT_SETTINGS.palette)];
// The old "Real glass" on/off switch became the Glass method choice.
if (look.realGlass === false && !(saved.look || {}).glassMethod) look.glassMethod = "backup";
look.realGlass = true;
const shapeChoice = { shape: "d12", seed: 20261003, facets: GEM_FACETS.default, ...(saved.shape || {}) };
const motion = { autoRotate: true, speed: 0.25, autoQuality: true, liveSync: true, ...(saved.motion || {}) };
const kitChoice = { kit: saved.kit || "custom" };

// Safe mode: ?safe in the address, or after the graphics crashed (the page
// reloads itself with ?safe=crashed). Starts with the lightest settings.
const params = new URLSearchParams(location.search);
const safeMode = params.has("safe");
const crashed = params.get("safe") === "crashed";

let gui = null;
let interaction = null; // set once the controls exist (see "viewer interaction" below)
const canvas = document.getElementById("lantern");
const lantern = createLantern(canvas, look);
if (safeMode) lantern.setOverrides(SAFE_SETTINGS);

// If the browser gives up on the graphics (Chrome shows a sad face), reload in safe mode.
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  if (!crashed) location.replace(`${location.pathname}?safe=crashed`);
});

// ---------- automatic quality ----------
let governor = null;
function startQuality() {
  if (safeMode || !motion.autoQuality) {
    governor = null;
    if (!safeMode) lantern.setOverrides({});
    return;
  }
  lantern.setOverrides({});
  // Steps that would change nothing (for example "half resolution" when the
  // glass is already clear) are skipped instead of measured.
  governor = createQualityGovernor({ isUseful: (step, before) => stepIsUseful(step, { ...lantern.settings, ...before }) });
}

function choiceFor(c) {
  if (c.shape === "gem") return { group: "gem", id: "gem", seed: c.seed, facets: c.facets };
  if (c.shape === "chestahedron") return { group: "special", id: "chestahedron" };
  return { group: "classic", id: c.shape };
}
function applyShape() {
  lantern.setShape(getShape(choiceFor(shapeChoice)));
  if (interaction) interaction.shapeChanged();
  persist();
}
function applyLook() {
  lantern.update({ ...look, palette: [...look.palette] });
  // A few settings appear in two folders; keep both copies showing the same value.
  if (gui) gui.controllersRecursive().forEach((c) => c.updateDisplay());
  persist();
}
function persist() {
  save({ look, shape: shapeChoice, motion, kit: kitChoice.kit });
  sendSync();
}

// ---------- live sync between devices (see labSync in vite.config.js) ----------
// The look, kit and shape travel; each device keeps its own speed settings
// (DEVICE_KEYS: real glass, sharpness, auto quality and so on).
const hot = import.meta.hot; // only there while running under Vite (npm run lab)
const deviceId = Math.random().toString(36).slice(2);
let applyingRemote = false;
let sendTimer = null;
// Nothing is sent while the lab is starting up: a device that opens or
// reloads must never broadcast its own (possibly old) saved look over the
// others. It asks for the latest look instead (lab:hello) and takes that.
// Only changes made by hand on this device are sent.
let syncReady = false;
function sendSync() {
  if (!hot || !motion.liveSync || applyingRemote || !syncReady) return;
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    const shared = { ...look, palette: [...look.palette] };
    for (const k of DEVICE_KEYS) delete shared[k];
    hot.send("lab:update", { from: deviceId, kit: kitChoice.kit, shape: { ...shapeChoice }, look: shared });
  }, 120);
}
function receiveSync(data) {
  if (!motion.liveSync || !data || data.from === deviceId) return;
  applyingRemote = true;
  try {
    const { palette, ...rest } = data.look || {};
    for (const [k, v] of Object.entries(rest)) if (!DEVICE_KEYS.includes(k) && k in look) look[k] = v;
    if (Array.isArray(palette)) look.palette.splice(0, look.palette.length, ...palette);
    if (data.kit) kitChoice.kit = data.kit;
    const shapeChanged = JSON.stringify(data.shape) !== JSON.stringify(shapeChoice);
    if (data.shape && shapeChanged) {
      Object.assign(shapeChoice, data.shape);
      gemOnly(shapeChoice.shape === "gem");
      applyShape();
    }
    applyLook();
  } finally {
    applyingRemote = false;
  }
}
if (hot) {
  hot.on("lab:update", receiveSync);
  // Catch up with what the other devices last sent.
  setTimeout(() => motion.liveSync && hot.send("lab:hello", { from: deviceId }), 300);
}

// ---------- controls ----------
gui = new GUI({ title: "Look lab" });
// Kit: loads a whole look in one go (glass, metal, lamp, background). Adjust
// from there; "Show settings to copy" sends the tuned kit back to Claude.
const kitOptions = { "Your own settings": "custom", ...Object.fromEntries(KITS.map((k) => [k.tuned ? k.label : `${k.label} (draft)`, k.id])) };
function loadKit(id) {
  if (id !== "custom") {
    const next = kitLook(id);
    const palette = look.palette; // the colour controls hold this array, so refill it in place
    Object.assign(look, next, { palette });
    palette.splice(0, palette.length, ...next.palette);
  }
  applyLook();
}
gui.add(kitChoice, "kit", kitOptions).name("Kit").onChange(loadKit);
// Picking the kit that is already selected does nothing, so this always reloads its locked settings.
gui.add({ reloadKit: () => loadKit(kitChoice.kit) }, "reloadKit").name("Reload kit");
const fShape = gui.addFolder("Shape");
fShape.add(shapeChoice, "shape", SHAPES).name("Shape").onChange(() => {
  gemOnly(shapeChoice.shape === "gem");
  applyShape();
});
const cFacets = fShape.add(shapeChoice, "facets", GEM_FACETS.min, GEM_FACETS.max, 1).name("Gem facets").onFinishChange(applyShape);
const cSeed = fShape.add(shapeChoice, "seed").name("Gem seed").disable();
const cNewGem = fShape.add({ newGem: () => { shapeChoice.seed = randomSeed(); cSeed.updateDisplay(); applyShape(); } }, "newGem").name("New gem shape");
function gemOnly(on) {
  for (const c of [cFacets, cSeed, cNewGem]) c.show(on);
}
gemOnly(shapeChoice.shape === "gem");

const fGlass = gui.addFolder("Glass colours and texture");
look.palette.forEach((_, i) => fGlass.addColor(look.palette, i).name(`Colour ${i + 1}`).onChange(applyLook));
fGlass.add(look, "ripple", 0, 1, 0.01).name("Ripple").onChange(applyLook);
fGlass.add(look, "rippleScale", 2, 30, 0.5).name("Ripple size (small ↔ big)").onChange(applyLook);
fGlass.add(look, "opal", 0, 1, 0.01).name("Opalescent").onChange(applyLook);
fGlass.add(look, "opalScale", 0.5, 10, 0.1).name("Opal swirl size").onChange(applyLook);
fGlass.add(look, "opalGlow", 0, 2, 0.01).name("Opal glow").onChange(applyLook);

const fReal = gui.addFolder("Real glass");
fReal.add(look, "glassMethod", Object.fromEntries([["Auto (clear when nothing bends)", "auto"], ["Real (bends light)", "real"], ["Clear (cheaper)", "clear"], ["Backup (cheapest)", "backup"]])).name("Glass method").onChange(applyLook);
fReal.add(look, "thickness", 0, 0.6, 0.01).name("Thickness").onChange(applyLook);
fReal.add(look, "ior", 1, 2.4, 0.01).name("Bending").onChange(applyLook);
fReal.add(look, "frost", 0, 0.6, 0.01).name("Frost").onChange(applyLook);
fReal.add(look, "dispersion", 0, 1, 0.01).name("Rainbow edges").onChange(applyLook);
fReal.add(look, "farSide").name("Glass on the far side").onChange(applyLook);

const fLamp = gui.addFolder("Lamp");
fLamp.add(look, "lampBrightness", 0, 6, 0.05).name("Brightness").onChange(applyLook);
fLamp.add(look, "lampSize", 0.1, 1.2, 0.01).name("Glow size").onChange(applyLook);
fLamp.add(look, "lampWarmth", 1500, 6500, 50).name("Warmth (K)").onChange(applyLook);
fLamp.add(look, "showBulb").name("Show the round bulb").onChange(applyLook);

const fBackup = gui.addFolder("Backup glass (slower phones)");
fBackup.add(look, "glow", 0, 4, 0.05).name("Glow from inside").onChange(applyLook);
fBackup.add(look, "surface", 0, 1, 0.01).name("Colour in outside light").onChange(applyLook);
fBackup.add(look, "glassRoughness", 0, 0.6, 0.01).name("Glass roughness").onChange(applyLook);

const fPanes = gui.addFolder("Panes");
fPanes.add(look, "bezelWidth", 0, 0.1, 0.002).name("Bevel width").onChange(applyLook);
fPanes.add(look, "bezelDepth", 0, 0.1, 0.002).name("Pane set in by").onChange(applyLook);

const fCame = gui.addFolder("Came (metal)");
fCame.add(look, "metal", Object.keys(METALS)).name("Metal").onChange(applyLook);
fCame.add(look, "cameWidth", 0.01, 0.1, 0.001).name("Width").onChange(applyLook);
fCame.add(look, "cameFlatten", 0.2, 1, 0.01).name("Round ↔ flat").onChange(applyLook);
fCame.add(look, "metalRoughness", 0, 1, 0.01).name("Roughness").onChange(applyLook);
fCame.add(look, "rivets").name("Rivets").onChange(applyLook);

const fLight = gui.addFolder("Outside light");
fLight.add(look, "keyLight", 0, 3, 0.05).name("Outside light").onChange(applyLook);
fLight.add(look, "envIntensity", 0, 3, 0.05).name("Reflection strength").onChange(applyLook);

const fBg = gui.addFolder("Background");
fBg.add(look, "background", Object.fromEntries(BACKGROUNDS.map((b) => [b.label, b.id]))).name("Background").onChange(applyLook);
fBg.addColor(look, "bgTop").name("Main colour").onChange(applyLook);
fBg.addColor(look, "bgBottom").name("Dark colour").onChange(applyLook);
fBg.addColor(look, "bgAccent").name("Accent colour").onChange(applyLook);
fBg.add(look, "bgScale", 0.4, 4, 0.01).name("Pattern size (big ↔ small)").onChange(applyLook);
fBg.add(look, "bgContrast", 0, 2, 0.01).name("Contrast").onChange(applyLook);
fBg.add(look, "bgBrightness", 0.2, 2, 0.01).name("Brightness").onChange(applyLook);
fBg.add(look, "bgSoftness", 0, 1, 0.01).name("Softness (sharp ↔ soft)").onChange(applyLook);
fBg.add(look, "bgHalo", 0, 2, 0.01).name("Lamp light on the wall").onChange(applyLook);
fBg.add(look, "bgVignette", 0, 1, 0.01).name("Dark edges").onChange(applyLook);

const fRoll = gui.addFolder("Roll (tap the lantern to try)");
fRoll.add(look, "rollDuration", 0.6, 5, 0.05).name("Duration (s)").onChange(applyLook);
fRoll.add(look, "rollSpins", 0, 5, 1).name("Spins").onChange(applyLook);
fRoll.add(look, "rollWindUp", 0, 1, 0.01).name("Wind-up (s)").onChange(applyLook);
fRoll.add(look, "rollEase", 0.5, 4, 0.05).name("Slowdown (even ↔ early)").onChange(applyLook);
fRoll.add(look, "rollSettle", 0, 15, 0.5).name("Settle (degrees)").onChange(applyLook);
fRoll.add({ roll: () => interaction && interaction.roll() }, "roll").name("Roll now");

const fTable = gui.addFolder("Tabletop");
fTable.add(look, "tabletop").name("Tabletop").onChange(applyLook);
fTable.addColor(look, "tableColor").name("Table colour").onChange(applyLook);
fTable.add(look, "poolStrength", 0, 4, 0.05).name("Coloured light").onChange(applyLook);

const fPerf = gui.addFolder("Phone check (expensive parts)");
fPerf.add(look, "reflections").name("Reflections").onChange(applyLook);
fPerf.add(look, "rippleOn").name("Ripple").onChange(applyLook);
fPerf.add(look, "opalOn").name("Opalescent").onChange(applyLook);
fPerf.add(look, "glassMethod", Object.fromEntries([["Auto (clear when nothing bends)", "auto"], ["Real (bends light)", "real"], ["Clear (cheaper)", "clear"], ["Backup (cheapest)", "backup"]])).name("Glass method").onChange(applyLook);
fPerf.add(look, "farSide").name("Glass on the far side").onChange(applyLook);
fPerf.add(look, "dispersion", 0, 1, 0.01).name("Rainbow edges (0 = off)").onChange(applyLook);
fPerf.add(look, "pixelRatio", PIXEL_RATIOS).name("Sharpness (pixel ratio)").onChange(applyLook);
fPerf.add(look, "glassResolution", GLASS_RESOLUTIONS).name("Real glass resolution").onChange(applyLook);
fPerf.add(motion, "autoQuality").name("Auto quality").onChange(() => { persist(); startQuality(); });
gui.add(motion, "liveSync").name("Live sync with other devices").onChange(() => {
  persist();
  if (motion.liveSync && hot) hot.send("lab:hello", { from: deviceId });
});
fPerf.add({ recheck: () => { motion.autoQuality = true; gui.controllersRecursive().forEach((c) => c.updateDisplay()); persist(); startQuality(); } }, "recheck").name("Check quality again");
if (safeMode) fPerf.add({ leave: () => location.replace(location.pathname) }, "leave").name("Leave safe mode");
fPerf.add(motion, "autoRotate").name("Slow turn").onChange(() => { interaction.setSlowTurn(motion.autoRotate, motion.speed); gear.setSlowTurn(motion.autoRotate); persist(); });
fPerf.add(motion, "speed", 0, 1.5, 0.01).name("Turn speed").onChange(() => { interaction.setSlowTurn(motion.autoRotate, motion.speed); persist(); });
fPerf.add({ roll: () => interaction.roll() }, "roll").name("Roll (same as a tap)");

const box = document.getElementById("settings-box");
const text = document.getElementById("settings-text");
gui.add({ show: () => {
  text.value = JSON.stringify({ kit: kitChoice.kit, shape: shapeChoice, look }, null, 2);
  box.style.display = "block";
  text.focus();
  text.select();
} }, "show").name("Show settings to copy");
gui.add({ reset: () => {
  Object.assign(look, DEFAULT_SETTINGS, { palette: [...DEFAULT_SETTINGS.palette] });
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyLook();
} }, "reset").name("Reset look to defaults");
document.getElementById("settings-close").onclick = () => (box.style.display = "none");

// Small screens: start with the panel closed and the folders folded.
if (window.innerWidth < 700) {
  gui.close();
  gui.folders.forEach((f) => f.close());
} else {
  [fPanes, fBackup, fLight].forEach((f) => f.close());
}

// ---------- viewer interaction (stage 4: the same code the tile will use) ----------
interaction = createInteraction({ canvas, lantern, slowTurn: motion.autoRotate, slowTurnSpeed: motion.speed });
// The gear menu sits bottom right in the lab (the lab's own panel is top right);
// in the tile it will be top right.
const gear = createGearMenu({
  corner: "bottom-right",
  slowTurn: motion.autoRotate && !interaction.reducedMotion,
  onSlowTurn: (on) => {
    motion.autoRotate = on;
    interaction.setSlowTurn(on, motion.speed);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    persist();
  },
  onReset: () => interaction.reset(),
});
// For checking the lab from the browser console (development only).
window.lab = { lantern, interaction };

// ---------- frame loop and frame-rate counter ----------
const stats = document.getElementById("stats");
let frames = 0;
let since = performance.now();
let last = since;
let worst = 0;

function report(now) {
  const secs = (now - since) / 1000;
  const fps = frames / secs;
  const info = lantern.renderer.info.render;
  const w = lantern.renderer.domElement.width;
  const h = lantern.renderer.domElement.height;
  stats.innerHTML = `<b>${fps.toFixed(0)} fps</b><small>slowest frame ${worst.toFixed(0)} ms · ${w}×${h} px<br>${info.triangles.toLocaleString()} triangles · ${info.calls} draws<br>${qualityText()}</small>`;
  frames = 0;
  worst = 0;
  since = now;
}

function qualityText() {
  const lines = [`Glass: ${lantern.glassMethod}${look.glassMethod === "auto" ? " (auto)" : ""}`];
  if (safeMode) lines.push(crashed ? "Safe mode: the graphics crashed, so this is the lightest look" : "Safe mode (lightest look)");
  else if (!motion.autoQuality) lines.push("Auto quality off");
  else if (governor && governor.state !== "done") lines.push("Auto quality: checking…");
  else if (governor && governor.count) lines.push(`Stepped down: ${governor.steps.map((s) => s.label).join(", ")}`);
  else lines.push("Auto quality: full look");
  if (lantern.pixels.capped) lines.push(`Big window: drawing at ${Math.round(lantern.pixels.ratio * 100)}% resolution`);
  return lines.join("<br>");
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  worst = Math.max(worst, now - last);
  last = now;
  interaction.update(dt);
  lantern.render();
  if (governor) {
    const change = governor.frame(performance.now());
    if (change) lantern.setOverrides(overridesFor(change.count));
  }
  frames++;
  if (now - since > 750) report(now);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => lantern.resize());
document.addEventListener("visibilitychange", () => {
  last = since = performance.now();
  frames = 0;
  if (governor && !document.hidden) governor.restart(performance.now());
});
lantern.resize();
applyShape();
startQuality();
syncReady = true; // from here on, changes made on this device are shared
requestAnimationFrame((t) => {
  last = since = t;
  frame(t);
});
