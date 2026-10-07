// Reading an account's songs on plyr.fm: its public fm.plyr.track records,
// read straight from the account's own server (no sign-in needed), grouped
// by show (the record's album).
//
// Only songs whose audio is stored on the account's own server (audioBlob)
// can go on a tape today. Older plyr.fm uploads keep their audio only on
// plyr.fm's own storage, which other sites can't read (no CORS, as found in
// the audio lab, Oct 2026); those are listed with the reason.
//
// The account is a setting ("songs from this account"), not assumed to be
// the signed-in one, so other song sources can be added later (see the
// mixtape plan, "Song sources").

import { trackNumberOf } from "./transitions.js";

export const PLYR_TRACK = "fm.plyr.track";
const PAGE = 100;
const MAX_PAGES = 50; // 5000 songs
const TIMEOUT_MS = 15000;

export const REASONS = Object.freeze({
  storage: "Only on plyr.fm's storage, which other sites can't read. In plyr.fm, copy its audio to your PDS to use it here.",
  gated: "For supporters only.",
  noAudio: "No audio file in the record.",
});

/** "15 My Sweet Lord" -> "My Sweet Lord"; titles without a leading number stay as they are. */
export function stripTrackNumber(title) {
  const s = String(title || "").trim();
  const m = /^\s*\d{1,3}\s*(?:[.)\-–:]\s*|\s+)(?=\S)/.exec(s);
  return m ? s.slice(m[0].length).trim() : s;
}

const CID = /^b[a-z2-7]{20,}$/;

/** A name for comparing: no leading @, spaces squeezed, any case. */
function nameKey(s) {
  return String(s || "").trim().replace(/^@/, "").replace(/\s+/g, " ").toLowerCase();
}

function ownerNamesOf(owner) {
  const list = Array.isArray(owner) ? owner : owner ? [owner] : [];
  return new Set(list.map(nameKey).filter(Boolean));
}

/**
 * The names plyr.fm may have put in an account's `artist` fields: its handle,
 * and its display name from its Bluesky profile (read from the account's own
 * server; left out if that can't be read).
 */
export async function ownerNames({ did, pds, handle = null, fetchImpl = fetch }) {
  const names = handle ? [handle] : [];
  try {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", "app.bsky.actor.profile");
    url.searchParams.set("rkey", "self");
    const j = await getJson(url.toString(), fetchImpl);
    const name = j && j.value && typeof j.value.displayName === "string" ? j.value.displayName.trim() : "";
    if (name) names.push(name);
  } catch {
    /* no profile, or it couldn't be read: the handle alone */
  }
  return names;
}

/**
 * One record as a song:
 *   { uri, cid, title, trackNumber, album, artist, seconds, createdAt,
 *     blob: { cid, size, mimeType } | null, usable, reason }
 * `owner` is the account's handle, or a list of the account's names (handle
 * and display name): plyr.fm puts the uploader in `artist` (newer uploads
 * the handle, older ones the display name), which is not the performer, so
 * it is left out when it matches one of them.
 */
export function songFromRecord(rec, { owner = null } = {}) {
  const v = (rec && rec.value) || {};
  const rawTitle = typeof v.title === "string" ? v.title.trim() : "";
  const artist = typeof v.artist === "string" ? v.artist.trim() : "";
  const blobCid = v.audioBlob && v.audioBlob.ref && v.audioBlob.ref.$link;
  const blob = typeof blobCid === "string" && CID.test(blobCid)
    ? { cid: blobCid, size: Number(v.audioBlob.size) || null, mimeType: String(v.audioBlob.mimeType || "") }
    : null;
  let reason = null;
  if (v.supportGate) reason = "gated";
  else if (!blob) reason = v.audioUrl ? "storage" : "noAudio";
  return {
    uri: String(rec.uri || ""),
    cid: String(rec.cid || ""),
    title: stripTrackNumber(rawTitle) || rawTitle || "Untitled",
    trackNumber: trackNumberOf(rawTitle),
    album: typeof v.album === "string" && v.album.trim() ? v.album.trim() : "",
    artist: artist && !ownerNamesOf(owner).has(nameKey(artist)) ? artist : "",
    seconds: Number(v.duration) > 0 ? Number(v.duration) : 0,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    blob,
    usable: !reason,
    reason,
  };
}

/**
 * Songs grouped by show (album), newest show first; songs in track-number
 * order. Each show: { album, songs, usable (count), newest }.
 */
export function groupShows(songs) {
  const byAlbum = new Map();
  for (const s of songs) {
    const key = s.album || "Other songs";
    if (!byAlbum.has(key)) byAlbum.set(key, []);
    byAlbum.get(key).push(s);
  }
  const shows = [...byAlbum.entries()].map(([album, list]) => ({
    album,
    songs: list.slice().sort((a, b) => {
      if (a.trackNumber != null && b.trackNumber != null && a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
      return a.title.localeCompare(b.title, undefined, { numeric: true });
    }),
    usable: list.filter((s) => s.usable).length,
    newest: list.reduce((m, s) => (s.createdAt > m ? s.createdAt : m), ""),
  }));
  shows.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : a.album.localeCompare(b.album)));
  return shows;
}

async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`the account's server answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("the account's server is taking too long to respond");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Every fm.plyr.track record of an account, as songs (songFromRecord). */
export async function listPlyrSongs({ did, pds, owner = null, fetchImpl = fetch }) {
  const songs = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", PLYR_TRACK);
    url.searchParams.set("limit", String(PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const j = await getJson(url.toString(), fetchImpl);
    const records = Array.isArray(j.records) ? j.records : [];
    for (const rec of records) songs.push(songFromRecord(rec, { owner }));
    if (!j.cursor || !records.length) break;
    cursor = j.cursor;
  }
  return songs;
}
