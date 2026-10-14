import { copyPaths, pageRefs } from "../../core/published-tile.js";
import { tileViewUrl } from "../../core/publish.js";
import { bookReady, bookFiles, bookRecipe } from "./books.js";
import { activityReady, activityRecipe, treelineUrl, TREELINE } from "./activities.js";

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

// ATMOSYNTH tiles (Foundry v0.24.0; claude/atmosynth-collab.md, "Host test"):
// the creator's own synth patches, exported from atmosynth.at as Web Tiles,
// go on "A web tile" pages too. They have no /foundry.json; the exporter marks
// its tiles with `generator: "ATMOSYNTH"` in the tile's manifest. Their page
// loads its files by relative address ("./tile.js"), the player fetches its own
// files (./patch.json, ./tile.json; samples as separate files such as
// ./samples/<cid>.flac), its stylesheet loads fonts with url(./fonts/…), and its
// script names one file from the tile's root ("/assets/mark.svg"). The reader
// handles all of these (runtime/reader.js, startTile). Since v0.27.0 it answers
// the player's fetches for EVERY one of the tile's own files (not a fixed list),
// so both the older export (made for appmosphe.re: samples.json) and the direct
// publish from atmosynth.at (fonts, FLAC samples, no samples.json) play. A page's ATMOSYNTH tile keeps, beside the
// usual piece fields:
//   maker: "atmosynth", atmo: { patchId?, creator?, modules: [did], samples: [did], forkedFrom?, others }
// `others`: the patch uses other people's modules (their own code), so the
// reader runs it walled off (a sealed frame; owner's decision, Oct 10).
//
// Your own tiles from other apps (v0.28.0; claude/zine-other-app-tiles-plan.md):
// any of the creator's own published tiles that isn't a Foundry tile can go on
// "A web tile" pages too (Treeline's activity replays, hand-made tiles, …) and
// runs through the same path as ATMOSYNTH tiles. Such a piece keeps:
//   maker: "app", app: { generator?, activityUri? }
// `generator` names the app that made it (the tile manifest's `generator`);
// Treeline tiles also keep the activity they replay (the record's `activityUri`)
// for their credit link. They run normally (not walled off): they're the
// creator's own (owner, Oct 13).

export const ATMOSYNTH = "ATMOSYNTH";
export const ATMOSYNTH_HOME = "https://atmosynth.at/";
// The account ATMOSYNTH's built-in modules are published from (the platform).
export const ATMOSYNTH_PLATFORM = "did:plc:fzjkahpwapmoqxybwdjb6ysf";
/**
 * The files the reader answers the ATMOSYNTH player's own fetches with: every
 * one of the tile's files but its page, script and stylesheet (those the page
 * itself loads; leaving them out keeps a walled-off page from carrying them twice).
 */
export function atmoFetched(paths) {
  return (paths || []).filter((p) => p !== "/" && !/\.(js|css)$/i.test(p));
}
const DID_LIKE = /^did:[a-z]+:[A-Za-z0-9._:%-]{1,200}$/;
const PATCH_ID = /^[A-Za-z0-9._~-]{1,100}$/;

/** Whether a tile's manifest (or its generator) says ATMOSYNTH made it. */
export function isAtmosynthTile(manifestOrGenerator) {
  const g = manifestOrGenerator && typeof manifestOrGenerator === "object" ? manifestOrGenerator.generator : manifestOrGenerator;
  return String(g || "").trim().toUpperCase() === ATMOSYNTH;
}

export function isAtmoPiece(piece) {
  return Boolean(piece && piece.kind === "tile" && piece.maker === "atmosynth");
}

/** A tile from another app (not the Foundry): ATMOSYNTH's or any other. They share the reader's app path. */
export function isAppPiece(piece) {
  return Boolean(piece && piece.kind === "tile" && (piece.maker === "atmosynth" || piece.maker === "app"));
}

