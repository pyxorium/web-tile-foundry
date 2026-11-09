// The Post step (v0.32.0): the tile post record, its limits, the permission
// check, and writing and reading back a post (src/core/tile-post.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POST_COLLECTION,
  RAKU_POSTS,
  buildPostRecord,
  postTile,
  deletePost,
  scopeAllows,
  canPost,
  graphemeCount,
  parseLangs,
  isScopeRefusal,
  PostError,
} from "../src/core/tile-post.js";
import { SCOPE } from "../src/auth/client-config.js";
import { XrpcError } from "../src/core/publish.js";

const DID = "did:plc:6vxjigxrqizmbo56gojxico3";
const URI = `at://${DID}/ing.dasl.masl/3mztexample2k`;
const CID = "bafyreiexampleexampleexampleexampleexampleexampleexample";
const AT = "2026-11-08T21:14:05.123Z";

test("the record: the tile as a strongRef, then only what was filled in", () => {
  assert.equal(POST_COLLECTION, "cafe.thunderbird.tile.post");
  assert.deepEqual(buildPostRecord({ uri: URI, cid: CID, createdAt: AT }), {
    $type: POST_COLLECTION,
    tile: { uri: URI, cid: CID },
    createdAt: AT,
  });
  assert.deepEqual(buildPostRecord({ uri: URI, cid: CID, text: "  Hello  ", alt: " A sprite walks ", langs: "en, fr", createdAt: AT }), {
    $type: POST_COLLECTION,
    tile: { uri: URI, cid: CID },
    text: "Hello",
    alt: "A sprite walks",
    langs: ["en", "fr"],
    createdAt: AT,
  });
  // Blank boxes are left out, not written as empty strings.
  const blank = buildPostRecord({ uri: URI, cid: CID, text: "   ", alt: "", langs: " ", createdAt: AT });
  assert.deepEqual(Object.keys(blank), ["$type", "tile", "createdAt"]);
  assert.match(buildPostRecord({ uri: URI, cid: CID }).createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test("the lexicon's limits: 300 characters as a reader counts them, 3000 bytes; alt 1000 / 10000", () => {
  const family = "👨‍👩‍👧"; // one character to a reader, five code points, 18 bytes
  assert.equal(graphemeCount(family), 1);
  assert.equal(graphemeCount("é"), 1);
  assert.equal(buildPostRecord({ uri: URI, cid: CID, text: "a".repeat(300) }).text.length, 300);
  assert.throws(() => buildPostRecord({ uri: URI, cid: CID, text: "a".repeat(301) }), (e) => e instanceof PostError && e.step === "check" && /301 characters; at most 300/.test(e.message));
  // 166 family emoji: 166 characters, but 2988 bytes; 167 would pass 3000 bytes...
  assert.ok(buildPostRecord({ uri: URI, cid: CID, text: family.repeat(166) }).text);
  assert.throws(() => buildPostRecord({ uri: URI, cid: CID, text: family.repeat(167) }), /too long \(3006 bytes; at most 3000\)/);
  assert.ok(buildPostRecord({ uri: URI, cid: CID, alt: "b".repeat(1000) }).alt);
  assert.throws(() => buildPostRecord({ uri: URI, cid: CID, alt: "b".repeat(1001) }), /Your alt text is 1001 characters; at most 1000/);
});

test("languages: up to three tags, each a real-looking tag", () => {
  assert.deepEqual(parseLangs("en fr,  pt-BR"), ["en", "fr", "pt-BR"]);
  assert.deepEqual(buildPostRecord({ uri: URI, cid: CID, langs: ["zh-Hant"], createdAt: AT }).langs, ["zh-Hant"]);
  assert.throws(() => buildPostRecord({ uri: URI, cid: CID, langs: "en fr de es" }), /At most 3 languages/);
  assert.throws(() => buildPostRecord({ uri: URI, cid: CID, langs: "english!" }), /isn't a language tag/);
});

test("only a tile's address, with its version, can be posted", () => {
  assert.throws(() => buildPostRecord({ uri: `at://${DID}/app.bsky.feed.post/3abc`, cid: CID }), /Not a tile's address/);
  assert.throws(() => buildPostRecord({ uri: URI, cid: "" }), /version/);
});

test("the permission: the Foundry's own scope allows posting; the old one doesn't", () => {
  assert.equal(scopeAllows(SCOPE), true);
  assert.equal(scopeAllows("atproto repo:ing.dasl.masl blob:*/*"), false, "a sign-in from before v0.32.0");
  assert.equal(scopeAllows("atproto repo:*"), true);
  assert.equal(scopeAllows("atproto transition:generic"), true);
  assert.equal(scopeAllows("atproto repo?collection=cafe.thunderbird.tile.post&collection=ing.dasl.masl"), true);
  assert.equal(scopeAllows("atproto repo:cafe.thunderbird.tile.post?action=create"), true);
  assert.equal(scopeAllows("atproto repo:cafe.thunderbird.tile.post?action=delete"), false, "delete only can't create");
  assert.equal(scopeAllows("atproto repo:cafe.thunderbird.tile.postx"), false);
  assert.equal(scopeAllows("atproto rpc:cafe.thunderbird.tile.post"), false);
  assert.equal(canPost(null), null, "unknown: let the post try");
  assert.equal(canPost(SCOPE), true);
  assert.equal(canPost("atproto repo:ing.dasl.masl blob:*/*"), false);
});

test("Raku's Tile posts link", () => {
  assert.equal(RAKU_POSTS, "https://raku.lexicographer.space/#t=raku%3Adiscover%2Fposts&a=0");
  assert.equal(decodeURIComponent(new URL(RAKU_POSTS).hash.slice(3).split("&")[0]), "raku:discover/posts");
});

// A stand-in account server holding records in memory.
function fakeServer({ onCreate, onGet } = {}) {
  const records = new Map();
  const calls = [];
  const xrpc = async (nsid, { method = "GET", params, body } = {}) => {
    calls.push({ nsid, method, params, body });
    if (nsid === "com.atproto.repo.createRecord") {
      if (onCreate) await onCreate(body);
      const rkey = `3mzpost${records.size}`;
      records.set(rkey, structuredClone(body.record));
      return { uri: `at://${body.repo}/${body.collection}/${rkey}`, cid: `bafyreipost${records.size}` };
    }
    if (nsid === "com.atproto.repo.getRecord") {
      if (onGet) return onGet(params, records);
      if (!records.has(params.rkey)) throw new XrpcError(400, "RecordNotFound", "Could not locate record");
      return { uri: `at://${params.repo}/${params.collection}/${params.rkey}`, value: records.get(params.rkey) };
    }
    if (nsid === "com.atproto.repo.deleteRecord") {
      records.delete(body.rkey);
      return {};
    }
    throw new Error(`unexpected ${nsid}`);
  };
  return { xrpc, records, calls };
}

test("posting writes one record to the account's tile posts, then reads it back", async () => {
  const server = fakeServer();
  const made = await postTile({ xrpc: server.xrpc, did: DID, uri: URI, cid: CID, text: "A café walk", now: () => AT });
  assert.equal(made.uri, `at://${DID}/${POST_COLLECTION}/3mzpost0`);
  assert.equal(made.rkey, "3mzpost0");
  const create = server.calls[0];
  assert.equal(create.nsid, "com.atproto.repo.createRecord");
  assert.equal(create.body.repo, DID);
  assert.equal(create.body.collection, POST_COLLECTION);
  assert.equal(create.body.validate, false);
  assert.deepEqual(create.body.record, { $type: POST_COLLECTION, tile: { uri: URI, cid: CID }, text: "A café walk", createdAt: AT });
  assert.equal(server.calls[1].nsid, "com.atproto.repo.getRecord");
  assert.deepEqual(server.calls[1].params, { repo: DID, collection: POST_COLLECTION, rkey: "3mzpost0" });
  assert.equal(server.calls.length, 2);
  await deletePost({ xrpc: server.xrpc, did: DID, rkey: made.rkey });
  assert.deepEqual(server.calls[2], { nsid: "com.atproto.repo.deleteRecord", method: "POST", params: undefined, body: { repo: DID, collection: POST_COLLECTION, rkey: "3mzpost0" } });
  assert.equal(server.records.size, 0);
});

test("words over the limit stop before anything is sent", async () => {
  const server = fakeServer();
  await assert.rejects(postTile({ xrpc: server.xrpc, did: DID, uri: URI, cid: CID, text: "x".repeat(301) }), (e) => e.step === "check");
  assert.equal(server.calls.length, 0);
});

test("a read-back that differs, or fails, is reported as 'may still have been posted'", async () => {
  const differs = fakeServer({ onGet: (params, records) => ({ value: { ...records.get(params.rkey), text: "changed" } }) });
  await assert.rejects(postTile({ xrpc: differs.xrpc, did: DID, uri: URI, cid: CID, text: "mine" }), (e) => e.step === "verify" && /doesn't match/.test(e.message));
  const fails = fakeServer({ onGet: () => { throw new XrpcError(502, "UpstreamFailure", "Couldn't reach the server"); } });
  await assert.rejects(postTile({ xrpc: fails.xrpc, did: DID, uri: URI, cid: CID }), (e) => e.step === "verify" && /reading it back failed: Couldn't reach/.test(e.message));
});

test("a refusal for the permission is told apart from other failures", async () => {
  const noScope = fakeServer({ onCreate: () => { throw new XrpcError(403, "ScopeMissingError", "Missing required scope \"repo:cafe.thunderbird.tile.post?action=create\""); } });
  await assert.rejects(postTile({ xrpc: noScope.xrpc, did: DID, uri: URI, cid: CID }), (e) => e.step === "scope");
  const down = fakeServer({ onCreate: () => { throw new XrpcError(500, "InternalServerError", "Internal Server Error"); } });
  await assert.rejects(postTile({ xrpc: down.xrpc, did: DID, uri: URI, cid: CID }), (e) => e.step === "create" && e.message === "Internal Server Error");
  assert.equal(isScopeRefusal(new XrpcError(401, "InvalidToken", "Bad token scope")), true);
  assert.equal(isScopeRefusal(new XrpcError(400, "ScopeMissingError", "Missing required scope")), true, "named by its error, whatever the status");
  assert.equal(isScopeRefusal(new XrpcError(401, "ExpiredToken", "Token has expired")), false);
  assert.equal(isScopeRefusal(new XrpcError(400, "InvalidRequest", "Input/record must be an object")), false);
});
