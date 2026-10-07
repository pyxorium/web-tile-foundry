// Revising a published tape in place (scripts/revise-tape.mjs), against a
// stand-in account server, and the label style fix.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMixtapeTile } from "../src/tile-types/mixtape/tile.js";
import { reviseTape, configFromPage } from "../src/tile-types/mixtape/revise.js";
import { runRevision } from "../scripts/revise-tape.mjs";
import { buildManifest, buildRecord } from "../src/core/publish.js";
import { rawCid } from "../src/core/cid.js";
import { PLAYER_CSS } from "../src/tile-types/mixtape/runtime/player-css.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://pds.example";
const RKEY = "3mx7opazqwe2a";
const URI = `at://${DID}/ing.dasl.masl/${RKEY}`;
const TONE = new Uint8Array(readFileSync(new URL("./fixtures/audio/tone-a-96k-32k.mp3", import.meta.url)));

// A tape as the Foundry made it before the label fix: old page style.
async function publishedTape() {
  const tile = await makeMixtapeTile({
    name: "Parlor Greens Jam Cruise Set",
    description: "test cassette for tileman app",
    tape: { label: { text: "Parlor Greens jam" }, notes: "test cassette", madeBy: { handle: "pyxorium.com" } },
    sides: ["A", "B"],
    tracks: [{ id: "1", title: "Drop Top", side: "A", bytes: TONE }],
    runtime: "/* player */",
    art: { icon: new Uint8Array([1]), banner: new Uint8Array([2]) },
  });
  const page = tile.files.find((f) => f.path === "/");
  const oldHtml = new TextDecoder().decode(page.bytes).replace("font: 22px/1.35", "font: 22px/1.15");
  const files = tile.files.map((f) => (f.path === "/" ? { ...f, bytes: new TextEncoder().encode(oldHtml) } : f));
  const blobs = new Map();
  const refs = {};
  for (const f of files) {
    const cid = await rawCid(f.bytes);
    blobs.set(cid, f.bytes);
    refs[f.path] = { $type: "blob", ref: { $link: cid }, mimeType: f.contentType, size: f.bytes.length };
  }
  const manifest = buildManifest({ ...tile, files }, refs);
  const record = await buildRecord(manifest, "2026-10-06T15:00:00.000Z");
  return { record, blobs };
}

