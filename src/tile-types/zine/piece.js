import { copyPaths, pageRefs } from "../../core/published-tile.js";
import { tileViewUrl } from "../../core/publish.js";

// Tiles on zine pages (stage 4, claude/zine-maker-plan.md section 26): one of
// the creator's own published tiles, copied into the zine byte for byte and
// run on an "A tile" page when the reader taps it (way C: the zine hands the
// tile its files). Kept free of the browser so the tests can use it; the panel
// that picks a tile is tilepanel.js.
//
// A page with the "A tile" layout keeps its tile in page.piece:
//   { kind: "tile", uri, cid, name, did, handle, own, typeId, typeVersion, foundryVersion,
//     status: "loading" | "ready" | "error", error?,
//     files: [{ path, bytes, contentType }] }   the tile's files as published (when ready)
// `own`: picked from one of the creator's own accounts (any of them), so not credited.
// A page with the "A tape" layout (part 2) keeps one of the creator's Mixtape C60
// tapes the same way, with kind "tape": `files` holds only the tape's banner
// (copied as published), and `tape` what the J-card shows, read from its tape.json:
//   tape: { title, dedication?, sides: [{ name, tracks: [{ title, duration, cid, path, url?, record? }] }] }
// The tape's songs aren't copied; a page's optional taste (stage 3's sound, cut
// from one of the tape's own song files) is page.sound + page.clip as usual.

/** The kind of piece each layout holds. */
export const PIECE_KINDS = Object.freeze({ tile: "tile", tape: "tape" });
const TAPE_TEXT_MAX = 300;

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
  if (!t || t.status !== "ready" || !Array.isArray(t.files)) return false;
  if (t.kind === "tape") return Boolean(t.tape && Array.isArray(t.tape.sides));
  return t.kind === "tile" && t.files.some((f) => f.path === "/");
}

/** Whether the page's piece is the kind its layout holds. */
function pieceFits(page) {
  const want = PIECE_KINDS[page && page.layout];
  return Boolean(page && page.piece && (!want || page.piece.kind === want));
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
  const tape = PIECE_KINDS[page && page.layout] === "tape";
  const what = tape ? "tape" : "tile";
  if (!t || !t.uri || !pieceFits(page)) return [`${name}: choose one of your ${what}s, or pick another layout.`];
  if (t.status === "error") return [`${name}: the ${what} couldn't be copied (${String(t.error || "unknown problem").replace(/[.\s]+$/, "")}). Try again, or choose another.`];
  if (!pieceReady(page)) return [`${name}: the ${what} is still being copied.`];
  return [];
}

/** The tile's files as they go into the zine (copied byte for byte, under /tiles/<page id>/). */
export function pieceFiles(page, pageId) {
  if (!pieceReady(page) || !pieceFits(page)) return [];
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
  if (!pieceReady(page) || page.piece.kind !== "tile") return null;
  const t = page.piece;
  const html = new TextDecoder().decode(t.files.find((f) => f.path === "/").bytes);
  const refs = pageRefs(html, t.files.map((f) => f.path));
  const out = {
    name: oneLine(t.name, TILE_NAME_MAX) || "Untitled tile",
    // The creator's own tiles (from any of their accounts) aren't credited: it's still them (owner, Oct 9).
    by: t.handle && !t.own ? `@${oneLine(t.handle, 253)}` : "",
    page: src("/"),
    refs: refs.map((ref) => ({ ref, src: src(ref) })),
  };
  try { out.url = tileViewUrl(t.uri, null); } catch { /* no link for an odd address */ }
  if (t.files.some((f) => f.path === "/banner.png")) out.poster = src("/banner.png");
  return out;
}

