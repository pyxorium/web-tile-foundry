// How one song leads into the next on a tape side, baked into the audio.
//
//   straight  the next song starts right away (keeps segues from a show intact)
//   pause     a short silence between the two songs
//   fade      the song fades out, a short silence, the next song fades in
//
// A song's own transition says how it leads into the NEXT song on its side,
// the same as the "Then" choice in the song list. The last song on a side
// has nothing after it, so its transition is ignored there (the side just
// ends). Fades are applied while the song is converted (convertSong in
// src/core/audio/convert.js); the silence is added to the end of the song's
// file when the tile is put together (tile.js). So every player, the tile's
// page, Tileman or anything else, plays the tape the same way.

import { TRANSITIONS } from "../../core/contract.js";

/** Seconds, kept in one place. Silence is cut in whole MP3 frames (36 ms each at 32 kHz). */
export const TIMING = Object.freeze({
  pause: Object.freeze({ pause: 2 }),
  fade: Object.freeze({ fadeOut: 2, pause: 1.5, fadeIn: 0.5 }),
});

/** What the song list shows when a song has no choice yet (the same as the list's default). */
export const DEFAULT_TRANSITION = "fade";

/** A song's transition, with the default filled in. */
export function transitionOf(track) {
  return track && TRANSITIONS.includes(track.transition) ? track.transition : DEFAULT_TRANSITION;
}

/**
 * What happens to song `i` of a side (the side's songs, in order):
 *   { fadeIn, fadeOut, pause, into }
 * fadeIn/fadeOut: seconds of fade to apply while converting; pause: seconds of
 * silence to add after it; into: its transition into the next song, or null
 * for the side's last song.
 */
export function shapeFor(sideTracks, i) {
  const last = i === sideTracks.length - 1;
  const into = last ? null : transitionOf(sideTracks[i]);
  const fromPrev = i > 0 ? transitionOf(sideTracks[i - 1]) : null;
  return {
    fadeIn: fromPrev === "fade" ? TIMING.fade.fadeIn : 0,
    fadeOut: into === "fade" ? TIMING.fade.fadeOut : 0,
    pause: into === "pause" ? TIMING.pause.pause : into === "fade" ? TIMING.fade.pause : 0,
    into,
  };
}

/**
 * Shapes for a whole song list (the tracks input's value): a Map from song id
 * to its shape, worked out side by side.
 */
export function shapesFor(tracks, sides) {
  const out = new Map();
  for (const side of sides) {
    const list = tracks.filter((t) => t.side === side);
    list.forEach((t, i) => out.set(t.id, shapeFor(list, i)));
  }
  return out;
}

/** The fades a song must be converted with; equal fades mean no need to convert again. */
export function fadesOf(shape) {
  return { fadeIn: shape.fadeIn, fadeOut: shape.fadeOut };
}

export function sameFades(a, b) {
  return !!a && !!b && a.fadeIn === b.fadeIn && a.fadeOut === b.fadeOut;
}

/** "03 The Ripper", "3. The Ripper", "03 - The Ripper" -> 3; no number -> null. */
export function trackNumberOf(title) {
  const m = /^\s*(\d{1,3})\s*(?:[.)\-–:]\s*|\s+)\S/.exec(String(title || ""));
  return m ? Number(m[1]) : null;
}

/**
 * The suggested transition from song a into song b: straight on when they were
 * back to back at the same show (same album, consecutive track numbers, from a
 * `trackNumber` or the title's leading number), so segues stay intact; fade
 * and pause otherwise.
 */
export function suggestTransition(a, b) {
  if (!a || !b) return DEFAULT_TRANSITION;
  const albumA = String(a.album || "").trim().toLowerCase();
  const albumB = String(b.album || "").trim().toLowerCase();
  if (!albumA || albumA !== albumB) return DEFAULT_TRANSITION;
  const na = Number.isInteger(a.trackNumber) ? a.trackNumber : trackNumberOf(a.title);
  const nb = Number.isInteger(b.trackNumber) ? b.trackNumber : trackNumberOf(b.title);
  return na !== null && nb === na + 1 ? "straight" : DEFAULT_TRANSITION;
}
