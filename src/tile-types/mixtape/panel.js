// The Mixtape panel's rules (no page or audio work here, so the tests can run
// them in Node): starting values, the shows in the liner notes, free words,
// and what goes in the public recipe.

import { normalizeTracks } from "./workshop.js";

export const SIDES = Object.freeze(["A", "B"]);
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 200;
export const LABEL_MAX = 40;
export const DEDICATION_MAX = 300;
export const NOTES_MAX = 5000;
export const WORDS_MAX = 300;
export const MAX_TRACKS = 40;

export function panelDefaults({ handle = null } = {}) {
  return {
    tracks: [],
    label: "",
    dedication: "",
    notes: "",
    genres: "",
    moods: "",
    tags: "",
    name: handle ? `A mixtape from @${handle}` : "A mixtape",
    description: "",
    confirm: false,
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
  if (key === "tracks") return { values: { ...values, tracks: normalizeTracks(value, SIDES) } };
  if (key === "addShows") return { values: { ...values, notes: addShowsToNotes(values.notes, values.tracks) } };
  return null;
}

/** The tape's own details for tape.json (tile.js makes the rest). */
export function tapeDetails(values) {
  return {
    label: { text: values.label },
    dedication: values.dedication,
    notes: values.notes,
    describe: { genres: splitWords(values.genres), moods: splitWords(values.moods), tags: splitWords(values.tags) },
    madeBy: values.handle ? { handle: values.handle } : null,
  };
}

/** The panel's choices for the public recipe (/foundry.json): no file names, nothing private. */
export function panelRecipe(values) {
  const songsFrom = (values.tracks || []).map((t) => (t.source && t.source.record ? t.source.record.uri.split("/")[2] : null));
  const owners = [...new Set(songsFrom.filter(Boolean))];
  return {
    songsFrom: owners.map((did) => ({ kind: "plyr.fm", did })),
    chosenTransitions: (values.tracks || []).filter((t) => t.transitionChosen).length,
    confirmed: values.confirm === true,
  };
}