// A stand-in account server: public reads, sign-in, uploads, and putRecord with swapRecord.
function standIn({ record, blobs }) {
  const state = { record, recordCid: "bafyreioldrecordcidaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", puts: [], uploads: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === "plc.directory") {
      return json(200, { alsoKnownAs: ["at://pyxorium.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    }
    const nsid = u.pathname.replace("/xrpc/", "");
    if (nsid === "com.atproto.repo.getRecord") return json(200, { uri: URI, cid: state.recordCid, value: state.record });
    if (nsid === "com.atproto.sync.getBlob") {
      const b = blobs.get(u.searchParams.get("cid"));
      return b ? new Response(b) : json(404, { error: "BlobNotFound" });
    }
    if (nsid === "com.atproto.server.createSession") {
      const body = JSON.parse(init.body);
      return body.password === "app-pass" ? json(200, { did: DID, accessJwt: "jwt" }) : json(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
    }
    if (init.headers && init.headers.Authorization !== "Bearer jwt") return json(401, { error: "AuthMissing" });
    if (nsid === "com.atproto.repo.uploadBlob") {
      const bytes = new Uint8Array(init.body);
      const cid = await rawCid(bytes);
      blobs.set(cid, bytes);
      state.uploads.push(init.headers["Content-Type"]);
      return json(200, { blob: { $type: "blob", ref: { $link: cid }, mimeType: init.headers["Content-Type"], size: bytes.length } });
    }
    if (nsid === "com.atproto.repo.putRecord") {
      const body = JSON.parse(init.body);
      if (body.swapRecord !== state.recordCid) return json(400, { error: "InvalidSwap", message: "Record was at a different cid" });
      assert.equal(body.rkey, RKEY);
      assert.equal(body.validate, false);
      state.record = body.record;
      state.recordCid = "bafyreinewrecordcidaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      state.puts.push(body);
      return json(200, { uri: URI, cid: state.recordCid });
    }
    return json(404, { error: "NotFound" });
  };
  return { state, fetchImpl };
}

function answers(list) {
  const q = [...list];
  return async () => (q.length ? q.shift() : "");
}

test("the handwritten label is never clipped: no line clamp or hidden overflow, roomier lines", () => {
  const rule = /\.mt-label \{([^}]*)\}/.exec(PLAYER_CSS)[1];
  assert.ok(!/overflow:\s*hidden/.test(rule), rule);
  assert.ok(!/line-clamp/.test(rule), rule);
  assert.match(rule, /22px\/1\.35/);
});

test("revising keeps the songs and settings, changes only the words asked for, and refreshes the page style", async () => {
  const { record, blobs } = await publishedTape();
  const page = blobs.get(record.tile.resources["/"].src.ref.$link);
  const tapeFile = blobs.get(record.tile.resources["/tape.json"].src.ref.$link);
  const r = await reviseTape({ manifest: record.tile, page, tapeFile, edits: { description: "A mixtape C60 cassette for Tileman phone app", notes: "Songs from Jam Cruise 2026" } });
  assert.equal(r.manifest.description, "A mixtape C60 cassette for Tileman phone app");
  assert.deepEqual(r.files.map((f) => f.path), ["/", "/tape.json"]);
  const html = new TextDecoder().decode(r.files[0].bytes);
  assert.ok(html.includes("font: 22px/1.35"), "the page has the label fix");
  const cfg = configFromPage(html);
  assert.equal(cfg.tape.notes, "Songs from Jam Cruise 2026");
  assert.equal(cfg.artwork, "/icon.png");
  const before = JSON.parse(new TextDecoder().decode(tapeFile));
  assert.deepEqual(r.tape.sides, before.sides, "songs untouched");
  assert.deepEqual(r.tape.label, before.label);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(r.files[1].bytes)), r.tape);
  assert.equal(r.changes.length, 3);
  // Nothing asked for, page already current: nothing changes.
  const again = await reviseTape({ manifest: r.manifest, page: r.files[0].bytes, tapeFile: r.files[1].bytes, edits: {} });
  assert.deepEqual(again.files, []);
  assert.deepEqual(again.changes, []);
});

test("the script replaces the record at the same address, after a backup and a yes", async () => {
  const pub = await publishedTape();
  const server = standIn(pub);
  const backups = [];
  const out = [];
  const res = await runRevision({
    uri: URI,
    fetchImpl: server.fetchImpl,
    ask: answers(["A mixtape C60 cassette for Tileman phone app", "", "", "Songs from Jam Cruise 2026", "y"]),
    askHidden: async () => "app-pass",
    log: (s) => out.push(s),
    saveBackup: (name, text) => backups.push({ name, text }),
    now: () => new Date("2026-10-07T01:00:00Z"),
  });
  assert.equal(res.changed, true);
  assert.equal(server.state.puts.length, 1);
  assert.equal(backups.length, 1);
  assert.match(backups[0].name, /^backup-3mx7opazqwe2a-2026-10-07T01-00-00-000Z\.json$/);
  assert.deepEqual(JSON.parse(backups[0].text).value, pub.record);
  const tile = server.state.record.tile;
  assert.equal(tile.description, "A mixtape C60 cassette for Tileman phone app");
  assert.equal(tile.name, "Parlor Greens Jam Cruise Set");
  assert.equal(server.state.record.createdAt, "2026-10-06T15:00:00.000Z", "keeps when it was made");
  // Songs and card pictures point at the same files as before.
  for (const path of Object.keys(pub.record.tile.resources)) {
    if (path === "/" || path === "/tape.json") assert.notEqual(tile.resources[path].src.ref.$link, pub.record.tile.resources[path].src.ref.$link);
    else assert.deepEqual(tile.resources[path], pub.record.tile.resources[path]);
  }
  assert.deepEqual(server.state.uploads, ["text/html", "application/json"]);
  const tj = JSON.parse(new TextDecoder().decode(pub.blobs.get(tile.resources["/tape.json"].src.ref.$link)));
  assert.equal(tj.notes, "Songs from Jam Cruise 2026");
  assert.ok(out.some((l) => l.includes("Tileman shows Update")));
});

test("the script changes nothing without a yes, or with the wrong password", async () => {
  const pub = await publishedTape();
  const s1 = standIn(pub);
  const r1 = await runRevision({ uri: URI, fetchImpl: s1.fetchImpl, ask: answers(["new words", "", "", "", "n"]), askHidden: async () => "app-pass", log: () => {}, saveBackup: () => assert.fail("no backup without a yes") });
  assert.equal(r1.changed, false);
  assert.equal(s1.state.puts.length, 0);
  const s2 = standIn(await publishedTape());
  await assert.rejects(runRevision({ uri: URI, fetchImpl: s2.fetchImpl, ask: answers(["new words"]), askHidden: async () => "wrong", log: () => {}, saveBackup: () => {} }), /Invalid identifier or password/);
  assert.equal(s2.state.puts.length, 0);
  await assert.rejects(runRevision({ uri: "at://did:plc:x/app.bsky.feed.post/1", ask: answers([]), askHidden: async () => "", log: () => {}, saveBackup: () => {} }), /tape's address/);
});
