import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchPublicBlob } from "./atproto.js";
import { rawCid } from "./cid.js";
import { contentTypeFor } from "./fileset.js";

// Reading a published tile back from its author's account: the record, and
// every one of its files, each checked against the address the record gives
// for it. Public reads only (no sign-in). Used to put a creator's own tiles on
// zine pages (claude/zine-maker-plan.md section 26).

export const TILE_COLLECTION = "ing.dasl.masl";
const APPVIEW = "https://public.api.bsky.app";
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+)$/;
const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const RKEY_RE = /^[A-Za-z0-9._~:-]{1,512}$/;

/**
 * Reads a tile address in any of the forms people copy:
 *   at://<did or handle>/ing.dasl.masl/<rkey>
 *   https://appmosphe.re/@<handle or did>/<rkey>
 *   https://webtil.es/browser/#url=at://…
 * Returns { repo, rkey } (repo is a DID or a handle) or null.
 */
export function parseTileAddress(text) {
  let s = String(text || "").trim();
  if (!s) return null;
  const hash = /#url=(.+)$/.exec(s);
  if (hash) s = decodeURIComponent(hash[1]);
  let m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(s);
  if (m) {
    if (m[2] !== TILE_COLLECTION) return null;
    return checked(decodeURIComponent(m[1]), m[3]);
  }
  m = /^https:\/\/(?:www\.)?appmosphe\.re\/@([^/]+)\/([^/?#]+)\/?$/.exec(s);
  if (m) return checked(decodeURIComponent(m[1]), m[2]);
  return null;
}
function checked(repo, rkey) {
  if (!(DID_RE.test(repo) || HANDLE_RE.test(repo))) return null;
  if (!RKEY_RE.test(rkey)) return null;
  return { repo, rkey };
}

/** A handle or DID, as a DID. */
export async function resolveRepo(repo, fetchImpl = fetch) {
  if (DID_RE.test(repo)) return repo;
  const url = `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(repo)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Couldn't find the account @${repo}.`);
  const { did } = await res.json();
  if (!DID_RE.test(String(did || ""))) throw new Error(`Couldn't find the account @${repo}.`);
  return did;
}

/** The blob address in a record's file reference, or null. */
export function blobCidOf(src) {
  const link = src && src.ref && src.ref.$link;
  return typeof link === "string" && link ? link : null;
}

/**
 * Reads a published tile: { uri, cid, did, handle, pds, manifest, files, recipe }.
 * `files` is [{ path, bytes, contentType }] exactly as published (bytes checked
 * against their addresses); `recipe` is the parsed /foundry.json, or null for a
 * tile the Foundry didn't make. With `only` (a list of paths), just those files
 * are downloaded (a tape's songs are big and not needed for its J-card).
 */
export async function fetchPublishedTile(address, { fetchImpl = fetch, only = null } = {}) {
  const where = parseTileAddress(address);
  if (!where) throw new Error("That doesn't look like a tile address. Paste its at:// address or its appmosphe.re link.");
  const did = await resolveRepo(where.repo, fetchImpl);
  const doc = await resolveDidDocument(did, fetchImpl);
  const pds = pdsFromDidDocument(doc);
  const recordUrl = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  recordUrl.searchParams.set("repo", did);
  recordUrl.searchParams.set("collection", TILE_COLLECTION);
  recordUrl.searchParams.set("rkey", where.rkey);
  const res = await fetchImpl(recordUrl.toString());
  if (res.status === 400 || res.status === 404) throw new Error("No tile was found at that address. It may have been deleted.");
  if (!res.ok) throw new Error(`The tile's record couldn't be read (${res.status}).`);
  const { uri, cid, value } = await res.json();
  const manifest = value && value.tile;
  const resources = manifest && manifest.resources;
  if (!resources || typeof resources !== "object" || !resources["/"]) throw new Error("That record isn't a tile this Foundry can read.");
  const files = [];
  for (const [path, entry] of Object.entries(resources)) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    if (only && !only.includes(path)) continue;
    const blob = blobCidOf(entry && entry.src);
    if (!blob) throw new Error(`The tile's file ${path} has no address.`);
    const bytes = await fetchPublicBlob(did, pds, blob, fetchImpl);
    if ((await rawCid(bytes)) !== blob) throw new Error(`The tile's file ${path} didn't match its address. Please try again.`);
    files.push({ path, bytes, contentType: String((entry && entry["content-type"]) || "") });
  }
  let recipe = null;
  const recipeFile = files.find((f) => f.path === "/foundry.json");
  if (recipeFile) {
    try { recipe = JSON.parse(new TextDecoder().decode(recipeFile.bytes)); } catch { recipe = null; }
  }
  return { uri: uri || `at://${did}/${TILE_COLLECTION}/${where.rkey}`, cid, did, handle: handleFromDidDocument(doc), pds, manifest, files, recipe };
}

/** A file of a published tile, as text parsed from JSON (null if missing or not JSON). */
export function jsonFile(files, path) {
  const f = (files || []).find((x) => x.path === path);
  if (!f) return null;
  try { return JSON.parse(new TextDecoder().decode(f.bytes)); } catch { return null; }
}

/**
 * Where a published tile's files go inside another tile: under `folder`
 * ("/t1"), the page as `${folder}/index.html`. Each copy keeps its bytes and
 * must keep its content type (a PDS keeps the first type it saw for given
 * bytes; see src/core/fileset.js), so a file whose type differs from the one
 * the Foundry gives its new path can't be copied.
 */
export function copyPaths(files, folder) {
  return files.map((f) => {
    const to = f.path === "/" ? `${folder}/index.html` : `${folder}${f.path}`;
    const type = contentTypeFor(to);
    if (f.contentType && f.contentType !== type) {
      throw new Error(`The tile's file ${f.path} is stored as ${f.contentType}, so it can't be copied as ${type}.`);
    }
    return { from: f.path, path: to, bytes: f.bytes, contentType: type };
  });
}

/** The root paths a tile's page refers to in quotes ("/lantern.js"), among the tile's own files. */
export function pageRefs(html, paths) {
  return paths.filter((p) => p !== "/" && (html.includes(`"${p}"`) || html.includes(`'${p}'`)));
}

/** The page with those addresses swapped: map is { "/lantern.js": "new address", … }. */
export function swapRefs(html, map) {
  let out = html;
  for (const [from, to] of Object.entries(map)) out = out.split(`"${from}"`).join(`"${to}"`).split(`'${from}'`).join(`'${to}'`);
  return out;
}
