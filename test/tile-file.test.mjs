// "Save as .tile" (v0.39.0; every type in v0.40.0; claude/tile-files-plan.md): the CARball the
// Foundry writes, read back here by a small reader of the test's own (so the
// writer isn't checked by its own code), and compared with what Publish would
// put in the account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import vm from "node:vm";
import { encodeTileFile, tileFileParts, fileManifest, tileFileName, varint, TILE_FILE_TYPES } from "../src/core/tile-file.js";
import { readCspMeta } from "../src/core/policy.js";
import { listTileTypes } from "../src/core/registry.js";
import "../src/tile-types/index.js";
import { renderTileHtml } from "../src/tile-types/sprite-walker/template.js";
import { getScene } from "../src/tile-types/sprite-walker/scenes/index.js";
import { spriteWalker } from "../src/tile-types/sprite-walker/index.js";
import { makeCoasterTile } from "../src/tile-types/coaster-carnival/tile.js";
import { bundleRuntime as bundleCoaster } from "../src/tile-types/coaster-carnival/runtime/bundle.js";
import { generateTrack } from "../src/tile-types/coaster-carnival/track/index.js";
import { makeMixtapeTile } from "../src/tile-types/mixtape/tile.js";
import { bundleRuntime as bundleMixtape } from "../src/tile-types/mixtape/runtime/bundle.js";
import { TAPE_FORMAT } from "../src/core/audio/mp3.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages } from "../src/tile-types/zine/pages.js";
import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { makeFile } from "../src/core/fileset.js";
import { rawCid, base32Lower } from "../src/core/cid.js";
import { TILE_CSP } from "../src/core/policy.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";
import { bundleRuntime } from "../src/tile-types/glass-lantern/runtime/bundle.js";
import { makeLanternTile } from "../src/tile-types/glass-lantern/tile.js";
import { panelDefaults, resolvePanel, panelRecipe } from "../src/tile-types/glass-lantern/panel.js";

const SAMPLE = readFileSync(new URL("./fixtures/sample-sprite.png", import.meta.url));

// ---- a small, independent CAR + DAG-CBOR reader ---------------------------
function readVarint(buf, at) {
  let n = 0, mul = 1, i = at;
  for (;;) {
    const b = buf[i++];
    n += (b & 0x7f) * mul;
    if (b < 0x80) return [n, i];
    mul *= 0x80;
  }
}
function decodeCbor(buf) {
  let at = 0;
  const td = new TextDecoder("utf-8", { fatal: true });
  function arg(info) {
    if (info < 24) return info;
    const len = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    let n = 0;
    for (let i = 0; i < len; i++) n = n * 256 + buf[at++];
    return n;
  }
  function item() {
    const first = buf[at++];
    const major = first >> 5, info = first & 31;
    if (major === 7) return info === 20 ? false : info === 21 ? true : info === 22 ? null : assert.fail(`simple ${info}`);
    const n = arg(info);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { const b = buf.slice(at, at + n); at += n; return b; }
    if (major === 3) { const s = td.decode(buf.slice(at, at + n)); at += n; return s; }
    if (major === 4) return Array.from({ length: n }, item);
    if (major === 5) { const o = {}; for (let i = 0; i < n; i++) { const k = item(); o[k] = item(); } return o; }
    if (major === 6) {
      assert.equal(n, 42, "only CID tags");
      const b = item();
      assert.equal(b[0], 0, "identity multibase prefix");
      return { $link: "b" + base32Lower(b.slice(1)) };
    }
    assert.fail(`major ${major}`);
  }
  const v = item();
  assert.equal(at, buf.length, "nothing after the header");
  return v;
}
function readCar(bytes) {
  const [hlen, start] = readVarint(bytes, 0);
  const header = decodeCbor(bytes.slice(start, start + hlen));
  const blocks = new Map();
  let at = start + hlen;
  while (at < bytes.length) {
    const [len, s] = readVarint(bytes, at);
    const cid = bytes.slice(s, s + 36); // CIDv1, raw, sha-256: 4 + 32 bytes
    const data = bytes.slice(s + 36, s + len);
    blocks.set("b" + base32Lower(cid), data);
    at = s + len;
  }
  assert.equal(at, bytes.length);
  return { header, blocks };
}
const sha = (b) => new Uint8Array(createHash("sha256").update(b).digest());

