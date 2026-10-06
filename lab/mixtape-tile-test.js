import runtime from "virtual:mixtape-runtime";
import { buildTile } from "../src/core/build.js";
import { toMemoryTile, LOAD_DOMAIN } from "../src/core/loader-tile.js";
import { formatSize } from "../src/core/fileset.js";
import { TRANSITIONS, formatDuration } from "../src/core/contract.js";
import { createEncoderPool } from "../src/core/audio/pool.js";
import { convertSong, makeSilence } from "../src/core/audio/convert.js";
import { makeMixtapeTile } from "../src/tile-types/mixtape/tile.js";
import { shapesFor, fadesOf, DEFAULT_TRANSITION } from "../src/tile-types/mixtape/transitions.js";
import { mountPreview } from "../src/tile-types/mixtape/preview.js";
import { TAPE_PATH } from "../src/tile-types/mixtape/tape.js";

// Mixtape tile test (development only, never part of the live site).
// Run `npm run dev`, then open /lab/mixtape-tile-test.html on the computer
// (127.0.0.1). It converts MP3 files from this computer with the transitions
// baked in, builds a real Mixtape tile, and plays it through the real tile
// loader and as the Foundry's preview. The Foundry's own Mixtape panel (with
// the plyr.fm song picker) comes in stage 4; until then this stands in for it.

const HEIGHT = 400;
const SIDES = ["A", "B"];
const LABELS = { straight: "Straight on", pause: "Short pause", fade: "Fade and pause" };

const $ = (id) => document.getElementById(id);
const status = $("status");
const goBtn = $("go");
let songs = []; // { id, file, title, transition }
let pool = null;
const conversions = new Map(); // "id|fadeIn|fadeOut" -> Promise<{ bytes, seconds }>
let preview = null;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "error" : "";
}

$("files").addEventListener("change", (e) => {
  const files = [...e.target.files];
  songs = files.map((file, i) => ({ id: `s${Date.now()}-${i}`, file, title: file.name.replace(/\.mp3$/i, ""), transition: DEFAULT_TRANSITION }));
  conversions.clear();
  const half = Math.ceil(songs.length / 2) + 1;
  $("sideB").innerHTML = songs.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("") + `<option value="${songs.length + 1}">(no side B)</option>`;
  $("sideB").value = String(Math.min(half, songs.length + 1));
  renderSongs();
  goBtn.disabled = !songs.length;
});
$("sideB").addEventListener("change", renderSongs);

function sideOf(i) {
  return i + 1 >= Number($("sideB").value) ? "B" : "A";
}

function renderSongs() {
  const table = $("songs");
  table.replaceChildren();
  const head = table.insertRow();
  head.innerHTML = "<th>#</th><th>Side</th><th>Title</th><th>Size</th><th>Then</th>";
  songs.forEach((s, i) => {
    const row = table.insertRow();
    row.insertCell().textContent = String(i + 1);
    row.insertCell().textContent = sideOf(i);
    row.insertCell().textContent = s.title;
    row.insertCell().textContent = formatSize(s.file.size);
    const cell = row.insertCell();
    const lastOnSide = i === songs.length - 1 || sideOf(i + 1) !== sideOf(i);
    if (lastOnSide) {
      cell.textContent = "(end of side)";
      return;
    }
    const select = document.createElement("select");
    select.innerHTML = TRANSITIONS.map((t) => `<option value="${t}">${LABELS[t]}</option>`).join("");
    select.value = s.transition;
    select.addEventListener("change", () => (s.transition = select.value));
    cell.append(select);
  });
}

function convert(song, fades, onProgress) {
  const key = `${song.id}|${fades.fadeIn}|${fades.fadeOut}`;
  if (!conversions.has(key)) {
    const p = (async () => {
      const bytes = new Uint8Array(await song.file.arrayBuffer());
      const r = await convertSong(bytes, { pool, ...fades, onProgress });
      return { bytes: r.bytes, seconds: r.seconds };
    })();
    p.catch(() => conversions.delete(key));
    conversions.set(key, p);
  }
  return conversions.get(key);
}

