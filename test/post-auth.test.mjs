// The Post step's sign-in helpers (v0.32.0, src/auth/auth.js): what a sign-in
// was granted, posting to the publishing account after a switch, and signing
// the same account in again in the small window. A stand-in sign-in client.
import { test } from "node:test";
import assert from "node:assert/strict";

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const OLD = "atproto repo:ing.dasl.masl blob:*/*";
const NEW = "atproto repo:ing.dasl.masl repo:cafe.thunderbird.tile.post blob:*/*";
const sessions = new Map();
const calls = [];
let generation = 0;
// Like the library's sessions: each sign-in has its own key, so an old copy can't use new tokens.
const session = (sub, scope) => {
  const gen = ++generation;
  return {
    sub,
    gen,
    async getTokenInfo(refresh) {
      calls.push(["getTokenInfo", sub, refresh]);
      return { scope, sub };
    },
    async fetchHandler(path, init) {
      calls.push([sub, gen, path, init.method]);
      return { ok: true, status: 200, text: async () => JSON.stringify({ from: sub, gen }) };
    },
  };
};
let signInBehaviour = null;
globalThis.indexedDB = {};
globalThis.__FOUNDRY_TEST_AUTH__ = {
  async init() {
    return { session: sessions.get(A) };
  },
  async signIn(handle, options) {
    calls.push(["signIn", handle, options && options.display, options && options.popupName]);
    return signInBehaviour(handle, options);
  },
  async restore(did) {
    calls.push(["restore", did]);
    if (!sessions.has(did)) throw new Error("The session was deleted");
    return sessions.get(did);
  },
  async revoke(did) {
    sessions.delete(did);
  },
};
sessions.set(A, session(A, OLD));
sessions.set(B, session(B, NEW));
const auth = await import("../src/auth/auth.js");
const { canPost } = await import("../src/core/tile-post.js");

test("what a sign-in was granted is read without refreshing it", async () => {
  assert.deepEqual(await auth.restoreSession(), { did: A, state: null });
  assert.equal(await auth.grantedScope(A), OLD);
  assert.deepEqual(calls.at(-1), ["getTokenInfo", A, false]);
  assert.equal(canPost(await auth.grantedScope(A)), false, "an old sign-in can't post");
  assert.equal(canPost(await auth.grantedScope(B)), true, "another account's stored sign-in, read without switching to it");
  assert.deepEqual(await auth.xrpc("x.y"), { from: A, gen: sessions.get(A).gen }, "the account in use is still A");
});

test("a sign-in that doesn't say what it was granted: unknown, not refused", async () => {
  const C = "did:plc:cccccccccccccccccccccccc";
  sessions.set(C, { sub: C, async fetchHandler() { return { ok: true, status: 200, text: async () => "{}" }; } });
  assert.equal(await auth.grantedScope(C), null);
  assert.equal(canPost(null), null);
  sessions.delete(C);
  await assert.rejects(auth.grantedScope(C), /deleted/, "an account no longer signed in here");
});

test("a post goes to the publishing account even after switching to another", async () => {
  await auth.switchAccount(B);
  const toA = await auth.xrpcForAccount(A);
  const reply = await toA("com.atproto.repo.createRecord", { method: "POST", body: {} });
  assert.equal(reply.from, A);
  assert.deepEqual(await auth.xrpc("x.y"), { from: B, gen: sessions.get(B).gen }, "the account in use stays B");
  await auth.switchAccount(A);
});

test("signing in again replaces the account's sign-in, and the one in use uses the new one", async () => {
  const before = sessions.get(A).gen;
  signInBehaviour = (handle) => {
    assert.equal(handle, "thunderbird.cafe");
    sessions.set(A, session(A, NEW)); // the library revokes the old one and stores the new
    return sessions.get(A);
  };
  assert.deepEqual(await auth.signInAgain(A, "@thunderbird.cafe"), { did: A });
  assert.deepEqual(calls.at(-1), ["signIn", "thunderbird.cafe", "popup", auth.SIGNIN_WINDOW]);
  assert.equal(canPost(await auth.grantedScope(A)), true);
  const now = await auth.xrpc("x.y");
  assert.equal(now.from, A);
  assert.notEqual(now.gen, before, "calls use the new sign-in, not the old copy");
  assert.equal(now.gen, sessions.get(A).gen);
});

test("signing in again for an account not in use leaves the one in use alone", async () => {
  await auth.switchAccount(B);
  signInBehaviour = () => {
    sessions.set(A, session(A, NEW));
    return sessions.get(A);
  };
  assert.deepEqual(await auth.signInAgain(A, null), { did: A });
  assert.equal(calls.at(-1)[1], A, "with no handle known, the DID is the hint");
  assert.equal((await auth.xrpc("x.y")).from, B);
  await auth.switchAccount(A);
});

test("a window that signs in a different account is reported", async () => {
  signInBehaviour = () => {
    sessions.set(B, session(B, NEW));
    return sessions.get(B);
  };
  await assert.rejects(auth.signInAgain(A, "thunderbird.cafe"), /different account\. Sign in again as @thunderbird\.cafe/);
  assert.equal((await auth.xrpc("x.y")).from, A, "the account in use is unchanged");
});
