import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  restoreSession,
  signIn as startSignIn,
  signOut as endSignIn,
  isStorageError,
  openSignInWindow,
  addAccount as startAddAccount,
  switchAccount as restoreStoredSignIn,
  finishedInWindow,
} from "../auth/auth.js";
import { readAccounts, rememberAccount, forgetAccount, accountName } from "../auth/accounts.js";
import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchOwnSprite } from "../core/atproto.js";
import { DEBUG } from "./debug.js";

// The signed-in account, if any:
//   { status: "starting" | "signedOut" | "signedIn" | "windowDone", did, handle, pds, error, errorKind, lookupError, busy }
// errorKind "storage": the browser wouldn't let the page store data (see auth.js).
// lookupError: signed in, but the account's handle and data server couldn't be
// looked up (for example, a blocker stopped the request to plc.directory).
// "windowDone": this page is the small sign-in window used to add an account;
// its account has gone back to the Foundry page that opened it.
//
// More than one account: `accounts` lists every account signed in on this
// browser ([{ did, handle }], see src/auth/accounts.js); the one in `account`
// is the one tiles are published to. `adding` is the add-an-account form's state:
//   { state: "idle" | "waiting" | "error", message? }

export const STORAGE_HELP =
  "Sign-in couldn't start because this browser isn't allowing the page to store data. " +
  "Please open this page in your regular browser app (not inside another app, and not in a private tab), then try again.";

export const BLOCKED_HELP =
  "Your browser blocked the sign-in window. Allow pop-ups for this page, then try again. " +
  "(Or sign out and sign in with the other account instead; anything you haven't published is lost that way.)";