/** A page's tile in the zine's public recipe: what it is, where it came from, where it went. */
export function pieceRecipe(page, pageId) {
  if (!pieceReady(page) || !pieceFits(page)) return null;
  const t = page.piece;
  const out = { kind: t.kind, uri: t.uri, cid: t.cid, name: oneLine(t.name, TILE_NAME_MAX), folder: tileFolder(pageId) };
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
export function tilePlacement(recipe, getType, want = "live") {
  if (!recipe || recipe.madeWith !== "Web Tile Foundry" || typeof recipe.type !== "string") {
    return { ok: false, reason: "Not made with the Foundry, so it can't go on a page yet." };
  }
  const type = getType(recipe.type);
  if (!type) return { ok: false, reason: "A kind of tile this Foundry doesn't know." };
  if (want === "live" && type.zinePage === "tape") return { ok: false, reason: "Mixtapes go on “A mixtape” pages.", type };
  if (want === "tape" && type.zinePage === "live") return { ok: false, reason: "Live tiles go on “A web tile” pages.", type };
  if (type.zinePage !== want) return { ok: false, reason: `A ${type.title} can't go on a zine page.`, type };
  if (Number.isFinite(recipe.typeVersion) && recipe.typeVersion > type.version) {
    return { ok: false, reason: "Made with a newer Foundry than this one.", type };
  }
  return { ok: true, type };
}

// ---- Tapes (part 2) ----

const cleanLine = (v, max = TAPE_TEXT_MAX) => oneLine(v, max);
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length < 600;

/** What a tape page keeps from the tape's tape.json (titles, sides, songs; no notes). */
export function tapeFromJson(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.sides)) return null;
  const sides = json.sides
    .filter((s) => s && Array.isArray(s.tracks) && s.tracks.length)
    .slice(0, 4)
    .map((s) => ({
      name: cleanLine(s.name, 30) || "A",
      tracks: s.tracks.slice(0, 60).map((t) => {
        const out = { title: cleanLine(t && t.title, 120) || "Untitled", duration: Number.isFinite(t && t.duration) ? Math.max(0, t.duration) : 0 };
        if (t && typeof t.cid === "string" && /^b[a-z2-7]{20,100}$/.test(t.cid)) out.cid = t.cid;
        if (t && typeof t.path === "string" && /^\/[a-z0-9/_.-]{1,100}$/.test(t.path)) out.path = t.path;
        const rec = t && t.source && t.source.record;
        if (rec && typeof rec.uri === "string" && rec.uri.startsWith("at://")) out.record = { uri: rec.uri, cid: typeof rec.cid === "string" ? rec.cid : "" };
        if (t && t.source && isHttps(t.source.url)) out.url = t.source.url;
        return out;
      }),
    }));
  if (!sides.length) return null;
  const tape = { title: cleanLine(json.title, 120) || "Untitled tape", sides };
  const ded = cleanLine(json.dedication);
  if (ded) tape.dedication = ded;
  return tape;
}

/**
 * A page's tape as the reader gets it (its J-card), or null:
 *   { name, title, url?, poster?, sides: [{ name, songs: [title, …] }], dedication? }
 */
export function tapeForReader(page, pageId, src = (path) => tilePath(pageId, path)) {
  if (!pieceReady(page) || page.piece.kind !== "tape") return null;
  const t = page.piece;
  const out = {
    name: oneLine(t.name, TILE_NAME_MAX) || t.tape.title,
    title: t.tape.title,
    sides: t.tape.sides.map((s) => ({ name: s.name, songs: s.tracks.map((x) => x.title) })),
  };
  if (t.tape.dedication) out.dedication = t.tape.dedication;
  try { out.url = tileViewUrl(t.uri, null); } catch { /* no link for an odd address */ }
  if (t.files.some((f) => f.path === "/banner.png")) out.poster = src("/banner.png");
  return out;
}

/**
 * The tape's songs, as the sound panel lists them for a taste: grouped by
 * side, each read from the tape's own song file (blob) in the creator's account.
 */
export function tasteSongs(piece) {
  if (!piece || piece.kind !== "tape" || !piece.tape) return [];
  const out = [];
  for (const side of piece.tape.sides) {
    for (const t of side.tracks) {
      if (!t.cid) continue;
      out.push({
        uri: (t.record && t.record.uri) || `${piece.uri}#${t.path || t.cid}`,
        cid: (t.record && t.record.cid) || t.cid,
        title: t.title,
        album: `Side ${side.name}`,
        artist: "",
        seconds: t.duration,
        blob: { cid: t.cid },
        usable: true,
        details: `From ${piece.tape.title}`.slice(0, 80),
        // The song's file is the tape's own copy, in the tape's account.
        ...(piece.did ? { home: piece.did } : {}),
        ...(t.url ? { url: t.url } : {}),
      });
    }
  }
  return out;
}
