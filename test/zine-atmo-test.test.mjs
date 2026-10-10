// The debug-only ATMOSYNTH host test (src/tile-types/zine-atmo-test/), and the
// core changes it needs: .css and .svg file types, and copies of a published
// tile uploaded under the type the account's server already holds them under.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { zineAtmoTest, isAtmosynthTile, atmoPageRefs, FETCHED } from "../src/tile-types/zine-atmo-test/index.js";
import { fetchHelperSource, renderAtmoTestHtml } from "../src/tile-types/zine-atmo-test/template.js";
import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { fetchPublishedTile, copyPaths } from "../src/core/published-tile.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://pds.example";
const RKEY = "3mxig2zz37cnt";
const ADDRESS = `at://${DID}/ing.dasl.masl/${RKEY}`;
const enc = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// A small tile shaped like an ATMOSYNTH export, published the way appmosphe.re
// publishes one: text files stored as octet-stream, the PNG as image/png.
const PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<script type="module" crossorigin src="./tile.js"></script>\n<link rel="stylesheet" crossorigin href="./tile.css">\n</head>\n<body></body>\n</html>\n';
const FILES = {
  "/": [PAGE, "text/html", "application/octet-stream"],
  "/tile.js": ["var mark=`/assets/mark.svg`;Promise.all([fetch(`./patch.json`),fetch(`./tile.json`),fetch(`./samples.json`)]);", "text/javascript", "application/octet-stream"],
  "/tile.css": ["body{background:#0a0713}", "text/css", "application/octet-stream"],
  "/tile.json": ['{"controls":[]}', "application/json", "application/octet-stream"],
  "/patch.json": ['{"patch":{}}', "application/json", "application/octet-stream"],
  "/samples.json": ["{}", "application/json", "application/octet-stream"],
  "/assets/mark.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", "application/octet-stream"],
  "/screenshot.png": [PNG, "image/png", "image/png"],
};

async function stand(generator = "ATMOSYNTH") {
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct, stored]] of Object.entries(FILES)) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, { bytes, mimeType: stored });
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: stored, size: bytes.length }, "content-type": ct };
  }
  const tile = { name: "Twinkle Little Star", resources, screenshots: [{ src: "/screenshot.png" }], ...(generator ? { generator } : {}) };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, createdAt: "2026-10-10T02:13:34.668Z" };
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
  return { fetchImpl, blobs };
}

/** Builds the test tile with the global fetch pointed at a stand-in account. */
async function buildWith(server, address = ADDRESS) {
  const real = globalThis.fetch;
  globalThis.fetch = server.fetchImpl;
  try {
    return await buildTile(zineAtmoTest, { name: "ATMOSYNTH zine test", address, description: "" });
  } finally {
    globalThis.fetch = real;
  }
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
  const copies = copyPaths(pub.files, "/t1");
  assert.equal(copies.find((c) => c.path === "/t1/tile.css").storedType, "application/octet-stream");
  assert.equal(copies.find((c) => c.path === "/t1/screenshot.png").storedType, "image/png");
});

test("recognises ATMOSYNTH tiles and the addresses their page uses", () => {
  assert.equal(isAtmosynthTile({ generator: "ATMOSYNTH" }), true);
  assert.equal(isAtmosynthTile({ generator: "atmosynth" }), true);
  assert.equal(isAtmosynthTile({}), false);
  assert.equal(isAtmosynthTile(null), false);
  assert.deepEqual(atmoPageRefs(PAGE, Object.keys(FILES)), [
    { ref: "./tile.js", path: "/tile.js" },
    { ref: "./tile.css", path: "/tile.css" },
  ]);
});

