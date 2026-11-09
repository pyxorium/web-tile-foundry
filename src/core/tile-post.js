// Posting a just-published tile to Raku's Tile posts (Foundry v0.32.0).
//
// A tile post is a small record in the creator's own repo, in the collection
// cafe.thunderbird.tile.post (lexicon: pyxorium/tile-posts,
// lexicons/cafe.thunderbird.tile.post.json). It points at the tile with a
// strongRef (the tile record's at:// address and its exact version, the record
// CID), with optional words, alt text and languages. Raku finds these records
// through Bluesky's relay and shows each post's tile running inside the post.
//
// The same rules as scripts/tile_post.py in pyxorium/tile-posts. No DOM here,
// so Node (tests) can import it; `xrpc` is passed in as for publishTile.

import { TILE_COLLECTION } from "./publish.js";

export const POST_COLLECTION = "cafe.thunderbird.tile.post";

// The lexicon's limits: graphemes (what a reader counts as characters) and UTF-8 bytes.
export const TEXT_MAX = 300;
export const TEXT_MAX_BYTES = 3000;
export const ALT_MAX = 1000;
export const ALT_MAX_BYTES = 10000;
export const LANGS_MAX = 3;

/** Raku's Tile posts, opened from the posted note. */
export const RAKU_POSTS = "https://raku.lexicographer.space/#t=raku%3Adiscover%2Fposts&a=0";

/** A language tag such as en, fr, pt-BR or zh-Hant (as tile_post.py checks it). */
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export class PostError extends Error {
  constructor(message, step) {
    super(message);
    this.name = "PostError";
    this.step = step; // "check" | "create" | "verify" | "scope"
  }
}

/** Characters as a reader counts them (graphemes); code points where the browser can't segment. */
export function graphemeCount(text) {
  const s = String(text || "");
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      let n = 0;
      for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) n++;
      return n;
    }
  } catch {
    /* fall through */
  }
  return [...s].length;
}

function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

function checkText(text, most, mostBytes, what) {
  const n = graphemeCount(text);
  if (n > most) throw new PostError(`${what} ${n} characters; at most ${most}.`, "check");
  const bytes = utf8Length(text);
  if (bytes > mostBytes) throw new PostError(`${what} too long (${bytes} bytes; at most ${mostBytes}).`, "check");
}

/** Splits what was typed in the language box ("en", "en, fr", "en fr") into tags. */
export function parseLangs(input) {
  if (Array.isArray(input)) return input.map((l) => String(l).trim()).filter(Boolean);
  return String(input || "").split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
}

/**
 * The post record. `uri` and `cid` are the tile record's address and version
 * (publishTile's `uri` and `recordCid`). Empty text, alt and langs are left out.
 * Throws a PostError (step "check") when something is over the lexicon's limits.
 */
export function buildPostRecord({ uri, cid, text, alt, langs, createdAt }) {
  if (typeof uri !== "string" || !uri.startsWith("at://") || uri.split("/")[3] !== TILE_COLLECTION) {
    throw new PostError(`Not a tile's address: ${uri}`, "check");
  }
  if (typeof cid !== "string" || !cid) throw new PostError("The tile's version (its record CID) is missing.", "check");
  const record = { $type: POST_COLLECTION, tile: { uri, cid } };
  const words = String(text || "").trim();
  if (words) {
    checkText(words, TEXT_MAX, TEXT_MAX_BYTES, "Your words are");
    record.text = words;
  }
  const altText = String(alt || "").trim();
  if (altText) {
    checkText(altText, ALT_MAX, ALT_MAX_BYTES, "Your alt text is");
    record.alt = altText;
  }
  const tags = parseLangs(langs);
  if (tags.length > LANGS_MAX) throw new PostError(`At most ${LANGS_MAX} languages.`, "check");
  for (const t of tags) {
    if (!LANG_RE.test(t)) throw new PostError(`“${t}” isn't a language tag (en, fr, pt-BR …).`, "check");
  }
  if (tags.length) record.langs = tags;
  record.createdAt = createdAt || new Date().toISOString();
  return record;
}