// ---- tiles to save ------------------------------------------------------------
const fakeType = {
  id: "fake-tile", version: 1, title: "Fake", summary: "For tests.",
  inputs: [{ key: "name", kind: "text", required: true }],
  defaults: () => ({ name: "x" }),
  build: async (inputs) => ({
    name: inputs.name,
    description: "A test tile.",
    files: [
      makeFile("/", `<html><head><meta http-equiv="Content-Security-Policy" content="${TILE_CSP}" /></head><body>hi</body></html>`),
      makeFile("/icon.png", SAMPLE),
      makeFile("/banner.png", SAMPLE), // same bytes as the icon: one block
    ],
    icons: [{ src: "/icon.png" }],
    screenshots: [{ src: "/banner.png" }],
    recipeInputs: { hello: "world" },
  }),
};

const esbuild = await import("esbuild");
const runtime = (await bundleRuntime(esbuild)).code;
async function lanternResult() {
  const values = { ...panelDefaults(), ...glassLantern.defaults({}) };
  const art = { icon: SAMPLE, banner: new Uint8Array(readFileSync(new URL("./fixtures/sample-sprite.png", import.meta.url))).reverse() };
  const out = makeLanternTile({ name: values.name, parts: resolvePanel(values), recipe: panelRecipe(values), runtime, art });
  const files = [];
  for (const f of out.files) files.push({ ...f, cid: await rawCid(f.bytes) });
  return { ...out, files };
}

// ---- the tests ------------------------------------------------------------------
test("varints are LEB128, as CAR wants", () => {
  assert.deepEqual([...varint(0)], [0]);
  assert.deepEqual([...varint(127)], [127]);
  assert.deepEqual([...varint(128)], [0x80, 1]);
  assert.deepEqual([...varint(300)], [0xac, 0x02]);
  assert.deepEqual(readVarint(varint(1_234_567), 0), [1_234_567, varint(1_234_567).length]);
  assert.throws(() => varint(-1));
});

test("a saved tile is a CAR whose header is the manifest plus version 1 and empty roots", async () => {
  const result = await buildTile(fakeType, { name: "My test tile" });
  const { header } = readCar(encodeTileFile(result));
  assert.equal(header.version, 1);
  assert.deepEqual(header.roots, []);
  assert.equal(header.name, "My test tile");
  assert.equal(header.description, "A test tile.");
  assert.deepEqual(header.icons, [{ src: "/icon.png" }]);
  assert.deepEqual(header.screenshots, [{ src: "/banner.png" }]);
  assert.deepEqual(Object.keys(header.resources).sort(), ["/", "/banner.png", "/foundry.json", "/icon.png"]);
  assert.equal(header.resources["/"]["content-type"], "text/html");
  assert.equal(header.resources["/"]["content-security-policy"], TILE_CSP);
  assert.equal(header.resources["/icon.png"]["content-type"], "image/png");
  for (const f of result.files) assert.deepEqual(header.resources[f.path].src, { $link: f.cid }, f.path);
});

test("every file is inside, under its own address; the same bytes are stored once", async () => {
  const result = await buildTile(fakeType, { name: "T" });
  const { header, blocks } = readCar(encodeTileFile(result));
  assert.equal(blocks.size, 3, "page, picture (shared by icon and banner), recipe");
  for (const [cid, data] of blocks) {
    const expected = "b" + base32Lower(new Uint8Array([1, 0x55, 0x12, 0x20, ...sha(data)]));
    assert.equal(cid, expected, "each block's address is the sha-256 of its bytes");
  }
  for (const [path, entry] of Object.entries(header.resources)) {
    const data = blocks.get(entry.src.$link);
    assert.ok(data, `${path} is in the file`);
    assert.deepEqual(data, result.files.find((f) => f.path === path).bytes);
  }
});

