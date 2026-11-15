// The importer's permission (v0.35.0, claude/mixtape-v2-plan.md R3-A8): the
// Foundry declares the track permission but every ordinary sign-in asks for
// today's permissions only; "Sign in again to allow importing" asks for both;
// signing in again for the Post step keeps importing if the account had it.
// A stand-in sign-in client that records what each sign-in asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCOPE, IMPORT_SCOPE } from "../src/auth/client-config.js";

const P = "did:plc:rqbqpaaluty5v47jwciowpik";
const sessions = new Map();
const asked = [];
const session = (sub, scope) => ({
  sub,
  async getTokenInfo() {
    return { scope, sub };
  },
  async fetchHandler() {
    return { ok: true, status: 200, text: async () => "{}" };
  },
});
globalThis.indexedDB = {};
globalThis.__FOUNDRY_TEST_AUTH__ = {
  async init() {
    return null;
  },
  async signIn(handle, options) {
    asked.push({ handle, scope: options && options.scope, display: options && options.display });
    const s = session(P, options && options.scope);
    sessions.set(P, s);
    return s;
  },
  async restore(did) {
    if (!sessions.has(did)) throw new Error("The session was deleted");
    return sessions.get(did);
  },
  async revoke(did) {
    sessions.delete(did);
  },
};
const auth = await import("../src/auth/auth.js");

test("a plain sign-in (leaving for the account's page) asks for today's permissions only", async () => {
  await auth.signIn("pyxorium.com");
  assert.equal(asked.at(-1).scope, SCOPE);
  await auth.signIn("pyxorium.com", "some-state");
  assert.equal(asked.at(-1).scope, SCOPE);
});

test("adding an account asks for today's permissions only", async () => {
  await auth.addAccount("pyxorium.com");
  assert.deepEqual(asked.at(-1), { handle: "pyxorium.com", scope: SCOPE, display: "popup" });
});

test("“Sign in again to allow importing” asks for today's permissions plus songs, in the small window", async () => {
  await auth.signInAgain(P, "pyxorium.com", { scope: IMPORT_SCOPE });
  assert.deepEqual(asked.at(-1), { handle: "pyxorium.com", scope: IMPORT_SCOPE, display: "popup" });
});

test("signing in again for the Post step keeps importing when the account has it, and doesn't add it otherwise", async () => {
  sessions.set(P, session(P, IMPORT_SCOPE));
  await auth.switchAccount(P);
  await auth.signInAgain(P, "pyxorium.com");
  assert.equal(asked.at(-1).scope, IMPORT_SCOPE);
  sessions.set(P, session(P, SCOPE));
  await auth.switchAccount(P); // the account in use is read from the page's own copy
  await auth.signInAgain(P, "pyxorium.com");
  assert.equal(asked.at(-1).scope, SCOPE);
  await auth.signOut(P);
  await auth.signInAgain(P, "pyxorium.com");
  assert.equal(asked.at(-1).scope, SCOPE, "no stored sign-in: today's permissions");
});
