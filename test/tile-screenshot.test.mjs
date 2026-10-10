// Giving a published tile a PNG screenshot in place (scripts/set-tile-screenshot.mjs),
// against a stand-in account server that recognises PNGs the way a real PDS does.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { runSetScreenshot, pngSize, withScreenshot, SCREENSHOT_PATH } from "../scripts/set-tile-screenshot.mjs";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://pds.example";
const RKEY = "3mxig2zz37cnt";
const URI = `at://${DID}/ing.dasl.masl/${RKEY}`;
const enc = (s) => new TextEncoder().encode(s);

/** A small PNG: signature and IHDR are all the script and the stand-in look at. */
function fakePng(width, height) {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b[40] = 7; // anything, so different sizes give different bytes
  return b;
}

/** A tile published the way appmosphe.re's Publish page writes one (every blob ref octet-stream). */
async function publishedTile() {
  const files = {
    "/": ["<!doctype html><script type=module src=./tile.js></script>", "text/html"],
    "/tile.js": ["console.log(1)", "text/javascript"],
    "/screenshot.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml"],
    "/icon.svg": ["<svg xmlns='http://www.w3.org/2000/svg' id='i'/>", "image/svg+xml"],
  };
  const blobs = new Map();
  const resources = {};
  for (const [path, [text, ct]] of Object.entries(files)) {
    const bytes = enc(text);
    const cid = await rawCid(bytes);
    blobs.set(cid, { bytes, mimeType: "application/octet-stream" });
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: "application/octet-stream", size: bytes.length }, "content-type": ct };
  }
  const tile = {
    name: "Twinkle Little Star",
    icons: [{ src: "/icon.svg" }],
    sizing: { width: 720, height: 520 },
    generator: "ATMOSYNTH",
    resources,
    categories: ["music"],
    description: "A small synth-strings arrangement.",
    screenshots: [{ src: "/screenshot.svg" }],
    theme_color: "#0a0713",
    background_color: "#0a0713",
  };
  const record = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, createdAt: "2026-10-10T02:13:34.668Z" };
  return { record, blobs };
}

