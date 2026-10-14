// Zine Scene v0.28.0: your own tiles from other apps on "A web tile" pages, and
// one-tap tiles (claude/zine-other-app-tiles-plan.md). Any of the creator's own
// published tiles the Foundry didn't make can go on a page, run through the same
// path as ATMOSYNTH tiles: Treeline's activity replays (credited, linked to the
// activity), other apps that name themselves (credited by name), hand-made tiles.
// The Treeline stand-in is shaped like the owner's "Golden Hiking Nightbird
// Gulch Trail" (at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3mxrkta4fzv22).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTile } from "../src/core/build.js";
import { publishTile } from "../src/core/publish.js";
import { fetchPublishedTile, copyPaths } from "../src/core/published-tile.js";
import { contentTypeFor, copyTypeAccepts } from "../src/core/fileset.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, zineConfig } from "../src/tile-types/zine/pages.js";
import {
  tilePlacement, tileForReader, pieceReady, pieceFiles, pieceRecipe, appTileInfo, appType, generatorOf, isTreelineTile, isAppPiece,
} from "../src/tile-types/zine/piece.js";
import { READER_JS } from "../src/tile-types/zine/runtime/reader.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://pds.example";
const ACTIVITY = `at://${DID}/world.treeline.activity.record/3mxndekaacj22`;
const enc = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const OCTET = "application/octet-stream";

// A Treeline tile: everything inline, its data in a JSON script, one file loaded by itself.
const TREELINE_PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Golden Hiking</title>\n<style>.map{position:relative}</style>\n</head>\n<body>\n<div class="map"><canvas></canvas></div>\n' +
  '<script type="application/json" id="treeline-data">{"schema":"treeline.tile.activity/1","name":"Golden Hiking","satellite":{"path":"/satellite.jpg","bounds":[0,0,1,1]}}</script>\n' +
  '<script>var data=JSON.parse(document.getElementById("treeline-data").textContent);var satImg=new Image();satImg.src=data.satellite.path;</script>\n</body>\n</html>\n';
function treelineSpec() {
  return {
    "/": [TREELINE_PAGE, "text/html", OCTET],
    "/DATA.md": ["# Data\nRoute only, privacy zones applied.", "text/markdown", OCTET],
    "/icon.svg": ["<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", OCTET],
    "/activity.json": ['{"schema":"treeline.tile.activity/1"}', "application/json", OCTET],
    "/satellite.jpg": [JPG, "image/jpeg", "image/jpeg"],
    "/screenshot.png": [PNG, "image/png", "image/png"],
  };
}
// A hand-made tile: a page and a script it loads from the tile's root.
const HAND_PAGE = '<!doctype html><html><head><meta charset="utf-8"><script src="/cube.js"></script></head><body></body></html>';
function handSpec() {
  return { "/": [HAND_PAGE, "text/html", "text/html"], "/cube.js": ["document.title='cube';", "text/javascript", "text/javascript"] };
}

