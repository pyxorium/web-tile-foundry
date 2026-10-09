import { test } from "node:test";
import assert from "node:assert/strict";
import { rawCid } from "../src/core/cid.js";
import { parseTileAddress, fetchPublishedTile, copyPaths, blobCidOf, jsonFile, pageRefs, swapRefs } from "../src/core/published-tile.js";

// Reading a published tile back and copying it into a zine (stage 4).

const DID = "did:plc:joer5rzmwgec3dkr4srfmq45";
const PDS = "https://pds.example";
const enc = (s) => new TextEncoder().encode(s);
const PAGE = '<!DOCTYPE html><html><head><title>Lantern</title></head><body><script type="application/json" id="lantern-config">{}</script><script src="/lantern.js"></script></body></html>';
const FILES = {
  "/": { bytes: enc(PAGE), type: "text/html" },
  "/lantern.js": { bytes: enc("console.log('lantern')"), type: "text/javascript" },
  "/icon.png": { bytes: new Uint8Array([137, 80, 78, 71, 1]), type: "image/png" },
  "/banner.png": { bytes: new Uint8Array([137, 80, 78, 71, 2]), type: "image/png" },
  "/foundry.json": { bytes: enc(JSON.stringify({ madeWith: "Web Tile Foundry", foundryVersion: "0.9.0", type: "glass-lantern", typeVersion: 1, inputs: {} })), type: "application/json" },
};

async function standIn({ tamper = false } = {}) {
  const blobs = new Map();
  const resources = {};
  for (const [path, f] of Object.entries(FILES)) {
    const cid = await rawCid(f.bytes);
    blobs.set(cid, tamper && path === "/lantern.js" ? enc("something else") : f.bytes);
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: f.type, size: f.bytes.length }, "content-type": f.type };
  }
  const record = { uri: `at://${DID}/ing.dasl.masl/3mlantern`, cid: "bafyreirecord", value: { $type: "ing.dasl.masl", tile: { name: "Glass <Lantern>", resources } } };
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    const json = (o, status = 200) => ({ ok: status === 200, status, json: async () => o });
    if (u.host === "plc.directory") return json({ id: DID, alsoKnownAs: ["at://thunderbird.cafe"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
    if (u.pathname.endsWith("resolveHandle")) return u.searchParams.get("handle") === "thunderbird.cafe" ? json({ did: DID }) : json({}, 400);
    if (u.pathname.endsWith("getRecord")) return u.searchParams.get("rkey") === "3mlantern" ? json(record) : json({ error: "RecordNotFound" }, 400);
    if (u.pathname.endsWith("getBlob")) {
      const b = blobs.get(u.searchParams.get("cid"));
      return b ? { ok: true, status: 200, arrayBuffer: async () => b.slice().buffer } : { ok: false, status: 404 };
    }
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

test("tile addresses: at://, appmosphe.re and webtil.es forms", () => {
  assert.deepEqual(parseTileAddress(`at://${DID}/ing.dasl.masl/3mlantern`), { repo: DID, rkey: "3mlantern" });
  assert.deepEqual(parseTileAddress("https://appmosphe.re/@thunderbird.cafe/3mlantern"), { repo: "thunderbird.cafe", rkey: "3mlantern" });
  assert.deepEqual(parseTileAddress(`https://appmosphe.re/@${DID}/3mlantern`), { repo: DID, rkey: "3mlantern" });
  assert.deepEqual(parseTileAddress(`https://webtil.es/browser/#url=${encodeURIComponent(`at://${DID}/ing.dasl.masl/3mlantern`)}`), { repo: DID, rkey: "3mlantern" });
  assert.equal(parseTileAddress(`at://${DID}/app.bsky.feed.post/3m`), null);
  assert.equal(parseTileAddress("https://example.com/@x/3m"), null);
  assert.equal(parseTileAddress(""), null);
  assert.equal(blobCidOf({ ref: { $link: "bafkx" } }), "bafkx");
  assert.equal(blobCidOf({}), null);
});

test("reading a published tile: every file checked against its address", async () => {
  const { fetchImpl } = await standIn();
  const pub = await fetchPublishedTile("https://appmosphe.re/@thunderbird.cafe/3mlantern", { fetchImpl });
  assert.equal(pub.did, DID);
  assert.equal(pub.handle, "thunderbird.cafe");
  assert.equal(pub.uri, `at://${DID}/ing.dasl.masl/3mlantern`);
  assert.equal(pub.files.length, 5);
  assert.deepEqual(pub.files.find((f) => f.path === "/lantern.js").bytes, FILES["/lantern.js"].bytes);
  assert.equal(pub.recipe.type, "glass-lantern");
  const bad = await standIn({ tamper: true });
  await assert.rejects(fetchPublishedTile(`at://${DID}/ing.dasl.masl/3mlantern`, { fetchImpl: bad.fetchImpl }), /didn't match its address/);
  await assert.rejects(fetchPublishedTile(`at://${DID}/ing.dasl.masl/3mnothing`, { fetchImpl }), /No tile was found/);
  await assert.rejects(fetchPublishedTile("not an address", { fetchImpl }), /doesn't look like a tile address/);
});

test("copies keep their bytes and their content type", () => {
  const files = Object.entries(FILES).map(([path, f]) => ({ path, bytes: f.bytes, contentType: f.type }));
  const copies = copyPaths(files, "/t1");
  assert.deepEqual(copies.map((c) => c.path).sort(), ["/t1/banner.png", "/t1/foundry.json", "/t1/icon.png", "/t1/index.html", "/t1/lantern.js"]);
  assert.equal(copies.find((c) => c.path === "/t1/index.html").contentType, "text/html");
  assert.throws(() => copyPaths([{ path: "/x.js", bytes: enc("1"), contentType: "application/javascript" }], "/t1"), /can't be copied/);
});

test("only some files, JSON files, and the page's own references", async () => {
  const { fetchImpl, calls } = await standIn();
  const pub = await fetchPublishedTile(`at://${DID}/ing.dasl.masl/3mlantern`, { fetchImpl, only: ["/banner.png", "/foundry.json"] });
  assert.deepEqual(pub.files.map((f) => f.path).sort(), ["/banner.png", "/foundry.json"]);
  assert.equal(calls.filter((c) => c.endsWith("getBlob")).length, 2, "only those files are downloaded");
  assert.equal(jsonFile(pub.files, "/foundry.json").type, "glass-lantern");
  assert.equal(jsonFile(pub.files, "/missing.json"), null);
  assert.equal(jsonFile([{ path: "/x.json", bytes: enc("not json") }], "/x.json"), null);
  const refs = pageRefs(PAGE, Object.keys(FILES));
  assert.deepEqual(refs, ["/lantern.js"]);
  assert.ok(swapRefs(PAGE, { "/lantern.js": "/tiles/p3/lantern.js" }).includes('<script src="/tiles/p3/lantern.js">'));
});
