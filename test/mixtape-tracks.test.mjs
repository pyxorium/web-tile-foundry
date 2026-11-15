// Songs kept on the PDS (v0.35.0, src/tile-types/mixtape/tracks.js): listing
// (public, paged), storing (upload, record, read back), Edit details (the same
// audio, a new version), and the server's errors passed on. A stand-in server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listTracks, groupRecordings, storeTrack, updateTrack, editedRecord, trackFromRecord, TrackError, IMPORT_DID, TRACK_COLLECTION } from "../src/tile-types/mixtape/tracks.js";
import { XrpcError } from "../src/core/publish.js";

const DID = IMPORT_DID;
const PDS = "https://pds.fakepds.net";
const BLOB = { $type: "blob", ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" }, mimeType: "audio/webm", size: 1834503 };

function rec(k, value) {
  return { uri: `at://${DID}/${TRACK_COLLECTION}/3n2a${k}`, cid: `bafyreiaaa${k}`, value: { $type: TRACK_COLLECTION, audioBlob: BLOB, ...value } };
}

test("the importer is pyxorium.com's, by DID", () => {
  assert.equal(IMPORT_DID, "did:plc:rqbqpaaluty5v47jwciowpik");
  assert.equal(TRACK_COLLECTION, "cafe.thunderbird.audio.track");
});

test("listing reads every page of the account's track records", async () => {
  const pages = [
    { records: [rec("a", { title: "One", trackNumber: 2, createdAt: "2026-11-14T10:00:00Z", recording: { archiveUrl: "https://archive.org/details/x", set: "Set 1" } })], cursor: "c1" },
    { records: [rec("b", { title: "Two", album: "Other", createdAt: "2026-11-14T12:00:00Z" })] },
  ];
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    return new Response(JSON.stringify(pages[u.searchParams.get("cursor") ? 1 : 0]), { status: 200 });
  };
  const list = await listTracks({ did: DID, pds: PDS, fetchImpl });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /com\.atproto\.repo\.listRecords\?repo=did%3Aplc%3Arqbqpaaluty5v47jwciowpik&collection=cafe\.thunderbird\.audio\.track&limit=100$/);
  assert.equal(list[0].title, "One");
  assert.equal(list[0].set, "Set 1");
  assert.equal(list[0].size, 1834503);
  assert.equal(list[0].rkey, "3n2aa");
  const groups = groupRecordings(list);
  assert.deepEqual(groups.map((g) => g.album), ["Other", "Other songs"], "newest added first");
  await assert.rejects(listTracks({ did: DID, pds: PDS, fetchImpl: async () => new Response("no", { status: 500 }) }), /answered 500/);
});

function server({ fail = {} } = {}) {
  const calls = [];
  const records = new Map();
  const xrpc = async (nsid, opts) => {
    calls.push([nsid, opts]);
    if (fail[nsid]) throw fail[nsid];
    if (nsid === "com.atproto.repo.uploadBlob") return { blob: { ...BLOB, size: opts.body.length } };
    if (nsid === "com.atproto.repo.createRecord" || nsid === "com.atproto.repo.putRecord") {
      const rkey = opts.body.rkey || "3n2anew";
      records.set(rkey, opts.body.record);
      return { uri: `at://${DID}/${TRACK_COLLECTION}/${rkey}`, cid: "bafyreinew" };
    }
    if (nsid === "com.atproto.repo.getRecord") return { value: records.get(opts.params.rkey), cid: "bafyreinew" };
    throw new Error(`unexpected ${nsid}`);
  };
  return { xrpc, calls, records };
}

