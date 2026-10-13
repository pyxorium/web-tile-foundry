import { TILE_CSP } from "./policy.js";

/**
 * The tile server the real-loader previews use (runtime, service worker, sandbox).
 * load.tiles.lexicographer.space gives each tile its own random name (since
 * Oct 2026; the old load.tiles.thunderbird.cafe rotated five fixed names, where
 * two tiles could break each other). Same server as the blog and gallery; see
 * claude/tile-loading-findings.md.
 */
export const LOAD_DOMAIN = "load.tiles.lexicographer.space";

// Turns a built tile into the shape @dasl/tile-loader's MemoryTileLoader takes,
// so the tile can run through the real loading pipeline (tile server runtime,
// service worker, sandbox) before anything is published. Same shape as the
// die demos' dev-entry.js:
//   { name, resources: { "/": { src, "content-type", "content-security-policy" }, ... } }
// HTML is passed as text and everything else as bytes. The page's policy is
// also given as a header on "/", as published records carry it.

export function toMemoryTile(result) {
  const resources = {};
  for (const file of result.files) {
    const isHtml = file.contentType === "text/html";
    const entry = {
      src: isHtml ? new TextDecoder().decode(file.bytes) : file.bytes,
      "content-type": file.contentType,
    };
    if (file.path === "/") entry["content-security-policy"] = TILE_CSP;
    resources[file.path] = entry;
  }
  return { name: result.name, resources };
}
