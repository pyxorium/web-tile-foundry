// Zine Scene v0.24.0: the creator's own ATMOSYNTH tiles on "A web tile" pages
// (claude/atmosynth-collab.md, "Host test"; claude/zine-maker-plan.md section 31).
// Also the core pieces the debug host test brought in, kept now it's gone:
// .css and .svg file types, and copies uploaded under the type the account's
// server already holds them under.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { fetchPublishedTile, copyPaths, jsonFile } from "../src/core/published-tile.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, zineConfig } from "../src/tile-types/zine/pages.js";
import {
  isAtmosynthTile, atmoPageRefs, atmoPatchInfo, atmoPatchUrl, tilePlacement, tileForReader, pieceRecipe, pieceReady,
  pieceFiles, tilePosterPath, tileSize, atmoFetched, ATMOSYNTH_PLATFORM,
} from "../src/tile-types/zine/piece.js";
import { READER_JS, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const OTHER = "did:plc:33k6yq7knpf5ecf532kdi5xy";
const PDS = "https://pds.example";
const RKEY = "3mxjqmsmemcl3";
const ADDRESS = `at://${DID}/ing.dasl.masl/${RKEY}`;
const enc = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function patchJson({ others = false } = {}) {
  return JSON.stringify({
    creatorDid: DID,
    patchId: "3mxjq5x6dtl2i",
    runsCommunityCode: true,
    patch: {
      name: "Blues Trio · 2 · Drums",
      moduleInstances: [
        { instanceId: "osc-sine", module: { authorDid: ATMOSYNTH_PLATFORM, moduleId: "osc-sine", versionKey: "v1" } },
        { instanceId: "reverb", module: { authorDid: ATMOSYNTH_PLATFORM, moduleId: "reverb", versionKey: "v1" } },
        ...(others ? [{ instanceId: "fuzz", module: { authorDid: OTHER, moduleId: "fuzz", versionKey: "v3" }, sampleSlotFills: { a: { ownerDid: OTHER, cid: "bafkreix" } } }] : []),
      ],
    },
    modules: {},
    slots: {},
  });
}

// A small tile shaped like an ATMOSYNTH export, published the way appmosphe.re
// publishes one: text files stored as octet-stream, the PNG as image/png.
const PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<script type="module" crossorigin src="./tile.js"></script>\n<link rel="stylesheet" crossorigin href="./tile.css">\n</head>\n<body></body>\n</html>\n';
function filesSpec(opts) {
  return {
    "/": [PAGE, "text/html", "application/octet-stream"],
    "/tile.js": ["var mark=`/assets/mark.svg`;Promise.all([fetch(`./patch.json`),fetch(`./tile.json`),fetch(`./samples.json`)]);", "text/javascript", "application/octet-stream"],
    "/tile.css": ["body{background:#0a0713}", "text/css", "application/octet-stream"],
    "/tile.json": ['{"controls":[]}', "application/json", "application/octet-stream"],
    "/patch.json": [patchJson(opts), "application/json", "application/octet-stream"],
    "/samples.json": ["{}", "application/json", "application/octet-stream"],
    "/assets/mark.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", "application/octet-stream"],
    "/screenshot.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", "application/octet-stream"],
    "/screenshot.png": [PNG, "image/png", "image/png"],
  };
}

