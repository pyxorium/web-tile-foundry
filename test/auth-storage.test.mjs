// Sign-in when the browser's storage fails ("Database closed"), with stand-in
// sign-in clients (no network). Its own file, so the sign-in module starts fresh.
import { test } from "node:test";
import assert from "node:assert/strict";

// What a client's signIn does, decided when it is called: behaviour(clientNumber).
let behaviour = () => {};
let made = 0;
let disposed = 0;
const calls = [];
globalThis.__FOUNDRY_TEST_AUTH__ = () => {
  const n = ++made;
  return {
    async signIn(handle) {
      calls.push([n, handle]);
      return behaviour(n);
    },
    async dispose() {
      disposed++;
    },
  };
};
globalThis.indexedDB = {}; // Node has none; the browser's is only checked for presence

const { signIn, isStorageError } = await import("../src/auth/auth.js");
const closed = () => {
  throw new Error("Database closed");
};

test("storage errors are told apart from account and network errors", () => {
  assert.ok(isStorageError(new Error("Database closed")));
  assert.ok(isStorageError(new Error("IndexedDB is not available in this browser")));
  assert.equal(isStorageError(new Error("Failed to resolve identity: zzstoatzz.io")), false);
  assert.equal(isStorageError(null), false);
});

test("a closed storage connection: sign-in starts once more with a fresh client, and works", async () => {
  behaviour = (n) => (n === 1 ? closed() : undefined);
  await signIn("@someone.test");
  assert.deepEqual(calls, [[1, "someone.test"], [2, "someone.test"]]);
  assert.equal(disposed, 1, "the broken client was put away");
});

test("storage that keeps failing: exactly one retry, then the original error, unchanged", async () => {
  calls.length = 0;
  behaviour = closed;
  await assert.rejects(signIn("x.test"), /^Error: Database closed$/);
  assert.deepEqual(calls, [[2, "x.test"], [3, "x.test"]], "the cached client, then one fresh one: no more");
});

test("other errors (a mistyped handle, a server problem) are passed on untouched, without a retry", async () => {
  calls.length = 0;
  behaviour = () => {
    throw new Error("Failed to resolve identity: nobody.invalid");
  };
  await assert.rejects(signIn("nobody.invalid"), /Failed to resolve identity/);
  assert.deepEqual(calls, [[3, "nobody.invalid"]]);
});

test("no IndexedDB at all: a storage error, without trying", async () => {
  calls.length = 0;
  const saved = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try {
    await assert.rejects(signIn("someone.test"), (err) => isStorageError(err));
    assert.deepEqual(calls, []);
  } finally {
    globalThis.indexedDB = saved;
  }
});
