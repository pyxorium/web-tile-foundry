import { useCallback, useEffect, useState } from "react";
import { restoreSession, signIn as startSignIn, signOut as endSignIn } from "../auth/auth.js";
import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchOwnSprite } from "../core/atproto.js";
import { DEBUG } from "./debug.js";

// The signed-in account, if any:
//   { status: "starting" | "signedOut" | "signedIn", did, handle, pds, error, busy }
export function useAccount() {
  const [account, setAccount] = useState({ status: "starting" });

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
      try {
        const doc = await resolveDidDocument(session.did);
        if (!cancelled) {
          setAccount({ status: "signedIn", did: session.did, handle: handleFromDidDocument(doc), pds: pdsFromDidDocument(doc) });
        }
      } catch (err) {
        if (!cancelled) setAccount((a) => ({ ...a, error: err.message }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (handle) => {
    if (!handle.trim()) return;
    setAccount((a) => ({ ...a, busy: true, error: null }));
    try {
      await startSignIn(handle);
      // On success the browser has already left for the sign-in page.
    } catch (err) {
      console.error("[sign-in]", err);
      setAccount((a) => ({ ...a, busy: false, error: `Couldn't start sign-in for that handle: ${err.message}` }));
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

  return { account, signIn, signOut };
}

// The signed-in account's own rpg.actor sprite:
//   { state: "idle" | "loading" | "ready" | "none" | "error", sprite, message, retry }
export function useOwnSprite(account) {
  const [state, setState] = useState({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const { did, pds } = account;

  useEffect(() => {
    if (account.status !== "signedIn" || !did || !pds) {
      setState({ state: "idle" });
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
  }, [account.status, did, pds, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