function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

/** Whether a server's refusal means the sign-in lacks the permission to post. */
export function isScopeRefusal(err) {
  if (!err) return false;
  const words = `${err.error || ""} ${err.message || ""}`;
  if (/ScopeMissing|InsufficientScope|insufficient_scope/i.test(words)) return true;
  return (err.status === 401 || err.status === 403) && /scope|permission|forbidden|not authori[sz]ed|insufficient/i.test(words);
}

/**
 * Writes the post and reads it back. Resolves to { uri, rkey, cid, record }.
 * Errors are PostErrors: step "create" (nothing written), "scope" (the sign-in
 * may not post), or "verify" (written, but reading it back failed or differed:
 * it may still be there).
 */
export async function postTile({ xrpc, did, uri, cid, text, alt, langs, now = () => new Date().toISOString() }) {
  const record = buildPostRecord({ uri, cid, text, alt, langs, createdAt: now() });
  let created;
  try {
    created = await xrpc("com.atproto.repo.createRecord", {
      method: "POST",
      // validate: false, as for tiles: the account's server doesn't know this lexicon.
      body: { repo: did, collection: POST_COLLECTION, record, validate: false },
    });
  } catch (err) {
    if (isScopeRefusal(err)) throw new PostError(`Your account's server refused the post: ${err.message}`, "scope");
    throw new PostError(err.message, "create");
  }
  const postUri = created && created.uri;
  if (typeof postUri !== "string" || !postUri.startsWith("at://")) {
    throw new PostError("The post was written, but the server didn't say where.", "verify");
  }
  const rkey = postUri.split("/").pop();
  let back;
  try {
    back = await xrpc("com.atproto.repo.getRecord", { method: "GET", params: { repo: did, collection: POST_COLLECTION, rkey } });
  } catch (err) {
    throw new PostError(`The post was written, but reading it back failed: ${err.message}`, "verify");
  }
  if (!back || !sameJson(back.value, record)) {
    throw new PostError("The post was written, but what the server returned doesn't match what was sent.", "verify");
  }
  return { uri: postUri, rkey, cid: created.cid, record };
}

/** Deletes one tile post by its key (debug: throwaway test posts). */
export async function deletePost({ xrpc, did, rkey }) {
  await xrpc("com.atproto.repo.deleteRecord", { method: "POST", body: { repo: did, collection: POST_COLLECTION, rkey } });
}

/**
 * Whether a granted permission string (a sign-in's scope) allows creating
 * records in `collection`. Understands the forms in
 * https://atproto.com/specs/permission: repo:<nsid>, repo:*, repo?collection=…,
 * an action list (?action=create…), and the older transition:generic (full access).
 */
export function scopeAllows(scope, collection = POST_COLLECTION) {
  if (typeof scope !== "string") return false;
  for (const raw of scope.split(/\s+/)) {
    if (!raw) continue;
    if (raw === "transition:generic") return true;
    if (!/^repo[:?]/.test(raw)) continue;
    let resource = raw.slice(4);
    let query = "";
    const q = resource.indexOf("?");
    if (q >= 0) {
      query = resource.slice(q + 1);
      resource = resource.slice(0, q);
    }
    if (resource.startsWith(":")) resource = resource.slice(1);
    let params;
    try {
      params = new URLSearchParams(query);
    } catch {
      continue;
    }
    const collections = [...(resource ? [decodeURIComponent(resource)] : []), ...params.getAll("collection")];
    const actions = params.getAll("action");
    const coversCollection = collections.some((c) => c === "*" || c === collection);
    const coversCreate = actions.length === 0 || actions.includes("create");
    if (coversCollection && coversCreate) return true;
  }
  return false;
}

/**
 * Whether a sign-in may post: true, false, or null when it can't be told
 * (the sign-in doesn't say what it was granted). `scope` is from grantedScope().
 */
export function canPost(scope) {
  if (scope == null) return null;
  return scopeAllows(scope, POST_COLLECTION);
}