async function stand(spec, { generator = "", extra = {}, sizing, rkey = "3mxrkta4fzv22" } = {}) {
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct, stored]] of Object.entries(spec)) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, { bytes, mimeType: stored });
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: stored, size: bytes.length }, "content-type": ct };
  }
  const tile = { name: "Golden Hiking Nightbird Gulch Trail", resources, ...(generator ? { generator } : {}), ...(sizing ? { sizing } : {}),
    ...(spec["/screenshot.png"] ? { screenshots: [{ src: "/screenshot.png", type: "image/png", sizes: "1200x630" }] } : {}) };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, createdAt: "2026-10-13T17:32:21.707Z", ...extra };
  const address = `at://${DID}/ing.dasl.masl/${rkey}`;
  const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.host === "plc.directory") return json({ alsoKnownAs: ["at://pyxorium.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    if (u.pathname.endsWith("getRecord")) return json({ uri: address, cid: "bafyreirecord", value });
    if (u.pathname.endsWith("getBlob")) {
      const b = blobs.get(u.searchParams.get("cid"));
      return b ? new Response(b.bytes) : new Response("no", { status: 404 });
    }
    return new Response("?", { status: 404 });
  };
  return { fetchImpl, blobs, address };
}

/** A page's piece as the tile panel leaves it once an app tile is copied. */
async function appPiece(spec, opts) {
  const server = await stand(spec, opts);
  const pub = await fetchPublishedTile(server.address, { fetchImpl: server.fetchImpl });
  return {
    server, pub,
    piece: {
      kind: "tile", uri: pub.uri, cid: pub.cid, name: pub.manifest.name, did: pub.did, handle: pub.handle, own: true,
      maker: "app", app: appTileInfo(pub.manifest, pub.record), ...(pub.manifest.sizing ? { sizing: pub.manifest.sizing } : {}),
      status: "ready", files: pub.files,
    },
  };
}
const treeline = () => appPiece(treelineSpec(), { generator: "Treeline", extra: { activityUri: ACTIVITY }, sizing: { width: 720, height: 520 } });

function zineWith(pieces) {
  const pages = emptyPages();
  pieces.forEach((piece, k) => { pages[k + 1].layout = "tile"; pages[k + 1].piece = piece; });
  return { name: "Hikes", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, handle: "pyxorium.com", sprite: null, soundRights: false };
}
const configOf = (v) => zineConfig({ title: v.name, handle: v.handle, paper: v.paper, look: v.look, ink: v.ink, pages: v.pages, pageCount: 8, made: "October 2026", src: () => "" });

// ---- Which tiles, and how they're named ----

test("any of your own tiles the Foundry didn't make can go on “A web tile” pages, grouped by the app it names", () => {
  const getType = () => undefined;
  assert.deepEqual(tilePlacement(null, getType, "live", "Treeline").type.title, "Treeline");
  assert.equal(tilePlacement(null, getType, "live", "Treeline").ok, true);
  assert.equal(tilePlacement(null, getType, "live", "").type.title, "Other tiles");
  assert.equal(tilePlacement(null, getType, "live", "Synthville").type.title, "Synthville");
  assert.equal(tilePlacement({ some: "other recipe" }, getType, "live", "").ok, true, "a recipe not made with the Foundry");
  assert.match(tilePlacement(null, getType, "tape", "Treeline").reason, /Tiles from other apps go on “A web tile” pages/);
  assert.equal(tilePlacement(null, getType, "live", "ATMOSYNTH").type.title, "ATMOSYNTH patch", "ATMOSYNTH keeps its own group");
  // Foundry tiles are still judged by their recipe.
  assert.match(tilePlacement({ madeWith: "Web Tile Foundry", type: "nope", typeVersion: 1 }, getType, "live", "").reason, /doesn't know/);
});

test("the app a tile names is read carefully; Treeline tiles keep the activity they replay", () => {
  assert.equal(generatorOf({ generator: "  Tree\u0000line  " }), "Tree line");
  assert.equal(generatorOf({ generator: 5 }), "");
  assert.equal(generatorOf("x".repeat(200)).length, 60);
  assert.equal(isTreelineTile({ generator: "treeline" }), true);
  assert.equal(appType("TREELINE").id, "treeline");
  assert.deepEqual(appTileInfo({ generator: "Treeline" }, { activityUri: ACTIVITY }), { generator: "Treeline", activityUri: ACTIVITY });
  assert.deepEqual(appTileInfo({ generator: "Treeline" }, { activityUri: "https://evil.example/" }), { generator: "Treeline" }, "only an at:// address");
  assert.deepEqual(appTileInfo({ generator: "Synthville" }, { activityUri: ACTIVITY }), { generator: "Synthville" }, "the activity only for Treeline");
  assert.deepEqual(appTileInfo({}, null), {});
});

// ---- A Treeline tile ----

test("Markdown notes have a type; a Treeline tile's files can all be copied", async () => {
  assert.equal(contentTypeFor("/DATA.md"), "text/markdown");
  assert.equal(copyTypeAccepts("/t/DATA.md", "text/x-markdown"), true);
  assert.equal(copyTypeAccepts("/t/DATA.md", "text/html"), false);
  const { pub } = await treeline();
  assert.equal(pub.record.activityUri, ACTIVITY, "the record's other fields come along");
  const copies = copyPaths(pub.files, "/tiles/p1");
  assert.equal(copies.length, 6);
  assert.equal(copies.find((c) => c.path === "/tiles/p1/DATA.md").storedType, OCTET);
});

test("a Treeline tile on a page: ready with only its page, credited and linked to its activity, runs normally", async () => {
  const { piece } = await treeline();
  assert.equal(isAppPiece(piece), true);
  assert.equal(pieceReady({ layout: "tile", piece }), true);
  const t = tileForReader({ layout: "tile", piece }, "p1");
  assert.equal(t.app, true);
  assert.equal(t.atmo, undefined);
  assert.equal(t.treeline, true);
  assert.equal(t.made, "Treeline");
  assert.equal(t.madeUrl, `https://treeline.world/?activity=${encodeURIComponent(ACTIVITY)}`);
  assert.equal(t.sealed, undefined, "your own tiles run normally");
  assert.deepEqual(t.size, { w: 720, h: 520 });
  assert.equal(t.poster, "/tiles/p1/screenshot.png");
  assert.equal(t.by, "");
  // The picture it loads by itself is named in its page, so the page's address is swapped for the copy.
  assert.deepEqual(t.refs, [{ ref: "/satellite.jpg", path: "/satellite.jpg" }]);
  assert.ok(t.fetched.includes("/satellite.jpg") && t.fetched.includes("/DATA.md"));
  assert.equal(t.url, "https://lexicographer.space/@did:plc:rqbqpaaluty5v47jwciowpik/3mxrkta4fzv22");
  const r = pieceRecipe({ layout: "tile", piece }, "p1");
  assert.deepEqual({ generator: r.generator, activity: r.activity, sealed: r.sealed, type: r.type }, { generator: "Treeline", activity: ACTIVITY, sealed: undefined, type: undefined });
});

test("Treeline tiles join “Activities · Treeline” on the Credits sheet", async () => {
  const { piece } = await treeline();
  const config = configOf(zineWith([piece]));
  const c = config.credits.find((x) => x.app === "Treeline");
  assert.ok(c);
  assert.equal(c.what, "Activities");
  assert.equal(c.pages, "page 1");
  assert.equal(config.credits.filter((x) => x.app === "Treeline").length, 1);
});

test("builds a zine with a Treeline tile, copied byte for byte, and publishes first time", async () => {
  const { piece, server } = await treeline();
  assert.deepEqual(pieceFiles({ layout: "tile", piece }, "p1").map((f) => f.path).sort(),
    Object.keys(treelineSpec()).map((p) => (p === "/" ? "/tiles/p1/index.html" : `/tiles/p1${p}`)).sort());
  const result = await buildTile(zine, zineWith([piece]), { final: false });
  for (const [path, [data, ct, stored]] of Object.entries(treelineSpec())) {
    const to = path === "/" ? "/tiles/p1/index.html" : `/tiles/p1${path}`;
    const f = result.files.find((x) => x.path === to);
    assert.ok(f, `${to} copied`);
    assert.deepEqual(Buffer.from(f.bytes), Buffer.from(typeof data === "string" ? enc(data) : data));
    assert.equal(f.contentType, path === "/" ? "text/html" : ct);
    assert.equal(f.storedType, stored);
  }
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.pages[1].tile.generator, "Treeline");
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
        if (stored.get(r.src.ref.$link) !== r.src.mimeType) { const e = new Error("mismatch"); e.error = "InvalidMimeType"; throw e; }
      }
      return { uri: `at://${DID}/ing.dasl.masl/3newzine`, cid: "bafyreinew" };
    }
    if (nsid === "com.atproto.repo.getRecord") return { value: creates[creates.length - 1].record };
    throw new Error(nsid);
  };
  const files = new Map(result.files.map((f) => [f.cid, f.bytes]));
  await publishTile({ xrpc, fetchBlob: async (cid) => files.get(cid), did: DID, result });
  assert.equal(creates.length, 1, "no retry needed");
  assert.equal(creates[0].record.tile.resources["/tiles/p1/DATA.md"]["content-type"], "text/markdown");
});

