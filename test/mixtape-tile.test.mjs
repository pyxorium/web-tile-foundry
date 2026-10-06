// Mixtape stage 3: the tape tile itself (transitions baked into the audio,
// the tape.json writer, the page and its player program).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { bundleRuntime, RUNTIME_PATH } from "../src/tile-types/mixtape/runtime/bundle.js";
import { makeMixtapeTile } from "../src/tile-types/mixtape/tile.js";
import { shapeFor, shapesFor, suggestTransition, trackNumberOf, transitionOf, TIMING, DEFAULT_TRANSITION } from "../src/tile-types/mixtape/transitions.js";
import { makeTape, tapeJson, trackPath, sideKey, cleanText, TAPE_PATH, LIMITS } from "../src/tile-types/mixtape/tape.js";
import { sidesOf, clock } from "../src/tile-types/mixtape/runtime/player.js";
import { scanMp3, joinMp3, TAPE_FORMAT } from "../src/core/audio/mp3.js";
import { readCspMeta, TILE_CSP } from "../src/core/policy.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { rawCid } from "../src/core/cid.js";
import { buildTile } from "../src/core/build.js";
import { RECIPE_PATH } from "../src/core/recipe.js";

// esbuild comes with Vite, so it is there after `npm install`.
const esbuild = await import("esbuild");
const runtime = (await bundleRuntime(esbuild)).code;

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/audio/${name}`, import.meta.url)));
const TONE_A = fixture("tone-a-96k-32k.mp3");
const TONE_B = fixture("tone-b-96k-32k.mp3");
const TONE_128 = fixture("tone-128k-32k.mp3");

// Silence made the way the Foundry makes it (makeSilence): the real encoder, 10 s.
function encodeSilence(seconds = 10) {
  const ctx = vm.createContext({ console, Math, Int16Array, Int8Array, Uint8Array, Float32Array });
  vm.runInContext(readFileSync(new URL("../public/vendor/lamejs/lame.min.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../public/audio/encode-core.js", import.meta.url), "utf8"), ctx);
  const n = TAPE_FORMAT.decodeRate * seconds;
  return ctx.FoundryEncode.encodePcm(ctx.lamejs, new Float32Array(n), new Float32Array(n), TAPE_FORMAT.decodeRate, TAPE_FORMAT.kbps);
}
const SILENCE = encodeSilence();

const RECORD = { uri: "at://did:plc:rqbqpaaluty5v47jwciowpik/fm.plyr.track/3lzexample22", cid: "bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy" };

function song(id, side, extra = {}) {
  return { id, title: `Song ${id}`, side, status: "ready", bytes: id.charCodeAt(0) % 2 ? TONE_A : TONE_B, seconds: 1, ...extra };
}

function tapeTracks() {
  return [
    song("a", "A", { transition: "straight", artist: "Parlor Greens", album: "Jam Cruise 2026-02-07", source: { record: RECORD, url: "https://plyr.fm/track/1" } }),
    song("b", "A", { transition: "pause" }),
    song("c", "A", { transition: "fade", fades: { fadeIn: 0, fadeOut: TIMING.fade.fadeOut } }),
    song("d", "A", { transition: "fade", fades: { fadeIn: TIMING.fade.fadeIn, fadeOut: 0 } }), // last on its side: nothing after it
    song("e", "B"),
  ];
}

function makeTile(over = {}) {
  return makeMixtapeTile({
    name: "Road Trip Mix",
    description: "Two sides",
    tape: { dedication: "For Sam", notes: "Side A out,\nSide B home.", label: { text: "ROAD TRIP '26" }, madeBy: { handle: "pyxorium.com", did: "did:plc:rqbqpaaluty5v47jwciowpik" } },
    sides: ["A", "B"],
    tracks: tapeTracks(),
    silence: SILENCE,
    recipe: { from: "test" },
    runtime,
    art: { icon: new Uint8Array([1]), banner: new Uint8Array([2]) },
    ...over,
  });
}
const fileAt = (tile, path) => tile.files.find((f) => f.path === path);
const pageOf = (tile) => new TextDecoder().decode(fileAt(tile, "/").bytes);
const configOf = (tile) => JSON.parse(/<script type="application\/json" id="mixtape-config">([\s\S]*?)<\/script>/.exec(pageOf(tile))[1]);
const tapeOf = (tile) => JSON.parse(new TextDecoder().decode(fileAt(tile, TAPE_PATH).bytes));

// ---- transitions ------------------------------------------------------------------

test("each transition gives the right fades and silence, and a side's last song gets none", () => {
  const side = [{ transition: "straight" }, { transition: "pause" }, { transition: "fade" }, { transition: "fade" }];
  assert.deepEqual(shapeFor(side, 0), { fadeIn: 0, fadeOut: 0, pause: 0, into: "straight" });
  assert.deepEqual(shapeFor(side, 1), { fadeIn: 0, fadeOut: 0, pause: TIMING.pause.pause, into: "pause" });
  assert.deepEqual(shapeFor(side, 2), { fadeIn: 0, fadeOut: TIMING.fade.fadeOut, pause: TIMING.fade.pause, into: "fade" });
  // Faded in (the song before it fades), and nothing after it.
  assert.deepEqual(shapeFor(side, 3), { fadeIn: TIMING.fade.fadeIn, fadeOut: 0, pause: 0, into: null });
});

test("a song without a choice uses the song list's default, and shapes are worked out per side", () => {
  assert.equal(transitionOf({}), DEFAULT_TRANSITION);
  assert.equal(transitionOf({ transition: "nonsense" }), DEFAULT_TRANSITION);
  const shapes = shapesFor([{ id: "1", side: "A" }, { id: "2", side: "B" }, { id: "3", side: "A" }], ["A", "B"]);
  assert.equal(shapes.get("1").into, "fade");
  assert.equal(shapes.get("2").into, null); // alone on side B
  assert.equal(shapes.get("3").fadeIn, TIMING.fade.fadeIn);
});

test("back-to-back songs from the same show go straight on; anything else fades", () => {
  assert.equal(trackNumberOf("03 The Ripper"), 3);
  assert.equal(trackNumberOf("3. The Ripper"), 3);
  assert.equal(trackNumberOf("12 - Jam"), 12);
  assert.equal(trackNumberOf("1999"), null);
  assert.equal(trackNumberOf("The Ripper"), null);
  const show = "Jam Cruise 2026-02-07";
  assert.equal(suggestTransition({ album: show, title: "03 Ripper" }, { album: show, title: "04 Jam" }), "straight");
  assert.equal(suggestTransition({ album: show, trackNumber: 7 }, { album: show, trackNumber: 8 }), "straight");
  assert.equal(suggestTransition({ album: show, title: "03 Ripper" }, { album: show, title: "05 Jam" }), "fade");
  assert.equal(suggestTransition({ album: show, title: "03 Ripper" }, { album: "Other show", title: "04 Jam" }), "fade");
  assert.equal(suggestTransition({ title: "03 Ripper" }, { title: "04 Jam" }), "fade");
});

// ---- the tile's files -----------------------------------------------------------

test("the player program bundles the same bytes every time and stays small", async () => {
  assert.equal((await bundleRuntime(esbuild)).code, runtime);
  assert.ok(runtime.length < 40 * 1024, `mixtape.js is ${runtime.length} bytes`);
});

test("a tape tile has its page, player, tape.json, one file per song and card pictures", async () => {
  const tile = await makeTile();
  assert.deepEqual(tile.files.map((f) => f.path), [
    "/", RUNTIME_PATH, TAPE_PATH,
    "/tracks/a1.mp3", "/tracks/a2.mp3", "/tracks/a3.mp3", "/tracks/a4.mp3", "/tracks/b1.mp3",
    "/icon.png", "/banner.png",
  ]);
  assert.equal(contentTypeFor("/tracks/a1.mp3"), "audio/mpeg");
  assert.equal(contentTypeFor(TAPE_PATH), "application/json");
  const html = pageOf(tile);
  assert.equal(readCspMeta(html), TILE_CSP);
  assert.ok(html.includes(`<script src="${RUNTIME_PATH}"></script>`));
  assert.deepEqual(configOf(tile).tape, tapeOf(tile));
  assert.equal(configOf(tile).artwork, "/icon.png");
});

test("silence is baked in after a song for pause and fade, never after straight or a side's last song", async () => {
  const tile = await makeTile();
  const seconds = (p) => scanMp3(fileAt(tile, p).bytes).seconds;
  const a = scanMp3(TONE_A).seconds;
  const b = scanMp3(TONE_B).seconds;
  const near = (x, y) => Math.abs(x - y) < 0.04; // one frame is 36 ms
  assert.ok(near(seconds("/tracks/a1.mp3"), a), "straight: no silence");
  assert.ok(near(seconds("/tracks/a2.mp3"), b + TIMING.pause.pause), "pause");
  assert.ok(near(seconds("/tracks/a3.mp3"), a + TIMING.fade.pause), "fade");
  assert.ok(near(seconds("/tracks/a4.mp3"), b), "last on side A");
  assert.ok(near(seconds("/tracks/b1.mp3"), a), "last on side B");
});

test("each side's files join into one continuous side, as Tileman joins them", async () => {
  const tile = await makeTile();
  const tape = tapeOf(tile);
  for (const side of tape.sides) {
    const joined = joinMp3(side.tracks.map((t) => fileAt(tile, t.path).bytes));
    const listed = side.tracks.reduce((n, t) => n + t.duration, 0);
    assert.ok(Math.abs(joined.total - listed) < 0.05, `side ${side.name}: ${joined.total} vs ${listed}`);
  }
});

test("tape.json follows the v2 spec: sides, tracks with path, cid, duration, source and transition", async () => {
  const tile = await makeTile();
  const tape = tapeOf(tile);
  assert.equal(tape.v, 2);
  assert.equal(tape.title, "Road Trip Mix");
  assert.deepEqual(tape.audio, { mimeType: "audio/mpeg", bitrate: 96, sampleRate: 32000, channels: 2 });
  assert.deepEqual(tape.label, { text: "ROAD TRIP '26" });
  assert.equal(tape.dedication, "For Sam");
  assert.equal(tape.notes, "Side A out,\nSide B home.");
  assert.deepEqual(tape.madeBy, { did: "did:plc:rqbqpaaluty5v47jwciowpik", handle: "pyxorium.com" });
  assert.ok(!("createdAt" in tape), "no dates, so the same tape gives the same file");
  assert.deepEqual(tape.sides.map((s) => s.name), ["A", "B"]);
  const [a1, a2, a3, a4] = tape.sides[0].tracks;
  assert.equal(a1.path, "/tracks/a1.mp3");
  assert.equal(a1.cid, await rawCid(fileAt(tile, a1.path).bytes));
  assert.equal(a1.artist, "Parlor Greens");
  assert.equal(a1.album, "Jam Cruise 2026-02-07");
  assert.deepEqual(a1.source, { record: RECORD, url: "https://plyr.fm/track/1" });
  assert.deepEqual(a1.transition, { kind: "straight", baked: true });
  assert.deepEqual(a2.transition, { kind: "pause", pause: TIMING.pause.pause, baked: true });
  assert.deepEqual(a3.transition, { kind: "fade", fadeOut: TIMING.fade.fadeOut, pause: TIMING.fade.pause, fadeIn: TIMING.fade.fadeIn, baked: true });
  assert.ok(!("transition" in a4), "the last song on a side leads nowhere");
  for (const side of tape.sides) for (const t of side.tracks) assert.ok(t.duration > 0 && Number.isFinite(t.duration));
});

test("the same tape always gives byte-identical files", async () => {
  const one = await makeTile();
  const two = await makeTile();
  assert.deepEqual(one.files.map((f) => f.bytes), two.files.map((f) => f.bytes));
});

test("a song converted with the wrong fades, in the wrong format, or a missing silence is refused", async () => {
  const tracks = tapeTracks();
  tracks[2].fades = { fadeIn: 0, fadeOut: 0 }; // made before its transition changed to fade
  await assert.rejects(makeTile({ tracks }), /needs converting again/);
  const wrong = tapeTracks();
  wrong[0].bytes = TONE_128;
  await assert.rejects(makeTile({ tracks: wrong }), /128 kbps.*not the tape format/);
  await assert.rejects(makeTile({ silence: null }), /silence between songs is missing/);
  const unready = tapeTracks();
  unready[4].bytes = undefined;
  await assert.rejects(makeTile({ tracks: unready }), /isn't converted yet/);
  await assert.rejects(makeTile({ runtime: "" }), /player/);
});

test("a straight-only, single-side tape needs no silence and has one side", async () => {
  const tracks = [song("a", "A", { transition: "straight" }), song("b", "A")];
  const tile = await makeTile({ tracks, silence: null, sides: ["A", "B"], art: null });
  const tape = tapeOf(tile);
  assert.deepEqual(tape.sides.map((s) => s.name), ["A"]);
  assert.deepEqual(tile.icons, []);
  assert.equal(configOf(tile).artwork, null);
  assert.ok(!tile.files.some((f) => f.path.endsWith(".png")));
});

test("text is cleaned: trimmed, limited, and safe inside the page", async () => {
  assert.equal(cleanText("  a \n b  ", 10), "a b");
  assert.equal(cleanText("x\n\n\n\ny", 10, { lines: true }), "x\n\ny");
  assert.equal(cleanText("abc\u0007def", 10), "abcdef");
  assert.equal(cleanText(42, 10), "");
  assert.equal([...cleanText("é".repeat(500), LIMITS.title)].length, LIMITS.title);
  const tracks = tapeTracks();
  tracks[0].title = "</script><script>alert(1)</script>";
  tracks[0].source = { record: { uri: "https://evil.example/", cid: "x" }, url: "javascript:alert(1)" };
  const tile = await makeTile({ tracks, name: "Tape </script> & <b>" });
  const html = pageOf(tile);
  assert.equal(html.match(/<\/script>/g).length, 2, "only the page's own two script tags close");
  assert.ok(html.includes("<title>Tape &lt;/script&gt; &amp; &lt;b&gt;</title>"));
  const a1 = tapeOf(tile).sides[0].tracks[0];
  assert.equal(a1.title, "</script><script>alert(1)</script>"); // kept as plain text for players
  assert.ok(!("source" in a1), "an invalid source is left out");
});

test("tape.json details: describe terms, side keys and file paths", () => {
  const tape = makeTape({
    title: "T",
    describe: { genres: ["funk", "Funk", " jazz "], moods: [], tags: ["live", 3], live: true },
    sides: [{ name: "Morning", tracks: [{ path: "/tracks/s1-1.mp3", cid: "bafkreix", title: "x", duration: 1.234 }] }],
  });
  assert.deepEqual(tape.describe, { genres: ["funk", "jazz"], tags: ["live"], live: true });
  assert.equal(tape.sides[0].tracks[0].duration, 1.23);
  assert.equal(sideKey("A", 0), "a");
  assert.equal(sideKey("Morning", 1), "s2");
  assert.equal(trackPath("B", 1, 3), "/tracks/b3.mp3");
  assert.equal(tapeJson(tape), tapeJson(structuredClone(tape)));
  assert.throws(() => makeTape({ title: " ", sides: [] }), /needs a title/);
});

test("the tile builds through the Foundry's own build step, with a small public recipe", async () => {
  const type = {
    id: "mixtape", version: 1, title: "Mixtape", inputs: [], maxBytes: 50 * 1024 * 1024,
    build: () => makeTile(),
  };
  const result = await buildTile(type, {});
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === RECIPE_PATH).bytes));
  assert.deepEqual(recipe.inputs.sides, ["A", "B"]);
  assert.equal(recipe.inputs.tracks.length, 5);
  assert.deepEqual(recipe.inputs.tracks[0], { side: "A", title: "Song a", seconds: Math.round(scanMp3(TONE_A).seconds * 100) / 100, then: "straight", source: RECORD });
  assert.ok(!JSON.stringify(recipe).includes(".mp3\""), "no file names in the recipe");
  // tape.json's addresses are the ones the manifest will list.
  const tape = tapeOf(result);
  for (const t of tape.sides.flatMap((s) => s.tracks)) assert.equal(t.cid, result.files.find((f) => f.path === t.path).cid);
});

// ---- the player's reading of tape.json --------------------------------------------

test("the player reads v2 sides and v1 track lists, and skips songs without a path", () => {
  assert.deepEqual(sidesOf({ v: 1, title: "x", tracks: [{ path: "/tracks/01.mp3" }, { title: "no path" }] }), [{ name: "", tracks: [{ path: "/tracks/01.mp3" }] }]);
  const v2 = sidesOf({ v: 2, sides: [{ name: "A", tracks: [{ path: "/a.mp3" }] }, { name: "B", tracks: [] }] });
  assert.deepEqual(v2.map((s) => s.name), ["A"]);
  assert.deepEqual(sidesOf(null), []);
  assert.equal(clock(7), "0:07");
  assert.equal(clock(225.9), "3:45");
  assert.equal(clock(3723), "1:02:03");
});

test("card pictures can be drawn from the finished tape (its label and side lengths)", async () => {
  let seen = null;
  const tile = await makeTile({ art: null, drawArt: async (tape) => { seen = tape; return { icon: new Uint8Array([1]), banner: new Uint8Array([2]) }; } });
  assert.deepEqual(seen, tapeOf(tile));
  assert.deepEqual(tile.icons, [{ src: "/icon.png" }]);
  assert.equal(configOf(tile).artwork, "/icon.png");
});
