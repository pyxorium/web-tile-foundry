// "Your accounts" as panels see them, and finding where an account's data lives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { myAccounts, nameOf } from "../src/core/my-accounts.js";
import { pdsOf, didOfUri } from "../src/core/atproto.js";

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";

test("the account in use first, then the others that have been looked up", () => {
  assert.equal(myAccounts({}).state, "out");
  assert.equal(myAccounts({ account: { status: "signedIn", did: A, lookupError: "x" } }).state, "lookup");
  assert.equal(myAccounts({ account: { status: "signedIn", did: A } }).state, "waiting");
  const ctx = {
    account: { status: "signedIn", did: A, pds: "https://a.test", handle: "a.test" },
    accounts: [{ did: B, pds: "https://b.test", handle: "pyxorium.com" }, { did: A, pds: "https://old.test" }, { did: "did:plc:cccccccccccccccccccccccc" }],
  };
  const m = myAccounts(ctx);
  assert.equal(m.state, "ok");
  assert.deepEqual(m.list, [
    { did: A, pds: "https://a.test", handle: "a.test" },
    { did: B, pds: "https://b.test", handle: "pyxorium.com" },
  ]);
  assert.notEqual(m.key, myAccounts({ account: ctx.account }).key, "the key changes with the list");
  assert.equal(nameOf(m.list[1]), "@pyxorium.com");
  assert.equal(nameOf({ did: B }), B);
});

test("where an account's data lives: your accounts answer at once; others are looked up once", async () => {
  assert.equal(await pdsOf(B, [{ did: B, pds: "https://b.test" }]), "https://b.test");
  let lookups = 0;
  const fetchImpl = async () => {
    lookups++;
    return { ok: true, json: async () => ({ service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://c.test/" }] }) };
  };
  const C = "did:plc:cccccccccccccccccccccccc";
  assert.equal(await pdsOf(C, [], fetchImpl), "https://c.test");
  assert.equal(await pdsOf(C, [], fetchImpl), "https://c.test");
  assert.equal(lookups, 1);
  assert.equal(didOfUri(`at://${B}/fm.plyr.track/3m`), B);
  assert.equal(didOfUri(`at://${B}/ing.dasl.masl/3m#/tracks/a.mp3`), B);
  assert.equal(didOfUri("at://pyxorium.com/x/y"), null);
  assert.equal(didOfUri(null), null);
});
