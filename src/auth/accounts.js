// The accounts this browser has signed in to the Foundry with, so the creator
// can switch between them (and, later, use what's in all of them). Kept in the
// browser's localStorage as [{ did, handle }]: the DID is what counts (handles
// can change); the handle is only remembered to show a name before it's looked
// up again. The sign-in library keeps each account's sign-in itself (in
// IndexedDB); this is just the list. Storage may be missing or throw (private
// windows, blocked site data), so every use is guarded and the list then
// simply starts empty.

export const ACCOUNTS_KEY = "foundry-accounts";
export const MAX_ACCOUNTS = 10;
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+)$/;
const HANDLE_RE = /^[a-zA-Z0-9.-]{1,253}$/;

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function clean(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a.did !== "string" || !DID_RE.test(a.did)) continue;
    if (out.some((b) => b.did === a.did)) continue;
    out.push({ did: a.did, handle: typeof a.handle === "string" && HANDLE_RE.test(a.handle) ? a.handle : null });
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

/** The remembered accounts, in the order they were added. */
export function readAccounts(storage = defaultStorage()) {
  try {
    const raw = storage && storage.getItem(ACCOUNTS_KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function save(storage, list) {
  try {
    if (storage) storage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  } catch {
    /* not saved; the list still works for this visit */
  }
  return list;
}

/** Adds an account (or updates its handle); returns the new list. */
export function rememberAccount({ did, handle = null }, storage = defaultStorage()) {
  if (!DID_RE.test(String(did || ""))) return readAccounts(storage);
  const list = readAccounts(storage);
  const i = list.findIndex((a) => a.did === did);
  const entry = { did, handle: handle && HANDLE_RE.test(handle) ? handle : i >= 0 ? list[i].handle : null };
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  return save(storage, clean(list));
}

/** Removes an account from the list; returns the new list. */
export function forgetAccount(did, storage = defaultStorage()) {
  return save(storage, readAccounts(storage).filter((a) => a.did !== did));
}

/** How an account is named on screen. */
export function accountName(a) {
  return a && a.handle ? `@${a.handle}` : a ? a.did : "";
}
