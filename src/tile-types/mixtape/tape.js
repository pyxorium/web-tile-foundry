// The tape's track list, /tape.json (format: claude/tape-json-spec.md, v2).
// Players read this file: the tile's own page, Tileman, anything else. The
// Foundry writes it the same way every time for the same tape (no dates, a
// fixed field order), so publishing the same tape twice gives the same file.
//
// Only known fields, each checked and trimmed: everything in it is shown to
// listeners, and players treat it all as plain text.

import { TAPE_FORMAT } from "../../core/audio/mp3.js";

export const TAPE_PATH = "/tape.json";
export const TAPE_VERSION = 2;

export const LIMITS = Object.freeze({
  title: 120,
  artist: 200,
  album: 200,
  label: 60,
  dedication: 300,
  notes: 5000,
  term: 40,
  terms: 20,
});

const AT_URI = /^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~:-]+$/;
const CID = /^b[a-z2-7]{20,}$/;
const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const HANDLE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Trimmed text with line breaks kept (for notes) or folded (everything else); "" if not text. */
export function cleanText(value, max, { lines = false } = {}) {
  if (typeof value !== "string") return "";
  let s = value.replace(/\r\n?/g, "\n");
  // Control characters (other than line breaks) never belong in a label.
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  s = lines ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  s = s.trim();
  return [...s].slice(0, max).join("").trim();
}

function cleanUrl(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function cleanTerms(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const s = cleanText(t, LIMITS.term);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
    if (out.length >= LIMITS.terms) break;
  }
  return out;
}

/** { genres, moods, tags } of free words (scheme "free", the default), or null if empty. */
export function cleanDescribe(d) {
  if (!d || typeof d !== "object") return null;
  const out = {};
  for (const key of ["genres", "moods", "tags"]) {
    const terms = cleanTerms(d[key]);
    if (terms.length) out[key] = terms;
  }
  if (d.live === true) out.live = true;
  return Object.keys(out).length ? out : null;
}

/** { name?, did?, handle? } or null. */
export function cleanPerson(p) {
  if (!p || typeof p !== "object") return null;
  const out = {};
  const name = cleanText(p.name, 100);
  if (name) out.name = name;
  if (typeof p.did === "string" && DID.test(p.did) && p.did.length <= 200) out.did = p.did;
  if (typeof p.handle === "string" && HANDLE.test(p.handle) && p.handle.length <= 253) out.handle = p.handle.toLowerCase();
  return Object.keys(out).length ? out : null;
}

/** Where a song came from: { record: { uri, cid }, url } (each part only if valid), or null. */
export function cleanSource(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  const r = s.record;
  if (r && typeof r.uri === "string" && AT_URI.test(r.uri) && typeof r.cid === "string" && CID.test(r.cid)) {
    out.record = { uri: r.uri, cid: r.cid };
  }
  const url = cleanUrl(s.url);
  if (url) out.url = url;
  return Object.keys(out).length ? out : null;
}

/** The side letter used in file names: "A" -> "a"; other names -> "s1", "s2"… by position. */
export function sideKey(name, index) {
  return /^[A-Za-z]$/.test(name) ? name.toLowerCase() : `s${index + 1}`;
}

/** /tracks/a1.mp3, /tracks/b3.mp3, … (n counts from 1 within the side). */
export function trackPath(sideName, sideIndex, n) {
  return `/tracks/${sideKey(sideName, sideIndex)}${n}.mp3`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The tape.json object. `sides`: [{ name, tracks: [{ path, cid, title, artist?,
 * album?, year?, duration, source?, transition? }] }]; the other fields are the
 * tape's own (title, artist, madeBy, dedication, notes, label, describe, cover).
 * Empty or invalid optional fields are left out.
 */
export function makeTape({ title, artist, madeBy, dedication, notes, label, describe, cover, sides }) {
  const tape = { v: TAPE_VERSION, title: cleanText(title, LIMITS.title) };
  if (!tape.title) throw new Error("The tape needs a title.");
  const a = cleanText(artist, LIMITS.artist);
  if (a) tape.artist = a;
  const who = cleanPerson(madeBy);
  if (who) tape.madeBy = who;
  const ded = cleanText(dedication, LIMITS.dedication);
  if (ded) tape.dedication = ded;
  const n = cleanText(notes, LIMITS.notes, { lines: true });
  if (n) tape.notes = n;
  const labelText = cleanText(label && label.text, LIMITS.label);
  if (labelText) tape.label = { text: labelText };
  if (typeof cover === "string" && /^\/[a-z0-9/_-]+\.png$/.test(cover)) tape.cover = cover;
  const desc = cleanDescribe(describe);
  if (desc) tape.describe = desc;
  tape.audio = { mimeType: TAPE_FORMAT.mimeType, bitrate: TAPE_FORMAT.kbps, sampleRate: TAPE_FORMAT.sampleRate, channels: TAPE_FORMAT.channels };

  tape.sides = sides
    .filter((s) => s.tracks.length)
    .map((s) => ({
      name: cleanText(s.name, 30) || "A",
      tracks: s.tracks.map((t) => {
        const track = { path: t.path, cid: t.cid, title: cleanText(t.title, LIMITS.title) };
        if (!track.title) throw new Error("Every song needs a title.");
        const ar = cleanText(t.artist, LIMITS.artist);
        if (ar) track.artist = ar;
        const al = cleanText(t.album, LIMITS.album);
        if (al) track.album = al;
        if (Number.isInteger(t.year) && t.year > 1800 && t.year < 3000) track.year = t.year;
        track.duration = round2(t.duration);
        const src = cleanSource(t.source);
        if (src) track.source = src;
        if (t.transition) track.transition = t.transition;
        return track;
      }),
    }));
  if (!tape.sides.length) throw new Error("The tape has no songs.");
  return tape;
}

/** The file's text: the same tape always gives the same bytes. */
export function tapeJson(tape) {
  return JSON.stringify(tape, null, 2) + "\n";
}
