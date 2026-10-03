import { buildTile } from "../src/core/build.js";
import { toMemoryTile, LOAD_DOMAIN } from "../src/core/loader-tile.js";
import { formatSize } from "../src/core/fileset.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";
import { KITS } from "../src/tile-types/glass-lantern/lantern/kits.js";

// Glass Lantern tile test (development only, never part of the live site).
// Run `npm run tiletest`. It builds a real tile, with the look you last had in
// the look lab (or one of the kits), and runs it through the real tile loader:
// the tile server provides the sandbox, and the tile's files come from memory.

const HEIGHT = 400; // the embed box height on the blog and webtil.es
const LAB_STORE = "glass-lantern-lab-v2";
const SHAPES = ["d4", "d6", "d8", "d10", "d12", "d20", "chestahedron", "gem"];

function labState() {
  try {
    return JSON.parse(localStorage.getItem(LAB_STORE)) || {};
  } catch {
    return {};
  }
}
const lab = labState();

const lookSelect = document.getElementById("look");
const shapeSelect = document.getElementById("shape");
const widthSelect = document.getElementById("width");
const status = document.getElementById("status");
const stage = document.getElementById("stage");

const looks = [];
if (lab.look) looks.push({ value: "lab", label: "From the look lab (last used)" });
for (const k of KITS) looks.push({ value: k.id, label: k.label });
lookSelect.innerHTML = looks.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
shapeSelect.innerHTML = SHAPES.map((s) => `<option value="${s}">${s}</option>`).join("");
shapeSelect.value = (lab.shape && lab.shape.shape) || "d12";

function shapeChoice(id) {
  if (id === "gem") return { group: "gem", id: "gem", seed: (lab.shape && lab.shape.seed) || 20261003, facets: (lab.shape && lab.shape.facets) || 14 };
  if (id === "chestahedron") return { group: "special", id: "chestahedron" };
  return { group: "classic", id };
}

// Building a tile and running the tile loader both need a "secure" address.
// 127.0.0.1 on the computer counts as one; the home Wi-Fi address (http://192.168...)
// used on a phone does not, so explain that instead of failing with a puzzling error.
const INSECURE_NOTE =
  "This page can't build a tile at this address. Phones reach it through the home Wi-Fi address, " +
  "which browsers treat as not secure, and building and loading tiles need a secure address. " +
  "Use the page on the computer, or check the lantern on the phone once it is on webtil.es or the blog.";

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "error" : "";
}

// One shared mothership for the page (two would answer each other's messages).
let loaderPromise = null;
function getLoader() {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      const [{ TileMothership }, { MemoryTileLoader }] = await Promise.all([import("@dasl/tile-loader"), import("@dasl/tile-loader/memory")]);
      const mothership = new TileMothership({ loadDomain: LOAD_DOMAIN });
      mothership.init();
      const memory = new MemoryTileLoader();
      mothership.addLoader(memory);
      return { mothership, memory };
    })().catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

let counter = 0;
let artUrls = [];

async function go() {
  if (!window.isSecureContext) {
    say(INSECURE_NOTE, true);
    return;
  }
  const lookId = lookSelect.value;
  const kit = lookId === "lab" ? (KITS.some((k) => k.id === lab.kit) ? lab.kit : "tiffany") : lookId;
  const inputs = {
    ...glassLantern.defaults(),
    name: `Glass Lantern test (${lookId}, ${shapeSelect.value})`,
    shape: shapeChoice(shapeSelect.value),
    kit,
    look: lookId === "lab" ? lab.look : null,
    slowTurn: lab.motion ? lab.motion.autoRotate !== false : true,
  };
  try {
    say("Building the tile (drawing the card pictures takes a moment)…");
    const started = performance.now();
    const result = await buildTile(glassLantern, inputs);
    const buildMs = performance.now() - started;
    showFacts(result, buildMs);
    showArt(result);

    say("Loading through the real tile loader…");
    const { mothership, memory } = await getLoader();
    const name = `lantern-test-${++counter}`;
    memory.addTile(name, toMemoryTile(result));
    const tile = await mothership.loadTile(`memory://${name}`);
    if (!tile) throw new Error("The loader returned nothing for this tile.");
    const frame = await tile.renderContent(HEIGHT);
    frame.setAttribute("title", result.name);
    stage.style.width = widthSelect.value;
    stage.replaceChildren(frame);
    say(`Loaded through ${LOAD_DOMAIN}. Drag to turn, tap to roll, pinch or wheel to zoom.`);
  } catch (err) {
    console.error("[tile test]", err);
    say(`Something went wrong: ${err && err.message ? err.message : err}. The browser console (F12) has details.`, true);
  }
}

function showFacts(result, buildMs) {
  const lines = result.files.map((f) => `${f.path.padEnd(14)} ${formatSize(f.bytes.length).padStart(10)}  ${f.contentType}`);
  lines.push("", `Total ${formatSize(result.totalBytes)} (the limit is 5 MB). Built in ${(buildMs / 1000).toFixed(1)} s.`);
  lines.push("/lantern.js is the same in every lantern tile, so a repo stores it once.");
  document.getElementById("facts").textContent = lines.join("\n");
}

function showArt(result) {
  artUrls.forEach((u) => URL.revokeObjectURL(u));
  artUrls = [];
  const box = document.getElementById("art");
  box.replaceChildren();
  for (const [path, label, width] of [["/icon.png", "Icon (256, shown at 48 on the card)", 128], ["/banner.png", "Banner (1280 x 720)", 480]]) {
    const file = result.files.find((f) => f.path === path);
    if (!file) continue;
    const url = URL.createObjectURL(new Blob([file.bytes], { type: "image/png" }));
    artUrls.push(url);
    const fig = document.createElement("figure");
    fig.innerHTML = `<img alt="" width="${width}" src="${url}"><figcaption>${label}</figcaption>`;
    box.append(fig);
  }
}

widthSelect.addEventListener("change", () => (stage.style.width = widthSelect.value));
document.getElementById("go").addEventListener("click", go);
if (!window.isSecureContext) say(INSECURE_NOTE, true);
