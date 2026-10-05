import runtime from "virtual:coaster-carnival-runtime";
import { buildTile } from "../src/core/build.js";
import { toMemoryTile, LOAD_DOMAIN } from "../src/core/loader-tile.js";
import { formatSize } from "../src/core/fileset.js";
import { generateTrack, RANGES } from "../src/tile-types/coaster-carnival/track/index.js";
import { makeCoasterTile } from "../src/tile-types/coaster-carnival/tile.js";
import { THEMES, DEFAULT_THEME } from "../src/tile-types/coaster-carnival/ride/themes.js";
import { DEFAULT_COLORS } from "../src/tile-types/coaster-carnival/ride/colors.js";

// Coaster Carnival tile test (development only, never part of the live site).
// Run `npm run dev`, then open /lab/coaster-tile-test.html on the computer
// (127.0.0.1). It builds a real tile, with the track and look you last had in
// the ride lab, draws its card pictures, and runs it through the real tile
// loader: the tile server provides the sandbox, and the tile's files come
// from memory. The Foundry's own Coaster Carnival panel comes in stage 6;
// until then this stands in for it.

const HEIGHT = 400; // the embed box height on the blog and webtil.es
const LAB_STORE = "coaster-carnival-lab"; // the ride lab's saved settings
const DEFAULT_SPRITE = "/coaster-carnival/default-sprite.png";

function labState() {
  try {
    return JSON.parse(localStorage.getItem(LAB_STORE)) || {};
  } catch {
    return {};
  }
}

const themeSelect = document.getElementById("theme");
const widthSelect = document.getElementById("width");
const status = document.getElementById("status");
const stage = document.getElementById("stage");

themeSelect.innerHTML = Object.entries(THEMES).map(([id, t]) => `<option value="${id}">${t.label}</option>`).join("");
themeSelect.value = labState().theme in THEMES ? labState().theme : DEFAULT_THEME;

const INSECURE_NOTE =
  "This page can't build a tile at this address. Phones reach it through the home Wi-Fi address, " +
  "which browsers treat as not secure, and building and loading tiles need a secure address. " +
  "Use the page on the computer (http://127.0.0.1:5173/lab/coaster-tile-test.html).";

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "error" : "";
}

// A stand-in for the Coaster Carnival tile type (stage 6 makes the real one):
// just enough for the Foundry's own build step, which checks the page, adds
// the recipe and measures the size, exactly as for a real tile.
function standInType(parts) {
  return {
    id: "coaster-carnival",
    version: 1,
    title: "Coaster Carnival",
    inputs: [],
    async build() {
      const { makeCardArt } = await import("../src/tile-types/coaster-carnival/art.js");
      const art = await makeCardArt(parts);
      return makeCoasterTile({ ...parts, runtime, art, rider: { kind: "default" }, recipe: { from: "tile test" } });
    },
  };
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
  const lab = labState();
  const num = (key) => (Number.isFinite(lab[key]) ? lab[key] : RANGES[key].default);
  try {
    say("Making the track…");
    const track = generateTrack({
      drops: num("drops"),
      loops: num("loops"),
      corkscrews: num("corkscrews"),
      intensity: num("intensity"),
      seed: Number.isFinite(lab.seed) ? lab.seed : 1,
      trackSwitch: lab.trackSwitch !== false,
    });
    const sprite = new Uint8Array(await (await fetch(DEFAULT_SPRITE)).arrayBuffer());
    const choices = {
      theme: themeSelect.value,
      style: lab.trackStyle === "wood" ? "wood" : "steel",
      colors: { steel: lab.steelColors || DEFAULT_COLORS.steel, wood: lab.woodColors || DEFAULT_COLORS.wood, cart: lab.cartColors || DEFAULT_COLORS.cart },
      tunnel: lab.tunnel !== false,
      handle: "thunderbirdwine.bsky.social",
    };
    const name = `Coaster Carnival test (layout ${track.input.seed})`;

    say("Building the tile (drawing the card pictures takes a moment)…");
    const started = performance.now();
    const result = await buildTile(standInType({ name, choices, track, sprite }), {});
    const buildMs = performance.now() - started;
    showFacts(result, buildMs);
    showArt(result);

    say("Loading through the real tile loader…");
    const { mothership, memory } = await getLoader();
    const id = `coaster-test-${++counter}`;
    memory.addTile(id, toMemoryTile(result));
    const tile = await mothership.loadTile(`memory://${id}`);
    if (!tile) throw new Error("The loader returned nothing for this tile.");
    const frame = await tile.renderContent(HEIGHT);
    frame.setAttribute("title", result.name);
    stage.style.width = widthSelect.value;
    stage.replaceChildren(frame);
    say(`Loaded through ${LOAD_DOMAIN}. Tap to ride.`);
  } catch (err) {
    console.error("[tile test]", err);
    say(`Something went wrong: ${err && err.message ? err.message : err}. The browser console (F12) has details.`, true);
  }
}

function showFacts(result, buildMs) {
  const lines = result.files.map((f) => `${f.path.padEnd(14)} ${formatSize(f.bytes.length).padStart(10)}  ${f.contentType}`);
  lines.push("", `Total ${formatSize(result.totalBytes)} (the limit is 5 MB). Built in ${(buildMs / 1000).toFixed(1)} s.`);
  lines.push("/coaster.js is the same in every coaster tile, so a repo stores it once.");
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