test("the file's addresses and manifest match what Publish puts in the account, apart from how src is written", async () => {
  const result = await buildTile(fakeType, { name: "Same as published" });
  // A stand-in server that stores what it's sent and echoes it back.
  const blobs = new Map(); let record;
  const xrpc = async (nsid, { params, body, contentType }) => {
    if (nsid === "com.atproto.repo.uploadBlob") {
      const cid = await rawCid(body); blobs.set(cid, body);
      return { blob: { $type: "blob", ref: { $link: cid }, mimeType: contentType, size: body.length } };
    }
    if (nsid === "com.atproto.repo.createRecord") { record = structuredClone(body.record); return { uri: `at://${body.repo}/ing.dasl.masl/3mtest1`, cid: "bafyreirecord" }; }
    if (nsid === "com.atproto.repo.getRecord") return { value: structuredClone(record) };
    throw new Error(nsid);
  };
  const out = await publishTile({ xrpc, fetchBlob: async (cid) => blobs.get(cid), did: "did:plc:test", result });
  const published = out.record.tile;
  const { header } = readCar(encodeTileFile(result));
  const { version, roots, ...fromFile } = header;
  for (const [path, entry] of Object.entries(published.resources)) {
    assert.equal(fromFile.resources[path].src.$link, entry.src.ref.$link, `${path}: same address`);
    const { src: a, ...restPublished } = entry;
    const { src: b, ...restFile } = fromFile.resources[path];
    assert.deepEqual(restFile, restPublished, `${path}: same headers`);
  }
  const strip = (m) => ({ ...m, resources: Object.keys(m.resources).sort() });
  assert.deepEqual(strip(fromFile), strip(published), "same name, description, icons, screenshots and paths");
});

test("a Glass Lantern tile saves whole: page, program, pictures and recipe, every byte intact", async () => {
  const result = await lanternResult();
  const bytes = encodeTileFile(result);
  const { header, blocks } = readCar(bytes);
  assert.deepEqual(Object.keys(header.resources).sort(), ["/", "/banner.png", "/icon.png", "/lantern.js"].sort());
  assert.equal(header.resources["/lantern.js"]["content-type"], "text/javascript");
  for (const f of result.files) assert.deepEqual(blocks.get(f.cid), f.bytes, f.path);
  assert.ok(bytes.length < 5 * 1024 * 1024, `${bytes.length} bytes`);
  assert.deepEqual(encodeTileFile(result), bytes, "the same tile always makes the same file");
});

test("every tile type offers it (v0.40.0)", () => {
  const ids = listTileTypes().map((t) => t.id).sort();
  assert.deepEqual([...TILE_FILE_TYPES].sort(), ids);
  assert.deepEqual(ids, ["coaster-carnival", "glass-lantern", "mixtape", "sprite-walker", "zine"]);
});

test("a tile with no page can't be saved", () => {
  assert.throws(() => encodeTileFile({ name: "x", files: [] }), /"\/" page/);
});

test("file names come from the tile's name", () => {
  assert.equal(tileFileName("My Lantern!"), "my-lantern.tile");
  assert.equal(tileFileName("@alice.test's glass lantern"), "alice-test-s-glass-lantern.tile");
  assert.equal(tileFileName("Crème brûlée"), "creme-brulee.tile");
  assert.equal(tileFileName("  "), "tile.tile");
  assert.equal(tileFileName("../../etc/passwd"), "etc-passwd.tile");
  assert.ok(tileFileName("x".repeat(200)).length <= 65);
});

test("fileManifest is buildManifest with plain address links", async () => {
  const result = await buildTile(fakeType, { name: "T" });
  const m = fileManifest(result);
  for (const f of result.files) assert.deepEqual(m.resources[f.path].src, { $link: f.cid });
});

