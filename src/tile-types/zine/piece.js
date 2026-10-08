import { copyPaths, pageRefs } from "../../core/published-tile.js";
import { tileViewUrl } from "../../core/publish.js";

// Tiles on zine pages (stage 4, claude/zine-maker-plan.md section 26): one of
// the creator's own published tiles, copied into the zine byte for byte and
// run on an "A tile" page when the reader taps it (way C: the zine hands the
// tile its files). Kept free of the browser so the tests can use it; the panel
// that picks a tile is tilepanel.js.
//
// A page with the "A tile" layout keeps its tile in page.piece:
//   { kind: "tile", uri, cid, name, did, handle, typeId, typeVersion, foundryVersion,
//     status: "loading" | "ready" | "error", error?,
//     files: [{ path, bytes, contentType }] }   the tile's files as published (when ready)

export const TILE_NAME_MAX = 120;

/** Where a page's tile goes inside the zine. */
export function tileFolder(pageId) {
  return `/tiles/${pageId}`;
}

/** A tile file's address inside the zine ("/" is its page). */
export function tilePath(pageId, path) {
  return tileFolder(pageId) + (path === "/" ? "/index.html" : path);
}

export function pieceReady(page) {
  const t = page && page.piece;
  return Boolean(t && t.kind === "tile" && t.status === "ready" && Array.isArray(t.files) && t.files.some((f) => f.path === "/"));
}

/** Bytes a page's tile adds (for the size meter). */
export function pieceBytes(page) {
  const t = page && page.piece;
  if (!t || !Array.isArray(t.files)) return 0;
  return t.files.reduce((n, f) => n + (f.bytes ? f.bytes.length : 0), 0);
}

function nameOf(spec) {
  const n = spec.label || spec.id;
  return n.toLowerCase().startsWith("page") ? n : `The ${n.toLowerCase()}`;
}

/** Problems with a page's tile (the "A tile" layout), as sentences. */
export function pieceProblems(page, spec) {
  const t = page && page.piece;
  const name = nameOf(spec);
  if (!t || !t.uri) return [`${name}: choose one of your tiles, or pick another layout.`];
  if (t.status === "error") return [`${name}: the tile couldn't be copied (${String(t.error || "unknown problem").replace(/[.\s]+$/, "")}). Try again, or choose another.`];
  if (!pieceReady(page)) return [`${name}: the tile is still being copied.`];
  return [];
}

/** The tile's files as they go into the zine (copied byte for byte, under /tiles/<page id>/). */
export function pieceFiles(page, pageId) {
  if (!pieceReady(page)) return [];
  return copyPaths(page.piece.files, tileFolder(pageId));
}

function oneLine(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * A page's tile as the reader gets it, or null. `src(path)` gives the address
 * the reader fetches a tile file from (its place in the zine, or in the Foundry
 * preview an address the Foundry answers).
 *   { name, by, url, page, refs: [{ ref, src }], poster? }
 */
export function tileForReader(page, pageId, src = (path) => tilePath(pageId, path)) {
  if (!pieceReady(page)) return null;
  const t = page.piece;
  const html = new TextDecoder().decode(t.files.find((f) => f.path === "/").bytes);
  const refs = pageRefs(html, t.files.map((f) => f.path));
  const out = {
    name: oneLine(t.name, TILE_NAME_MAX) || "Untitled tile",
    by: t.handle ? `@${oneLine(t.handle, 253)}` : "",
    page: src("/"),
    refs: refs.map((ref) => ({ ref, src: src(ref) })),
  };
  try { out.url = tileViewUrl(t.uri, null); } catch { /* no link for an odd address */ }
  if (t.files.some((f) => f.path === "/banner.png")) out.poster = src("/banner.png");
  return out;
}

/** A page's tile in the zine's public recipe: what it is, where it came from, where it went. */
export function pieceRecipe(page, pageId) {
  if (!pieceReady(page)) return null;
  const t = page.piece;
  const out = { uri: t.uri, cid: t.cid, name: oneLine(t.name, TILE_NAME_MAX), folder: tileFolder(pageId) };
  if (t.typeId) out.type = t.typeId;
  if (t.typeVersion) out.typeVersion = t.typeVersion;
  if (t.foundryVersion) out.foundryVersion = t.foundryVersion;
  return out;
}

/**
 * Whether a published tile can go on an "A tile" page, from its recipe and the
 * Foundry's types (getType(id) -> type or undefined):
 *   { ok: true, type } or { ok: false, reason }
 */
export function tilePlacement(recipe, getType) {
  if (!recipe || recipe.madeWith !== "Web Tile Foundry" || typeof recipe.type !== "string") {
    return { ok: false, reason: "Not made with the Foundry, so it can't go on a page yet." };
  }
  const type = getType(recipe.type);
  if (!type) return { ok: false, reason: "A kind of tile this Foundry doesn't know." };
  if (type.zinePage === "tape") return { ok: false, reason: "Tapes go on “A tape” pages (coming next).", type };
  if (type.zinePage !== "live") return { ok: false, reason: `A ${type.title} can't go on a zine page.`, type };
  if (Number.isFinite(recipe.typeVersion) && recipe.typeVersion > type.version) {
    return { ok: false, reason: "Made with a newer Foundry than this one.", type };
  }
  return { ok: true, type };
}
