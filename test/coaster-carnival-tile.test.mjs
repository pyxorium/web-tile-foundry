// Coaster Carnival stage 5: the tile itself (page, program, files, recipe).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { bundleRuntime, RUNTIME_PATH } from "../src/tile-types/coaster-carnival/runtime/bundle.js";
import { makeCoasterTile } from "../src/tile-types/coaster-carnival/tile.js";
import { cleanChoices, MAKE_URL } from "../src/tile-types/coaster-carnival/runtime/template.js";
import { packTrack, unpackTrack } from "../src/tile-types/coaster-carnival/runtime/track-data.js";
import { generateTrack } from "../src/tile-types/coaster-carnival/track/index.js";
import { findTunnel } from "../src/tile-types/coaster-carnival/ride/tunnel.js";
import { placeProps } from "../src/tile-types/coaster-carnival/ride/placement.js";
import { THEMES } from "../src/tile-types/coaster-carnival/ride/themes.js";
import { DEFAULT_COLORS } from "../src/tile-types/coaster-carnival/ride/colors.js";
import { readCspMeta, TILE_CSP } from "../src/core/policy.js";
import { contentTypeFor } from "../src/core/fileset.js";

// esbuild comes with Vite, so it is there after `npm install`.
const esbuild = await import("esbuild");
const runtime = (await bundleRuntime(esbuild)).code;
const art = { icon: new Uint8Array([1]), banner: new Uint8Array([2]) };
// Enough of a PNG for the checks (the real sprite is drawn by the browser, not here).
const sprite = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(7)]);

const plain = generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 });
const withSwitch = generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: true });

function tileFor({ track = withSwitch, choices = {}, name = "Test" } = {}) {
  return makeCoasterTile({ name, choices: { handle: "alice.example", ...choices }, track, sprite, rider: { kind: "default" }, recipe: { seed: track.input.seed }, runtime, art });
}
function pageOf(tile) {
  return new TextDecoder().decode(tile.files[0].bytes);
}
function configOf(tile) {
  const m = /<script type="application\/json" id="coaster-config">([\s\S]*?)<\/script>/.exec(pageOf(tile));
  return JSON.parse(m[1]);
}

test("the coaster program bundles the same bytes every time, and stays well under the size limit", async () => {
  const again = (await bundleRuntime(esbuild)).code;
  assert.equal(again, runtime);
  assert.ok(runtime.length < 1.5 * 1024 * 1024, `coaster.js is ${runtime.length} bytes`);
});

test("a tile has its page, the shared program, and card pictures; .js files are served as JavaScript", () => {
  const tile = tileFor({ name: "  My coaster " });
  assert.equal(tile.name, "My coaster");
  assert.deepEqual(tile.files.map((f) => f.path), ["/", RUNTIME_PATH, "/icon.png", "/banner.png"]);
  assert.equal(contentTypeFor(RUNTIME_PATH), "text/javascript");
  const html = pageOf(tile);
  assert.equal(readCspMeta(html), TILE_CSP);
  assert.ok(html.includes(`<script src="${RUNTIME_PATH}"></script>`));
  assert.ok(html.length < 400 * 1024, `page is ${html.length} bytes`);
});

test("every coaster tile carries byte-identical /coaster.js, whatever its track and look", () => {
  const a = tileFor({ track: plain });
  const b = tileFor({ track: withSwitch, choices: { theme: "spooky", style: "wood", tunnel: false } });
  assert.deepEqual(a.files[1].bytes, b.files[1].bytes);
});

test("the page's track rebuilds the exact same coaster: points, fingerprint, tunnel and scenery", () => {
  for (const track of [plain, withSwitch]) {
    const back = unpackTrack(configOf(tileFor({ track })).track);
    assert.equal(back.fingerprint, track.fingerprint);
    assert.deepEqual(back.points, track.points);
    // (JSON writes -0 as 0; the same direction, so nothing changes on screen.)
    assert.deepEqual(back.ups, track.ups.map((u) => u.map((x) => x + 0)));
    assert.deepEqual(back.time, track.time);
    assert.deepEqual(back.bounds, track.bounds);
    assert.deepEqual(findTunnel(back), findTunnel(track), "the tunnel goes in the same place");
    assert.deepEqual(placeProps(back, THEMES.day.props), placeProps(track, THEMES.day.props), "the scenery stands in the same places");
    if (track.trackSwitch) {
      assert.equal(back.trackSwitch.at, track.trackSwitch.at);
      assert.deepEqual(back.trackSwitch.thrill.points, track.trackSwitch.thrill.points);
      assert.equal(back.trackSwitch.thrill.duration, track.trackSwitch.thrill.duration);
    } else assert.equal(back.trackSwitch, null);
  }
  // Packing twice gives the same data.
  assert.deepEqual(packTrack(unpackTrack(packTrack(withSwitch))), packTrack(withSwitch));
});

test("the page carries the creator's choices, and the recipe says how the track was made", () => {
  const tile = tileFor({ choices: { theme: "night", style: "wood", colors: { wood: "barn-red", cart: "silver" }, tunnel: false } });
  const config = configOf(tile);
  assert.equal(config.version, 1);
  assert.equal(config.theme, "night");
  assert.equal(config.style, "wood");
  assert.deepEqual(config.colors, { steel: DEFAULT_COLORS.steel, wood: "barn-red", cart: "silver" });
  assert.equal(config.tunnel, false);
  assert.equal(config.handle, "alice.example");
  assert.equal(config.makeUrl, MAKE_URL);
  assert.ok(config.sprite.startsWith("data:image/png;base64,"));
  assert.equal(tile.recipeInputs.track.seed, 1);
  assert.equal(tile.recipeInputs.track.fingerprint, withSwitch.fingerprint);
  assert.equal(tile.recipeInputs.track.trackSwitch, true);
  assert.deepEqual(tile.recipeInputs.rider, { kind: "default" });
  assert.equal(tile.recipeInputs.choices.theme, "night");
});

test("the same inputs always make the same page", () => {
  assert.deepEqual(tileFor().files[0].bytes, tileFor().files[0].bytes);
});

test("only known choices of the right kind reach a tile; names and handles cannot break the page", () => {
  const clean = cleanChoices({ theme: "disco", style: "chrome", colors: { steel: "<b>", cart: "silver" }, tunnel: "yes", handle: "</script>", evil: 1 });
  assert.deepEqual(clean, { theme: "day", style: "steel", colors: { steel: DEFAULT_COLORS.steel, wood: DEFAULT_COLORS.wood, cart: "silver" }, tunnel: true, handle: null });
  assert.equal(cleanChoices({ handle: "Alice.Example" }).handle, "alice.example");
  const html = pageOf(tileFor({ name: "</script><b>" }));
  assert.ok(!html.includes("</script><b>"));
  assert.throws(() => makeCoasterTile({ name: "x", track: plain, sprite: new Uint8Array([1, 2, 3]), runtime, art }), /PNG/);
  assert.throws(() => makeCoasterTile({ name: "x", track: plain, sprite, runtime: "", art }), /coaster\.js/);
});
