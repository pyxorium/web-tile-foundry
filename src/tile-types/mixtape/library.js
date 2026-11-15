import { formatDuration } from "../../core/contract.js";

// The Choose songs window's rules (picker.js draws it): searching the
// library, the side meters' "to burn" lines, a whole show's tick, and what
// the window remembers between visits. Kept free of the page so the tests can
// use it.

/** Lower-case words of a search, split on spaces. */
export function searchWords(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether a song matches a search: every word must appear somewhere in the
 * song's title, its performer, or its show's name (which usually carries the
 * venue and date, so years and venues are found too); for imported Archive
 * songs also the recording's venue, place, taper and date (v0.36.0).
 */
export function songMatches(song, words, album = "") {
  if (!words.length) return true;
  const s = song || {};
  const hay = [s.title, s.artist, album || s.album, s.venue, s.place, s.taper, s.date].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Whether a search finds a show by the show itself (v0.36.2, R3b-21): every
 * word in its name or, for an imported recording, its band, venue, place,
 * date or taper (the same for every song in it). Such a show starts closed
 * while searching ("yonder" lists the Yonder Mountain shows as single lines);
 * a show found by song titles starts open with just those songs.
 */
export function showMatches(show, words) {
  if (!words.length || !show) return false;
  const first = (show.songs && show.songs[0]) || {};
  const own = [show.album];
  if (first.kind === "archive") own.push(first.artist, first.venue, first.place, first.date, first.taper);
  const hay = own.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The source filter by the search box (v0.36.0): "all", "plyr" or "archive". */
export const SOURCE_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "plyr", label: "plyr.fm" },
  { id: "archive", label: "Archive" },
]);

/** A show's (or song's) source: "archive" for imported tracks, "plyr" otherwise. */
export function sourceOf(item) {
  return item && item.kind === "archive" ? "archive" : "plyr";
}

/** Whether a show passes the source filter. */
export function sourceMatches(item, filter) {
  return !filter || filter === "all" || sourceOf(item) === filter;
}

/** The small label on a show's heading. */
export function sourceLabel(item) {
  return sourceOf(item) === "archive" ? "Archive" : "plyr.fm";
}

/**
 * Shows from both sources in one list, newest added first (a 1997 concert
 * imported today lands at the top; R3b-10). Ties keep plyr.fm's shows first,
 * then by name.
 */
export function mergeShows(...lists) {
  return lists
    .flat()
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const x = a.g.newest || "", y = b.g.newest || "";
      if (x !== y) return x < y ? 1 : -1;
      return a.i - b.i;
    })
    .map((e) => e.g);
}

/**
 * The "artist · show" line without the band twice (R3b-18): an imported
 * show's name starts with its band ("Yonder Mountain String Band · The
 * Fillmore · 2002-04-20"), so the artist is left out when the show name
 * already begins with it. The same rule is in runtime/player.js.
 */
export function artistShowLine(artist, album) {
  const a = String(artist || "").trim();
  const b = String(album || "").trim();
  if (a && b && b.toLowerCase().startsWith(`${a.toLowerCase()} · `)) return b;
  return [a, b].filter(Boolean).join(" · ");
}

/**
 * One side's meter: { side, total, max, left, over, line }.
 * `line` is the short words beside the bar: "3:18 to burn", "Burned down"
 * when exactly full, "0:36 over" when too long; empty without a limit.
 */
export function sideMeter(tracks, side, max) {
  const total = (tracks || []).filter((t) => t.side === side).reduce((n, t) => n + (Number(t.seconds) || 0), 0);
  const limit = Number(max) > 0 ? Number(max) : 0;
  if (!limit) return { side, total, max: 0, left: 0, over: false, line: "" };
  const left = Math.round(limit - total);
  const over = left < 0;
  const line = over ? `${formatDuration(-left)} over` : left === 0 ? "Burned down" : `${formatDuration(left)} to burn`;
  return { side, total, max: limit, left, over, line };
}

/** Every side's meter, in the sides' order. */
export function sideMeters(tracks, sides, max) {
  return (sides || []).map((s) => sideMeter(tracks, s, max));
}

/** A tape is burned down when no side is over and every side has less than a minute left. */
export function tapeBurnedDown(meters) {
  return meters.length > 0 && meters.every((m) => m.max > 0 && !m.over && m.left < 60);
}

/**
 * A show's tick: "all" when every usable song is on the tape, "some" when
 * a few are, "none" otherwise (also when the show has no usable songs).
 */
export function showTick(show, tracks) {
  const usable = ((show && show.songs) || []).filter((s) => s.usable);
  if (!usable.length) return "none";
  const on = new Set((tracks || []).map((t) => t.id));
  const n = usable.filter((s) => on.has(s.uri)).length;
  return n === 0 ? "none" : n === usable.length ? "all" : "some";
}

/** A show's key for remembering it open: its account and its name. */
export function showKey(did, album) {
  return `${did || ""}|${album || ""}`;
}

export const MEMORY_KEY = "foundry.mixtape.chooser";
const OPEN_MAX = 400;

const FILTER_IDS = SOURCE_FILTERS.map((f) => f.id);

// A remembered column width (v0.37.0): 0 means the narrow default.
const cleanWidth = (w) => (Number.isFinite(w) && w > TAPE_WIDTH ? Math.min(4000, Math.round(w)) : 0);

/** What the window remembers: { open: [show keys], scroll, source, width }. Safe with no storage or a broken entry. */
export function readMemory(storage) {
  try {
    const raw = storage && storage.getItem(MEMORY_KEY);
    const v = raw ? JSON.parse(raw) : null;
    const open = v && Array.isArray(v.open) ? v.open.filter((k) => typeof k === "string").slice(0, OPEN_MAX) : [];
    const scroll = v && Number.isFinite(v.scroll) && v.scroll > 0 ? Math.round(v.scroll) : 0;
    const source = v && FILTER_IDS.includes(v.source) ? v.source : "all";
    const width = cleanWidth(v && v.width);
    return { open, scroll, source, width };
  } catch {
    return { open: [], scroll: 0, source: "all", width: 0 };
  }
}

