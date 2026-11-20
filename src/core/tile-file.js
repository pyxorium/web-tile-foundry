import { buildManifest } from "./publish.js";
import { encodeDagCbor, cidBytes } from "./dagcbor.js";

// Saving a built tile as a .tile file (v0.39.0; every type and out of ?debug
// in v0.40.0, for signed-in makers; claude/tile-files-plan.md).
//
// A .tile file is a "CARball", as the tiles spec describes it
// (https://dasl.ing/tiles.html, "Tiles in CAR"; https://dasl.ing/masl.html):
//
//   - a CAR (version 1) whose header IS the tile's manifest (MASL, bundle
//     mode), plus the two fields CAR itself requires: `version: 1` and
//     `roots` (an empty list here; the spec says they mean nothing to MASL);
//   - every file of the tile as a block after the header, found by the
//     address in its `resources` entry.
//
// The manifest is the one Publish writes (buildManifest), with one
// difference: on atproto each `src` is a blob reference ({ $type: "blob",
// ref, mimeType, size }); in a file it is the file's plain address, a CID
// link. The file addresses are the same raw sha-256 CIDs a PDS gives blobs
// ("bafkrei…"), so a saved tile's files have exactly the addresses they would
// have once published. Robin's CARTileLoader (@dasl/tile-loader/car) reads
// files made this way.
//
// Nothing here touches the network. (The Foundry offers it to signed-in
// makers, as Publish; signed out only with ?debug.)

export const TILE_FILE_EXTENSION = ".tile";

/**
 * Tile types that offer "Save as .tile": every type (v0.40.0). Each Foundry tile
 * is self-contained (its page's policy, src/core/policy.js, lets it reach
 * nothing outside itself), so whatever it shows or plays is in the file:
 * a tape's songs are its /tracks/ files, a zine's tiles its /tiles/ folders.
 */
export const TILE_FILE_TYPES = new Set(["sprite-walker", "glass-lantern", "coaster-carnival", "mixtape", "zine"]);

/** The manifest as it goes into a .tile file's header (before version and roots). */
export function fileManifest(result) {
  const links = {};
  for (const file of result.files) links[file.path] = { $link: file.cid };
  return buildManifest(result, links);
}

/** An unsigned LEB128 varint, as CAR uses for its length prefixes. */
export function varint(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Not a length: ${n}`);
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return new Uint8Array(out);
}

/**
 * The pieces of a .tile file for a built tile (the Foundry's build result:
 * { name, description, icons, screenshots, files: [{ path, bytes, contentType, cid }] }),
 * in order, without joining them: a tape can be 90 MB, and a Blob made from
 * the pieces needs no second whole copy. Files with the same bytes share one
 * block. Returns { parts, size }.
 */
export function tileFileParts(result) {
  if (!result || !Array.isArray(result.files) || !result.files.some((f) => f.path === "/")) {
    throw new Error('A tile file needs a built tile with a "/" page.');
  }
  const header = encodeDagCbor({ ...fileManifest(result), version: 1, roots: [] });
  const parts = [varint(header.length), header];
  const seen = new Set();
  for (const file of result.files) {
    if (seen.has(file.cid)) continue;
    seen.add(file.cid);
    const cid = cidBytes(file.cid);
    parts.push(varint(cid.length + file.bytes.length), cid, file.bytes);
  }
  return { parts, size: parts.reduce((n, p) => n + p.length, 0) };
}

/** The bytes of a .tile file for a built tile, joined (tileFileParts, in one piece). */
export function encodeTileFile(result) {
  const { parts, size } = tileFileParts(result);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A file name for the tile: "My Lantern!" -> "my-lantern.tile". */
export function tileFileName(name) {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return (base || "tile") + TILE_FILE_EXTENSION;
}

/** Hands the file to the browser as a download (browser only): its bytes, or tileFileParts' parts. */
export function downloadTileFile(bytesOrParts, fileName) {
  const parts = Array.isArray(bytesOrParts) ? bytesOrParts : [bytesOrParts];
  const blob = new Blob(parts, { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
