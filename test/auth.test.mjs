// The sign-in wrapper, with a stand-in sign-in client (no network).
import { test } from "node:test";
import assert from "node:assert/strict";

let initCalls = 0;
globalThis.__FOUNDRY_TEST_AUTH__ = {
  async init() {
    initCalls++;
    await new Promise((r) => setTimeout(r, 20));
    // A returning sign-in can only be completed once, like the real one.
    if (initCalls > 1) throw new Error("this sign-in was already used");
    return { session: { sub: "did:plc:test" }, state: null };
  },
  async signIn() {},
  async revoke() {},
};
const { restoreSession, signOut } = await import("../src/auth/auth.js");

test("start-up running twice at once still signs in (React development mode)", async () => {
  const [a, b] = await Promise.all([restoreSession(), restoreSession()]);
  assert.equal(initCalls, 1, "the returning sign-in is completed only once");
  assert.deepEqual(a, { did: "did:plc:test", state: null });
  assert.deepEqual(b, a);
});

test("after signing out, the next check asks again", async () => {
  await signOut("did:plc:test");
  await assert.rejects(restoreSession(), /already used/);
  assert.equal(initCalls, 2);
});
