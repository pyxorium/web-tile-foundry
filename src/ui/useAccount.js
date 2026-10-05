import { useCallback, useEffect, useState } from "react";
import { restoreSession, signIn as startSignIn, signOut as endSignIn, isStorageError } from "../auth/auth.js";
import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchOwnSprite } from "../core/atproto.js";
import { DEBUG } from "./debug.js";

// The signed-in account, if any:
//   { status: "starting" | "signedOut" | "signedIn", did, handle, pds, error, errorKind, lookupError, busy }
// errorKind "storage": the browser wouldn't let the page store data (see auth.js).
// lookupError: signed in, but the account's handle and data server couldn't be
// looked up (for example, a blocker stopped the request to plc.directory).

export const STORAGE_HELP =
  "Sign-in couldn't start because this browser isn't allowing the page to store data. " +
  "Please open this page in your regular browser app (not inside another app, and not in a private tab), then try again.";

export function useAccount() {
  const [account, setAccount] = useState({ status: "starting" });
  const [lookupAttempt, setLookupAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let session = null;
      const returning = /[?#&](code|error|iss)=/.test(location.search + location.hash);
      try {
        session = await restoreSession();
      } catch (err) {
        console.error("[sign-in]", err);
        // Restoring an old sign-in can fail harmlessly (it expired, or the app's
        // address changed): just start signed out. A failed return from the
        // sign-in page is worth telling the user about.
        if (!cancelled) {
          setAccount(returning ? { status: "signedOut", error: `Sign-in didn't complete: ${err.message}` } : { status: "signedOut" });
        }
        return;
      } finally {
        // Tidy the address after returning from the sign-in page.
        if (/[?#&](code|error|iss)=/.test(location.search + location.hash)) {
          history.replaceState(null, "", location.pathname + (DEBUG ? "?debug" : ""));
        }
      }
      if (cancelled) return;
      if (!session) {
        setAccount({ status: "signedOut" });
        return;
      }
      setAccount({ status: "signedIn", did: session.did, handle: null, pds: null });
      setLookupAttempt((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // After sign-in, look up the account's handle and data server (PDS).
  // Runs again when lookupAttempt changes (the "Try again" button).
  const signedInDid = account.status === "signedIn" ? account.did : null;
  useEffect(() => {
    if (!signedInDid || lookupAttempt === 0) return undefined;
    let cancelled = false;
    setAccount((a) => ({ ...a, lookupError: null }));
    resolveDidDocument(signedInDid)
      .then((doc) => {
        if (!cancelled) {
          setAccount((a) => ({ ...a, handle: handleFromDidDocument(doc), pds: pdsFromDidDocument(doc), lookupError: null }));
        }
      })
      .catch((err) => {
        console.error("[account]", err);
        if (!cancelled) {
          setAccount((a) => ({
            ...a,
            lookupError:
              `Couldn't look up your account's details (${err.message}), so your sprite can't be fetched yet. ` +
              "An ad or privacy blocker, or a work or school network, may be blocking the lookup. " +
              "\"Try again\" asks for your account details again and, if that works, loads your sprite. " +
              "If it keeps failing, turn off your blocker for this page (or use a different browser), then press Try again.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedInDid, lookupAttempt]);

  const retryLookup = useCallback(() => setLookupAttempt((n) => n + 1), []);

  const signIn = useCallback(async (handle) => {
    if (!handle.trim()) return;
    setAccount((a) => ({ ...a, busy: true, error: null, errorKind: null }));
    try {
      await startSignIn(handle);
      // On success the browser has already left for the sign-in page.
    } catch (err) {
      console.error("[sign-in]", err);
      if (isStorageError(err)) {
        setAccount((a) => ({ ...a, busy: false, error: STORAGE_HELP, errorKind: "storage" }));
      } else {
        setAccount((a) => ({ ...a, busy: false, error: `Couldn't start sign-in for that handle: ${err.message}`, errorKind: null }));
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (account.did) await endSignIn(account.did);
    } catch (err) {
      console.error("[sign-out]", err);
    }
    setAccount({ status: "signedOut" });
  }, [account.did]);

  return { account, signIn, signOut, retryLookup };
}

// The signed-in account's own rpg.actor sprite:
//   { state: "idle" | "loading" | "ready" | "none" | "error", sprite, message, lookup, retry }
export function useOwnSprite(account, retryLookup) {
  const [state, setState] = useState({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const { did, pds } = account;

  useEffect(() => {
    if (account.status !== "signedIn" || !did) {
      setState({ state: "idle" });
      return undefined;
    }
    // Signed in, but the account's data server isn't known yet: still being
    // looked up, or the lookup failed (shown with its own "Try again").
    if (!pds) {
      setState(account.lookupError ? { state: "error", message: account.lookupError, lookup: true } : { state: "loading" });
      return undefined;
    }
    let cancelled = false;
    setState({ state: "loading" });
    fetchOwnSprite(did, pds)
      .then(({ sprite }) => {
        if (!cancelled) setState(sprite ? { state: "ready", sprite } : { state: "none" });
      })
      .catch((err) => {
        console.error("[sprite]", err);
        if (!cancelled) setState({ state: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [account.status, did, pds, account.lookupError, attempt]);

  // When the account lookup is what failed, "Try again" redoes the lookup.
  return { ...state, retry: state.lookup && retryLookup ? retryLookup : () => setAttempt((n) => n + 1) };
}