async function stand({ generator = "ATMOSYNTH", others = false } = {}) {
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct, stored]] of Object.entries(filesSpec({ others }))) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, { bytes, mimeType: stored });
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: stored, size: bytes.length }, "content-type": ct };
  }
  const tile = { name: "Blues Trio · 2 · Drums", resources, screenshots: [{ src: "/screenshot.png" }], ...(generator ? { generator } : {}) };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, createdAt: "2026-10-10T15:00:00.000Z" };
  const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.host === "plc.directory") return json({ alsoKnownAs: ["at://pyxorium.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    if (u.pathname.endsWith("getRecord")) return json({ uri: ADDRESS, cid: "bafyreirecord", value });
    if (u.pathname.endsWith("getBlob")) {
      const b = blobs.get(u.searchParams.get("cid"));
      return b ? new Response(b.bytes) : new Response("no", { status: 404 });
    }
    return new Response("?", { status: 404 });
  };
  return { fetchImpl, blobs, manifest: tile };
}

/** A page's piece as the tile panel leaves it once the tile is copied. */
async function atmoPiece(opts = {}) {
  const server = await stand(opts);
  const pub = await fetchPublishedTile(ADDRESS, { fetchImpl: server.fetchImpl });
  return {
    server,
    piece: {
      kind: "tile", uri: pub.uri, cid: pub.cid, name: pub.manifest.name, did: pub.did, handle: pub.handle, own: true,
      maker: "atmosynth", atmo: atmoPatchInfo(jsonFile(pub.files, "/patch.json")), status: "ready", files: pub.files,
    },
  };
}

function zineWith(piece) {
  const pages = emptyPages();
  pages[1].layout = "tile";
  pages[1].piece = piece;
  pages[1].heading = "Drums alone";
  return { name: "Blues Trio", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, handle: "pyxorium.com", sprite: null, soundRights: false };
}

test(".css and .svg have fixed content types", () => {
  assert.equal(contentTypeFor("/tile.css"), "text/css");
  assert.equal(contentTypeFor("/assets/mark.svg"), "image/svg+xml");
});

test("a published tile's files carry the type the server stores them under, and copies keep it", async () => {
  const server = await stand();
  const pub = await fetchPublishedTile(ADDRESS, { fetchImpl: server.fetchImpl });
  const js = pub.files.find((f) => f.path === "/tile.js");
  assert.equal(js.contentType, "text/javascript");
  assert.equal(js.storedType, "application/octet-stream");
  const copies = copyPaths(pub.files, "/tiles/p1");
  assert.equal(copies.find((c) => c.path === "/tiles/p1/tile.css").storedType, "application/octet-stream");
  assert.equal(copies.find((c) => c.path === "/tiles/p1/screenshot.png").storedType, "image/png");
});

test("recognises ATMOSYNTH tiles, the addresses their page uses, and their poster", () => {
  assert.equal(isAtmosynthTile({ generator: "ATMOSYNTH" }), true);
  assert.equal(isAtmosynthTile("atmosynth"), true);
  assert.equal(isAtmosynthTile({}), false);
  assert.equal(isAtmosynthTile(null), false);
  assert.deepEqual(atmoPageRefs(PAGE, Object.keys(filesSpec())), [
    { ref: "./tile.js", path: "/tile.js" },
    { ref: "./tile.css", path: "/tile.css" },
  ]);
  assert.equal(tilePosterPath([{ path: "/screenshot.svg" }, { path: "/screenshot.png" }]), "/screenshot.png");
  assert.equal(tilePosterPath([{ path: "/screenshot.svg" }]), "/screenshot.svg");
  assert.equal(tilePosterPath([{ path: "/banner.png" }, { path: "/screenshot.png" }]), "/banner.png");
  assert.equal(tilePosterPath([]), null);
});

test("ATMOSYNTH tiles go on “A web tile” pages, not mixtape pages; others without a recipe still can't", () => {
  const getType = (id) => (id === "glass-lantern" ? glassLantern : undefined);
  const live = tilePlacement(null, getType, "live", "ATMOSYNTH");
  assert.equal(live.ok, true);
  assert.equal(live.type.title, "ATMOSYNTH patch");
  const tape = tilePlacement(null, getType, "tape", "ATMOSYNTH");
  assert.equal(tape.ok, false);
  assert.match(tape.reason, /A web tile/);
  assert.equal(tilePlacement(null, getType, "live", "").ok, false);
  assert.equal(tilePlacement(null, getType, "live", "SomethingElse").ok, false);
  // A Foundry tile is judged by its recipe as before.
  assert.equal(tilePlacement({ madeWith: "Web Tile Foundry", type: "glass-lantern", typeVersion: 1 }, getType, "live").ok, true);
});

test("reads a patch: its id, creator, other people's modules and samples, and a fork", () => {
  const own = atmoPatchInfo(JSON.parse(patchJson()));
  assert.deepEqual(own, { modules: [], samples: [], others: false, creator: DID, patchId: "3mxjq5x6dtl2i" });
  const mixed = atmoPatchInfo(JSON.parse(patchJson({ others: true })));
  assert.deepEqual(mixed.modules, [OTHER]);
  assert.deepEqual(mixed.samples, [OTHER]);
  assert.equal(mixed.others, true);
  // The creator's own community modules aren't "other people's".
  const mine = atmoPatchInfo({ creatorDid: DID, patch: { moduleInstances: [{ module: { authorDid: DID } }] } });
  assert.equal(mine.others, false);
  assert.deepEqual(mine.modules, [DID]);
  const fork = atmoPatchInfo({ patch: { forkedFrom: { uri: `at://${OTHER}/at.atmosynth.patch/3abc` } } });
  assert.equal(fork.forkedFrom, `at://${OTHER}/at.atmosynth.patch/3abc`);
  for (const odd of [null, "x", 5, { patch: { moduleInstances: "no" } }, { patchId: "bad id/../" }]) {
    assert.doesNotThrow(() => atmoPatchInfo(odd));
  }
  assert.equal(atmoPatchInfo({ patchId: "bad id/../" }).patchId, undefined);
  assert.equal(atmoPatchUrl(own), "https://atmosynth.at/patch/3mxjq5x6dtl2i");
  assert.equal(atmoPatchUrl({}), "https://atmosynth.at/");
});

test("the reader gets every file, the fetched files, the credit link and the poster; walled off only with other people's modules", async () => {
  const { piece } = await atmoPiece();
  assert.equal(pieceReady({ layout: "tile", piece }), true);
  const t = tileForReader({ layout: "tile", piece }, "p1");
  assert.equal(t.atmo, true);
  assert.equal(t.made, "ATMOSYNTH");
  assert.equal(t.page, "/tiles/p1/index.html");
  assert.equal(t.patchUrl, "https://atmosynth.at/patch/3mxjq5x6dtl2i");
  assert.equal(t.poster, "/tiles/p1/screenshot.png");
  assert.deepEqual(t.size, { w: 720, h: 520 }, "ATMOSYNTH's size when the tile names none");
  assert.deepEqual(tileForReader({ layout: "tile", piece: { ...piece, sizing: { width: 800, height: 600 } } }, "p1").size, { w: 800, h: 600 });
  assert.equal(t.by, ""); // the creator's own: not credited to themselves
  // Every file but the page, script and stylesheet (the older export: its three JSON files among them).
  assert.deepEqual(t.fetched, ["/tile.json", "/patch.json", "/samples.json", "/assets/mark.svg", "/screenshot.svg", "/screenshot.png"]);
  assert.deepEqual(t.refs, [{ ref: "./tile.js", path: "/tile.js" }, { ref: "./tile.css", path: "/tile.css" }]);
  assert.deepEqual(t.files.find((f) => f.path === "/assets/mark.svg"), { path: "/assets/mark.svg", src: "/tiles/p1/assets/mark.svg", type: "image/svg+xml" });
  assert.equal(t.files.some((f) => f.path === "/"), false);
  assert.equal(t.sealed, undefined);
  assert.equal(t.url, "https://lexicographer.space/@did:plc:rqbqpaaluty5v47jwciowpik/3mxjqmsmemcl3");

  const walled = tileForReader({ layout: "tile", piece: (await atmoPiece({ others: true })).piece }, "p1");
  assert.equal(walled.sealed, true);

  // Not ready without its patch.
  const noPatch = { ...piece, files: piece.files.filter((f) => f.path !== "/patch.json") };
  assert.equal(pieceReady({ layout: "tile", piece: noPatch }), false);
});

test("the recipe names the patch and whose modules and samples it uses", async () => {
  const { piece } = await atmoPiece({ others: true });
  const r = pieceRecipe({ layout: "tile", piece }, "p1");
  assert.equal(r.generator, "ATMOSYNTH");
  assert.equal(r.kind, "tile");
  assert.equal(r.folder, "/tiles/p1");
  assert.deepEqual(r.patch, { modules: [OTHER], samples: [OTHER], id: "3mxjq5x6dtl2i", creator: DID });
  assert.equal(r.sealed, true);
  assert.equal(r.type, undefined);
});

test("the credits sheet names ATMOSYNTH on the pages with a synth patch", async () => {
  const { piece } = await atmoPiece();
  const v = zineWith(piece);
  const config = zineConfig({ title: v.name, handle: v.handle, paper: v.paper, look: v.look, ink: v.ink, pages: v.pages, pageCount: 8, made: "October 2026", src: () => "" });
  const c = config.credits.find((x) => x.app === "ATMOSYNTH");
  assert.ok(c, "credited");
  assert.equal(c.what, "Synth patches");
  assert.equal(c.href, "https://atmosynth.at/");
  assert.equal(c.pages, "page 1");
  assert.equal(config.pages[1].tile.atmo, true);
});

test("builds a zine with an ATMOSYNTH tile: files copied byte for byte with their stored types, and it publishes first time", async () => {
  const { piece, server } = await atmoPiece();
  assert.deepEqual(pieceFiles({ layout: "tile", piece }, "p1").map((f) => f.path).sort(), Object.keys(filesSpec()).map((p) => (p === "/" ? "/tiles/p1/index.html" : `/tiles/p1${p}`)).sort());
  const result = await buildTile(zine, zineWith(piece), { final: false });
  for (const [path, [data, ct, stored]] of Object.entries(filesSpec())) {
    const to = path === "/" ? "/tiles/p1/index.html" : `/tiles/p1${path}`;
    const f = result.files.find((x) => x.path === to);
    assert.ok(f, `${to} copied`);
    assert.deepEqual(Buffer.from(f.bytes), Buffer.from(typeof data === "string" ? enc(data) : data));
    assert.equal(f.contentType, path === "/" ? "text/html" : ct);
    assert.equal(f.storedType, stored);
  }
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.pages[1].tile.generator, "ATMOSYNTH");

  // The zine goes to the same account the tile is in: its blobs are already there, stored as octet-stream.
  const stored = new Map([...server.blobs].map(([cid, b]) => [cid, b.mimeType]));
  const uploads = [];
  const creates = [];
  const xrpc = async (nsid, { body, contentType }) => {
    if (nsid === "com.atproto.repo.uploadBlob") {
      const bytes = new Uint8Array(body);
      const cid = await rawCid(bytes);
      const sniffed = bytes[0] === 0x89 ? "image/png" : null;
      if (!stored.has(cid)) stored.set(cid, sniffed || contentType);
      uploads.push([cid, contentType]);
      return { blob: { $type: "blob", ref: { $link: cid }, mimeType: stored.get(cid), size: bytes.length } };
    }
    if (nsid === "com.atproto.repo.createRecord") {
      creates.push(body);
      for (const r of Object.values(body.record.tile.resources)) {
        if (stored.get(r.src.ref.$link) !== r.src.mimeType) {
          const err = new Error(`Referenced Mimetype does not match stored blob. Expected: ${stored.get(r.src.ref.$link)}, Got: ${r.src.mimeType}`);
          err.error = "InvalidMimeType";
          throw err;
        }
      }
      return { uri: `at://${DID}/ing.dasl.masl/3newzine`, cid: "bafyreinew" };
    }
    if (nsid === "com.atproto.repo.getRecord") return { value: creates[creates.length - 1].record };
    throw new Error(nsid);
  };
  const files = new Map(result.files.map((f) => [f.cid, f.bytes]));
  const done = await publishTile({ xrpc, fetchBlob: async (cid) => files.get(cid), did: DID, result });
  assert.equal(creates.length, 1, "no retry needed");
  assert.equal(done.rkey, "3newzine");
  const res = creates[0].record.tile.resources;
  assert.equal(res["/tiles/p1/tile.js"]["content-type"], "text/javascript");
  assert.equal(res["/tiles/p1/tile.js"].src.mimeType, "application/octet-stream");
});