const GENERATOR_MAX = 60;
/** The app a tile names as its maker (the manifest's `generator`), cleaned; "" when none. */
export function generatorOf(manifestOrGenerator) {
  const g = manifestOrGenerator && typeof manifestOrGenerator === "object" ? manifestOrGenerator.generator : manifestOrGenerator;
  return String(typeof g === "string" ? g : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GENERATOR_MAX);
}

/** Whether a tile's manifest (or its generator) says Treeline made it. */
export function isTreelineTile(manifestOrGenerator) {
  return generatorOf(manifestOrGenerator).toLowerCase() === TREELINE.app.toLowerCase();
}

/** What a piece keeps about a tile from another app: { generator?, activityUri? }. `record` is the tile's record value. */
export function appTileInfo(manifest, record) {
  const out = {};
  const generator = generatorOf(manifest);
  if (generator) out.generator = generator;
  const act = record && record.activityUri;
  if (isTreelineTile(generator) && typeof act === "string" && /^at:\/\/[^\s"'<>]{1,500}$/.test(act)) out.activityUri = act;
  return out;
}

/**
 * What the zine keeps about an ATMOSYNTH patch, from the tile's /patch.json
 * ({ creatorDid, patchId, patch: { moduleInstances, forkedFrom, … }, … }):
 * who made it, whose modules and samples it uses (for fuller credits later),
 * and whether any module is someone else's. Never throws; odd parts are skipped.
 */
export function atmoPatchInfo(json) {
  const out = { modules: [], samples: [], others: false };
  if (!json || typeof json !== "object") return out;
  const creator = typeof json.creatorDid === "string" && DID_LIKE.test(json.creatorDid) ? json.creatorDid : "";
  if (creator) out.creator = creator;
  if (typeof json.patchId === "string" && PATCH_ID.test(json.patchId)) out.patchId = json.patchId;
  const patch = json.patch && typeof json.patch === "object" ? json.patch : {};
  const modules = new Set(), samples = new Set();
  const instances = Array.isArray(patch.moduleInstances) ? patch.moduleInstances.slice(0, 500) : [];
  for (const m of instances) {
    const author = m && m.module && m.module.authorDid;
    if (typeof author === "string" && DID_LIKE.test(author) && author !== ATMOSYNTH_PLATFORM) modules.add(author);
  }
  // Sample makers: any "ownerDid" in the patch's sample fills and slots (looked for a few levels deep).
  const seen = { n: 0 };
  (function walk(v, depth) {
    if (!v || typeof v !== "object" || depth > 6 || seen.n++ > 5000) return;
    if (typeof v.ownerDid === "string" && DID_LIKE.test(v.ownerDid) && v.ownerDid !== ATMOSYNTH_PLATFORM) samples.add(v.ownerDid);
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  })({ fills: instances.map((m) => m && m.sampleSlotFills), slots: json.slots }, 0);
  out.modules = [...modules].slice(0, 50);
  out.samples = [...samples].slice(0, 50);
  const from = patch.forkedFrom;
  const fromUri = typeof from === "string" ? from : from && typeof from.uri === "string" ? from.uri : "";
  if (fromUri.startsWith("at://") && fromUri.length < 600) out.forkedFrom = fromUri;
  out.others = out.modules.some((d) => d !== creator);
  return out;
}

/** The patch's page on atmosynth.at (or the site, when the patch id is unknown). */
export function atmoPatchUrl(atmo) {
  return atmo && atmo.patchId ? `${ATMOSYNTH_HOME}patch/${encodeURIComponent(atmo.patchId)}` : ATMOSYNTH_HOME;
}

/**
 * The tile's own files its page loads by address, as written in the page:
 * [{ ref: "./tile.js", path: "/tile.js" }, …]. Relative ("./x", "x") and root ("/x") forms.
 */
export function atmoPageRefs(html, paths) {
  const out = [];
  for (const path of paths) {
    if (path === "/") continue;
    for (const ref of [`.${path}`, path, path.slice(1)]) {
      if (html.includes(`"${ref}"`) || html.includes(`'${ref}'`)) out.push({ ref, path });
    }
  }
  return out;
}

/** The size a tile asks for (its manifest's `sizing`), within sensible bounds; ATMOSYNTH's 720 x 520 when missing. */
export function tileSize(sizing) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
  const w = num(sizing && (sizing.width ?? sizing.w ?? sizing[0]));
  const h = num(sizing && (sizing.height ?? sizing.h ?? sizing[1]));
  const ok = (v) => Number.isFinite(v) && v >= 100 && v <= 4000;
  return { w: ok(w) ? Math.round(w) : 720, h: ok(h) ? Math.round(h) : 520 };
}

/** The picture shown until the tile is started: its banner, else its PNG screenshot, else its SVG one. */
export function tilePosterPath(files) {
  const has = (p) => (files || []).some((f) => f.path === p);
  return ["/banner.png", "/screenshot.png", "/screenshot.svg"].find(has) || null;
}

/** How an ATMOSYNTH tile is named in the tile list (it isn't a Foundry type). */
export const ATMO_TYPE = Object.freeze({ id: "atmosynth", title: "ATMOSYNTH patch", zinePage: "live" });
/** How other apps' tiles are grouped in the tile list: by the app they name, else "Other tiles". */
export const OTHER_TYPE = Object.freeze({ id: "other", title: "Other tiles", zinePage: "live" });
export function appType(generator) {
  const g = generatorOf(generator);
  if (!g) return OTHER_TYPE;
  if (isTreelineTile(g)) return Object.freeze({ id: "treeline", title: TREELINE.app, zinePage: "live" });
  return Object.freeze({ id: `app:${g.toLowerCase()}`, title: g, zinePage: "live" });
}

/** The kind of piece each layout holds. */
export const PIECE_KINDS = Object.freeze({ tile: "tile", tape: "tape", book: "book", activity: "activity" });
const PLURAL = { tile: "tiles", tape: "tapes", book: "books", activity: "activities" };
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
  if (t.kind === "book") return bookReady(t);
  if (t.kind === "activity") return activityReady(t);
  if (t.kind === "tape") return Boolean(t.tape && Array.isArray(t.tape.sides));
  if (t.kind !== "tile" || !t.files.some((f) => f.path === "/")) return false;
  // An ATMOSYNTH tile needs the patch its player plays; other tiles need only their page.
  return !isAtmoPiece(t) || t.files.some((f) => f.path === "/patch.json");
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
  const what = PIECE_KINDS[page && page.layout] || "tile";
  if (!t || !t.uri || !pieceFits(page)) return [`${name}: choose one of your ${PLURAL[what] || `${what}s`}, or pick another layout.`];
  if (t.status === "error") return [`${name}: the ${what} couldn't be copied (${String(t.error || "unknown problem").replace(/[.\s]+$/, "")}). Try again, or choose another.`];
  if (!pieceReady(page)) return [`${name}: the ${what} is still being copied.`];
  return [];
}

