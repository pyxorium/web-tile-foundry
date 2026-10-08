// Sounds on zine pages (stage 3): one short clip per page, cut from one of the
// creator's own plyr.fm songs. Kept free of the browser so the tests can use it;
// the panel that picks and cuts clips is soundpanel.js.
//
// A page with its "Add a sound" switch on (page.sound = true) keeps its clip in
// page.clip:
//   { song: { uri, cid, title, album, artist, seconds, blobCid },
//     start, end,          the cut, in seconds of the song (up to CLIP_MAX_SECONDS)
//     title, details,      shown on the page's sound band (editable)
//     status,              "waiting" (no clip made yet) | "converting" | "ready" | "error"
//     bytes, seconds,      the finished clip (MP3, the Mixtape's format) when ready
//     made: { start, end } the cut the bytes were made from
//     error }              why it couldn't be made

export const CLIP_MAX_SECONDS = 60;
export const CLIP_MIN_SECONDS = 1;
export const FADE_IN_SECONDS = 0.5;
export const FADE_OUT_SECONDS = 1.5;
export const SOUND_TITLE_MAX = 80;
export const SOUND_DETAILS_MAX = 80;
export const PLYR_HOME = "https://plyr.fm/";

// The sound band's row at the bottom of a page (design pixels: 8 above, the
// 32 px band, 6 below), and how much word room it takes on the layouts whose
// words fill the page (measured in a browser, like SPRITE_COST).
export const SOUND_ROW = 46;
export const SOUND_COST = 240;
// A big quote shrinks to fit, so it only loses a little (measured: an A4 back
// page with the sprite and a sound fits 172 of the quote's 180).
export const QUOTE_SOUND_COST = 10;

/** Where a page's clip goes in the tile. */
export function soundPath(pageId) {
  return `/sounds/${pageId}.mp3`;
}

const TRACK_URI = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/fm\.plyr\.track\/([A-Za-z0-9._~:-]{1,512})$/;

/**
 * The song's page on plyr.fm, from its record address. plyr.fm's /at/ pages
 * look the record up and open the song (checked in plyr.fm's source, Oct 2026).
 */
export function plyrSongUrl(uri) {
  const m = TRACK_URI.exec(String(uri || ""));
  return m ? `${PLYR_HOME}at/${m[1]}/fm.plyr.track/${m[2]}` : null;
}

/** The details line a new clip starts with: the performer (when plyr.fm has one) and the show. */
export function defaultDetails(song) {
  return [song && song.artist, song && song.album].filter((x) => x && String(x).trim()).join(" · ").slice(0, SOUND_DETAILS_MAX);
}

const round1 = (n) => Math.round(n * 10) / 10;

/** A cut made safe: inside the song, at least CLIP_MIN_SECONDS and at most CLIP_MAX_SECONDS long. */
export function cleanCut(start, end, songSeconds) {
  const len = Number.isFinite(songSeconds) && songSeconds > 0 ? songSeconds : CLIP_MAX_SECONDS;
  let s = Number.isFinite(start) ? Math.max(0, Math.min(start, len)) : 0;
  let e = Number.isFinite(end) ? Math.max(0, Math.min(end, len)) : Math.min(len, s + CLIP_MAX_SECONDS);
  if (e < s) [s, e] = [e, s];
  if (e - s > CLIP_MAX_SECONDS) e = s + CLIP_MAX_SECONDS;
  if (e - s < CLIP_MIN_SECONDS) {
    e = Math.min(len, s + CLIP_MIN_SECONDS);
    s = Math.max(0, e - CLIP_MIN_SECONDS);
  }
  return { start: round1(s), end: round1(e) };
}

/** A new clip for a song from the picker (plyr.js songFromRecord): the first minute (or the whole song if shorter). */
export function clipFromSong(song) {
  const cut = cleanCut(0, CLIP_MAX_SECONDS, song.seconds);
  return {
    song: {
      uri: song.uri, cid: song.cid, title: song.title, album: song.album || "", artist: song.artist || "",
      seconds: song.seconds, blobCid: song.blob && song.blob.cid,
    },
    ...cut,
    title: String(song.title || "").slice(0, SOUND_TITLE_MAX),
    details: defaultDetails(song),
    status: "waiting",
  };
}

/** Fades for a clip of this length (shorter for very short clips). */
export function clipFades(seconds) {
  return { fadeIn: Math.min(FADE_IN_SECONDS, seconds / 4), fadeOut: Math.min(FADE_OUT_SECONDS, seconds / 3) };
}

/** Whether the clip's bytes were made from its current cut. */
export function clipUpToDate(clip) {
  return Boolean(clip && clip.made && clip.made.start === clip.start && clip.made.end === clip.end);
}

/** Whether a page's sound is ready to go into the zine. */
export function soundReady(page) {
  const c = page && page.sound && page.clip;
  return Boolean(c && c.status === "ready" && c.bytes instanceof Uint8Array && c.bytes.length > 0 && clipUpToDate(c));
}

/** Bytes a page's sound adds (for the size meter). */
export function soundBytes(page) {
  const c = page && page.clip;
  return c && c.bytes instanceof Uint8Array ? c.bytes.length : 0;
}

function nameOf(spec) {
  const n = spec.label || spec.id;
  return n.toLowerCase().startsWith("page") ? n : `The ${n.toLowerCase()}`;
}

/** Problems with a page's sound (the switch is on), as sentences. */
export function soundProblems(page, spec) {
  const c = page.clip;
  const name = nameOf(spec);
  if (!c || !c.song) return [`${name}: pick a song for its sound, or turn the sound off.`];
  const out = [];
  if (c.status === "error") out.push(`${name}: the sound couldn't be made (${String(c.error || "unknown problem").replace(/[.\s]+$/, "")}). Try again, or pick another song.`);
  else if (!soundReady(page)) out.push(`${name}: the sound is still being made.`);
  if (!String(c.title || "").trim()) out.push(`${name}: the sound needs a title.`);
  if (String(c.title || "").length > SOUND_TITLE_MAX) out.push(`${name}: the sound's title is longer than ${SOUND_TITLE_MAX} characters.`);
  if (String(c.details || "").length > SOUND_DETAILS_MAX) out.push(`${name}: the sound's details line is longer than ${SOUND_DETAILS_MAX} characters.`);
  return out;
}

/** Whether any page will carry a sound. */
export function usesSounds(pages) {
  return (pages || []).some((p) => soundReady(p));
}

function oneLine(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A page's sound as the reader gets it, or null. `src(page)` gives the clip's address. */
export function soundForReader(page, src = (p) => soundPath(p.id)) {
  if (!soundReady(page)) return null;
  const c = page.clip;
  const out = { src: src(page), title: oneLine(c.title, SOUND_TITLE_MAX) || "Untitled", seconds: Math.round((c.seconds || c.end - c.start) * 10) / 10 };
  const details = oneLine(c.details, SOUND_DETAILS_MAX);
  if (details) out.details = details;
  const url = plyrSongUrl(c.song.uri);
  if (url) out.url = url;
  return out;
}

/** A page's sound in the public recipe: where it went, what it says, and the song it was cut from. */
export function soundRecipe(page) {
  const s = soundForReader(page);
  if (!s) return null;
  const c = page.clip;
  const out = { path: s.src, title: s.title, start: c.start, end: c.end, seconds: s.seconds };
  if (s.details) out.details = s.details;
  out.source = { record: { uri: c.song.uri, cid: c.song.cid } };
  if (s.url) out.source.url = s.url;
  return out;
}