test("builds the test tile: every file copied byte for byte under /t1/, with its stored type", async () => {
  const server = await stand();
  const r = await buildWith(server);
  for (const [path, [data, ct, stored]] of Object.entries(FILES)) {
    const to = path === "/" ? "/t1/index.html" : `/t1${path}`;
    const f = r.files.find((x) => x.path === to);
    assert.ok(f, `${to} copied`);
    assert.deepEqual(Buffer.from(f.bytes), Buffer.from(typeof data === "string" ? enc(data) : data));
    assert.equal(f.contentType, path === "/" ? "text/html" : ct);
    assert.equal(f.storedType, stored);
  }
  assert.deepEqual(r.screenshots, [{ src: "/t1/screenshot.png" }]);
  const recipe = JSON.parse(new TextDecoder().decode(r.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.type, "zine-atmo-test");
  assert.deepEqual(recipe.inputs.tile, { uri: ADDRESS, cid: "bafyreirecord", generator: "ATMOSYNTH" });

  // The page's config, and its scripts parse.
  const html = new TextDecoder().decode(r.files.find((f) => f.path === "/").bytes);
  const config = JSON.parse(/<script type="application\/json" id="test-config">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(config.tile.page, "/t1/index.html");
  assert.deepEqual(config.tile.fetched, FETCHED);
  assert.deepEqual(config.tile.refs.map((x) => x.ref), ["./tile.js", "./tile.css"]);
  assert.equal(config.tile.types["/assets/mark.svg"], "image/svg+xml");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.doesNotThrow(() => new vm.Script(s));
});

test("refuses a tile that wasn't made by ATMOSYNTH", async () => {
  const server = await stand(null);
  await assert.rejects(buildWith(server, `at://${DID}/ing.dasl.masl/3notatmosynth`), /wasn.t made by ATMOSYNTH/);
});

test("the fetch helper answers the player's own JSON fetches and passes the rest on", async () => {
  const calls = [];
  const sandbox = { window: null };
  sandbox.window = { fetch: (u) => { calls.push(u); return Promise.resolve(u); } };
  vm.runInNewContext(fetchHelperSource({ "/patch.json": "blob:x/1", "/tile.json": "blob:x/2" }), sandbox);
  const w = sandbox.window;
  await w.fetch("./patch.json");
  await w.fetch("tile.json");
  await w.fetch("/samples.json");
  await w.fetch({ url: "./patch.json" });
  assert.deepEqual(calls, ["blob:x/1", "blob:x/2", "/samples.json", "blob:x/1"]);
  assert.deepEqual([...w.__atmoFetches], ["/patch.json", "/tile.json", "/patch.json"]);
});

test("publishing uploads each copied file under its stored type, so the record goes through first time", async () => {
  const server = await stand();
  const result = await buildWith(server);
  const stored = new Map([...server.blobs].map(([cid, b]) => [cid, b.mimeType])); // the account already holds the tile's blobs
  const uploads = [];
  const creates = [];
  const xrpc = async (nsid, { body, contentType, params }) => {
    if (nsid === "com.atproto.repo.uploadBlob") {
      const bytes = new Uint8Array(body);
      const cid = await rawCid(bytes);
      const sniffed = bytes[0] === 0x89 ? "image/png" : null;
      if (!stored.has(cid)) stored.set(cid, sniffed || contentType);
      uploads.push([cid, contentType]);
      return { blob: { $type: "blob", ref: { $link: cid }, mimeType: sniffed || contentType, size: bytes.length } };
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
      return { uri: `at://${DID}/ing.dasl.masl/3newtest`, cid: "bafyreinew" };
    }
    if (nsid === "com.atproto.repo.getRecord") return { value: creates[creates.length - 1].record };
    throw new Error(nsid);
  };
  const files = new Map(result.files.map((f) => [f.cid, f.bytes]));
  const done = await publishTile({ xrpc, fetchBlob: async (cid) => files.get(cid), did: DID, result });
  assert.equal(creates.length, 1, "no retry needed");
  assert.equal(done.rkey, "3newtest");
  const typeOf = new Map(uploads);
  for (const f of result.files) {
    assert.equal(typeOf.get(f.cid), f.storedType || f.contentType, `${f.path} uploaded under its stored type`);
  }
  // The record still names each file's real type for the loader.
  const res = creates[0].record.tile.resources;
  assert.equal(res["/t1/tile.js"]["content-type"], "text/javascript");
  assert.equal(res["/t1/tile.js"].src.mimeType, "application/octet-stream");
});

test("the page names the tile and escapes its title", () => {
  const html = renderAtmoTestHtml({ title: "A <test>", config: { title: "A <test>", folder: "/t1", tile: { name: "T & U", by: "@me", uri: ADDRESS, page: "/t1/index.html", refs: [], fetched: [], types: {} } } });
  assert.match(html, /<title>A &lt;test&gt;<\/title>/);
  assert.match(html, /T &amp; U by @me/);
});
