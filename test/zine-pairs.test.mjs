// Zine Scene v0.29.0: tiles that talk to each other inside a zine (wish/grant
// pairs), the zine's reader relaying (claude/zine-wish-pairs-plan.md). The
// stand-ins are shaped like the owner's demo tiles: Bob's cube and Alice's
// palette (the colour-scheme wish), and the two shared dice, whose model.glb is
// the same bytes stored under two types in the two accounts.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { fetchPublishedTile } from "../src/core/published-tile.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, zineConfig, pagesFor, pagesInUse } from "../src/tile-types/zine/pages.js";
import { appTileInfo } from "../src/tile-types/zine/piece.js";
import { tilePairs, pairChanges, cleanShortName, showsTile, SHORT_NAME_MAX } from "../src/tile-types/zine/pairs.js";
import { READER_JS } from "../src/tile-types/zine/runtime/reader.js";

const BOB = "did:plc:ro563p5faldqu44apudq44k4";
const ALICE = "did:plc:6vxjigxrqizmbo56gojxico3";
const enc = (s) => new TextEncoder().encode(s);
const OCTET = "application/octet-stream";
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 9, 9, 9, 9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 3]);
const PAGE = (name) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><script type="module">fetch("model.glb");</script></body></html>`;

async function demoPiece(did, rkey, name, spec) {
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct, stored]] of Object.entries(spec)) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, bytes);
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: stored, size: bytes.length }, "content-type": ct };
  }
  const tile = { name, resources };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile };
  const uri = `at://${did}/ing.dasl.masl/${rkey}`;
  const json = (b) => new Response(JSON.stringify(b));
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.host === "plc.directory") return json({ alsoKnownAs: ["at://example.test"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }] });
    if (u.pathname.endsWith("getRecord")) return json({ uri, cid: "bafyreirec" + rkey, value });
    return new Response(blobs.get(u.searchParams.get("cid")));
  };
  const pub = await fetchPublishedTile(uri, { fetchImpl });
  return {
    kind: "tile", uri: pub.uri, cid: pub.cid, name, did, handle: "example.test", own: true,
    maker: "app", app: appTileInfo(pub.manifest, pub.record), status: "ready", files: pub.files,
  };
}
const cube = () => demoPiece(BOB, "3mwm2n3mnr42m", "@proto Colorado -- Wish Demo Cube", {
  "/": [PAGE("cube"), "text/html", OCTET], "/model.glb": [new Uint8Array([1, 2, 3, 4]), "model/gltf-binary", "model/gltf-binary"], "/screenshot.png": [PNG, "image/png", "image/png"],
});
const palette = () => demoPiece(ALICE, "3mwm2sljdes2m", "Creative Collaborator -- Color Scheme Palette", {
  "/": [PAGE("palette"), "text/html", OCTET], "/screenshot.png": [PNG, "image/png", "image/png"],
});
const bobDie = () => demoPiece(BOB, "3mwr5sobinc2f", "@proto Colorado -- Shared Die", {
  "/": [PAGE("bob die"), "text/html", OCTET], "/model.glb": [GLB, "model/gltf-binary", OCTET], "/screenshot.png": [PNG, "image/png", "image/png"],
});
const aliceDie = () => demoPiece(ALICE, "3mwr6fpldri2m", "thunderbird.cafe -- Shared Die", {
  "/": [PAGE("alice die"), "text/html", OCTET], "/model.glb": [GLB, "model/gltf-binary", "model/gltf-binary"], "/screenshot.png": [PNG, "image/png", "image/png"],
});

/** The demo zine: pages 1-2 the colour scheme, 3-4 the die, each pair set as the panel sets it. */
async function demoValues() {
  let pages = emptyPages();
  const put = (id, piece) => { pages = pages.map((p) => (p.id === id ? { ...p, layout: "tile", piece } : p)); };
  put("p1", await cube());
  put("p2", await palette());
  put("p3", await bobDie());
  put("p4", await aliceDie());
  const apply = (changes) => { pages = pages.map((p) => (changes[p.id] ? { ...p, ...changes[p.id] } : p)); };
  apply(pairChanges(pages, "p1", "p2"));
  apply(pairChanges(pages, "p4", "p3"));
  apply({ p1: { shortName: "Bob" }, p2: { shortName: "Alice" }, p3: { shortName: "Bob" }, p4: { shortName: "Alice" } });
  return { name: "Tiles that talk", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, handle: "pyxorium.com", sprite: null, soundRights: false };
}
const pairsOf = (v) => tilePairs(pagesFor(v.pageCount), pagesInUse(v.pages, v.pageCount));
const configOf = (v) => zineConfig({ title: v.name, handle: v.handle, paper: v.paper, look: v.look, ink: v.ink, pages: v.pages, pageCount: v.pageCount, made: "October 2026", src: () => "" });

