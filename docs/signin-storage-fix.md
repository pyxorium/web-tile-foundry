# Sign-in "Database closed" fix (web-tile-foundry, Oct 4 2026, commit b9efabc)

**Report:** an external user (zzstoatzz.io, self-hosted PDS) saw "Couldn't start sign-in for that handle: Database closed" before being sent to his PDS. His account, DID document and PDS OAuth metadata checked out fine; the user's own Bluesky and Eurosky accounts sign in normally.

**Cause (found in the code):** `src/auth/auth.js` makes one `BrowserOAuthClient` (`@atproto/oauth-client-browser` 0.5.8) per page load (`makeClient`/`getClient`, kept in `clientPromise`). The library stores its records in IndexedDB through its own wrapper (`DB` in `src/indexed-db/db.ts`), which opens one connection when the client is made. If the browser closes that connection (`close` or `versionchange` event, for example an in-app browser sent to the background, or site data cleared), the wrapper clears its handle and every later use throws "Database closed" until the page is reloaded. Browsers without IndexedDB (some in-app browsers, some private modes) fail too. Which case hit this user: unconfirmed (waiting for his device, browser and `[sign-in]` console line).

**Fix:**
- `auth.js` `signIn`: if IndexedDB is missing, throws "IndexedDB is not available in this browser". If sign-in fails with "Database closed", disposes the old client (`dispose()`), makes a fresh one with a fresh storage connection, and tries exactly once more. Other errors are not retried. Errors reach the page unchanged. `isStorageError(err)` (message contains "Database closed" or the no-IndexedDB message). Test hook `__FOUNDRY_TEST_AUTH__` may now be a function that makes a fresh client.
- `useAccount.js`: `console.error("[sign-in]", err)` kept with the full error; storage errors show "Sign-in couldn't start because this browser isn't allowing the page to store data. Please open this page in your regular browser app (not inside another app, and not in a private tab), then try again." (`errorKind: "storage"`); other errors unchanged.
- `SignIn.jsx`: a "Copy link" button under that message (clipboard, then the older copy command, then the link shown to copy by hand); copies origin + path.
- `test/auth-storage.test.mjs`: 5 tests with stand-in clients. Tests 123/123.
- Unchanged for browsers where sign-in already works (one call, same client).

**Later:** House Dice may use the same library and have the same weak spot.
