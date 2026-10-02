// The manifest address and publishing, against a stand-in server (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { dagCborCid, encodeDagCbor, cidBytes } from "../src/core/dagcbor.js";
import { rawCid } from "../src/core/cid.js";
import { makeFile } from "../src/core/fileset.js";
import { TILE_CSP } from "../src/core/policy.js";
import { buildTile } from "../src/core/build.js";
import {
  buildManifest, publishTile, deleteTile, parseMimeMismatch, webtilesUrl, XrpcError, PublishError, TILE_COLLECTION,
} from "../src/core/publish.js";

const SAMPLE = readFileSync(new URL("./fixtures/sample-sprite.png", import.meta.url));
const ALICE = JSON.parse(readFileSync(new URL("./fixtures/alice-palette.record.prepared.json", import.meta.url), "utf8"));
const DID = "did:plc:testpublisher";

test("manifest address matches atile for the published alice-palette tile", async () => {
  assert.equal(await dagCborCid(ALICE.tile), "bafyreigdh3jo25a7zs47ll26awksmlbetrjdwnrfoe2g6htsqi2gzoulpa");
});

test("and, encoded the old Python way, matches that record's own cid field", async () => {
  assert.equal(await dagCborCid(ALICE.tile, { linksAsMaps: true }), ALICE.cid);
});

test("DAG-CBOR basics: canonical key order, whole numbers, CID links", () => {
  const hex = (u8) => Buffer.from(u8).toString("hex");
  assert.equal(hex(encodeDagCbor({ bb: 1, a: 2, c: 3 })), "a3616102616303626262" + "01");
  assert.equal(hex(encodeDagCbor(500)), "1901f4");
  assert.equal(hex(encodeDagCbor(-1)), "20");
  assert.equal(hex(encodeDagCbor([true, null, "x"])), "83f5f66178");
  const link = encodeDagCbor({ $link: "bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy" });
  assert.equal(hex(link.slice(0, 5)), "d82a582500", "tag 42, 37-byte string, identity prefix");
  assert.equal(link.length, 2 + 2 + 1 + cidBytes("bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy").length);
  assert.throws(() => encodeDagCbor(1.5), /whole numbers/);
});

// ---- a stand-in PDS ----------------------------------------------------------
function fakePds({ storedTypes = {}, wrongCid = false, tamperRecord = false } = {}) {
  const blobs = new Map();   // cid -> { bytes, mimeType }
  const records = new Map(); // rkey -> value
  const calls = [];
  let tid = 0;
  async function xrpc(nsid, { method, params, body, contentType }) {
    calls.push(nsid);
    if (nsid === "com.atproto.repo.uploadBlob") {
      const cid = await rawCid(body);
      if (!blobs.has(cid)) blobs.set(cid, { bytes: body, mimeType: storedTypes[cid] || contentType });
      // Like a real PDS, the reply echoes the type it was sent, even when a
      // different type was stored the first time (the old "echo" trap).
      return { blob: { $type: "blob", ref: { $link: wrongCid ? "bafkreiwrong" : cid }, mimeType: contentType, size: body.length } };
    }
    if (nsid === "com.atproto.repo.createRecord") {
      assert.equal(body.validate, false);
      assert.equal(body.collection, TILE_COLLECTION);
      assert.equal(body.rkey, undefined, "always a new record with a server-assigned key");
      for (const res of Object.values(body.record.tile.resources)) {
        const stored = blobs.get(res.src.ref.$link);
        if (stored.mimeType !== res.src.mimeType) {
          throw new XrpcError(400, "InvalidMimeType", `Referenced Mimetype does not match stored blob. Expected: ${stored.mimeType}, Got: ${res.src.mimeType}`);
        }
      }
      const rkey = `3mtest${++tid}`;
      records.set(rkey, structuredClone(body.record));
      return { uri: `at://${body.repo}/${TILE_COLLECTION}/${rkey}`, cid: "bafyreirecord" };
    }
    if (nsid === "com.atproto.repo.getRecord") {
      const value = structuredClone(records.get(params.rkey));
      if (tamperRecord) value.tile.name = "Something else";
      return { uri: `at://${params.repo}/${TILE_COLLECTION}/${params.rkey}`, value };
    }
    if (nsid === "com.atproto.repo.deleteRecord") {
      records.delete(body.rkey);
      return {};
    }
    throw new Error("unexpected " + nsid);
  }
  const fetchBlob = async (cid) => blobs.get(cid).bytes;
  return { xrpc, fetchBlob, blobs, records, calls };
}