// ---- Pairing in the Foundry ----

test("pairing is mutual: set on one page, both change; a tile has one partner", () => {
  const tile = (id, extra = {}) => ({ id, layout: "tile", piece: { kind: "tile", uri: `at://x/${id}` }, ...extra });
  let pages = [tile("p1"), tile("p2"), tile("p3"), tile("p4")];
  const apply = (c) => { pages = pages.map((p) => (c[p.id] ? { ...p, ...c[p.id] } : p)); };
  assert.deepEqual(pairChanges(pages, "p1", "p2"), { p1: { talksTo: "p2" }, p2: { talksTo: "p1" } });
  apply(pairChanges(pages, "p1", "p2"));
  apply(pairChanges(pages, "p3", "p4"));
  // p1 now talks to p3: p2 and p4 are let go.
  assert.deepEqual(pairChanges(pages, "p1", "p3"), { p2: { talksTo: null }, p4: { talksTo: null }, p1: { talksTo: "p3" }, p3: { talksTo: "p1" } });
  apply(pairChanges(pages, "p1", "p3"));
  assert.deepEqual(pages.map((p) => p.talksTo || null), ["p3", null, "p1", null]);
  // Nobody: both sides end.
  assert.deepEqual(pairChanges(pages, "p3", ""), { p1: { talksTo: null }, p3: { talksTo: null } });
  assert.deepEqual(pairChanges(pages, "p3", "p3"), {}, "not with itself");
});

test("a pair counts only while it's mutual, both pages are in use and both show a tile", async () => {
  const v = await demoValues();
  assert.deepEqual([...pairsOf(v)].sort(), [["p1", "p2"], ["p2", "p1"], ["p3", "p4"], ["p4", "p3"]]);
  // A 4-page zine puts pages 3 and 4 aside: their pair doesn't count.
  assert.deepEqual([...pairsOf({ ...v, pageCount: 4 })].sort(), [["p1", "p2"], ["p2", "p1"]]);
  // The palette's page gets another layout: the colour-scheme pair ends quietly.
  const off = v.pages.map((p) => (p.id === "p2" ? { ...p, layout: "words" } : p));
  assert.equal(pairsOf({ ...v, pages: off }).has("p1"), false);
  assert.equal(showsTile(off[2]), false);
  // One-sided: ignored.
  const one = v.pages.map((p) => (p.id === "p2" ? { ...p, talksTo: null } : p));
  assert.equal(pairsOf({ ...v, pages: one }).has("p1"), false);
  // And the building still works, with no problems for it.
  const result = await buildTile(zine, { ...v, pages: off }, { final: false });
  assert.ok(result.files.length > 0);
});

test("short names are one short line", () => {
  assert.equal(cleanShortName("  Bob\n the\u0000 builder  "), "Bob the builder");
  assert.equal(cleanShortName("x".repeat(40)).length, SHORT_NAME_MAX);
  assert.equal(cleanShortName(null), "");
});

// ---- The reader's config and the recipe ----

test("the reader learns each paired tile's partner and short name", async () => {
  const v = await demoValues();
  const config = configOf(v);
  const tile = (id) => config.pages.find((p) => p.id === id).tile;
  assert.equal(tile("p1").pair, "p2");
  assert.equal(tile("p2").pair, "p1");
  assert.equal(tile("p3").pair, "p4");
  assert.equal(tile("p1").short, "Bob");
  assert.equal(tile("p4").short, "Alice");
  // No short name: none in the config (the captions say "the tile on p. 2").
  const plain = configOf({ ...v, pages: v.pages.map((p) => ({ ...p, shortName: "" })) });
  assert.equal(plain.pages.find((p) => p.id === "p2").tile.short, undefined);
  // A tile still being copied isn't in the reader, and neither is its pair.
  const loading = v.pages.map((p) => (p.id === "p2" ? { ...p, piece: { ...p.piece, status: "loading" } } : p));
  const c2 = configOf({ ...v, pages: loading });
  assert.equal(c2.pages.find((p) => p.id === "p1").tile.pair, undefined);
  assert.equal(c2.pages.find((p) => p.id === "p3").tile.pair, "p4");
  // No credits for pairs; hand-made tiles that name no app aren't credited.
  assert.equal(config.credits, undefined);
});

