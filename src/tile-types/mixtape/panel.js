// The Mixtape panel's rules (no page or audio work here, so the tests can run
// them in Node): starting values, the shows in the liner notes, free words,
// and what goes in the public recipe.

import { normalizeTracks, hasArchiveSongs, SIDE_SECONDS } from "./workshop.js";
import { DEFAULT_KIT, kitById, kitColors } from "./kits.js";

export const SIDES = Object.freeze(["A", "B"]);
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 200;
export const LABEL_MAX = 40;
export const DEDICATION_MAX = 300;
export const NOTES_MAX = 5000;
export const WORDS_MAX = 300;
export const MAX_TRACKS = 40;

/**
 * Tape lengths (v0.33.0), as printed on a cassette: the minutes of both sides
 * together. A C60 holds 30 minutes a side, a C90 45, a C120 60.
 */
export const LENGTHS = Object.freeze([
  { id: "C60", sideSeconds: SIDE_SECONDS },
  { id: "C90", sideSeconds: 45 * 60 },
  { id: "C120", sideSeconds: 60 * 60 },
]);
export const DEFAULT_LENGTH = "C60";

/** The length entry for an id; unknown or missing (tapes made before v0.33.0) means C60. */
export function lengthById(id) {
  return LENGTHS.find((l) => l.id === id) || LENGTHS[0];
}

/** Seconds a side holds for the chosen length. */
export function sideSecondsOf(values) {
  return lengthById(values && values.tapeLength).sideSeconds;
}

export function panelDefaults({ handle = null } = {}) {
  return {
    tapeLength: DEFAULT_LENGTH,
    tracks: [],
    label: "",
    kit: DEFAULT_KIT,
    dedication: "",
    notes: "",
    genres: "",
    moods: "",
    tags: "",
    name: handle ? `A mixtape from @${handle}` : "A mixtape",
    description: "",
    confirm: false,
    confirmShared: false,
    handle,
  };
}

/** The shows (albums) of the songs, in tape order, each once. */
export function showsOf(tracks) {
  const out = [];
  for (const t of tracks || []) {
    const a = typeof t.album === "string" ? t.album.trim() : "";
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** The notes with any shows not already mentioned added at the end, one per line. */
export function addShowsToNotes(notes, tracks) {
  const text = typeof notes === "string" ? notes.replace(/\s+$/, "") : "";
  const missing = showsOf(tracks).filter((s) => !text.includes(s));
  if (!missing.length) return text;
  const heading = text ? "" : "Songs from:\n";
  return `${text}${text ? "\n" : ""}${heading}${missing.join("\n")}`.slice(0, NOTES_MAX);
}

/** "funk, soul ,  live" -> ["funk", "soul", "live"] */
export function splitWords(s) {
  return String(s || "")
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Changes that touch other values (see applyChange in src/core/contract.js). */
export function applyPanelChange(key, value, values) {
  if (key === "tracks") {
    const tracks = normalizeTracks(value, SIDES);
    // The confirmation's words follow the songs (R3b-20): when they change
    // (the first Archive song added, or the last one taken off), the box is
    // ticked again against the words now shown.
    if (hasArchiveSongs(tracks) !== hasArchiveSongs(values.tracks)) return { values: { ...values, tracks, confirm: false, confirmShared: false } };
    return { values: { ...values, tracks } };
  }
  if (key === "addShows") return { values: { ...values, notes: addShowsToNotes(values.notes, values.tracks) } };
  return null;
}

/** The tape's own details for tape.json (tile.js makes the rest). */
export function tapeDetails(values) {
  return {
    label: { text: values.label, style: kitById(values.kit).id, colors: kitColors(values.kit), length: lengthById(values.tapeLength).id },
    dedication: values.dedication,
    notes: values.notes,
    describe: { genres: splitWords(values.genres), moods: splitWords(values.moods), tags: splitWords(values.tags) },
    madeBy: values.handle ? { handle: values.handle } : null,
  };
}

/** The panel's choices for the public recipe (/foundry.json): no file names, nothing private. */
export function panelRecipe(values) {
  // Each account the songs came from, once per kind: plyr.fm songs (fm.plyr.track)
  // and imported Archive songs (cafe.thunderbird.audio.track, v0.36.0).
  const seen = new Set();
  const songsFrom = [];
  for (const t of values.tracks || []) {
    const uri = t.source && t.source.record ? t.source.record.uri : "";
    const [, , did, collection] = uri.split("/");
    if (!did) continue;
    const kind = collection === "cafe.thunderbird.audio.track" ? "audio.track" : "plyr.fm";
    if (seen.has(`${kind}|${did}`)) continue;
    seen.add(`${kind}|${did}`);
    songsFrom.push({ kind, did });
  }
  const shared = hasArchiveSongs(values.tracks);
  return {
    songsFrom,
    kit: kitById(values.kit).id,
    tapeLength: lengthById(values.tapeLength).id,
    chosenTransitions: (values.tracks || []).filter((t) => t.transitionChosen).length,
    confirmed: (shared ? values.confirmShared : values.confirm) === true,
  };
}
