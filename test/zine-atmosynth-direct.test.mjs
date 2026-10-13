// Zine Scene v0.27.0: ATMOSYNTH tiles published straight from atmosynth.at
// (claude/atmosynth-direct-publish-handoff.md). Unlike the older export made for
// appmosphe.re's uploader, these carry web fonts (loaded with url(./fonts/…) in
// their stylesheet) and their licence, each sample as its own FLAC file under
// /samples/ (no samples.json), a real PNG screenshot, and their real file types
// as stored types. Shaped like the owner's test tile "foundry flac test"
// (at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3mxrzb3tiyu2p).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { fetchPublishedTile, copyPaths, jsonFile } from "../src/core/published-tile.js";
import {
  CONTENT_TYPES, COPY_ALIASES, contentTypeFor, copyTypeAccepts, bareType, extensionOf, hasContentType, makeFile,
} from "../src/core/fileset.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages } from "../src/tile-types/zine/pages.js";
import {
  atmoPatchInfo, tileForReader, pieceReady, pieceFiles, tilePosterPath, tileSize, atmoFetched, tilePlacement,
} from "../src/tile-types/zine/piece.js";
import { READER_JS } from "../src/tile-types/zine/runtime/reader.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://pds.example";
const RKEY = "3mxrzb3tiyu2p";
const ADDRESS = `at://${DID}/ing.dasl.masl/${RKEY}`;
const SAMPLE = "/samples/bafkreidqecq4mqqhvwhgabrnkqaocmzl2b6zlo2zzsbk6louwojuprskoy.flac";
const enc = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const FLAC = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 34, 1, 2, 3]); // "fLaC" …
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 5]); // "wOF2" …
const WOFF2_EXT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 6]);

const PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<script type="module" crossorigin src="./tile.js"></script>\n<link rel="stylesheet" crossorigin href="./tile.css">\n</head>\n<body></body>\n</html>\n';
const CSS = "@font-face{font-family:Michroma;src:url(./fonts/michroma-latin-v21.woff2)format(\"woff2\")}" +
  "@font-face{font-family:Michroma;src:url(./fonts/michroma-latin-ext-v21.woff2)format(\"woff2\")}" +
  ".tile{background:#0a0713}";
const JS = `var mark=\`/assets/mark.svg\`;fetch("./patch.json");fetch("./tile.json");fetch("./samples/"+"bafkreidqecq4mqqhvwhgabrnkqaocmzl2b6zlo2zzsbk6louwojuprskoy"+".flac");`;
const PATCH = JSON.stringify({ creatorDid: DID, patchId: RKEY, patch: { name: "foundry flac test", moduleInstances: [] }, slots: {} });

/** The files of a direct-publish tile: [data, declared type, stored type]. */
function directSpec({ flacType = "audio/flac", flacStored = null } = {}) {
  return {
    "/": [PAGE, "text/html", "text/html"],
    "/tile.js": [JS, "text/javascript", "text/javascript"],
    "/tile.css": [CSS, "text/css", "text/css"],
    "/tile.json": ['{"view":"roll","controls":[]}', "application/json", "application/json"],
    "/patch.json": [PATCH, "application/json", "application/json"],
    "/icon.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", "image/svg+xml"],
    "/screenshot.png": [PNG, "image/png", "image/png"],
    "/assets/mark.svg": ["<svg xmlns='http://www.w3.org/2000/svg' id='m'/>", "image/svg+xml", "image/svg+xml"],
    "/fonts/michroma-latin-v21.woff2": [WOFF2, "font/woff2", "font/woff2"],
    "/fonts/michroma-latin-ext-v21.woff2": [WOFF2_EXT, "font/woff2", "font/woff2"],
    "/fonts/OFL.txt": ["Copyright 2011 The Michroma Project Authors. SIL Open Font License 1.1", "text/plain", "text/plain"],
    [SAMPLE]: [FLAC, flacType, flacStored || flacType],
  };
}

async function stand(opts = {}) {
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct, stored]] of Object.entries(directSpec(opts))) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, { bytes, mimeType: stored });
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: stored, size: bytes.length }, "content-type": ct };
  }
  const tile = {
    name: "foundry flac test", icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }], sizing: { height: 520 },
    generator: "ATMOSYNTH", resources, categories: ["music"],
    screenshots: [{ src: "/screenshot.png", type: "image/png", sizes: "1200x630" }],
  };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, patch: `at://${DID}/at.atmosynth.patch/${RKEY}`, createdAt: "2026-10-13T21:56:08.473Z" };
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