/** The tile's files as they go into the zine (copied byte for byte, under /tiles/<page id>/). */
export function pieceFiles(page, pageId) {
  if (!pieceReady(page) || !pieceFits(page)) return [];
  if (page.piece.kind === "book") return bookFiles(page.piece, pageId);
  if (page.piece.kind === "activity") return [];
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
  if (isAppPiece(t)) return appForReader(t, html, src);
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

/**
 * A tile from another app (ATMOSYNTH's, Treeline's, any of your own) as the reader gets it:
 *   { name, by, url, page, app: true, atmo?: true, made, madeUrl?, patchUrl?, sealed?,
 *     refs: [{ ref, path }], files: [{ path, src, type }], fetched: [path], size, poster? }
 * `refs` are the addresses in its page; `files` every file but the page (the
 * reader swaps the addresses in its script and stylesheet for copies, and
 * answers the player's own fetches of `fetched`, all its other files, from copies).
 * `made` names the app ("" for a tile that names none); `madeUrl` is where its
 * credit links (ATMOSYNTH: the patch; Treeline: the activity), when known.
 * Only ATMOSYNTH patches with other people's modules run walled off (`sealed`).
 */
function appForReader(t, html, src) {
  const paths = t.files.map((f) => f.path).filter((p) => p !== "/");
  const atmoTile = isAtmoPiece(t);
  const info = t.app || {};
  const out = {
    name: oneLine(t.name, TILE_NAME_MAX) || (atmoTile ? "Untitled patch" : "Untitled tile"),
    by: t.handle && !t.own ? `@${oneLine(t.handle, 253)}` : "",
    page: src("/"),
    app: true,
    made: atmoTile ? ATMOSYNTH : generatorOf(info.generator),
    refs: atmoPageRefs(html, paths),
    files: t.files.filter((f) => f.path !== "/").map((f) => ({ path: f.path, src: src(f.path), type: f.contentType || "" })),
    fetched: atmoFetched(paths),
    size: tileSize(t.sizing),
  };
  if (atmoTile) {
    out.atmo = true;
    out.patchUrl = atmoPatchUrl(t.atmo || {});
    out.madeUrl = out.patchUrl;
    if ((t.atmo || {}).others) out.sealed = true;
  } else if (isTreelineTile(out.made)) {
    out.made = TREELINE.app;
    out.treeline = true;
    if (info.activityUri) out.madeUrl = treelineUrl(info.activityUri);
  }
  try { out.url = tileViewUrl(t.uri, null); } catch { /* no link for an odd address */ }
  const poster = tilePosterPath(t.files);
  if (poster) out.poster = src(poster);
  return out;
}

/** A page's tile in the zine's public recipe: what it is, where it came from, where it went. */
export function pieceRecipe(page, pageId) {
  if (!pieceReady(page) || !pieceFits(page)) return null;
  if (page.piece.kind === "book") return bookRecipe(page, pageId);
  if (page.piece.kind === "activity") return activityRecipe(page);
  const t = page.piece;
  const out = { kind: t.kind, uri: t.uri, cid: t.cid, name: oneLine(t.name, TILE_NAME_MAX), folder: tileFolder(pageId) };
  if (t.typeId) out.type = t.typeId;
  if (t.typeVersion) out.typeVersion = t.typeVersion;
  if (t.foundryVersion) out.foundryVersion = t.foundryVersion;
  if (t.maker === "app" && t.kind === "tile") {
    // Made with another app (or by hand): which app, and for Treeline the activity it replays.
    const a = t.app || {};
    if (generatorOf(a.generator)) out.generator = generatorOf(a.generator);
    if (a.activityUri) out.activity = a.activityUri;
  }
  if (isAtmoPiece(t)) {
    // Made with ATMOSYNTH: the patch, and whose modules and samples it uses (kept for fuller credits later).
    const a = t.atmo || {};
    out.generator = ATMOSYNTH;
    out.patch = { modules: a.modules || [], samples: a.samples || [] };
    if (a.patchId) out.patch.id = a.patchId;
    if (a.creator) out.patch.creator = a.creator;
    if (a.forkedFrom) out.patch.forkedFrom = a.forkedFrom;
    if (a.others) out.sealed = true;
  }
  return out;
}

/**
 * Whether a published tile can go on an "A tile" page, from its recipe and the
 * Foundry's types (getType(id) -> type or undefined):
 *   { ok: true, type } or { ok: false, reason }
 */
export function tilePlacement(recipe, getType, want = "live", generator = "") {
  const foundry = Boolean(recipe && recipe.madeWith === "Web Tile Foundry");
  // ATMOSYNTH's own tiles (no recipe; marked by the generator in their manifest).
  if (isAtmosynthTile(generator) && !foundry) {
    if (want === "live") return { ok: true, type: ATMO_TYPE };
    return { ok: false, reason: "ATMOSYNTH tiles go on “A web tile” pages.", type: ATMO_TYPE };
  }
  // Any other tile of yours that the Foundry didn't make (v0.28.0): Treeline's,
  // another app's, a hand-made one. It runs as it is, on "A web tile" pages.
  if (!foundry || typeof recipe.type !== "string") {
    const type = appType(generator);
    if (want === "live") return { ok: true, type };
    return { ok: false, reason: "Tiles from other apps go on “A web tile” pages.", type };
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