test("the recipe records each pair and short name", async () => {
  const v = await demoValues();
  const result = await buildTile(zine, v, { final: false });
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  const pages = recipe.inputs.pages;
  assert.deepEqual([pages[1].tile.talksTo, pages[1].tile.shortName], ["p2", "Bob"]);
  assert.deepEqual([pages[2].tile.talksTo, pages[2].tile.shortName], ["p1", "Alice"]);
  assert.deepEqual([pages[4].tile.talksTo, pages[4].tile.shortName], ["p3", "Alice"]);
  assert.equal(pages[5].tile, undefined);
});

test("the die's model, the same bytes under two stored types, publishes under the type the server reports", async () => {
  const v = await demoValues();
  const result = await buildTile(zine, v, { final: false });
  const a = result.files.find((f) => f.path === "/tiles/p3/model.glb");
  const b = result.files.find((f) => f.path === "/tiles/p4/model.glb");
  assert.equal(a.cid, b.cid, "the same bytes");
  assert.deepEqual([a.storedType, b.storedType], [OCTET, "model/gltf-binary"]);
  // Publishing to an account that already holds them as octet-stream (Bob's), and to a fresh one.
  for (const first of [OCTET, null]) {
    const stored = new Map(first ? [[a.cid, first]] : []);
    const creates = [];
    const xrpc = async (nsid, { body, contentType }) => {
      if (nsid === "com.atproto.repo.uploadBlob") {
        const bytes = new Uint8Array(body);
        const cid = await rawCid(bytes);
        if (!stored.has(cid)) stored.set(cid, contentType);
        return { blob: { $type: "blob", ref: { $link: cid }, mimeType: stored.get(cid), size: bytes.length } };
      }
      if (nsid === "com.atproto.repo.createRecord") {
        creates.push(body);
        for (const r of Object.values(body.record.tile.resources)) {
          if (stored.get(r.src.ref.$link) !== r.src.mimeType) { const e = new Error("mismatch"); e.error = "InvalidMimeType"; throw e; }
        }
        return { uri: `at://${BOB}/ing.dasl.masl/3newzine`, cid: "bafyreinew" };
      }
      if (nsid === "com.atproto.repo.getRecord") return { value: creates[creates.length - 1].record };
      throw new Error(nsid);
    };
    const files = new Map(result.files.map((f) => [f.cid, f.bytes]));
    await publishTile({ xrpc, fetchBlob: async (cid) => files.get(cid), did: BOB, result });
    assert.equal(creates.length, 1);
    const res = creates[0].record.tile.resources;
    assert.equal(res["/tiles/p3/model.glb"].src.mimeType, res["/tiles/p4/model.glb"].src.mimeType);
    assert.equal(res["/tiles/p4/model.glb"]["content-type"], "model/gltf-binary");
  }
});

// ---- The reader ----

test("the reader relays between paired tiles, keeps them running, and words the captions", () => {
  assert.match(READER_JS, /function partnerId\(id\)/);
  assert.match(READER_JS, /d\.kind === "hello"/);
  assert.match(READER_JS, /kind: "presence", state: present\(partnerId\(id\)\) \? "present" : "gone"/);
  assert.match(READER_JS, /kind: "rtt", ms: 0/);
  assert.match(READER_JS, /!partnerId\(id\)\) stopTile\(id\)/, "paired tiles aren't stopped off the page");
  assert.match(READER_JS, /"Message sent"/);
  assert.match(READER_JS, /"Go to " \+ tileWords\(to\) \+ " →"/);
  assert.match(READER_JS, /"From " \+ tileWords\(to\)/);
  assert.match(READER_JS, /"the back"/);
  assert.match(READER_JS, /short \+ "'s tile \(" \+ pageWords\(id\) \+ "\)" : "the tile on " \+ pageWords\(id\)/);
  assert.doesNotThrow(() => new Function(READER_JS));
});