export function writeMemory(storage, { open = [], scroll = 0, source = "all", width = 0 } = {}) {
  try {
    if (!storage) return;
    const v = { open: [...open].slice(0, OPEN_MAX), scroll: Math.max(0, Math.round(scroll) || 0), source: FILTER_IDS.includes(source) ? source : "all" };
    const w = cleanWidth(width);
    if (w) v.width = w;
    storage.setItem(MEMORY_KEY, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the window just won't remember */
  }
}

/** The narrow column's line on phones: "Side A · 6 songs · Side B · 5 songs". */
export function tapeLine(tracks, sides) {
  return (sides || [])
    .map((s) => {
      const n = (tracks || []).filter((t) => t.side === s).length;
      return `Side ${s} · ${n} ${n === 1 ? "song" : "songs"}`;
    })
    .join(" · ");
}

// ---- The tape desk (v0.37.0, R3d-1 to R3d-9) ----

/** The tape column's narrowest (and default) width, px. */
export const TAPE_WIDTH = 230;
/** The library keeps at least this much beside a widened column, px. */
export const LIBRARY_MIN = 480;
/** From this width the column shows each song's show under its title (R3d-1), px. */
export const SHOW_LINE_WIDTH = 320;

/**
 * The column's width as drawn (R3d-3): the wanted width (0 = default) kept
 * between 230 px and about half the window, the library keeping at least
 * 480 px. A window too small for what's wanted shrinks the column without
 * changing what's remembered. `space`: the window body's width.
 */
export function tapeWidth(want, space) {
  const w = Number(want) > 0 ? Number(want) : TAPE_WIDTH;
  const room = Number(space) > 0 ? Number(space) : 0;
  if (!room) return TAPE_WIDTH;
  const max = Math.max(TAPE_WIDTH, Math.floor(Math.min(room / 2, room - LIBRARY_MIN)));
  return Math.round(Math.min(max, Math.max(TAPE_WIDTH, w)));
}

/** The songs on one side, in playing order. */
export function sideSongs(tracks, side) {
  return (tracks || []).filter((t) => t && t.side === side);
}

/** Where a song is: { side, index } (its place on its side), or null. */
export function placeOf(tracks, id) {
  const t = (tracks || []).find((x) => x && x.id === id);
  if (!t) return null;
  return { side: t.side, index: sideSongs(tracks, t.side).indexOf(t) };
}

/**
 * The list with `track` put on `side` at `index` (its place among that
 * side's songs, counted without it; past the end means last). Songs keep
 * their order in the list; only the side's order matters for playing.
 */
export function putTrack(tracks, track, side, index) {
  const rest = (tracks || []).filter((t) => t && t.id !== track.id);
  const moved = track.side === side ? track : { ...track, side };
  const same = rest.filter((t) => t.side === side);
  const k = Math.max(0, Math.min(same.length, Math.floor(Number(index) || 0)));
  if (k < same.length) {
    const at = rest.indexOf(same[k]);
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  }
  if (same.length) {
    const at = rest.indexOf(same[same.length - 1]) + 1;
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  }
  return [...rest, moved];
}

/** A song moved to `side` at `index` (see putTrack); the same list when it's already there or not on the tape. */
export function moveTrack(tracks, id, side, index) {
  const t = (tracks || []).find((x) => x && x.id === id);
  if (!t) return tracks;
  const at = placeOf(tracks, id);
  const k = Math.max(0, Math.min(sideSongs(tracks, side).filter((x) => x.id !== id).length, Math.floor(Number(index) || 0)));
  if (at.side === side && at.index === k) return tracks;
  return putTrack(tracks, t, side, k);
}

/** ↑ (dir -1) or ↓ (dir 1) within its side; the same list at the side's end. */
export function stepTrack(tracks, id, dir) {
  const at = placeOf(tracks, id);
  if (!at) return tracks;
  const k = at.index + (dir < 0 ? -1 : 1);
  if (k < 0 || k >= sideSongs(tracks, at.side).length) return tracks;
  return moveTrack(tracks, id, at.side, k);
}

/**
 * "to Side B" / "to Side A": across the flip. To a later side the song goes
 * first on it, to an earlier side last, so it stays next to the songs it was
 * beside (Side A's last song becomes Side B's first, and back).
 * `dir`: 1 to the next side, -1 to the one before; the same list when there's none.
 */
export function crossTrack(tracks, id, sides, dir) {
  const at = placeOf(tracks, id);
  if (!at) return tracks;
  const i = (sides || []).indexOf(at.side) + (dir < 0 ? -1 : 1);
  if (i < 0 || i >= sides.length) return tracks;
  const to = sides[i];
  return moveTrack(tracks, id, to, dir < 0 ? sideSongs(tracks, to).length : 0);
}

/** Which song is selected after one is removed (R3d-6): the next on its side, else the one before, else none. */
export function selectAfterRemove(tracks, id) {
  const at = placeOf(tracks, id);
  if (!at) return null;
  const same = sideSongs(tracks, at.side);
  const next = same[at.index + 1] || same[at.index - 1];
  return next ? next.id : null;
}

/** The words a screen reader hears after a move (R3d-2): "Moved to Side B, position 3". */
export function movedLine(tracks, id, sides) {
  const at = placeOf(tracks, id);
  if (!at) return "";
  return `Moved to ${(sides || []).length > 1 ? `Side ${at.side}` : "the tape"}, position ${at.index + 1}`;
}