async function directPiece(opts = {}) {
  const server = await stand(opts);
  const pub = await fetchPublishedTile(ADDRESS, { fetchImpl: server.fetchImpl });
  return {
    server, pub,
    piece: {
      kind: "tile", uri: pub.uri, cid: pub.cid, name: pub.manifest.name, did: pub.did, handle: pub.handle, own: true,
      maker: "atmosynth", atmo: atmoPatchInfo(jsonFile(pub.files, "/patch.json")), sizing: pub.manifest.sizing, status: "ready", files: pub.files,
    },
  };
}

function zineWith(piece) {
  const pages = emptyPages();
  pages[1].layout = "tile";
  pages[1].piece = piece;
  pages[1].heading = "A test patch";
  return { name: "Synth test", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, handle: "pyxorium.com", sprite: null, soundRights: false };
}

// ---- File types ----

test("fonts, sounds and text have fixed types; the Foundry's own files use only those", () => {
  assert.equal(contentTypeFor("/fonts/a.woff2"), "font/woff2");
  assert.equal(contentTypeFor("/fonts/a.woff"), "font/woff");
  assert.equal(contentTypeFor("/fonts/a.ttf"), "font/ttf");
  assert.equal(contentTypeFor("/fonts/a.otf"), "font/otf");
  assert.equal(contentTypeFor(SAMPLE), "audio/flac");
  assert.equal(contentTypeFor("/samples/a.WAV"), "audio/wav");
  assert.equal(contentTypeFor("/samples/a.ogg"), "audio/ogg");
  assert.equal(contentTypeFor("/fonts/OFL.txt"), "text/plain");
  assert.equal(makeFile("/fonts/OFL.txt", "x").contentType, "text/plain");
  assert.throws(() => contentTypeFor("/fonts/a.eot"), /No content type is defined/);
  // Every other name belongs to an extension the Foundry knows.
  for (const ext of Object.keys(COPY_ALIASES)) assert.ok(CONTENT_TYPES[ext], ext);
});

test("extensions are read from the file's name; a declared type is compared without its parameters", () => {
  assert.equal(extensionOf("/"), ".html");
  assert.equal(extensionOf("/fonts/A.WOFF2"), ".woff2");
  assert.equal(extensionOf("/some.folder/file"), "");
  assert.equal(extensionOf("/.hidden"), "");
  assert.equal(hasContentType("/samples/x.flac"), true);
  assert.equal(hasContentType("/samples/x.aiff"), false);
  assert.equal(bareType(" Text/Plain; charset=utf-8 "), "text/plain");
  assert.equal(bareType(undefined), "");
});

test("copying accepts other common names for the same fonts and sounds, and nothing from another family", () => {
  assert.equal(copyTypeAccepts("/t/x.flac", "audio/flac"), true);
  assert.equal(copyTypeAccepts("/t/x.flac", "audio/x-flac"), true);
  assert.equal(copyTypeAccepts("/t/x.wav", "audio/x-wav"), true);
  assert.equal(copyTypeAccepts("/t/x.wav", "audio/wave"), true);
  assert.equal(copyTypeAccepts("/t/x.ttf", "application/x-font-ttf"), true);
  assert.equal(copyTypeAccepts("/t/x.woff", "application/font-woff"), true);
  assert.equal(copyTypeAccepts("/t/x.txt", "text/plain; charset=utf-8"), true);
  assert.equal(copyTypeAccepts("/t/x.woff2", "text/javascript"), false);
  assert.equal(copyTypeAccepts("/t/x.woff2", "text/html"), false);
  assert.equal(copyTypeAccepts("/t/x.flac", "audio/mpeg"), false);
  assert.equal(copyTypeAccepts("/t/x.txt", "text/html"), false);
  // Older kinds are unchanged: one name only.
  assert.equal(copyTypeAccepts("/t/x.js", "application/javascript"), false);
});

