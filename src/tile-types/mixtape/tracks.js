// Songs kept on the PDS as cafe.thunderbird.audio.track records (Foundry
// v0.35.0, Mixtape Burndown's importer; lexicon: pyxorium/audio-tracks).
// Since v0.36.0 the Choose songs window lists them beside plyr.fm's songs
// (songFromTrack, listTrackSongs, groupTrackShows).
// Listing is public (listRecords, no sign-in); storing and editing go through
// the signed-in account's own server (`xrpc`, as for publishTile).
// No DOM here, so Node (tests) can import it.

import { TRACK_COLLECTION } from "../../auth/client-config.js";
import { isScopeRefusal } from "../../core/tile-post.js";

export { TRACK_COLLECTION };

/** The importer is for pyxorium.com only for now (V2-2, matched by DID, not handle). */
export const IMPORT_DID = "did:plc:rqbqpaaluty5v47jwciowpik";

const PAGE = 100;
const MAX_PAGES = 50;
const TIMEOUT_MS = 15000;

export class TrackError extends Error {
  constructor(message, step) {
    super(message);
    this.name = "TrackError";
    this.step = step; // "upload" | "create" | "verify" | "scope" | "update"
  }
}

/** One record as the importer lists it. */
export function trackFromRecord(rec) {
  const v = (rec && rec.value) || {};
  const r = v.recording && typeof v.recording === "object" ? v.recording : {};
  const s = (x) => (typeof x === "string" ? x : "");
  const blob = v.audioBlob && v.audioBlob.ref && v.audioBlob.ref.$link ? v.audioBlob : null;
  const uri = String((rec && rec.uri) || "");
  return {
    uri,
    rkey: uri.split("/").pop(),
    cid: String((rec && rec.cid) || ""),
    value: v,
    title: s(v.title) || "Untitled",
    artist: s(v.artist),
    album: s(v.album),
    trackNumber: Number.isInteger(v.trackNumber) ? v.trackNumber : null,
    seconds: Number(v.duration) > 0 ? Number(v.duration) : 0,
    size: blob ? Number(blob.size) || 0 : 0,
    blob,
    description: s(v.description),
    createdAt: s(v.createdAt),
    date: s(r.date),
    venue: s(r.venue),
    place: s(r.place),
    set: s(r.set),
    taper: s(r.taper),
    source: s(r.source),
    archiveUrl: s(r.archiveUrl),
    policyUrl: s(r.policyUrl),
  };
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

/** Every track record of an account (public, read from its own server). */
export async function listTracks({ did, pds, fetchImpl = fetch }) {
  const tracks = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", TRACK_COLLECTION);
    url.searchParams.set("limit", String(PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const j = await getJson(url.toString(), fetchImpl);
    const records = Array.isArray(j.records) ? j.records : [];
    for (const rec of records) tracks.push(trackFromRecord(rec));
    if (!j.cursor || !records.length) break;
    cursor = j.cursor;
  }
  return tracks;
}

/**
 * Tracks grouped by recording (the Archive address, else the show name), the
 * newest added first; songs in track order: [{ key, album, tracks, newest }].
 */
export function groupRecordings(tracks) {
  const groups = new Map();
  for (const t of tracks) {
    const key = (t.archiveUrl || t.album || "Other songs").toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, album: t.album || "Other songs", tracks: [], newest: "" });
    const g = groups.get(key);
    g.tracks.push(t);
    if (t.createdAt > g.newest) g.newest = t.createdAt;
  }
  const list = [...groups.values()];
  for (const g of list) g.tracks.sort((a, b) => (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) || a.title.localeCompare(b.title));
  list.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : a.album.localeCompare(b.album)));
  return list;
}

/** Audio a browser can decode for converting to the tape's MP3 (the importer stores Opus in WebM). */
const PLAYABLE = /^audio\/(webm|ogg|opus|mpeg|mp3|flac|x-flac|wav|x-wav|mp4|aac)\b/;

/**
 * A track record as a song in the Choose songs window, shaped like plyr.js's
 * songFromRecord (uri, cid, title, trackNumber, album, artist, seconds,
 * createdAt, blob, usable, reason), plus `kind: "archive"` and the
 * recording's details (date, venue, place, set, taper, source, archiveUrl,
 * policyUrl) for search and for the tape's credits.
 */
export function songFromTrack(t) {
  const blobCid = t.blob && t.blob.ref && t.blob.ref.$link;
  const mimeType = String((t.blob && t.blob.mimeType) || (t.value && t.value.fileType) || "");
  const blob = typeof blobCid === "string" && /^b[a-z2-7]{20,}$/.test(blobCid) ? { cid: blobCid, size: Number(t.blob.size) || null, mimeType } : null;
  const reason = !blob ? "noAudio" : !PLAYABLE.test(mimeType.toLowerCase()) ? "format" : null;
  return {
    uri: t.uri,
    cid: t.cid,
    kind: "archive",
    title: t.title,
    trackNumber: t.trackNumber,
    album: t.album,
    artist: t.artist,
    seconds: t.seconds,
    createdAt: t.createdAt,
    blob,
    usable: !reason,
    reason,
    date: t.date,
    venue: t.venue,
    place: t.place,
    set: t.set,
    taper: t.taper,
    source: t.source,
    archiveUrl: t.archiveUrl,
    policyUrl: t.policyUrl,
  };
}

