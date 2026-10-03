// Tile files and their content types.
//
// Rule learned the hard way: a PDS stores each file once, keyed by its address,
// and the FIRST upload's file type sticks. If the same bytes are ever uploaded
// with two different types, record creation later fails with "InvalidMimeType".
// The Foundry avoids that by never choosing a type case by case: every file's
// type is fixed by its extension, here, and nowhere else.

export const CONTENT_TYPES = Object.freeze({
  ".html": "text/html",
  ".png": "image/png",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".js": "text/javascript",
});

const encoder = new TextEncoder();

/** The fixed content type for a tile path. "/" is the tile's HTML page. */
export function contentTypeFor(path) {
  if (path === "/") return CONTENT_TYPES[".html"];
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  const type = CONTENT_TYPES[ext];
  if (!type) throw new Error(`No content type is defined for "${path}". Add its extension to CONTENT_TYPES.`);
  return type;
}

/**
 * Makes one tile file. `data` may be a string (stored as UTF-8) or bytes.
 * Paths are absolute within the tile: "/" for the page, "/icon.png" and so on.
 */
export function makeFile(path, data) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`Tile paths must start with "/": got ${JSON.stringify(path)}`);
  }
  const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
  return Object.freeze({ path, bytes, contentType: contentTypeFor(path) });
}

/** Human-friendly size, e.g. "12.0 KB". */
export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