test("a copy is listed under the Foundry's type and uploaded under the type the account already holds", () => {
  const bytes = enc("x");
  const [held] = copyPaths([{ path: "/a.flac", bytes, contentType: "audio/x-flac", storedType: "audio/x-flac" }], "/t1");
  assert.deepEqual({ path: held.path, contentType: held.contentType, storedType: held.storedType }, { path: "/t1/a.flac", contentType: "audio/flac", storedType: "audio/x-flac" });
  // No stored type known: the name the tile declared it under.
  const [declared] = copyPaths([{ path: "/a.wav", bytes, contentType: "audio/x-wav" }], "/t1");
  assert.equal(declared.contentType, "audio/wav");
  assert.equal(declared.storedType, "audio/x-wav");
  // The Foundry's own name: nothing extra.
  const [plain] = copyPaths([{ path: "/a.woff2", bytes, contentType: "font/woff2" }], "/t1");
  assert.equal(plain.storedType, undefined);
  // A kind of file the Foundry doesn't know: said plainly.
  assert.throws(() => copyPaths([{ path: "/fonts/a.eot", bytes, contentType: "application/vnd.ms-fontobject" }], "/tiles/p1"),
    /The tile's file \/fonts\/a\.eot is a kind of file the Foundry can't copy yet\./);
  assert.throws(() => copyPaths([{ path: "/a.woff2", bytes, contentType: "text/javascript" }], "/t1"), /can't be copied as font\/woff2/);
});

// ---- The direct-publish tile on a zine page ----

test("a direct-publish tile is read with its real stored types, and every file can be copied (the error Sebastian saw is gone)", async () => {
  const { pub } = await directPiece();
  assert.equal(pub.files.find((f) => f.path === SAMPLE).storedType, "audio/flac");
  assert.equal(pub.files.find((f) => f.path === "/fonts/michroma-latin-v21.woff2").contentType, "font/woff2");
  const copies = copyPaths(pub.files, "/tiles/p1");
  assert.equal(copies.length, Object.keys(directSpec()).length);
  assert.equal(copies.find((c) => c.path === `/tiles/p1${SAMPLE}`).contentType, "audio/flac");
  assert.equal(copies.find((c) => c.path === "/tiles/p1/fonts/OFL.txt").contentType, "text/plain");
  // It goes on "A web tile" pages like the older export.
  assert.equal(tilePlacement(null, () => undefined, "live", pub.manifest.generator).ok, true);
});

test("ready without samples.json; the reader gets every file, answers fetches for all but the page's code, and shows its PNG screenshot", async () => {
  const { piece } = await directPiece();
  assert.equal(pieceReady({ layout: "tile", piece }), true);
  const t = tileForReader({ layout: "tile", piece }, "p1");
  assert.equal(t.atmo, true);
  assert.deepEqual(t.refs, [{ ref: "./tile.js", path: "/tile.js" }, { ref: "./tile.css", path: "/tile.css" }]);
  assert.ok(t.fetched.includes(SAMPLE), "the sample");
  assert.ok(t.fetched.includes("/patch.json") && t.fetched.includes("/tile.json"));
  assert.ok(t.fetched.includes("/fonts/michroma-latin-v21.woff2"));
  assert.equal(t.fetched.includes("/samples.json"), false);
  assert.equal(t.fetched.includes("/tile.js") || t.fetched.includes("/tile.css") || t.fetched.includes("/"), false);
  assert.deepEqual(t.files.find((f) => f.path === SAMPLE), { path: SAMPLE, src: `/tiles/p1${SAMPLE}`, type: "audio/flac" });
  assert.equal(t.poster, "/tiles/p1/screenshot.png");
  assert.equal(tilePosterPath(piece.files), "/screenshot.png");
  assert.deepEqual(t.size, { w: 720, h: 520 }, "only a height given: the usual width");
  assert.deepEqual(tileSize({ height: 400 }), { w: 720, h: 400 });
  assert.deepEqual(atmoFetched(["/", "/a.js", "/b.CSS", "/c.json", "/d.flac"]), ["/c.json", "/d.flac"]);
});

test("builds a zine with a direct-publish tile, copied byte for byte, and publishes first time", async () => {
  const { piece, server } = await directPiece({ flacType: "audio/x-flac" });
  const spec = directSpec({ flacType: "audio/x-flac" });
  assert.deepEqual(pieceFiles({ layout: "tile", piece }, "p1").map((f) => f.path).sort(),
    Object.keys(spec).map((p) => (p === "/" ? "/tiles/p1/index.html" : `/tiles/p1${p}`)).sort());
  const result = await buildTile(zine, zineWith(piece), { final: false });
  for (const [path, [data, , stored]] of Object.entries(spec)) {
    const to = path === "/" ? "/tiles/p1/index.html" : `/tiles/p1${path}`;
    const f = result.files.find((x) => x.path === to);
    assert.ok(f, `${to} copied`);
    assert.deepEqual(Buffer.from(f.bytes), Buffer.from(typeof data === "string" ? enc(data) : data));
    assert.equal(f.contentType, contentTypeFor(to));
    assert.equal(f.storedType, stored);
  }
  // Published to the same account: every blob is already there under its stored type.
  const stored = new Map([...server.blobs].map(([cid, b]) => [cid, b.mimeType]));
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
        if (stored.get(r.src.ref.$link) !== r.src.mimeType) {
          const err = new Error("Referenced Mimetype does not match stored blob");
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
  await publishTile({ xrpc, fetchBlob: async (cid) => files.get(cid), did: DID, result });
  assert.equal(creates.length, 1, "no retry needed");
  const res = creates[0].record.tile.resources;
  assert.equal(res[`/tiles/p1${SAMPLE}`]["content-type"], "audio/flac");
  assert.equal(res[`/tiles/p1${SAMPLE}`].src.mimeType, "audio/x-flac");
  assert.equal(res["/tiles/p1/fonts/michroma-latin-v21.woff2"]["content-type"], "font/woff2");
});

// ---- The reader's helper and stylesheet addresses ----

function readerFunction(name) {
  const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`).exec(READER_JS);
  assert.ok(m, `${name} is in the reader`);
  return m[0];
}

test("the fetch helper answers the player's fetch of any of the tile's files, in any form, and passes the rest on", () => {
  const make = vm.runInNewContext(`(${readerFunction("atmoHelper")})`);
  const calls = [];
  const sandbox = { URL, window: { fetch: (u) => { calls.push(u); return Promise.resolve(u); } } };
  vm.runInNewContext(make({ [SAMPLE]: "blob:z/flac", "/patch.json": "blob:z/patch", "/fonts/a b.woff2": "blob:z/font" }), sandbox);
  const w = sandbox.window;
  w.fetch(`.${SAMPLE}`);
  w.fetch(SAMPLE.slice(1));
  w.fetch(`${SAMPLE}?x=1#y`);
  w.fetch({ url: `https://zine.example/tiles/p1${SAMPLE}` });
  w.fetch(new URL(`https://zine.example/tiles/p1${SAMPLE}`));
  w.fetch("./fonts/a%20b.woff2");
  w.fetch("./patch.json");
  w.fetch("./samples/unknown.flac");
  w.fetch("https://atmosynth.at/api/x");
  w.fetch("blob:z/flac");
  assert.deepEqual(calls.map(String), [
    "blob:z/flac", "blob:z/flac", "blob:z/flac", "blob:z/flac", "blob:z/flac", "blob:z/font", "blob:z/patch",
    "./samples/unknown.flac", "https://atmosynth.at/api/x", "blob:z/flac",
  ]);
  assert.equal(make({ "/a.json": "</script>" }).includes("</script"), false, "never ends the <script> it's written into");
});

test("every url(…) in the stylesheet naming one of the tile's files is swapped for its copy; other addresses stay", () => {
  const swap = vm.runInNewContext(`${readerFunction("tilePathOf")}\n${readerFunction("swapCssUrls")}\nswapCssUrls`);
  const addr = { "/fonts/m.woff2": "blob:z/m", "/fonts/n.woff2": "data:font/woff2;base64,AAAA", "/assets/mark.svg": "blob:z/mark", "/img/a b.png": "blob:z/ab" };
  const css = [
    "@font-face{src:url(./fonts/m.woff2)format(\"woff2\")}",
    "@font-face{src:url( \"/fonts/n.woff2\" ) format('woff2')}",
    ".a{background:url('fonts/m.woff2?v=2')}",
    ".b{background:URL(assets/mark.svg)}",
    ".c{background:url(./img/a%20b.png)}",
    ".d{background:url(data:image/svg+xml;charset=utf8,%3Csvg%3E)}",
    ".e{background:url(https://example.com/x.png)}",
    ".f{background:url(#grain)}",
    ".g{background:url(./fonts/missing.woff2)}",
  ].join("");
  const out = swap(css, "/tile.css", addr);
  assert.ok(out.includes('src:url("blob:z/m")format("woff2")'));
  assert.ok(out.includes('src:url("data:font/woff2;base64,AAAA") format'));
  assert.ok(out.includes('.a{background:url("blob:z/m")}'));
  assert.ok(out.includes('.b{background:url("blob:z/mark")}'));
  assert.ok(out.includes('.c{background:url("blob:z/ab")}'));
  assert.ok(out.includes(".d{background:url(data:image/svg+xml;charset=utf8,%3Csvg%3E)}"));
  assert.ok(out.includes(".e{background:url(https://example.com/x.png)}"));
  assert.ok(out.includes(".f{background:url(#grain)}"));
  assert.ok(out.includes(".g{background:url(./fonts/missing.woff2)}"));
  // A stylesheet in a folder counts its addresses from there.
  assert.equal(swap("x{src:url(../fonts/m.woff2)}", "/css/tile.css", addr), 'x{src:url("blob:z/m")}');
  assert.equal(swap("x{src:url(m.woff2)}", "/fonts/f.css", addr), 'x{src:url("blob:z/m")}');
});

test("the reader swaps stylesheet addresses when it makes an ATMOSYNTH tile's copies, and still parses", () => {
  assert.ok(READER_JS.includes("if (/\\.css$/i.test(f.path)) code[f.path] = swapCssUrls(code[f.path], f.path, plain);"));
  assert.doesNotThrow(() => new vm.Script(READER_JS.replace(/\$\{[^}]*\}/g, "0")));
});
