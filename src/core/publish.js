import { dagCborCid } from "./dagcbor.js";
import { rawCid } from "./cid.js";
import { TILE_CSP } from "./policy.js";

// Publishing a built tile to the signed-in account, and checking it arrived.
//
// Lessons from the earlier tiles, all applied here:
//   - Always CREATE a new record (createRecord, server-assigned key); never
//     overwrite one by accident. validate: false, since the PDS doesn't know the
//     ing.dasl.masl lexicon.
//   - Upload each file, then check the address the server reports against the
//     address computed locally, before using it.
//   - Use the file type the SERVER reports in each blob reference, never an
//     assumed one, and compute the manifest's address only AFTER uploading,
//     because it depends on those types.
//   - A PDS stores each file once; if the same bytes were once uploaded with a
//     different type, createRecord fails with InvalidMimeType ("Expected: X,
//     Got: Y"). Adopt X for the affected files, recompute, and retry once.
//   - Read the record and every file back and verify them.
//
// `xrpc(nsid, { method, params, body, contentType })` makes an authenticated
// call for the signed-in account and returns the parsed JSON, or throws an
// XrpcError. `fetchBlob(cid)` downloads a public blob from the account's
// server. Both are passed in, so this file runs the same in tests.

export const TILE_COLLECTION = "ing.dasl.masl";

export class XrpcError extends Error {
  constructor(status, error, message) {
    super(message || error || `Request failed (${status})`);
    this.name = "XrpcError";
    this.status = status;
    this.error = error;
  }
}

export class PublishError extends Error {
  constructor(message, step) {
    super(message);
    this.name = "PublishError";
    this.step = step;
  }
}

/** The manifest ("tile" object): name, description, card images and resources. */
export function buildManifest(result, blobRefs) {
  const resources = {};
  for (const file of result.files) {
    const entry = { src: blobRefs[file.path], "content-type": file.contentType };
    if (file.path === "/") entry["content-security-policy"] = TILE_CSP;
    resources[file.path] = entry;
  }
  const manifest = { name: result.name };
  if (result.description) manifest.description = result.description;
  if (result.icons && result.icons.length) manifest.icons = result.icons.map((i) => ({ src: i.src }));
  if (result.screenshots && result.screenshots.length) manifest.screenshots = result.screenshots.map((s) => ({ src: s.src }));
  manifest.resources = resources;
  return manifest;
}

/** The full record for a manifest. */
export async function buildRecord(manifest, createdAt) {
  return { $type: TILE_COLLECTION, cid: await dagCborCid(manifest), tile: manifest, createdAt };
}

/** Parses "Expected: X, Got: Y" from a PDS InvalidMimeType message. */
export function parseMimeMismatch(message) {
  const m = /Expected:\s*([^,\s]+)\s*,\s*Got:\s*([^\s,]+)/i.exec(message || "");
  return m ? { expected: m[1], got: m[2] } : null;
}

function sameJson(a, b) {
  // Order-insensitive deep comparison of plain JSON values.
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

/**
 * Publishes a built tile. `onStep(id, state, detail)` reports progress:
 *   ids "upload", "create", "verify"; states "active", "done".
 * Resolves to { uri, rkey, recordCid, manifestCid, record }.
 */
export async function publishTile({ xrpc, fetchBlob, did, result, now = () => new Date().toISOString(), onStep = () => {} }) {
  // 1. Upload every file and check each address.
  onStep("upload", "active", { done: 0, total: result.files.length });
  const blobRefs = {};
  let n = 0;
  for (const file of result.files) {
    let res;
    try {
      res = await xrpc("com.atproto.repo.uploadBlob", { method: "POST", body: file.bytes, contentType: file.contentType });
    } catch (err) {
      throw new PublishError(`Uploading ${file.path === "/" ? "the tile" : file.path} failed: ${err.message}`, "upload");
    }
    const blob = res && res.blob;
    const link = blob && blob.ref && blob.ref.$link;
    if (link !== file.cid) {
      throw new PublishError(
        `The server stored ${file.path === "/" ? "the tile" : file.path} under a different address than expected (${link || "none"} instead of ${file.cid}).`,
        "upload"
      );
    }
    blobRefs[file.path] = { $type: "blob", ref: { $link: link }, mimeType: blob.mimeType, size: blob.size ?? file.bytes.length };
    onStep("upload", "active", { done: ++n, total: result.files.length });
  }
  onStep("upload", "done");

  // 2. Create the record (once more if the server insists on a stored file type).
  onStep("create", "active");
  const createdAt = now();
  let manifest = buildManifest(result, blobRefs);
  let record = await buildRecord(manifest, createdAt);
  let created;
  for (let attempt = 1; ; attempt++) {
    try {
      created = await xrpc("com.atproto.repo.createRecord", {
        method: "POST",
        body: { repo: did, collection: TILE_COLLECTION, record, validate: false },
      });
      break;
    } catch (err) {
      const mismatch = err && err.error === "InvalidMimeType" ? parseMimeMismatch(err.message) : null;
      if (attempt === 1 && mismatch) {
        let changed = 0;
        for (const ref of Object.values(blobRefs)) {
          if (ref.mimeType === mismatch.got) {
            ref.mimeType = mismatch.expected;
            changed++;
          }
        }
        if (changed) {
          manifest = buildManifest(result, blobRefs);
          record = await buildRecord(manifest, createdAt);
          continue;
        }
      }
      throw new PublishError(`Creating the tile in your account failed: ${err.message}`, "create");
    }
  }
  const uri = created.uri;
  const rkey = uri.split("/").pop();
  onStep("create", "done", { uri });

  // 3. Read it all back and verify.
  onStep("verify", "active");
  let readBack;
  try {
    readBack = await xrpc("com.atproto.repo.getRecord", {
      method: "GET",
      params: { repo: did, collection: TILE_COLLECTION, rkey },
    });
  } catch (err) {
    throw new PublishError(`The tile was created, but reading it back failed: ${err.message}`, "verify");
  }
  if (!sameJson(readBack.value, record)) {
    throw new PublishError("The tile was created, but what the server returned doesn't match what was sent.", "verify");
  }
  for (const file of result.files) {
    const bytes = await fetchBlob(file.cid);
    if ((await rawCid(bytes)) !== file.cid) {
      throw new PublishError(`The tile was created, but ${file.path} didn't come back intact.`, "verify");
    }
  }
  onStep("verify", "done");

  return { uri, rkey, recordCid: created.cid, manifestCid: record.cid, record };
}

/** Deletes one Web Tile record by its key (used for throwaway test tiles). */
export async function deleteTile({ xrpc, did, rkey }) {
  await xrpc("com.atproto.repo.deleteRecord", {
    method: "POST",
    body: { repo: did, collection: TILE_COLLECTION, rkey },
  });
}

/** The webtil.es browser link for a tile's at:// address. */
export function webtilesUrl(uri) {
  return `https://webtil.es/browser/#url=${uri}`;
}
