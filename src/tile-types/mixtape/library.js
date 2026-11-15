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

/** What the window remembers: { open: [show keys], scroll, source }. Safe with no storage or a broken entry. */
export function readMemory(storage) {
  try {
    const raw = storage && storage.getItem(MEMORY_KEY);
    const v = raw ? JSON.parse(raw) : null;
    const open = v && Array.isArray(v.open) ? v.open.filter((k) => typeof k === "string").slice(0, OPEN_MAX) : [];
    const scroll = v && Number.isFinite(v.scroll) && v.scroll > 0 ? Math.round(v.scroll) : 0;
    const source = v && FILTER_IDS.includes(v.source) ? v.source : "all";
    return { open, scroll, source };
  } catch {
    return { open: [], scroll: 0, source: "all" };
  }
}

export function writeMemory(storage, { open = [], scroll = 0, source = "all" } = {}) {
  try {
    if (!storage) return;
    storage.setItem(MEMORY_KEY, JSON.stringify({ open: [...open].slice(0, OPEN_MAX), scroll: Math.max(0, Math.round(scroll) || 0), source: FILTER_IDS.includes(source) ? source : "all" }));
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
