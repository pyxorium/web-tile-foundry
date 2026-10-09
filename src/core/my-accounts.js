// "Your accounts", as the tile types' panels see them: the account in use
// first, then the creator's other accounts signed in on this browser (see
// src/auth/accounts.js), each with where its data lives. Panels list songs,
// sprites, tiles and tapes from all of them; reading is public, so no sign-in
// is used here. What comes from any of these accounts is the creator's own, so
// it isn't credited to the other account (owner, Oct 9).
//
// The Foundry passes them to panels in `context`:
//   context.account   the account in use ({ status, did, handle, pds, lookupError })
//   context.accounts  [{ did, handle, pds }] the others, as they're looked up

/**
 * { state: "out" | "lookup" | "waiting" | "ok", list: [{ did, pds, handle }], key }
 * `key` changes when the list does (to know when to list again).
 */
export function myAccounts(ctx) {
  const a = ctx && ctx.account;
  if (!a || a.status !== "signedIn" || !a.did) return { state: "out", list: [], key: "" };
  if (a.lookupError) return { state: "lookup", list: [], key: "" };
  if (!a.pds) return { state: "waiting", list: [], key: "" };
  const list = [{ did: a.did, pds: a.pds, handle: a.handle || null }];
  for (const x of (ctx && ctx.accounts) || []) {
    if (!x || !x.did || !x.pds || list.some((y) => y.did === x.did)) continue;
    list.push({ did: x.did, pds: x.pds, handle: x.handle || null });
  }
  return { state: "ok", list, key: list.map((x) => `${x.did}@${x.pds}@${x.handle || ""}`).join("|") };
}

/** An account's name on screen. */
export function nameOf(a) {
  return a && a.handle ? `@${a.handle}` : (a && a.did) || "";
}