/** Every track record of an account, as songs (songFromTrack). */
export async function listTrackSongs({ did, pds, fetchImpl = fetch }) {
  return (await listTracks({ did, pds, fetchImpl })).map(songFromTrack);
}

/**
 * Track songs grouped by recording for the window, shaped like plyr.js's
 * groupShows ({ album, songs, usable, newest }) plus `kind: "archive"` and
 * `key` (the recording: its Archive address, else its show name).
 */
export function groupTrackShows(songs) {
  return groupRecordings(songs).map((g) => ({
    kind: "archive",
    key: g.key,
    album: g.album,
    songs: g.tracks,
    usable: g.tracks.filter((s) => s.usable).length,
    newest: g.newest,
  }));
}

function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

function serverMessage(err) {
  return (err && (err.message || err.error)) || "unknown error";
}

/**
 * Stores one song: uploads its audio, then writes its record and reads it back.
 * makeRecord(audioBlob) builds the record (archive.js buildTrackRecord).
 * Resolves to { uri, rkey, cid, record }. Errors are TrackErrors whose message
 * is the server's own (R3b-9: a storage error stops the batch and is shown).
 */
export async function storeTrack({ xrpc, did, bytes, mimeType, makeRecord }) {
  let uploaded;
  try {
    uploaded = await xrpc("com.atproto.repo.uploadBlob", { method: "POST", body: bytes, contentType: mimeType });
  } catch (err) {
    if (isScopeRefusal(err)) throw new TrackError(`Your account's server refused the upload: ${serverMessage(err)}`, "scope");
    throw new TrackError(`Uploading the song failed: ${serverMessage(err)}`, "upload");
  }
  const blob = uploaded && uploaded.blob;
  if (!blob || !blob.ref || !blob.ref.$link) throw new TrackError("The song was uploaded, but the server didn't say where it is.", "upload");
  const record = makeRecord(blob);
  let created;
  try {
    created = await xrpc("com.atproto.repo.createRecord", {
      method: "POST",
      // validate: false, as for tiles and tile posts: the account's server doesn't know this lexicon.
      body: { repo: did, collection: TRACK_COLLECTION, record, validate: false },
    });
  } catch (err) {
    if (isScopeRefusal(err)) throw new TrackError(`Your account's server refused to save the song: ${serverMessage(err)}`, "scope");
    throw new TrackError(`Saving the song failed: ${serverMessage(err)}`, "create");
  }
  return verify({ xrpc, did, created, record, step: "verify" });
}

async function verify({ xrpc, did, created, record, step }) {
  const uri = created && created.uri;
  if (typeof uri !== "string" || !uri.startsWith("at://")) throw new TrackError("The song was saved, but the server didn't say where.", step);
  const rkey = uri.split("/").pop();
  let back;
  try {
    back = await xrpc("com.atproto.repo.getRecord", { method: "GET", params: { repo: did, collection: TRACK_COLLECTION, rkey } });
  } catch (err) {
    throw new TrackError(`The song was saved, but reading it back failed: ${serverMessage(err)}`, step);
  }
  if (!back || !sameJson(back.value, record)) throw new TrackError("The song was saved, but what the server returned doesn't match what was sent.", step);
  return { uri, rkey, cid: (back && back.cid) || created.cid, record };
}

/**
 * Edit details (R3b-8): rewrites a track's record with the same stored audio.
 * `cid` is the version being edited (the server refuses if it changed since).
 */
export async function updateTrack({ xrpc, did, rkey, cid, record }) {
  let put;
  try {
    put = await xrpc("com.atproto.repo.putRecord", {
      method: "POST",
      body: { repo: did, collection: TRACK_COLLECTION, rkey, record, swapRecord: cid || undefined, validate: false },
    });
  } catch (err) {
    if (isScopeRefusal(err)) throw new TrackError(`Your account's server refused the change: ${serverMessage(err)}`, "scope");
    throw new TrackError(`Saving the changes failed: ${serverMessage(err)}`, "update");
  }
  return verify({ xrpc, did, created: put, record, step: "update" });
}

/** The record with new details: the same audio, file type and createdAt as `value`. */
export function editedRecord(value, changes) {
  const keep = { $type: TRACK_COLLECTION, ...value };
  const out = { $type: TRACK_COLLECTION };
  const t = (v) => String(v == null ? "" : v).trim();
  const title = t(changes.title);
  out.title = title || keep.title;
  if (t(changes.artist)) out.artist = t(changes.artist);
  if (t(changes.album)) out.album = t(changes.album);
  const n = Number(changes.trackNumber);
  if (changes.trackNumber !== "" && changes.trackNumber != null && Number.isInteger(n) && n >= 1 && n <= 999) out.trackNumber = n;
  if (keep.duration) out.duration = keep.duration;
  out.audioBlob = keep.audioBlob;
  if (keep.fileType) out.fileType = keep.fileType;
  if (t(changes.description)) out.description = t(changes.description);
  if (Array.isArray(keep.tags) && keep.tags.length) out.tags = keep.tags;
  if (keep.imageBlob) out.imageBlob = keep.imageBlob;
  const recording = {};
  for (const key of ["date", "venue", "place", "set", "taper", "source", "archiveUrl", "policyUrl"]) if (t(changes[key])) recording[key] = t(changes[key]);
  if (Object.keys(recording).length) out.recording = recording;
  out.createdAt = keep.createdAt;
  return out;
}