// ---- v0.40.0: every type ---------------------------------------------------------
async function withCids(out) {
  const files = [];
  for (const f of out.files) files.push({ ...f, cid: f.cid || (await rawCid(f.bytes)) });
  return { ...out, files };
}
// A saved tile holds every file, byte for byte, under its address and type, its
// page carries the policy (so it reaches nothing outside itself), and the parts
// make the same bytes as the joined file.
function savesWhole(result) {
  const bytes = encodeTileFile(result);
  const { parts, size } = tileFileParts(result);
  assert.equal(size, bytes.length);
  let at = 0;
  for (const p of parts) { assert.deepEqual(bytes.subarray(at, at + p.length), p); at += p.length; }
  const { header, blocks } = readCar(bytes);
  assert.deepEqual(Object.keys(header.resources).sort(), result.files.map((f) => f.path).sort());
  for (const f of result.files) {
    assert.equal(header.resources[f.path].src.$link, f.cid, f.path);
    assert.equal(header.resources[f.path]["content-type"], f.contentType, f.path);
    assert.deepEqual(blocks.get(f.cid), f.bytes, f.path);
  }
  assert.equal(header.resources["/"]["content-security-policy"], TILE_CSP);
  const page = new TextDecoder().decode(blocks.get(header.resources["/"].src.$link));
  assert.equal(readCspMeta(page), TILE_CSP, "the page keeps its policy");
  return { header, blocks, bytes };
}

test("a Sprite Walker tile saves whole: one page with the sprite inside, and its card pictures", async () => {
  const sheet = "data:image/png;base64," + Buffer.from(SAMPLE).toString("base64");
  const stand = {
    ...spriteWalker,
    inputs: [{ key: "name", kind: "text", required: true }],
    build: async (inputs) => ({
      name: inputs.name,
      files: [makeFile("/", renderTileHtml({ title: inputs.name, sheetDataUri: sheet, frameWidth: 48, frameHeight: 48, startMotion: "forward", scene: getScene("beach") })), makeFile("/icon.png", SAMPLE), makeFile("/banner.png", new Uint8Array(SAMPLE).reverse())],
      icons: [{ src: "/icon.png" }], screenshots: [{ src: "/banner.png" }], recipeInputs: {},
    }),
  };
  const result = await buildTile(stand, { name: "@alice.test's sprite" });
  const { blocks, header } = savesWhole(result);
  const page = new TextDecoder().decode(blocks.get(header.resources["/"].src.$link));
  assert.ok(page.includes(sheet.slice(0, 200)), "the sprite sheet is in the page");
  assert.doesNotMatch(page, /https?:\/\/(?!www\.w3\.org)/, "nothing outside");
});

test("a Coaster Carnival tile saves whole", async () => {
  const runtime = (await bundleCoaster(esbuild)).code;
  const track = generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: true });
  const out = makeCoasterTile({ name: "Loop Town", choices: { handle: "alice.example" }, track, sprite: new Uint8Array(SAMPLE), rider: { kind: "default" }, recipe: { seed: 1 }, runtime, art: { icon: SAMPLE, banner: new Uint8Array(SAMPLE).reverse() } });
  savesWhole(await withCids(out));
});

// The tape's silence, made the way the Foundry makes it (as in mixtape-tile.test.mjs).
function encodeSilence(seconds = 10) {
  const ctx = vm.createContext({ console, Math, Int16Array, Int8Array, Uint8Array, Float32Array });
  vm.runInContext(readFileSync(new URL("../public/vendor/lamejs/lame.min.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../public/audio/encode-core.js", import.meta.url), "utf8"), ctx);
  const n = TAPE_FORMAT.decodeRate * seconds;
  return ctx.FoundryEncode.encodePcm(ctx.lamejs, new Float32Array(n), new Float32Array(n), TAPE_FORMAT.decodeRate, TAPE_FORMAT.kbps);
}

