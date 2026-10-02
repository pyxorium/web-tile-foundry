import { spriteFromBytes, SpriteError } from "./sprite-source.js";

// Reading public atproto data: an account's DID document (where its data
// lives, and its handle), and its rpg.actor sprite. No sign-in is needed to
// read public records, so none of this uses the session.
//
// Same approach as House Dice's resolvePdsEndpoint / fetchSprite, with a
// timeout so a slow server can't hang the page.

export const SPRITE_COLLECTION = "actor.rpg.sprite";
export const SPRITE_RKEY = "self";
const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, fetchImpl, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("The account's server is taking too long to respond.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The DID document for a did:plc or did:web account. */
export async function resolveDidDocument(did, fetchImpl = fetch) {
  let url;
  if (did.startsWith("did:plc:")) url = `https://plc.directory/${encodeURIComponent(did)}`;
  else if (did.startsWith("did:web:")) url = `https://${did.slice("did:web:".length)}/.well-known/did.json`;
  else throw new Error(`Unsupported account type: ${did}`);
  const res = await fetchWithTimeout(url, fetchImpl);
  if (!res.ok) throw new Error("Could not look up this account.");
  return res.json();
}

/** The account's data server (PDS) address, from its DID document. */
export function pdsFromDidDocument(doc) {
  const service = (doc.service || []).find(
    (s) => s.type === "AtprotoPersonalDataServer" || (typeof s.id === "string" && s.id.endsWith("#atproto_pds"))
  );
  if (!service) throw new Error("This account has no data server listed.");
  return String(service.serviceEndpoint).replace(/\/+$/, "");
}

/** The account's handle, from its DID document (null if none is listed). */
export function handleFromDidDocument(doc) {
  const aka = (doc.alsoKnownAs || []).find((a) => typeof a === "string" && a.startsWith("at://"));
  return aka ? aka.slice("at://".length) : null;
}

/**
 * The account's own rpg.actor sprite, ready for the sprite-walker:
 *   { sprite }             when there is one
 *   { sprite: null }       when the account has no sprite yet
 * Throws (with a plain message) when something else goes wrong.
 */
export async function fetchOwnSprite(did, pds, fetchImpl = fetch) {
  const recordUrl = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  recordUrl.searchParams.set("repo", did);
  recordUrl.searchParams.set("collection", SPRITE_COLLECTION);
  recordUrl.searchParams.set("rkey", SPRITE_RKEY);
  const res = await fetchWithTimeout(recordUrl.toString(), fetchImpl);
  if (!res.ok) {
    let error = null;
    try { error = (await res.json()).error; } catch { /* not JSON */ }
    if (res.status === 404 || error === "RecordNotFound") return { sprite: null };
    throw new Error("Could not read your sprite from your account's server.");
  }
  const { uri, value } = await res.json();
  const blobCid = value && value.spriteSheet && value.spriteSheet.ref && value.spriteSheet.ref.$link;
  if (!blobCid) throw new SpriteError("Your sprite record has no sprite sheet in it.");

  const blobUrl = new URL(`${pds}/xrpc/com.atproto.sync.getBlob`);
  blobUrl.searchParams.set("did", did);
  blobUrl.searchParams.set("cid", blobCid);
  const blobRes = await fetchWithTimeout(blobUrl.toString(), fetchImpl);
  if (!blobRes.ok) throw new Error("Your sprite record was found, but its image could not be downloaded.");
  const bytes = new Uint8Array(await blobRes.arrayBuffer());

  const sprite = await spriteFromBytes(
    bytes,
    { kind: "record", uri: uri || `at://${did}/${SPRITE_COLLECTION}/${SPRITE_RKEY}`, generator: value.source ?? null },
    value
  );
  // The image's own address must match the one the record points to.
  if (sprite.cid !== blobCid) {
    throw new SpriteError("The downloaded sprite image doesn't match your sprite record. Please try again.");
  }
  return { sprite };
}

/** Downloads a public file (blob) from an account's server. */
export async function fetchPublicBlob(did, pds, cid, fetchImpl = fetch) {
  const url = new URL(`${pds}/xrpc/com.atproto.sync.getBlob`);
  url.searchParams.set("did", did);
  url.searchParams.set("cid", cid);
  const res = await fetchWithTimeout(url.toString(), fetchImpl);
  if (!res.ok) throw new Error(`Could not download ${cid} (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}
