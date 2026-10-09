// More than one account: the remembered list, and adding, switching and
// publishing-to with a stand-in sign-in client (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAccounts, rememberAccount, forgetAccount, accountName, ACCOUNTS_KEY, MAX_ACCOUNTS } from "../src/auth/accounts.js";

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("the list: added in order, handles kept and updated, forgotten, nothing odd kept", () => {
  const s = memoryStorage();
  assert.deepEqual(readAccounts(s), []);
  rememberAccount({ did: A }, s);
  rememberAccount({ did: B, handle: "pyxorium.com" }, s);
  rememberAccount({ did: A, handle: "thunderbirdwine.bsky.social" }, s);
  assert.deepEqual(readAccounts(s), [
    { did: A, handle: "thunderbirdwine.bsky.social" },
    { did: B, handle: "pyxorium.com" },
  ]);
  rememberAccount({ did: A }, s);
  assert.equal(readAccounts(s)[0].handle, "thunderbirdwine.bsky.social", "a known handle isn't lost");
  rememberAccount({ did: "not a did" }, s);
  rememberAccount({ did: B, handle: "<b>" }, s);
  assert.equal(readAccounts(s).length, 2);
  assert.equal(readAccounts(s)[1].handle, "pyxorium.com");
  assert.deepEqual(forgetAccount(A, s), [{ did: B, handle: "pyxorium.com" }]);
  assert.equal(accountName({ did: B, handle: "pyxorium.com" }), "@pyxorium.com");
  assert.equal(accountName({ did: B, handle: null }), B);
});

test("the list survives broken or missing storage", () => {
  const s = memoryStorage();
  s.setItem(ACCOUNTS_KEY, "{not json");
  assert.deepEqual(readAccounts(s), []);
  s.setItem(ACCOUNTS_KEY, JSON.stringify([{ did: A }, { did: A }, null, { did: 5 }]));
  assert.deepEqual(readAccounts(s), [{ did: A, handle: null }]);
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(readAccounts(throwing), []);
  assert.deepEqual(rememberAccount({ did: A }, throwing), [{ did: A, handle: null }]);
  assert.deepEqual(readAccounts(null), []);
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < MAX_ACCOUNTS + 3; i++) rememberAccount({ did: `did:plc:${letters[i].repeat(24)}` }, s);
  assert.equal(readAccounts(s).length, MAX_ACCOUNTS);
});

// ---- Adding and switching, with a stand-in client ----

const sessions = new Map(); // did -> stand-in session
const calls = [];
const session = (sub) => ({
  sub,
  async fetchHandler(path, init) {
    calls.push([sub, path, init.method]);
    return { ok: true, status: 200, text: async () => JSON.stringify({ from: sub }) };
  },
});
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
    if (!sessions.has(did)) throw new Error("The session was deleted");
    return sessions.get(did);
  },
  async revoke(did) {
    sessions.delete(did);
  },
};
sessions.set(A, session(A));
const auth = await import("../src/auth/auth.js");

test("adding an account signs in in the small window and makes it the one in use", async () => {
  assert.deepEqual(await auth.restoreSession(), { did: A, state: null });
  signInBehaviour = (handle) => {
    assert.equal(handle, "pyxorium.com");
    sessions.set(B, session(B));
    return sessions.get(B);
  };
  assert.deepEqual(await auth.addAccount(" @pyxorium.com "), { did: B });
  assert.deepEqual(calls.at(-1), ["signIn", "pyxorium.com", "popup", auth.SIGNIN_WINDOW]);
  assert.deepEqual(await auth.restoreSession(), { did: B, state: null });
  assert.deepEqual(await auth.xrpc("x.y"), { from: B });
});

test("switching uses the stored sign-in; an expired one is reported", async () => {
  assert.deepEqual(await auth.switchAccount(A), { did: A });
  assert.deepEqual(await auth.xrpc("x.y"), { from: A });
  await assert.rejects(auth.switchAccount("did:plc:cccccccccccccccccccccccc"), /deleted/);
  assert.deepEqual(await auth.xrpc("x.y"), { from: A }, "a failed switch leaves the account in use as it was");
});

test("a publish under way keeps going to its account after a switch", async () => {
  await auth.switchAccount(A);
  const toA = auth.xrpcFor(A);
  await auth.switchAccount(B);
  assert.deepEqual(await toA("com.atproto.repo.createRecord", { method: "POST", body: {} }), { from: A });
  assert.deepEqual(await auth.xrpc("x.y"), { from: B });
  assert.throws(() => auth.xrpcFor(A), /isn't the one signed in/);
});

test("the sign-in window, once done, is told apart from a failed sign-in", () => {
  const done = new Error("Login complete, please close the popup window.");
  done.code = "LOGIN_CONTINUED_IN_PARENT_WINDOW";
  assert.ok(auth.finishedInWindow(done));
  assert.equal(auth.finishedInWindow(new Error("Failed to resolve identity")), false);
  assert.equal(auth.finishedInWindow(null), false);
});

test("adding: a storage error gets one retry; other errors are passed on", async () => {
  let n = 0;
  signInBehaviour = () => {
    n++;
    if (n === 1) throw new Error("Database closed");
    return sessions.get(B);
  };
  assert.deepEqual(await auth.addAccount("pyxorium.com"), { did: B });
  assert.equal(n, 2);
  signInBehaviour = () => { throw new Error("Failed to resolve identity: nobody.invalid"); };
  await assert.rejects(auth.addAccount("nobody.invalid"), /Failed to resolve identity/);
});