test("a Mixtape tile saves whole: the songs are inside, so a saved tape plays", async () => {
  const runtime = (await bundleMixtape(esbuild)).code;
  const tone = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/audio/${n}`, import.meta.url)));
  const tracks = [
    { id: "a", title: "One", side: "A", status: "ready", bytes: tone("tone-a-96k-32k.mp3"), seconds: 1, transition: "pause" },
    { id: "b", title: "Two", side: "A", status: "ready", bytes: tone("tone-b-96k-32k.mp3"), seconds: 1 },
    { id: "c", title: "Three", side: "B", status: "ready", bytes: tone("tone-a-96k-32k.mp3"), seconds: 1 },
  ];
  const out = await makeMixtapeTile({ name: "Road Trip", sides: ["A", "B"], tracks, silence: encodeSilence(), recipe: {}, runtime, art: { icon: SAMPLE, banner: new Uint8Array(SAMPLE).reverse() } });
  const { header, blocks } = savesWhole(await withCids(out));
  const songs = Object.keys(header.resources).filter((p) => p.startsWith("/tracks/"));
  assert.equal(songs.length, 3);
  for (const p of songs) {
    assert.equal(header.resources[p]["content-type"], "audio/mpeg", p);
    assert.ok(blocks.get(header.resources[p].src.$link).length > 0, p);
  }
  const tape = JSON.parse(new TextDecoder().decode(blocks.get(header.resources["/tape.json"].src.$link)));
  const listed = tape.sides.flatMap((s) => s.tracks.map((t) => t.path)).sort();
  assert.deepEqual(listed, songs.sort(), "every song tape.json names is in the file");
});

test("a Zine Scene tile saves whole, a tile on its pages included; files kept under another type for the account keep their own type in the file", async () => {
  const enc = (t) => new TextEncoder().encode(t);
  const pages = emptyPages();
  pages[1].layout = "tile";
  pages[1].heading = "My lantern";
  pages[1].words = "Spin it.";
  pages[1].piece = {
    kind: "tile", uri: "at://did:plc:joer5rzmwgec3dkr4srfmq45/ing.dasl.masl/3mlantern", cid: "bafyreirec", name: "Glass lantern",
    did: "did:plc:joer5rzmwgec3dkr4srfmq45", handle: "thunderbirdwine.bsky.social", typeId: "glass-lantern", typeVersion: 1, foundryVersion: "0.9.0", status: "ready",
    files: [
      { path: "/", bytes: enc('<!DOCTYPE html><html><body><script src="/lantern.js"></script></body></html>'), contentType: "text/html" },
      { path: "/lantern.js", bytes: enc("console.log(1)"), contentType: "text/javascript", storedType: "application/octet-stream" },
      { path: "/banner.png", bytes: new Uint8Array([137, 80, 78, 71, 9]), contentType: "image/png" },
      { path: "/icon.png", bytes: new Uint8Array([137, 80, 78, 71, 8]), contentType: "image/png" },
      { path: "/foundry.json", bytes: enc("{}"), contentType: "application/json" },
    ],
  };
  const result = await buildTile(zine, { name: "Tiles", paper: "letter", look: "clean", pages, description: "", handle: "thunderbirdwine.bsky.social" }, { final: false });
  const { header } = savesWhole(result);
  for (const p of ["/tiles/p1/index.html", "/tiles/p1/lantern.js", "/tiles/p1/banner.png"]) assert.ok(header.resources[p], p);
  const stored = result.files.find((f) => f.path === "/tiles/p1/lantern.js");
  assert.equal(stored.storedType, "application/octet-stream", "kept under another type for the account");
  assert.equal(header.resources["/tiles/p1/lantern.js"]["content-type"], "text/javascript", "served as what it is");
  assert.ok(!JSON.stringify(Object.values(header.resources)).includes("octet-stream"));
});

test("a big tape's file is made of parts, not one second copy", () => {
  const song = new Uint8Array(8 * 1024 * 1024);
  const files = [{ path: "/", bytes: new TextEncoder().encode("<html></html>"), contentType: "text/html", cid: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" }];
  for (let i = 0; i < 6; i++) {
    const b = song.slice(); b[0] = i;
    files.push({ path: `/tracks/a${i + 1}.mp3`, bytes: b, contentType: "audio/mpeg" });
  }
  return (async () => {
    const result = await withCids({ name: "Big", files: files.map(({ cid, ...f }) => f) });
    const { parts, size } = tileFileParts(result);
    assert.ok(size > 48 * 1024 * 1024);
    for (const f of result.files) assert.ok(parts.includes(f.bytes), `${f.path}: its own bytes, not a copy`);
  })();
});