const fakeType = {
  id: "fake-tile", version: 1, title: "Fake", summary: "For tests.",
  inputs: [{ key: "name", kind: "text", required: true }],
  defaults: () => ({ name: "x" }),
  build: async (inputs) => ({
    name: inputs.name,
    description: inputs.description || "",
    files: [
      makeFile("/", `<html><head><meta http-equiv="Content-Security-Policy" content="${TILE_CSP}" /></head><body>hi</body></html>`),
      makeFile("/icon.png", SAMPLE),
    ],
    icons: [{ src: "/icon.png" }],
    screenshots: [{ src: "/icon.png" }],
    recipeInputs: { a: 1 },
  }),
};
const NOW = () => "2026-10-02T12:00:00.000Z";

test("the manifest has the card images, the policy on the page, and no empty description", async () => {
  const result = await buildTile(fakeType, { name: "Card test" });
  const refs = Object.fromEntries(result.files.map((f) => [f.path, { $type: "blob", ref: { $link: f.cid }, mimeType: f.contentType, size: f.bytes.length }]));
  const m = buildManifest(result, refs);
  assert.deepEqual(Object.keys(m), ["name", "icons", "screenshots", "resources"]);
  assert.equal(m.resources["/"]["content-security-policy"], TILE_CSP);
  assert.equal(m.resources["/icon.png"]["content-security-policy"], undefined);
  assert.equal(m.resources["/foundry.json"]["content-type"], "application/json");
});

test("publishing uploads, creates one new record, and verifies it all", async () => {
  const pds = fakePds();
  const steps = [];
  const result = await buildTile(fakeType, { name: "Hello tile" });
  const out = await publishTile({ ...pds, did: DID, result, now: NOW, onStep: (id, state) => steps.push(`${id}:${state}`) });
  assert.match(out.uri, /^at:\/\/did:plc:testpublisher\/ing\.dasl\.masl\/3mtest1$/);
  assert.equal(out.rkey, "3mtest1");
  assert.equal(out.manifestCid, await dagCborCid(out.record.tile));
  assert.equal(out.record.$type, "ing.dasl.masl");
  assert.equal(out.record.createdAt, "2026-10-02T12:00:00.000Z");
  assert.equal(pds.calls.filter((c) => c === "com.atproto.repo.createRecord").length, 1);
  assert.deepEqual(steps.filter((s) => s.endsWith(":done")), ["upload:done", "create:done", "verify:done"]);
  assert.equal(webtilesUrl(out.uri), `https://webtil.es/browser/#url=${out.uri}`);
});

test("a file stored earlier under another type: adopt the server's type and retry once", async () => {
  const result = await buildTile(fakeType, { name: "Dedupe" });
  const iconCid = result.files.find((f) => f.path === "/icon.png").cid;
  const pds = fakePds({ storedTypes: { [iconCid]: "*/*" } }); // the old sphere-tile situation
  const out = await publishTile({ ...pds, did: DID, result, now: NOW });
  assert.equal(out.record.tile.resources["/icon.png"].src.mimeType, "*/*");
  assert.equal(out.record.tile.resources["/"].src.mimeType, "text/html", "other files untouched");
  assert.equal(out.manifestCid, await dagCborCid(out.record.tile), "address recomputed after the change");
  assert.equal(pds.calls.filter((c) => c === "com.atproto.repo.createRecord").length, 2);
});

test("a wrong address from the server stops publishing before any record is made", async () => {
  const pds = fakePds({ wrongCid: true });
  const result = await buildTile(fakeType, { name: "Wrong" });
  await assert.rejects(publishTile({ ...pds, did: DID, result, now: NOW }), (e) => e instanceof PublishError && e.step === "upload");
  assert.equal(pds.records.size, 0);
});

test("a record that comes back different is reported", async () => {
  const pds = fakePds({ tamperRecord: true });
  const result = await buildTile(fakeType, { name: "Tamper" });
  await assert.rejects(publishTile({ ...pds, did: DID, result, now: NOW }), (e) => e.step === "verify");
});

test("deleting a test tile removes exactly that record", async () => {
  const pds = fakePds();
  const result = await buildTile(fakeType, { name: "Throwaway" });
  const a = await publishTile({ ...pds, did: DID, result, now: NOW });
  const b = await publishTile({ ...pds, did: DID, result, now: NOW });
  await deleteTile({ xrpc: pds.xrpc, did: DID, rkey: a.rkey });
  assert.deepEqual([...pds.records.keys()], [b.rkey]);
});

test("InvalidMimeType messages are read correctly", () => {
  assert.deepEqual(parseMimeMismatch("Referenced Mimetype does not match stored blob. Expected: */*, Got: application/octet-stream"), { expected: "*/*", got: "application/octet-stream" });
  assert.equal(parseMimeMismatch("something else"), null);
});