export function useAccount() {
  const [account, setAccount] = useState({ status: "starting" });
  const [accounts, setAccounts] = useState(() => readAccounts());
  const [adding, setAdding] = useState({ state: "idle" });
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const addAbort = useRef(null);

  // Start using an account (just signed in, restored, added or switched to).
  const begin = useCallback((did) => {
    const known = readAccounts().find((a) => a.did === did);
    setAccounts(rememberAccount({ did }));
    setAccount({ status: "signedIn", did, handle: known ? known.handle : null, pds: null });
    setLookupAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let session = null;
      const returning = /[?#&](code|error|iss)=/.test(location.search + location.hash);
      try {
        session = await restoreSession();
      } catch (err) {
        if (finishedInWindow(err)) {
          // The add-an-account window: the page that opened it carries on (and closes it).
          if (!cancelled) setAccount({ status: "windowDone" });
          return;
        }
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
      begin(session.did);
    })();
    return () => {
      cancelled = true;
    };
  }, [begin]);

  // After sign-in, look up the account's handle and data server (PDS).
  // Runs again when lookupAttempt changes (the "Try again" button).
  const signedInDid = account.status === "signedIn" ? account.did : null;
  useEffect(() => {
    if (!signedInDid || lookupAttempt === 0) return undefined;
    let cancelled = false;
    setAccount((a) => ({ ...a, lookupError: null }));
    resolveDidDocument(signedInDid)
      .then((doc) => {
        if (cancelled) return;
        const handle = handleFromDidDocument(doc);
        setAccount((a) => (a.did === signedInDid ? { ...a, handle, pds: pdsFromDidDocument(doc), lookupError: null } : a));
        if (handle) setAccounts(rememberAccount({ did: signedInDid, handle }));
      })
      .catch((err) => {
        console.error("[account]", err);
        if (!cancelled) {
          setAccount((a) => (a.did !== signedInDid ? a : {
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

  // Use another account signed in on this browser. If its sign-in has run out,
  // it's taken off the list and the creator is told to add it again.
  const switchTo = useCallback(async (did) => {
    const was = readAccounts().find((a) => a.did === did) || { did };
    setAccount((a) => ({ ...a, busy: true, error: null }));
    try {
      await restoreStoredSignIn(did);
      begin(did);
      return true;
    } catch (err) {
      console.error("[switch]", err);
      setAccounts(forgetAccount(did));
      const message = isStorageError(err)
        ? STORAGE_HELP
        : `${accountName(was)} needs to sign in again (${err.message}). Add it again to use it.`;
      setAccount((a) => ({ ...a, busy: false, error: message }));
      return false;
    }
  }, [begin]);

  // Must be called straight from the form's submit (the window opens first).
  const addAccount = useCallback((handle) => {
    const clean = String(handle || "").trim();
    if (!clean) return;
    const win = openSignInWindow();
    if (!win) {
      setAdding({ state: "error", message: BLOCKED_HELP });
      return;
    }
    const abort = new AbortController();
    addAbort.current = abort;
    setAdding({ state: "waiting" });
    startAddAccount(clean, { signal: abort.signal })
      .then(({ did }) => {
        addAbort.current = null;
        setAdding({ state: "idle" });
        begin(did);
      })
      .catch((err) => {
        addAbort.current = null;
        if (abort.signal.aborted) {
          setAdding({ state: "idle" });
          return;
        }
        console.error("[add account]", err);
        try { win.close(); } catch { /* already gone */ }
        setAdding({
          state: "error",
          message: isStorageError(err) ? STORAGE_HELP : `Couldn't add that account: ${err.message}`,
        });
      });
  }, [begin]);

  const cancelAdding = useCallback(() => {
    if (addAbort.current) addAbort.current.abort();
    addAbort.current = null;
    setAdding({ state: "idle" });
  }, []);

  // Signs out of the account in use; another account on this browser, if any, takes over.
  const signOut = useCallback(async () => {
    const did = account.did;
    try {
      if (did) await endSignIn(did);
    } catch (err) {
      console.error("[sign-out]", err);
    }
    const rest = did ? forgetAccount(did) : readAccounts();
    setAccounts(rest);
    for (const next of rest) {
      if (await switchTo(next.did)) return;
    }
    setAccount({ status: "signedOut" });
  }, [account.did, switchTo]);

  return { account, accounts, adding, signIn, signOut, switchTo, addAccount, cancelAdding, retryLookup };
}

// The creator's other accounts on this browser, with where each one's data lives
// (looked up once each): [{ did, handle, pds }]. Panels read songs, sprites,
// tiles and tapes from all of them (src/core/my-accounts.js).
export function useOtherAccounts(account, accounts) {
  const [found, setFound] = useState({}); // did -> { pds, handle } | { failed: true }
  const others = account.status === "signedIn" ? accounts.filter((a) => a.did !== account.did) : [];
  const want = others.map((a) => a.did).join(",");
  useEffect(() => {
    let cancelled = false;
    for (const did of want ? want.split(",") : []) {
      if (found[did]) continue;
      resolveDidDocument(did)
        .then((doc) => {
          if (cancelled) return;
          const handle = handleFromDidDocument(doc);
          setFound((f) => ({ ...f, [did]: { pds: pdsFromDidDocument(doc), handle } }));
        })
        .catch((err) => {
          console.error("[account]", did, err);
          if (!cancelled) setFound((f) => ({ ...f, [did]: { failed: true } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);
  const list = others
    .filter((a) => found[a.did] && found[a.did].pds)
    .map((a) => ({ did: a.did, pds: found[a.did].pds, handle: found[a.did].handle || a.handle || null }));
  const key = list.map((a) => `${a.did}@${a.pds}@${a.handle || ""}`).join("|");
  // The same array while nothing in it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => list, [key]);
}

// The creator's own rpg.actor sprite:
//   { state: "idle" | "loading" | "ready" | "none" | "error", sprite, message, lookup, retry,
//     options: [{ did, handle }], chosen, choose(did) }
// It's read from the account in use and from the creator's other accounts
// (`others`, from useOtherAccounts). The account in use's sprite comes first;
// if it has none, another account's is used. With sprites in more than one
// account, `options` lists them and `choose` picks one.
export function useOwnSprite(account, retryLookup, others = []) {
  const [state, setState] = useState({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [found, setFound] = useState({}); // did -> sprite | null (other accounts)
  const [chosen, setChosen] = useState(null);
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

  // The other accounts' sprites (looked up once each; missing ones are just left out).
  const othersKey = others.map((a) => `${a.did}@${a.pds}`).join("|");
  useEffect(() => {
    let cancelled = false;
    for (const a of others) {
      if (a.did in found) continue;
      fetchOwnSprite(a.did, a.pds)
        .then(({ sprite }) => { if (!cancelled) setFound((f) => ({ ...f, [a.did]: sprite || null })); })
        .catch((err) => {
          console.error("[sprite]", a.did, err);
          if (!cancelled) setFound((f) => ({ ...f, [a.did]: null }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey, attempt]);

  const retry = state.lookup && retryLookup ? retryLookup : () => setAttempt((n) => n + 1);
  const options = [];
  if (state.state === "ready") options.push({ did, handle: account.handle || null, sprite: state.sprite });
  for (const a of others) if (found[a.did]) options.push({ did: a.did, handle: a.handle || null, sprite: found[a.did] });
  // Another account's sprite stands in when the account in use has none (or couldn't be read).
  if (state.state === "loading" || state.state === "idle" || (!options.length && state.state !== "ready")) {
    return { ...state, retry, options: [], chosen: null, choose: setChosen };
  }
  const pick = options.find((o) => o.did === chosen) || options[0];
  return {
    state: "ready",
    sprite: pick.sprite,
    retry,
    options: options.map((o) => ({ did: o.did, handle: o.handle })),
    chosen: pick.did,
    choose: setChosen,
  };
}