test("the reader's fetch helper answers the player's own JSON fetches and passes the rest on", () => {
  const src = /function atmoHelper\(map\) \{[\s\S]*?\n  \}/.exec(READER_JS);
  assert.ok(src, "the helper is in the reader");
  const make = vm.runInNewContext(`(${src[0]})`);
  const calls = [];
  const sandbox = { window: { fetch: (u) => { calls.push(u); return Promise.resolve(u); } } };
  vm.runInNewContext(make({ "/patch.json": "blob:x/1", "/tile.json": "blob:x/2</script>" }), sandbox);
  const w = sandbox.window;
  w.fetch("./patch.json");
  w.fetch("tile.json");
  w.fetch("/samples.json");
  w.fetch({ url: "./patch.json?v=2" });
  assert.deepEqual(calls, ["blob:x/1", "blob:x/2</script>", "/samples.json", "blob:x/1"]);
  // Never ends the <script> it's written into.
  assert.equal(make({ "/a.json": "</script>" }).includes("</script"), false);
});

test("a tile's size comes from its manifest, within bounds", () => {
  assert.deepEqual(tileSize({ width: 720, height: 520 }), { w: 720, h: 520 });
  assert.deepEqual(tileSize([640, 480]), { w: 640, h: 480 });
  assert.deepEqual(tileSize({ width: "8", height: 2 }), { w: 720, h: 520 }, "odd sizes fall back");
  assert.deepEqual(tileSize(null), { w: 720, h: 520 });
});

test("with words, a tile takes the room they leave (at least half the page); the player is scaled to fit", () => {
  assert.ok(READER_CSS.includes(".zp.tile-page.has-words .tilebox { flex: 1 1 auto; min-height: calc(var(--ph) * 0.5); }"));
  assert.ok(READER_CSS.includes(".zp.tile-page.has-words .words { flex: 0 1 auto; }"));
  assert.ok(READER_JS.includes("function fitAtmo(box, f, size)") && READER_JS.includes("me.ro.observe(box)") && READER_JS.includes("if (me.ro) me.ro.disconnect();"));
});

test("the reader script still parses with the ATMOSYNTH code in it", () => {
  assert.doesNotThrow(() => new vm.Script(READER_JS.replace(/\$\{[^}]*\}/g, "0")));
});