// A stand-in for the Mixtape tile type (stage 4 makes the real one): just
// enough for the Foundry's own build step, which checks the page, adds the
// recipe and measures the size, exactly as for a real tile.
function standInType(parts) {
  return {
    id: "mixtape",
    version: 1,
    title: "Mixtape",
    inputs: [],
    maxBytes: 50 * 1024 * 1024,
    build: () => makeMixtapeTile({ ...parts, runtime, recipe: { from: "tile test" } }),
  };
}

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

async function go() {
  if (!window.isSecureContext) {
    say("Use this page on the computer at http://127.0.0.1:5173/lab/mixtape-tile-test.html (building needs a secure address).", true);
    return;
  }
  goBtn.disabled = true;
  try {
    if (!pool) pool = createEncoderPool();
    const tracks = songs.map((s, i) => ({ id: s.id, title: s.title, side: sideOf(i), transition: s.transition, status: "ready" }));
    const shapes = shapesFor(tracks, SIDES);
    const progress = new Map();
    const show = () => say(`Converting: ${[...progress.values()].join(" · ")}`);
    const started = performance.now();
    const results = await Promise.all(
      songs.map((s, i) => {
        const fades = fadesOf(shapes.get(s.id));
        progress.set(s.id, `${i + 1} waiting`);
        return convert(s, fades, (stage, pct) => {
          progress.set(s.id, `${i + 1} ${stage} ${pct}%`);
          show();
        }).then((r) => {
          progress.set(s.id, `${i + 1} done`);
          show();
          tracks[i].bytes = r.bytes;
          tracks[i].seconds = r.seconds;
          tracks[i].fades = fades;
          return r;
        });
      })
    );
    const convertMs = performance.now() - started;
    const silence = await makeSilence(10, { pool });

    say("Building the tile…");
    const t0 = performance.now();
    const result = await buildTile(standInType({
      name: $("title").value,
      description: "A tile test tape",
      tape: { label: { text: $("label").value }, dedication: $("dedication").value, notes: "Made in the mixtape tile test.\nSongs from this computer." },
      sides: SIDES,
      tracks,
      silence,
    }), {});
    const buildMs = performance.now() - t0;
    showFacts(result, convertMs, buildMs, results.length);

    if (preview) preview.dispose();
    preview = mountPreview($("preview"), { result });

    say("Loading through the real tile loader…");
    const { mothership, memory } = await getLoader();
    const id = `mixtape-test-${++counter}`;
    memory.addTile(id, toMemoryTile(result));
    const tile = await mothership.loadTile(`memory://${id}`);
    if (!tile) throw new Error("The loader returned nothing for this tile.");
    const frame = await tile.renderContent(HEIGHT);
    frame.setAttribute("title", result.name);
    $("stage").replaceChildren(frame);
    say(`Loaded through ${LOAD_DOMAIN}. Press play in either one (pause one before playing the other).`);
  } catch (err) {
    console.error("[mixtape tile test]", err);
    say(`Something went wrong: ${err && err.message ? err.message : err}. The browser console (F12) has details.`, true);
  } finally {
    goBtn.disabled = !songs.length;
  }
}

function showFacts(result, convertMs, buildMs, count) {
  const tapeFile = result.files.find((f) => f.path === TAPE_PATH);
  const tape = JSON.parse(new TextDecoder().decode(tapeFile.bytes));
  const durations = new Map(tape.sides.flatMap((s) => s.tracks.map((t) => [t.path, t.duration])));
  const lines = result.files.map((f) => {
    const d = durations.get(f.path);
    return `${f.path.padEnd(16)} ${formatSize(f.bytes.length).padStart(10)}  ${f.contentType.padEnd(18)}${d ? " " + formatDuration(d) : ""}`;
  });
  for (const s of tape.sides) {
    lines.push(`Side ${s.name}: ${formatDuration(s.tracks.reduce((n, t) => n + t.duration, 0))}, ${s.tracks.length} songs`);
  }
  lines.push("", `Total ${formatSize(result.totalBytes)}. ${count} songs converted in ${(convertMs / 1000).toFixed(1)} s (already converted songs are reused); built in ${(buildMs / 1000).toFixed(1)} s.`);
  $("facts").textContent = lines.join("\n");
  $("tape").textContent = new TextDecoder().decode(tapeFile.bytes);
}

goBtn.addEventListener("click", go);
