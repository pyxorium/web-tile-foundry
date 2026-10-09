import { XrpcError } from "../core/publish.js";
import {
  HANDLE_RESOLVER,
  isLoopbackHost,
  loopbackClientId,
  loopbackClientMetadata,
  productionClientMetadata,
} from "./client-config.js";

// Browser sign-in, using @atproto/oauth-client-browser the same way House Dice
// does (init, signIn, revoke). Authenticated calls to the account's server go
// through the session's own fetchHandler (what @atproto/api's Agent uses
// underneath), so no further package is needed.
//
// Development runs in atproto's localhost client mode. The library requires
// the page to be opened at 127.0.0.1 (not "localhost"), so the Foundry moves
// itself there first (see ensureLoopbackAddress).

let clientPromise = null;
let restorePromise = null;
let currentSession = null;

function onThisComputer() {
  return isLoopbackHost(location.hostname);
}

/** If opened at localhost, reload at 127.0.0.1 (same port and path). */
export function ensureLoopbackAddress() {
  if (location.hostname === "localhost") {
    const url = new URL(location.href);
    url.hostname = "127.0.0.1";
    location.replace(url.toString());
    return false;
  }
  return true;
}

async function makeClient() {
  // A test hook for the Foundry's own tests, which have no sign-in server.
  // It may be a client, or a function that makes a fresh one each time.
  const testAuth = globalThis.__FOUNDRY_TEST_AUTH__;
  if (testAuth) return typeof testAuth === "function" ? testAuth() : testAuth;

  const { BrowserOAuthClient } = await import("@atproto/oauth-client-browser");
  if (!onThisComputer()) {
    return new BrowserOAuthClient({ clientMetadata: productionClientMetadata(), handleResolver: HANDLE_RESOLVER });
  }
  const redirectUri = `http://127.0.0.1${location.port ? ":" + location.port : ""}/`;
  const clientId = loopbackClientId(redirectUri);
  // Preferred: let the library derive the details from the development client
  // ID itself. Fallback: spell them out, exactly as the spec says a sign-in
  // server derives them.
  if (typeof BrowserOAuthClient.load === "function") {
    try {
      return await BrowserOAuthClient.load({ clientId, handleResolver: HANDLE_RESOLVER });
    } catch (err) {
      console.warn("[sign-in] BrowserOAuthClient.load did not accept the development client ID; spelling it out instead.", err);
    }
  }
  return new BrowserOAuthClient({ clientMetadata: loopbackClientMetadata(redirectUri), handleResolver: HANDLE_RESOLVER });
}

