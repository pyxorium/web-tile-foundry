import GUI from "lil-gui";
import { Quaternion, Vector3 } from "three";
import { getShape, GEM_FACETS, randomSeed } from "../src/tile-types/glass-lantern/geometry/index.js";
import { createLantern } from "../src/tile-types/glass-lantern/lantern/scene.js";
import { DEFAULT_SETTINGS, METALS, PIXEL_RATIOS, GLASS_RESOLUTIONS } from "../src/tile-types/glass-lantern/lantern/settings.js";
import { createQualityGovernor, overridesFor, SAFE_SETTINGS } from "../src/tile-types/glass-lantern/lantern/quality.js";
import { KITS, kitLook } from "../src/tile-types/glass-lantern/lantern/kits.js";

// Glass Lantern look lab (development only, never part of the live site).
// Run `npm run lab`: it opens this page on the computer, and prints a
// "Network" address. On a phone on the same Wi-Fi, open that address
// followed by /lab/glass-lantern.html.

const STORE = "glass-lantern-lab-v2"; // v2: real glass became the default, so old saved settings are set aside
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
const shapeChoice = { shape: "d12", seed: 20261003, facets: GEM_FACETS.default, ...(saved.shape || {}) };
const motion = { autoRotate: true, speed: 0.25, autoQuality: true, ...(saved.motion || {}) };
const kitChoice = { kit: saved.kit || "custom" };

// Safe mode: ?safe in the address, or after the graphics crashed (the page
// reloads itself with ?safe=crashed). Starts with the lightest settings.
const params = new URLSearchParams(location.search);
const safeMode = params.has("safe");
const crashed = params.get("safe") === "crashed";

let gui = null;
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
  governor = createQualityGovernor();
}

function choiceFor(c) {
  if (c.shape === "gem") return { group: "gem", id: "gem", seed: c.seed, facets: c.facets };
  if (c.shape === "chestahedron") return { group: "special", id: "chestahedron" };
  return { group: "classic", id: c.shape };
}
function applyShape() {
  lantern.setShape(getShape(choiceFor(shapeChoice)));
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
}

// ---------- controls ----------
gui = new GUI({ title: "Look lab" });
// Kit: loads a whole look in one go (glass, metal, lamp, background). Adjust
// from there; "Show settings to copy" sends the tuned kit back to Claude.
const kitOptions = { "Your own settings": "custom", ...Object.fromEntries(KITS.map((k) => [k.tuned ? k.label : `${k.label} (draft)`, k.id])) };
gui.add(kitChoice, "kit", kitOptions).name("Kit").onChange((id) => {
  if (id !== "custom") {
    const next = kitLook(id);
    const palette = look.palette; // the colour controls hold this array, so refill it in place
    Object.assign(look, next, { palette });
    palette.splice(0, palette.length, ...next.palette);
  }
  applyLook();
});
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
fReal.add(look, "realGlass").name("Real glass (off = backup)").onChange(applyLook);
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

const fBg = gui.addFolder("Background (placeholder)");
fBg.addColor(look, "bgTop").name("Top").onChange(applyLook);
fBg.addColor(look, "bgBottom").name("Bottom").onChange(applyLook);
fBg.add(look, "bgHalo", 0, 2, 0.01).name("Halo").onChange(applyLook);
fBg.add(look, "bgVignette", 0, 1, 0.01).name("Dark edges").onChange(applyLook);

const fPerf = gui.addFolder("Phone check (expensive parts)");
fPerf.add(look, "reflections").name("Reflections").onChange(applyLook);
fPerf.add(look, "rippleOn").name("Ripple").onChange(applyLook);
fPerf.add(look, "opalOn").name("Opalescent").onChange(applyLook);
fPerf.add(look, "realGlass").name("Real glass").onChange(applyLook);
fPerf.add(look, "farSide").name("Glass on the far side").onChange(applyLook);
fPerf.add(look, "dispersion", 0, 1, 0.01).name("Rainbow edges (0 = off)").onChange(applyLook);
fPerf.add(look, "pixelRatio", PIXEL_RATIOS).name("Sharpness (pixel ratio)").onChange(applyLook);
fPerf.add(look, "glassResolution", GLASS_RESOLUTIONS).name("Real glass resolution").onChange(applyLook);
fPerf.add(motion, "autoQuality").name("Auto quality").onChange(() => { persist(); startQuality(); });
fPerf.add({ recheck: () => { motion.autoQuality = true; gui.controllersRecursive().forEach((c) => c.updateDisplay()); persist(); startQuality(); } }, "recheck").name("Check quality again");
if (safeMode) fPerf.add({ leave: () => location.replace(location.pathname) }, "leave").name("Leave safe mode");
fPerf.add(motion, "autoRotate").name("Slow turn").onChange(persist);
fPerf.add(motion, "speed", 0, 1.5, 0.01).name("Turn speed").onChange(persist);

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
  [fBg, fPanes, fBackup, fLight].forEach((f) => f.close());
}

// ---------- drag to turn (temporary; the real interaction is stage 4) ----------
let dragging = null;
const turn = new Quaternion();
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
canvas.addEventListener("pointerdown", (e) => {
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  const k = 4 / Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight));
  const dx = (e.clientX - dragging.x) * k;
  const dy = (e.clientY - dragging.y) * k;
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  lantern.group.quaternion.premultiply(turn.setFromAxisAngle(axisY, dx));
  lantern.group.quaternion.premultiply(turn.setFromAxisAngle(axisX, dy));
});
const endDrag = (e) => {
  if (dragging && e.pointerId === dragging.id) dragging = null;
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

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
  const lines = [];
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
  if (motion.autoRotate && !dragging) lantern.group.rotateOnWorldAxis(axisY, dt * motion.speed);
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
requestAnimationFrame((t) => {
  last = since = t;
  frame(t);
});