test("storing: the audio uploaded as audio/webm, the record written without server validation, then read back", async () => {
  const s = server();
  const bytes = new Uint8Array(100);
  const made = await storeTrack({ xrpc: s.xrpc, did: DID, bytes, mimeType: "audio/webm", makeRecord: (audioBlob) => ({ $type: TRACK_COLLECTION, title: "One", audioBlob, createdAt: "2026-11-14T00:00:00Z" }) });
  assert.deepEqual(s.calls.map((c) => c[0]), ["com.atproto.repo.uploadBlob", "com.atproto.repo.createRecord", "com.atproto.repo.getRecord"]);
  assert.equal(s.calls[0][1].contentType, "audio/webm");
  assert.equal(s.calls[0][1].body, bytes);
  assert.deepEqual(s.calls[1][1].body.collection, TRACK_COLLECTION);
  assert.equal(s.calls[1][1].body.validate, false);
  assert.equal(s.calls[1][1].body.record.audioBlob.size, 100);
  assert.equal(made.rkey, "3n2anew");
});

test("storing: the server's own message on a storage error; a missing permission is told apart", async () => {
  const full = server({ fail: { "com.atproto.repo.uploadBlob": new XrpcError(400, "BlobTooLarge", "This file is too large. It is 60.1MB but the maximum size is 50.0MB.") } });
  await assert.rejects(storeTrack({ xrpc: full.xrpc, did: DID, bytes: new Uint8Array(1), mimeType: "audio/webm", makeRecord: () => ({}) }), (err) => {
    assert.ok(err instanceof TrackError);
    assert.equal(err.step, "upload");
    assert.match(err.message, /maximum size is 50\.0MB/);
    return true;
  });
  const scope = server({ fail: { "com.atproto.repo.createRecord": new XrpcError(403, "ScopeMissingError", "Missing required scope \"repo:cafe.thunderbird.audio.track?action=create\"") } });
  await assert.rejects(storeTrack({ xrpc: scope.xrpc, did: DID, bytes: new Uint8Array(1), mimeType: "audio/webm", makeRecord: (b) => ({ audioBlob: b }) }), (err) => err.step === "scope");
  const odd = server();
  const xrpc = async (nsid, opts) => (nsid === "com.atproto.repo.getRecord" ? { value: { title: "changed" } } : odd.xrpc(nsid, opts));
  await assert.rejects(storeTrack({ xrpc, did: DID, bytes: new Uint8Array(1), mimeType: "audio/webm", makeRecord: (b) => ({ title: "One", audioBlob: b }) }), /doesn't match/);
});

test("Edit details: the same audio, file type and date; only the details change; the version is checked (R3b-8)", async () => {
  const old = trackFromRecord(rec("a", { title: "Tune Too", artist: "Band", trackNumber: 2, duration: 214, fileType: "webm", createdAt: "2026-11-14T10:00:00Z", recording: { set: "Set 1", venue: "Hall" } }));
  const next = editedRecord(old.value, { title: "Tune Two", artist: "Band", album: "Band · Hall · 1999-07-04", trackNumber: "2", set: "Set 2", venue: "The Hall", place: "", description: "" });
  assert.deepEqual(next, {
    $type: TRACK_COLLECTION, title: "Tune Two", artist: "Band", album: "Band · Hall · 1999-07-04", trackNumber: 2, duration: 214,
    audioBlob: BLOB, fileType: "webm", recording: { venue: "The Hall", set: "Set 2" }, createdAt: "2026-11-14T10:00:00Z",
  });
  const s = server();
  await updateTrack({ xrpc: s.xrpc, did: DID, rkey: old.rkey, cid: old.cid, record: next });
  const put = s.calls.find((c) => c[0] === "com.atproto.repo.putRecord")[1].body;
  assert.equal(put.rkey, "3n2aa");
  assert.equal(put.swapRecord, "bafyreiaaaa");
  assert.equal(put.validate, false);
  const stale = server({ fail: { "com.atproto.repo.putRecord": new XrpcError(400, "InvalidSwap", "Record was at bafyreiother") } });
  await assert.rejects(updateTrack({ xrpc: stale.xrpc, did: DID, rkey: "x", cid: "y", record: next }), /InvalidSwap|Record was at/);
});