function getClient() {
  if (!clientPromise) {
    clientPromise = makeClient().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * Finishes a sign-in that just returned from the account's server, or restores
 * an earlier one. Returns { did, state } or null when nobody is signed in.
 *
 * Runs init() only ONCE per page load and shares the answer. A returning
 * sign-in can only be completed once; in development React deliberately runs
 * start-up code twice, and a second, simultaneous init() would find the
 * sign-in already used up and report "signed out".
 */
export function restoreSession() {
  if (!restorePromise) {
    restorePromise = (async () => {
      const client = await getClient();
      const result = await client.init();
      if (!result || !result.session) return null;
      currentSession = result.session;
      return { did: result.session.sub, state: result.state ?? null };
    })();
  }
  return restorePromise;
}

/** Forget the shared answer (after signing out, the next check starts fresh). */
function forgetRestoredSession() {
  restorePromise = null;
  currentSession = null;
}

/**
 * An authenticated call to the signed-in account's own server.
 *   xrpc("com.atproto.repo.createRecord", { method: "POST", body: {...} })
 * Bytes are sent as-is with `contentType`; anything else as JSON.
 * Returns the parsed reply, or throws an XrpcError with the server's error name.
 */
export function xrpc(nsid, options) {
  if (!currentSession) return Promise.reject(new Error("You're not signed in."));
  return callWith(currentSession, nsid, options);
}

/**
 * xrpc, held to one account: calls made with it keep going to that account even
 * if the creator switches accounts meanwhile (a publish that's under way).
 */
export function xrpcFor(did) {
  const session = currentSession;
  if (!session || session.sub !== did) throw new Error("That account isn't the one signed in now.");
  return (nsid, options) => callWith(session, nsid, options);
}

async function callWith(session, nsid, { method = "GET", params, body, contentType } = {}) {
  let path = `/xrpc/${nsid}`;
  if (params) path += `?${new URLSearchParams(params)}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    if (body instanceof Uint8Array) {
      init.body = body;
      init.headers["content-type"] = contentType || "application/octet-stream";
    } else {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
  }
  const res = await session.fetchHandler(path, init);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new XrpcError(res.status, data && data.error, data && data.message);
  return data;
}

// The sign-in library (@atproto/oauth-client-browser) keeps its records in the
// browser's storage, IndexedDB, through its own small database wrapper. It
// opens that storage once, when the client is made. If the browser later closes
// the connection, every use after that fails with "Database closed". Some
// browsers (some in-app browsers, some private modes) don't offer IndexedDB at all.

const NO_STORAGE_MESSAGE = "IndexedDB is not available in this browser";

/** Whether sign-in failed because of the browser's storage (not the account or its server). */
export function isStorageError(err) {
  const message = (err && err.message) || "";
  return message.includes("Database closed") || message.includes(NO_STORAGE_MESSAGE);
}

/** Throws away the sign-in client (and its storage connection); the next use makes a new one. */
async function resetClient() {
  const old = clientPromise;
  clientPromise = null;
  if (!old) return;
  try {
    const client = await old;
    if (client && typeof client.dispose === "function") await client.dispose();
  } catch {
    /* it was already broken: nothing to tidy */
  }
}

async function startSignIn(handle, state) {
  const client = await getClient();
  await client.signIn(handle, state ? { state } : undefined);
}

/**
 * Sends the browser to the account's server to sign in. Does not return on success.
 * If it fails with "Database closed", it makes a fresh client (with a fresh
 * storage connection) and tries exactly once more. Errors are passed on as
 * they are, so the page can log them in full.
 */
export async function signIn(handle, state = "") {
  const clean = handle.trim().replace(/^@/, "");
  if (typeof indexedDB === "undefined" || indexedDB === null) throw new Error(NO_STORAGE_MESSAGE);
  try {
    await startSignIn(clean, state);
  } catch (err) {
    if (!isStorageError(err)) throw err;
    console.warn("[sign-in] Storage connection closed; trying once more with a fresh one.", err);
    await resetClient();
    await startSignIn(clean, state); // no further retries: a second failure goes to the page as it is
  }
}

/** Signs out: the session is revoked on the account's server and forgotten here. */
export async function signOut(did) {
  const client = await getClient();
  try {
    await client.revoke(did);
  } finally {
    forgetRestoredSession();
  }
}

// ---- More than one account (claude/web-tile-foundry-progress.md, multi-account) ----
//
// The sign-in library keeps a sign-in for every account that has signed in on
// this browser, and remembers which one is in use. Adding an account signs in
// through a small window, so the tile being made on this page is kept;
// switching uses the stored sign-in, with no trip to the account's server.

/** The name of the sign-in window, opened by openSignInWindow and reused by the library. */
export const SIGNIN_WINDOW = "foundry-signin";

/**
 * Opens the (empty) sign-in window. Call it straight from the click or form
 * submit, before anything is awaited, or the browser blocks it. Returns the
 * window, or null when the browser blocked it.
 */
export function openSignInWindow() {
  try {
    return window.open("about:blank", SIGNIN_WINDOW, "width=600,height=720,menubar=no,toolbar=no") || null;
  } catch {
    return null;
  }
}

/** Whether this page is the sign-in window, done: its account went back to the page that opened it. */
export function finishedInWindow(err) {
  return Boolean(err && err.code === "LOGIN_CONTINUED_IN_PARENT_WINDOW");
}

function use(session) {
  currentSession = session;
  restorePromise = Promise.resolve({ did: session.sub, state: null });
  return { did: session.sub };
}

async function withFreshStorage(run) {
  try {
    return await run(await getClient());
  } catch (err) {
    if (!isStorageError(err)) throw err;
    console.warn("[sign-in] Storage connection closed; trying once more with a fresh one.", err);
    await resetClient();
    return run(await getClient());
  }
}

/**
 * Signs in to another account in the sign-in window (already opened with
 * openSignInWindow), and makes it the one in use. Resolves with { did } when
 * the window reports back; `signal` cancels the wait.
 */
export async function addAccount(handle, { signal } = {}) {
  const clean = handle.trim().replace(/^@/, "");
  if (typeof indexedDB === "undefined" || indexedDB === null) throw new Error(NO_STORAGE_MESSAGE);
  const session = await withFreshStorage((client) => client.signIn(clean, { display: "popup", popupName: SIGNIN_WINDOW, signal }));
  return use(session);
}

/** Makes another account that signed in on this browser the one in use. */
export async function switchAccount(did) {
  const session = await withFreshStorage((client) => client.restore(did));
  return use(session);
}
