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
  ".mp3": "audio/mpeg",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  // Fonts, sounds and notes that other apps' tiles carry (ATMOSYNTH's direct
  // publish, Foundry v0.27.0): web fonts and their licence, FLAC samples.
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain",
  // Notes that travel with a tile (Treeline's DATA.md, v0.28.0).
  ".md": "text/markdown",
});

// Other names in common use for the same kinds of file. Only for COPYING a
// tile someone already published (src/core/published-tile.js, copyPaths): its
// app may have declared a font or sound under an older or vendor name. The
// Foundry's own files always use the one type in CONTENT_TYPES. A file is
// never accepted under a name from another family (a .woff2 can't be a script).
export const COPY_ALIASES = Object.freeze({
  ".woff2": Object.freeze(["application/font-woff2"]),
  ".woff": Object.freeze(["application/font-woff", "application/x-font-woff"]),
  ".ttf": Object.freeze(["application/x-font-ttf", "application/x-font-truetype", "application/font-sfnt", "font/sfnt"]),
  ".otf": Object.freeze(["application/x-font-otf", "application/x-font-opentype", "application/font-sfnt", "font/sfnt", "font/opentype"]),
  ".flac": Object.freeze(["audio/x-flac"]),
  ".wav": Object.freeze(["audio/x-wav", "audio/wave", "audio/vnd.wave"]),
  ".ogg": Object.freeze(["application/ogg", "audio/x-ogg"]),
  ".md": Object.freeze(["text/x-markdown"]),
});

const encoder = new TextEncoder();

/** A tile path's extension (".png"), lower case; "" when it has none. "/" is the page. */
export function extensionOf(path) {
  if (path === "/") return ".html";
  const name = String(path).slice(String(path).lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Whether the Foundry has a type for this path's kind of file. */
export function hasContentType(path) {
  return Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extensionOf(path));
}

/** The fixed content type for a tile path. "/" is the tile's HTML page. */
export function contentTypeFor(path) {
  if (path === "/") return CONTENT_TYPES[".html"];
  const ext = extensionOf(path);
  const type = Object.prototype.hasOwnProperty.call(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext] : undefined;
  if (!type) throw new Error(`No content type is defined for "${path}". Add its extension to CONTENT_TYPES.`);
  return type;
}

/** A declared type without its parameters, in lower case ("Text/Plain; charset=utf-8" -> "text/plain"). */
export function bareType(type) {
  return String(type || "").split(";")[0].trim().toLowerCase();
}

/**
 * Whether a file of a published tile, declared as `declared`, can be copied
 * to `path`: the declared type is the Foundry's type for that kind of file,
 * or one of its other names (COPY_ALIASES).
 */
export function copyTypeAccepts(path, declared) {
  const want = contentTypeFor(path);
  const got = bareType(declared);
  if (got === want) return true;
  const other = COPY_ALIASES[extensionOf(path)];
  return Boolean(other && other.includes(got));
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