// ---- Other apps and hand-made tiles ----

test("a tile from an app we don't know is credited by name, without a link; it opens on its own page", async () => {
  const { piece } = await appPiece(handSpec(), { generator: "Synthville", rkey: "3synthville1" });
  const t = tileForReader({ layout: "tile", piece }, "p2");
  assert.equal(t.made, "Synthville");
  assert.equal(t.madeUrl, undefined);
  assert.equal(t.treeline, undefined);
  assert.ok(t.url.startsWith("https://lexicographer.space/"));
  assert.deepEqual(t.size, { w: 720, h: 520 }, "no sizing: the usual size");
  assert.equal(t.poster, undefined, "no picture: the reader shows a plain card with its name");
  assert.deepEqual(t.refs, [{ ref: "/cube.js", path: "/cube.js" }]);
  const config = configOf(zineWith([piece]));
  const c = config.credits.find((x) => x.app === "Synthville");
  assert.deepEqual({ what: c.what, href: c.href, pages: c.pages }, { what: "Web tiles", href: "", pages: "page 1" });
});

test("a hand-made tile naming no app: ready with only its page, not credited", async () => {
  const { piece } = await appPiece(handSpec(), { rkey: "3handmade111" });
  assert.equal(pieceReady({ layout: "tile", piece }), true);
  const t = tileForReader({ layout: "tile", piece }, "p1");
  assert.equal(t.app, true);
  assert.equal(t.made, "");
  assert.equal(pieceRecipe({ layout: "tile", piece }, "p1").generator, undefined);
  const config = configOf(zineWith([piece]));
  assert.equal((config.credits || []).some((x) => x.what === "Web tiles"), false);
});

// ---- One tap: tiles start when their page is shown ----

test("the reader starts tiles when their page is shown, fetches their files a page ahead, and has no Play button", () => {
  assert.ok(READER_JS.includes("function startShownTiles()") && READER_JS.includes("function wantTile(i)"));
  assert.ok(READER_JS.includes("if (mode !== \"card\") wantTile(i);"), "a page's tile is fetched when the page comes near, as pictures are");
  assert.ok(/startShownTiles\(\);\s*\/\/ Load what's shown first/.test(READER_JS), "tiles are put in line before the shown pictures, so the pictures still come first");
  assert.ok(READER_JS.includes("config.preview ? PREVIEW_START_MS : START_MS"), "a moment's wait (longer in the Foundry's preview)");
  assert.ok(READER_JS.includes("clearTimeout(startTimer);"));
  assert.ok(READER_JS.includes('var making = t.app ? makeAtmo('), "tiles from other apps take the app path");
  assert.ok(READER_JS.includes('"made with " + t.made + " ↗"') && READER_JS.includes('el("span", "tile-made", "made with " + t.made)'));
  assert.ok(READER_JS.includes('el("span", "tile-plain", t.name)'), "a tile with no picture shows its name");
  assert.ok(!READER_JS.includes('"▶ Play"'));
});
