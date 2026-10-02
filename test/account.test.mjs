// Sign-in settings and reading an account's own sprite. No network: a stand-in
// fetch answers like plc.directory and a PDS would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SCOPE, productionClientMetadata, loopbackClientId, loopbackClientMetadata, isLoopbackHost,
} from "../src/auth/client-config.js";
import {
  resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchOwnSprite,
} from "../src/core/atproto.js";

const SAMPLE = readFileSync(new URL("./fixtures/sample-sprite.png", import.meta.url));
const DID = "did:plc:joer5rzmwgec3dkr4srfmq45";
const PDS = "https://pds.example.test";
const RECORD = {
  rows: 4, $type: "actor.rpg.sprite", width: 144, frames: 12, height: 192,
  source: "at://did:plc:joer5rzmwgec3dkr4srfmq45/actor.rpg.generator/self",
  columns: 3, frameWidth: 48, frameHeight: 48, createdAt: "2026-09-04T04:08:53.589Z",
  spriteSheet: { ref: { $link: "bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy" }, size: 12297, $type: "blob", mimeType: "image/png" },
};
const DID_DOC = {
  id: DID,
  alsoKnownAs: ["at://thunderbirdwine.bsky.social"],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS + "/" }],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function fakeFetch(routes) {
  const seen = [];
  const impl = async (url) => {
    seen.push(String(url));
    for (const [match, respond] of routes) if (String(url).includes(match)) return respond(String(url));
    return new Response("not found", { status: 404 });
  };
  impl.seen = seen;
  return impl;
}

test("one scope, used by both production and development sign-in", () => {
  assert.equal(SCOPE, "atproto repo:ing.dasl.masl blob:*/*");
  const prod = productionClientMetadata();
  assert.equal(prod.client_id, "https://foundry.thunderbird.cafe/client-metadata.json");
  assert.deepEqual(prod.redirect_uris, ["https://foundry.thunderbird.cafe/"]);
  assert.equal(prod.scope, SCOPE);
  assert.equal(prod.client_name, "Web Tile Foundry");
  assert.equal(prod.token_endpoint_auth_method, "none");
  assert.equal(prod.dpop_bound_access_tokens, true);
  assert.equal(loopbackClientMetadata("http://127.0.0.1:5173/").scope, SCOPE);
});

test("the development client ID carries the return address and the scope", () => {
  const id = loopbackClientId("http://127.0.0.1:5173/");
  assert.ok(id.startsWith("http://localhost?"), "origin must be exactly http://localhost, no port");
  const q = new URL(id).searchParams;
  assert.equal(q.get("redirect_uri"), "http://127.0.0.1:5173/");
  assert.equal(q.get("scope"), SCOPE);
  assert.ok(isLoopbackHost("127.0.0.1") && isLoopbackHost("localhost") && !isLoopbackHost("foundry.thunderbird.cafe"));
});

test("an account's server and handle come from its DID document", async () => {
  const f = fakeFetch([["plc.directory", () => json(DID_DOC)]]);
  const doc = await resolveDidDocument(DID, f);
  assert.equal(f.seen[0], `https://plc.directory/${encodeURIComponent(DID)}`);
  assert.equal(pdsFromDidDocument(doc), PDS, "trailing slash removed");
  assert.equal(handleFromDidDocument(doc), "thunderbirdwine.bsky.social");
  await assert.rejects(resolveDidDocument("did:key:z6Mk", f), /Unsupported/);
  assert.throws(() => pdsFromDidDocument({ service: [] }), /no data server/);
});

test("the account's own sprite is read, and its image checked against the record", async () => {
  const f = fakeFetch([
    ["com.atproto.repo.getRecord", () => json({ uri: `at://${DID}/actor.rpg.sprite/self`, cid: "bafyrei-x", value: RECORD })],
    ["com.atproto.sync.getBlob", () => new Response(SAMPLE, { status: 200, headers: { "content-type": "image/png" } })],
  ]);
  const { sprite } = await fetchOwnSprite(DID, PDS, f);
  assert.equal(sprite.cid, RECORD.spriteSheet.ref.$link);
  assert.deepEqual(sprite.geometry, { columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 });
  assert.deepEqual(sprite.origin, { kind: "record", uri: `at://${DID}/actor.rpg.sprite/self`, generator: RECORD.source });
  const rec = new URL(f.seen[0]);
  assert.equal(rec.searchParams.get("collection"), "actor.rpg.sprite");
  assert.equal(rec.searchParams.get("rkey"), "self");
  assert.equal(new URL(f.seen[1]).searchParams.get("cid"), RECORD.spriteSheet.ref.$link);
});

test("no sprite yet is a normal answer, not an error", async () => {
  const f = fakeFetch([["getRecord", () => json({ error: "RecordNotFound", message: "Could not locate record" }, 400)]]);
  assert.deepEqual(await fetchOwnSprite(DID, PDS, f), { sprite: null });
});

test("an image that doesn't match its record is refused", async () => {
  const other = new Uint8Array(SAMPLE); other[60] ^= 0xff;  // same PNG header, different bytes
  const f = fakeFetch([
    ["getRecord", () => json({ uri: `at://${DID}/actor.rpg.sprite/self`, value: RECORD })],
    ["getBlob", () => new Response(other, { status: 200 })],
  ]);
  await assert.rejects(fetchOwnSprite(DID, PDS, f), /doesn't match your sprite record/);
});

test("server trouble gives a plain message", async () => {
  const f = fakeFetch([["getRecord", () => new Response("oops", { status: 500 })]]);
  await assert.rejects(fetchOwnSprite(DID, PDS, f), /Could not read your sprite/);
});