// A stand-in account server. Like a real PDS it recognises PNG bytes and stores
// them as image/png whatever the upload says, keeps the first type it saw for
// given bytes, and refuses a record whose blob refs disagree with what it holds.
function standIn({ record, blobs }) {
  const state = { record, recordCid: "bafyreioldrecordcid", puts: [], uploads: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === "plc.directory") {
      return json(200, { alsoKnownAs: ["at://pyxorium.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    }
    const nsid = u.pathname.replace("/xrpc/", "");
    if (nsid === "com.atproto.repo.getRecord") return json(200, { uri: URI, cid: state.recordCid, value: state.record });
    if (nsid === "com.atproto.server.createSession") {
      const body = JSON.parse(init.body);
      return body.password === "app-pass" ? json(200, { did: DID, accessJwt: "jwt" }) : json(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
    }
    if (!init.headers || init.headers.Authorization !== "Bearer jwt") return json(401, { error: "AuthMissing" });
    if (nsid === "com.atproto.repo.uploadBlob") {
      const bytes = new Uint8Array(init.body);
      const cid = await rawCid(bytes);
      const sniffed = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : null;
      if (!blobs.has(cid)) blobs.set(cid, { bytes, mimeType: sniffed || init.headers["Content-Type"] });
      state.uploads.push(init.headers["Content-Type"]);
      const held = blobs.get(cid);
      return json(200, { blob: { $type: "blob", ref: { $link: cid }, mimeType: held.mimeType, size: bytes.length } });
    }
    if (nsid === "com.atproto.repo.putRecord") {
      const body = JSON.parse(init.body);
      state.puts.push(body);
      if (body.swapRecord !== state.recordCid) return json(400, { error: "InvalidSwap", message: "Record was at a different cid" });
      for (const r of Object.values(body.record.tile.resources)) {
        const held = blobs.get(r.src.ref.$link);
        if (!held) return json(400, { error: "BlobNotFound" });
        if (held.mimeType !== r.src.mimeType) {
          return json(400, { error: "InvalidMimeType", message: `Referenced Mimetype does not match stored blob. Expected: ${held.mimeType}, Got: ${r.src.mimeType}` });
        }
      }
      state.record = body.record;
      state.recordCid = "bafyreinewrecordcid";
      return json(200, { uri: URI, cid: state.recordCid });
    }
    return json(404, { error: "NotFound" });
  };
  return { state, fetchImpl };
}

const quiet = () => {};
const answers = (...list) => async () => list.shift() ?? "";

test("pngSize reads a PNG's size and refuses anything else", () => {
  assert.deepEqual(pngSize(fakePng(1200, 630)), { width: 1200, height: 630 });
  assert.throws(() => pngSize(enc("<svg/>")), /isn't a PNG/);
});

test("withScreenshot adds the PNG and makes it the only screenshot, leaving the rest", async () => {
  const { record } = await publishedTile();
  const m = withScreenshot(record.tile, { width: 1200, height: 630 });
  assert.deepEqual(m.screenshots, [{ src: SCREENSHOT_PATH, type: "image/png", sizes: "1200x630" }]);
  assert.equal(m.resources[SCREENSHOT_PATH]["content-type"], "image/png");
  for (const p of Object.keys(record.tile.resources)) assert.deepEqual(m.resources[p], record.tile.resources[p]);
  assert.deepEqual(record.tile.screenshots, [{ src: "/screenshot.svg" }], "the original isn't changed");
});

test("adds the PNG in place: uploaded as image/png, manifest address recomputed, nothing else changed", async () => {
  const published = await publishedTile();
  const before = structuredClone(published.record);
  const server = standIn(published);
  const backups = [];
  const png = fakePng(1200, 630);
  const result = await runSetScreenshot({
    uri: URI,
    png,
    fetchImpl: server.fetchImpl,
    ask: answers("y"),
    askHidden: async () => "app-pass",
    log: quiet,
    saveBackup: (name, text) => backups.push({ name, text }),
    now: () => new Date("2026-10-10T03:00:00Z"),
  });
  assert.equal(result.changed, true);
  assert.deepEqual(server.state.uploads, ["image/png"]);
  assert.equal(server.state.puts.length, 1, "no retry needed");
  assert.equal(server.state.puts[0].swapRecord, "bafyreioldrecordcid");
  assert.equal(server.state.puts[0].rkey, RKEY);

  const after = server.state.record;
  assert.equal(after.cid, await dagCborCid(after.tile), "manifest address matches its contents");
  assert.notEqual(after.cid, before.cid);
  assert.equal(after.createdAt, before.createdAt);
  const shot = after.tile.resources[SCREENSHOT_PATH];
  assert.deepEqual(shot.src, { $type: "blob", ref: { $link: await rawCid(png) }, mimeType: "image/png", size: png.length });
  assert.equal(shot["content-type"], "image/png");
  assert.deepEqual(after.tile.screenshots, [{ src: SCREENSHOT_PATH, type: "image/png", sizes: "1200x630" }]);
  const { resources: r1, screenshots: s1, ...rest1 } = after.tile;
  const { resources: r0, screenshots: s0, ...rest0 } = before.tile;
  assert.deepEqual(rest1, rest0, "name, icons, sizing, generator… unchanged");
  for (const p of Object.keys(r0)) assert.deepEqual(r1[p], r0[p], `${p} unchanged`);

  assert.equal(backups.length, 1);
  assert.equal(backups[0].name, "backup-3mxig2zz37cnt-2026-10-10T03-00-00-000Z.json");
  assert.deepEqual(JSON.parse(backups[0].text).value, before);
});

test("uses the server's own type when it already holds the bytes under another one", async () => {
  const published = await publishedTile();
  const png = fakePng(1200, 630);
  // As after appmosphe.re's failed attempt on a server that doesn't sniff: the bytes are held as octet-stream.
  published.blobs.set(await rawCid(png), { bytes: png, mimeType: "application/octet-stream" });
  const server = standIn(published);
  const result = await runSetScreenshot({ uri: URI, png, fetchImpl: server.fetchImpl, ask: answers("y"), askHidden: async () => "app-pass", log: quiet, saveBackup: quiet });
  assert.equal(result.changed, true);
  assert.equal(server.state.record.tile.resources[SCREENSHOT_PATH].src.mimeType, "application/octet-stream");
  assert.equal(server.state.record.cid, await dagCborCid(server.state.record.tile));
});

test("changes nothing when the answer is no, or the password is wrong", async () => {
  const published = await publishedTile();
  const before = structuredClone(published.record);
  const server = standIn(published);
  const png = fakePng(1200, 630);
  const r = await runSetScreenshot({ uri: URI, png, fetchImpl: server.fetchImpl, ask: answers("n"), askHidden: async () => "app-pass", log: quiet, saveBackup: () => assert.fail("no backup") });
  assert.equal(r.changed, false);
  await assert.rejects(
    runSetScreenshot({ uri: URI, png, fetchImpl: server.fetchImpl, ask: answers("y"), askHidden: async () => "wrong", log: quiet, saveBackup: quiet }),
    /Invalid identifier or password/,
  );
  assert.equal(server.state.puts.length, 0);
  assert.equal(server.state.uploads.length, 0);
  assert.deepEqual(server.state.record, before);
});

test("stops before asking anything when the manifest address doesn't recompute", async () => {
  const published = await publishedTile();
  published.record.cid = "bafyreisomethingelse";
  const server = standIn(published);
  await assert.rejects(
    runSetScreenshot({ uri: URI, png: fakePng(10, 10), fetchImpl: server.fetchImpl, ask: () => assert.fail("asked"), askHidden: () => assert.fail("asked"), log: quiet, saveBackup: quiet }),
    /doesn't recompute/,
  );
});

test("refuses a picture that isn't a PNG, and an address that isn't a tile", async () => {
  await assert.rejects(runSetScreenshot({ uri: URI, png: enc("<svg/>"), log: quiet }), /isn't a PNG/);
  await assert.rejects(runSetScreenshot({ uri: `at://${DID}/app.bsky.feed.post/abc`, png: fakePng(1, 1), log: quiet }), /tile's address/);
});

test("says so and stops when the tile already has that PNG", async () => {
  const published = await publishedTile();
  const png = fakePng(1200, 630);
  const server = standIn(published);
  await runSetScreenshot({ uri: URI, png, fetchImpl: server.fetchImpl, ask: answers("y"), askHidden: async () => "app-pass", log: quiet, saveBackup: quiet });
  const again = await runSetScreenshot({ uri: URI, png, fetchImpl: server.fetchImpl, ask: () => assert.fail("asked"), askHidden: () => assert.fail("asked"), log: quiet, saveBackup: quiet });
  assert.equal(again.changed, false);
});
