// Handle suggestions (sign-in typeahead), against a stand-in service.
import { test } from "node:test";
import assert from "node:assert/strict";

// searchActors lives in a .jsx file; it has no JSX of its own, so load its source as plain JS.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/ui/HandleTypeahead.jsx", import.meta.url), "utf8");
const start = src.indexOf("export const TYPEAHEAD_URL");
const end = src.indexOf("export function HandleTypeahead");
const mod = await import("data:text/javascript," + encodeURIComponent(src.slice(start, end)));

test("suggestions come from typeahead.waow.tech, labelled as the Foundry", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ actors: [{ did: "did:plc:a", handle: "thunderbird.cafe", displayName: "Thunderbird" }, { did: "did:plc:b" }] }));
  };
  const out = await mod.searchActors("@thunder", fake);
  assert.deepEqual(out.map((a) => a.handle), ["thunderbird.cafe"], "entries without a handle are dropped");
  const u = new URL(seen[0].url);
  assert.equal(u.origin + u.pathname, "https://typeahead.waow.tech/xrpc/tech.waow.typeahead.searchActors");
  assert.equal(u.searchParams.get("q"), "thunder", "a leading @ is removed");
  assert.equal(u.searchParams.get("limit"), "6");
  assert.equal(seen[0].init.headers["X-Client"], "foundry.thunderbird.cafe");
});

test("too-short input, errors and outages just mean no suggestions", async () => {
  let calls = 0;
  const count = async () => { calls++; return new Response("{}"); };
  assert.deepEqual(await mod.searchActors("t", count), []);
  assert.equal(calls, 0, "no request for one character");
  assert.deepEqual(await mod.searchActors("thunder", async () => new Response("nope", { status: 503 })), []);
  assert.deepEqual(await mod.searchActors("thunder", async () => { throw new Error("offline"); }), []);
});
