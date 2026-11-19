// Reading a recording's folder for the importer (Foundry v0.35.0, Mixtape
// Burndown; claude/mixtape-3b-importer-notes.md R3b-2, R3b-5, R3b-7, R3b-9,
// R3b-15, R3b-16). No DOM here, so Node (tests) can import it.
//
// A recording is usually one Live Music Archive item downloaded as a folder:
// its name is the item's identifier (ymsb2002-04-20.flac16.sbd), it holds one
// FLAC per song named in etree shorthand (ymsb2002-04-20d1t03.flac = disc 1,
// track 3) and an info .txt with the band, venue, date, lineage and setlist.
// A folder downloaded whole also holds MP3s, Ogg files, pictures, spectrograms,
// checksums and the Archive's own XML and torrent files: only the FLACs and
// the info .txt are taken.
//
// Song names come, in order, from the FLAC's own tags, the info .txt's
// setlist (matched by disc and track), then the file name (R3b-7). An arrow
// at the end of a title ("Bolton Stretch >") is dropped; one between two names
// ("Intro > New Horizons") stays (R3b-16).

import { TRACK_COLLECTION } from "../../auth/client-config.js";
import { bitrateFor } from "../../core/audio/opus.js";

export { TRACK_COLLECTION };

// ---- the files in a folder ----

const FLAC_RE = /\.flac$/i;
const TXT_RE = /\.txt$/i;
// Text files the Archive or tools add that aren't the taper's info file.
const NOT_INFO_RE = /(_files|_meta|_reviews|ffp|md5|st5|sha1?|checksum|fingerprint|torrent)\b|\.(ffp|md5|st5|sha1?)\.txt$/i;

/** The recording's folder: the first part of a file's path inside the picked folder. */
export function folderOf(files) {
  for (const f of files) {
    const rel = String(f.webkitRelativePath || f.relativePath || "");
    const cut = rel.indexOf("/");
    if (cut > 0) return rel.slice(0, cut);
  }
  return "";
}

/**
 * Sorts picked files: { flacs, texts, ignored } (each a list of the given
 * objects; anything with a `name`). Only .flac and candidate info .txt files
 * are kept; everything else is counted as ignored.
 */
export function sortFiles(files) {
  const flacs = [];
  const texts = [];
  const ignored = [];
  for (const f of files) {
    const name = String((f && f.name) || "");
    if (FLAC_RE.test(name)) flacs.push(f);
    else if (TXT_RE.test(name) && !NOT_INFO_RE.test(name)) texts.push(f);
    else ignored.push(f);
  }
  flacs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { flacs, texts, ignored };
}

/** Which of several text files is the info file: the one with the longest setlist, then the largest. */
export function pickInfo(texts) {
  let best = null;
  for (const t of texts) {
    const info = parseInfoText(t.text || "");
    const score = info.setlist.length * 100000 + String(t.text || "").length;
    if (!best || score > best.score) best = { ...t, info, score };
  }
  return best;
}

// ---- names ----

// Dates may be stuck to letters, as in Archive identifiers ("ymsb2002-04-20").
const DATE_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const DATE_DOTS = /(?<!\d)(\d{4})\.(\d{2})\.(\d{2})(?!\d)/;
const DATE_US = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_WORDS = new RegExp(`\\b(${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i");

const pad = (n) => String(n).padStart(2, "0");

/** The first date in some text, as YYYY-MM-DD, with where it was found: { date, match } or null. */
export function findDate(text) {
  const s = String(text || "");
  let m = DATE_ISO.exec(s);
  if (m && validDate(m[1], m[2], m[3])) return { date: `${m[1]}-${m[2]}-${m[3]}`, match: m[0] };
  m = DATE_DOTS.exec(s);
  if (m && validDate(m[1], m[2], m[3])) return { date: `${m[1]}-${m[2]}-${m[3]}`, match: m[0] };
  m = DATE_WORDS.exec(s);
  if (m) {
    const k = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3))) + 1;
    if (validDate(m[3], k, m[2])) return { date: `${m[3]}-${pad(k)}-${pad(m[2])}`, match: m[0] };
  }
  m = DATE_US.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y > 50 ? 1900 : 2000;
    if (validDate(y, m[1], m[2])) return { date: `${y}-${pad(m[1])}-${pad(m[2])}`, match: m[0] };
  }
  return null;
}

function validDate(y, mo, d) {
  y = Number(y);
  mo = Number(mo);
  d = Number(d);
  return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

/**
 * The folder's name read as an Archive identifier:
 * { identifier, archiveUrl, date, sourceHint } (archiveUrl null when it
 * doesn't look like one; sourceHint "Soundboard", "Audience", "Matrix" or "").
 */
export function parseFolderName(name) {
  const identifier = String(name || "").trim();
  const looksLikeItem = /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(identifier) && /\d/.test(identifier);
  const found = findDate(identifier);
  const lower = identifier.toLowerCase();
  // "mtx" or "matrix" anywhere means a matrix, even when "sbd" (one of its
  // parts) is named too, as in tsr2018-11-30.akg460_AT853_sbd.mtx (v0.38.0).
  const sourceHint = /(^|[._-])(mtx|matrix)([._-]|$)/.test(lower)
    ? "Matrix"
    : /(^|[._-])(sbd|soundboard)([._-]|$)/.test(lower)
      ? "Soundboard"
      : /(^|[._-])(aud|audience)([._-]|$)/.test(lower)
        ? "Audience"
        : "";
  return {
    identifier,
    archiveUrl: looksLikeItem ? `https://archive.org/details/${identifier}` : null,
    date: found ? found.date : "",
    sourceHint,
  };
}

/** A song file's place from its name: { disc, track } (disc 1 when only a track is given), or null. */
export function parseSongFileName(name) {
  const stem = String(name || "").replace(/\.[^.]+$/, "");
  let m = /(?:^|[^a-z])(?:d|disc|cd)\s*(\d{1,2})\s*[-_. ]?\s*t(?:rack)?\s*(\d{1,3})(?!\d)/i.exec(stem);
  if (m) return { disc: Number(m[1]), track: Number(m[2]) };
  m = /(?:^|[^a-z])t(?:rack)?\s*(\d{1,3})(?!\d)/i.exec(stem);
  if (m) return { disc: 1, track: Number(m[1]) };
  // "1-02 I Can't Complain.flac": disc 1, track 2 (Todd Snider 2005, v0.38.0;
  // read as track 1 before, so every song was stored as number 1).
  m = /^(\d{1,2})-(\d{1,3})(?=[\s._-]|$)/.exec(stem);
  if (m && Number(m[1]) >= 1) return { disc: Number(m[1]), track: Number(m[2]) };
  m = /^(\d{1,3})(?=[\s._-])/.exec(stem);
  if (m) return { disc: 1, track: Number(m[1]) };
  return null;
}

/**
 * A track or disc tag's number: "7" and "7/15" are 7; "1-07" (disc and track
 * in one tag) is 7. NaN when there's none.
 */
export function tagNumber(value) {
  const s = String(value == null ? "" : value).trim();
  const m = /^(\d{1,3})\s*-\s*(\d{1,3})\b/.exec(s);
  if (m) return Number(m[2]);
  return parseInt(s, 10);
}

/** "Lord Only Knows(Pt. 1) >" -> "Lord Only Knows (Pt. 1)"; an arrow between two names stays (R3b-16). */
export function cleanTitle(title) {
  let s = String(title || "").replace(/\s+/g, " ").trim();
  for (;;) {
    const t = s.replace(/\s*(?:-+>|=+>|>+|→|->)\s*$/, "").trim();
    if (t === s) break;
    s = t;
  }
  s = s.replace(/([A-Za-z0-9])\(/g, "$1 (");
  return s;
}

const PLACEHOLDER_RE = /^(?:(?:audio\s*)?track\s*\d*|unknown(?:\s+track)?|untitled|\?+|-+|n\/?a|tba|tbd|none|\d+)$/i;

/** Whether a name is only a placeholder ("Track 03", "Unknown", "Untitled", "???"): counts as no name. */
export function isPlaceholder(title, fileStem = "") {
  const s = String(title || "").trim();
  if (!s) return true;
  if (PLACEHOLDER_RE.test(s)) return true;
  return Boolean(fileStem) && s.toLowerCase() === String(fileStem).toLowerCase();
}

// ---- FLAC tags ----

/**
 * The start of a FLAC file read: { sampleRate, channels, bits, totalSamples,
 * seconds, tags } once every metadata block is in `bytes`, or { needBytes }
 * when more of the file must be read first. Tags' names are upper case; the
 * first value of each is kept. Throws when it isn't a FLAC file.
 */
export function readFlacMeta(bytes) {
  const b = bytes;
  if (b.length < 4) return { needBytes: 4096 };
  if (!(b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43)) {
    // An ID3 tag in front of the FLAC (some tools write one).
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b.length >= 10) {
      const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
      const skip = 10 + size;
      if (b.length < skip + 4) return { needBytes: skip + 65536 };
      return readFlacMeta(b.subarray(skip));
    }
    throw new Error("This isn't a FLAC file.");
  }
  const out = { sampleRate: 0, channels: 0, bits: 0, totalSamples: 0, seconds: 0, tags: {} };
  let at = 4;
  for (;;) {
    if (at + 4 > b.length) return { needBytes: at + 65536 };
    const last = (b[at] & 0x80) !== 0;
    const type = b[at] & 0x7f;
    const len = (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    const start = at + 4;
    if (type === 0 || type === 4) {
      if (start + len > b.length) return { needBytes: start + len + 4096 };
    }
    if (type === 0 && len >= 18) {
      const s = b.subarray(start, start + len);
      out.sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
      out.channels = ((s[12] >> 1) & 7) + 1;
      out.bits = (((s[12] & 1) << 4) | (s[13] >> 4)) + 1;
      out.totalSamples = (s[13] & 0x0f) * 2 ** 32 + ((s[14] << 24) >>> 0) + (s[15] << 16) + (s[16] << 8) + s[17];
      out.seconds = out.sampleRate ? out.totalSamples / out.sampleRate : 0;
    } else if (type === 4) {
      Object.assign(out.tags, readVorbisComments(b.subarray(start, start + len)));
    }
    at = start + len;
    if (last) break;
    if (type === 0x7f) throw new Error("This FLAC file's header is damaged.");
  }
  return out;
}

function readVorbisComments(s) {
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const dec = new TextDecoder("utf-8");
  const tags = {};
  let at = 0;
  const vendor = dv.getUint32(at, true);
  at += 4 + vendor;
  if (at + 4 > s.length) return tags;
  const n = dv.getUint32(at, true);
  at += 4;
  for (let i = 0; i < n && at + 4 <= s.length; i++) {
    const len = dv.getUint32(at, true);
    at += 4;
    if (at + len > s.length) break;
    const text = dec.decode(s.subarray(at, at + len));
    at += len;
    const eq = text.indexOf("=");
    if (eq <= 0) continue;
    const key = text.slice(0, eq).toUpperCase();
    if (!(key in tags)) tags[key] = text.slice(eq + 1).trim();
  }
  return tags;
}

// ---- the info .txt ----

const DISC_RE = /^\s*[-=*~#\[(]*\s*(?:disc|disk|cd)\s*[#:]?\s*(\d{1,2})\b(.{0,30})$/i;
const SET_RE = /^\s*[-=*~#\[(]*\s*(set\s*(?:\d+|[ivx]+|one|two|three|four)|encores?|e\s*:)\s*[-=*~#\])]*\s*:?\s*$/i;
const TRACK_RE = /^\s*(?:(?:d|disc|cd)\s*(\d{1,2})\s*)?(?:t|track)?\s*(\d{1,3})\s*[.):\-]?\s+(\S.*?)\s*$/i;
const INLINE_ENCORE_RE = /^(?:e|enc|encore)\s*[:.\-]\s*/i;
const UNDERLINE_RE = /^\s*[-=_~*]{3,}\s*$/;
// "Taper: X", "Taped by: X", "TAPED BY: X", "Recorded by: X", and (v0.38.0)
// "Recorded & Mastered By X" (no colon, but "by"), "Recorded & Transfered by: X".
const TAPER_RE = /^\s*(?:taped|taper|recorded|recording)(?:\s*(?:&|and|,)\s*(?:mastered|mixed|edited|transfer\w*|produced))*\s*(?:by\s*[:\-]?|[:\-])\s*(.+?)\s*$/i;
// "Source: …", "Lineage: …", and (v0.38.0) numbered ones, "Source 1: …".
const SOURCE_RE = /^\s*(?:source|src|lineage|transfer|equipment|gear)(?:\s*#?\d{1,2})?\s*[:\-]\s*(.+?)\s*$/i;
const LINEAGE_WORDS = /\b(sbd|aud|mtx|matrix|dat|cdr?|flac|wav|shn|dsm|schoeps|neumann|akg|dpa|senn\w*|mics?|microphones?|sony|tascam|zoom|edirol|marantz|sound devices|cassette|reel|minidisc|md|soundboard|audience|preamp|ua-?5|cmc\d|km\d+)\b/i;
const TERMS_RE = /\b(lossless|lossy|mp3s?|sell|sale|sold|selling|commercial(?:ly)?|profit|permission|convert(?:ed|ing)?|re-?encod\w*|re-?distribut\w*|trade only|for trading|not for)\b/i;
const NOTES_RE = /^\s*(?:notes?|comments?)\s*:/i;

function setName(raw) {
  const s = raw.replace(/[-=*~#\[\]():\s]+/g, " ").trim().toLowerCase();
  if (/^encores?$|^e$/.test(s)) return "Encore";
  const m = /^set\s*(\d+|[ivx]+|one|two|three|four)$/.exec(s);
  if (!m) return null;
  const words = { one: 1, two: 2, three: 3, four: 4, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1]];
  return n ? `Set ${n}` : null;
}

function cleanPerson(s) {
  const v = String(s || "").trim();
  return isPlaceholder(v) || /^(unknown|anonymous|\?+|n\/a)$/i.test(v) ? "" : v;
}

/**
 * What an info .txt says:
 *   { band, venue, place, date, taper, source, setlist, termsLines, setsMarked }
 * setlist: [{ disc, n (its number as written), title, set, inlineEncore }] in
 * order. Anything not found is "" (or []). Never throws.
 */
export function parseInfoText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const info = { band: "", venue: "", place: "", date: "", taper: "", source: "", setlist: [], termsLines: [], setsMarked: false };

  // The setlist: track lines, with disc and set markers.
  let disc = 1;
  let set = "";
  let firstTrack = -1;
  let inNotes = false;
  lines.forEach((line, i) => {
    if (!line.trim()) {
      return;
    }
    if (NOTES_RE.test(line)) inNotes = true;
    if (inNotes) return;
    if (UNDERLINE_RE.test(line)) return;
    const s = SET_RE.exec(line);
    if (s) {
      const name = setName(s[1]);
      if (name) {
        set = name;
        info.setsMarked = true;
        return;
      }
    }
    // "Disk 2", "CD 2:", "Disc 2 (Set 2)": a disc heading, perhaps naming a set too.
    const d = DISC_RE.exec(line);
    if (d) {
      disc = Number(d[1]);
      const inSet = /\b(set\s*(?:\d+|[ivx]+)|encores?)\b/i.exec(d[2] || "");
      const name = inSet && setName(inSet[1]);
      if (name) {
        set = name;
        info.setsMarked = true;
      }
      return;
    }
    // "E: Closer": an encore written without a number.
    if (!TRACK_RE.test(line) && INLINE_ENCORE_RE.test(line.trim()) && info.setlist.length) {
      const name = line.trim().replace(INLINE_ENCORE_RE, "");
      if (name) {
        if (firstTrack < 0) firstTrack = i;
        info.setsMarked = true;
        info.setlist.push({ disc, n: info.setlist[info.setlist.length - 1].n + 1, title: name, set: "Encore", inlineEncore: true });
      }
      return;
    }
    const t = TRACK_RE.exec(line);
    // A dated line before the setlist is the header's; once the setlist has
    // started, a song may carry a date ("11 [Trout Steak Revival 2018-11-30
    // Track 11]", v0.38.0: skipping it put every later song one place off).
    if (!t || (firstTrack < 0 && findDate(line)) || TAPER_RE.test(line) || SOURCE_RE.test(line)) return;
    // A playing time after the name ("Slow Train\t\t04:24.24") isn't part of it (v0.38.0).
    const title = t[3].replace(/\s+\(?\d{1,2}:\d{2}(?:[.:]\d{1,3})?\)?$/, "").trim();
    if (!title || /^[-=*~]+$/.test(title)) return;
    if (t[1]) disc = Number(t[1]);
    let songSet = set;
    let inlineEncore = false;
    let name = title;
    if (INLINE_ENCORE_RE.test(name)) {
      name = name.replace(INLINE_ENCORE_RE, "");
      songSet = "Encore";
      inlineEncore = true;
      info.setsMarked = true;
    }
    if (firstTrack < 0) firstTrack = i;
    info.setlist.push({ disc, n: Number(t[2]), title: name, set: songSet, inlineEncore });
  });
  // Songs before the first set marker are Set 1, when sets are marked at all.
  if (info.setsMarked) for (const s of info.setlist) if (!s.set) s.set = "Set 1";

  // The header: the lines before the setlist (or the first dozen).
  const headEnd = firstTrack >= 0 ? firstTrack : Math.min(lines.length, 12);
  const head = lines.slice(0, headEnd);
  const sourceLines = [];
  // Labelled lines ("Source:", "Lineage:", "Recorded by:", "TAPED BY:") count
  // anywhere in the file: many info files put them after the setlist
  // (Galactic 2007, Trout Steak Revival 2018; v0.38.0). Unlabelled lineage
  // lines ("SBD > DAT > CDR") only in the header.
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || UNDERLINE_RE.test(line) || DISC_RE.test(line) || SET_RE.test(line)) return;
    const tp = TAPER_RE.exec(line);
    if (tp) {
      if (!info.taper) info.taper = cleanPerson(tp[1]);
      return;
    }
    const sr = SOURCE_RE.exec(line);
    if (sr) {
      sourceLines.push(sr[1]);
      return;
    }
    if (i < headEnd && (line.includes(">") || /^(sbd|aud|mtx|matrix)\b/i.test(line)) && LINEAGE_WORDS.test(line)) sourceLines.push(line);
  });
  info.source = sourceLines.join(" · ");

  // Band, venue, place, date: the first lines of the header.
  const top = [];
  for (const raw of head) {
    const line = raw.trim();
    if (!line) {
      if (top.length) break;
      continue;
    }
    if (TAPER_RE.test(line) || SOURCE_RE.test(line) || sourceLines.includes(line)) break;
    // "[10:15 pm start]": a note, not a venue or place.
    if (/^\[.*\]$/.test(line)) continue;
    // A line ending in a comma goes on with the next (Billy Strings 2018:
    // "Grey Fox Bluegrass Festival," / "High Meadow Stage," / "Walsh Farm," / "Oak Hill, NY").
    if (top.length && /,\s*$/.test(top[top.length - 1])) {
      top[top.length - 1] = `${top[top.length - 1].replace(/\s+$/, "")} ${line}`;
      continue;
    }
    top.push(line);
    if (top.length >= 5) break;
  }
  const dated = top.map(findDate);
  const at = dated.findIndex(Boolean);
  if (at >= 0) info.date = dated[at].date;
  if (top.length === 1 || (at === 0 && top[0].includes(","))) {
    // "Band, Venue, City, ST, Date" on one line.
    const parts = splitHeadLine(top[0], dated[0]);
    Object.assign(info, parts);
  } else if (top.length) {
    // One thing per line: band, then venue and place (and the date somewhere).
    info.band = stripDate(top[0], dated[0]).replace(/[,\s]+$/, "");
    const restClean = top.slice(1).map((l, k) => stripDate(l, dated[k + 1])).filter(Boolean);
    const placeAt = restClean.findIndex((l) => /,\s*[A-Za-z .]{2,}$/.test(l) || /\b[A-Z]{2}$/.test(l));
    if (placeAt >= 0 && restClean.length === 1 && restClean[0].includes(",")) {
      // "Hardly Strictly Bluegrass Festival, San Francisco CA" on its own line:
      // the venue, then the place (Todd Snider 2005, v0.38.0).
      // With a state or country code at the end ("…, Walsh Farm, Oak Hill, NY"),
      // the place is the last two parts; otherwise everything after the first comma.
      const parts = restClean[0].split(",").map((x) => x.trim()).filter(Boolean);
      const cut = parts.length >= 3 && /^[A-Z]{2,3}$/.test(parts[parts.length - 1]) ? parts.length - 2 : 1;
      info.venue = parts.slice(0, cut).join(", ");
      info.place = parts.slice(cut).join(", ");
    } else if (placeAt >= 0) {
      info.place = restClean[placeAt];
      info.venue = restClean.filter((_, k) => k !== placeAt).join(", ");
    } else if (restClean.length) {
      info.venue = restClean[0];
      info.place = restClean.slice(1).join(", ");
    }
  }

  // Terms lines (shown beside the rights tick, R3b-5): anywhere, but not songs.
  const songTitles = new Set(info.setlist.map((s) => s.title));
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !TERMS_RE.test(line)) continue;
    const t = TRACK_RE.exec(line);
    if (t && songTitles.has(t[3])) continue;
    if (LINEAGE_WORDS.test(line) && line.includes(">") && !/\b(not|don'?t|do not|never|only|please)\b/i.test(line)) continue;
    if (!info.termsLines.includes(line)) info.termsLines.push(line);
  }
  return info;
}

function stripDate(line, found) {
  if (!found) return line;
  return line.replace(found.match, "").replace(/^[\s,\-–]+|[\s,\-–]+$/g, "").trim();
}

function splitHeadLine(line, found) {
  const rest = stripDate(line, found);
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  const out = { band: parts[0] || "", venue: "", place: "" };
  if (parts.length >= 2) out.venue = parts[1];
  if (parts.length >= 3) out.place = parts.slice(2).join(", ");
  return out;
}

/** An album tag such as "The Fillmore, Denver, CO, 2002-04-20" read as { venue, place, date }. */
export function parseAlbumTag(album) {
  const found = findDate(album);
  const parts = stripDate(String(album || ""), found).split(",").map((p) => p.trim()).filter(Boolean);
  return { venue: parts[0] || "", place: parts.slice(1).join(", "), date: found ? found.date : "" };
}

// ---- the songs ----

/**
 * The song list (R3b-7). flacs: [{ name, size, meta }] (meta from
 * readFlacMeta; null if it couldn't be read). setlist from parseInfoText.
 * Returns { songs, note }:
 *   songs: [{ name, size, disc, track, trackNumber, title, from, unknownName,
 *             set, seconds, plan (bitrateFor) }] by disc and track
 *   note:  the count note, or ""
 */
export function buildSongs(flacs, setlist = []) {
  const discs = new Map(); // disc -> its setlist entries, in order
  for (const s of setlist) {
    if (!discs.has(s.disc)) discs.set(s.disc, []);
    discs.get(s.disc).push(s);
  }
  const discList = [...discs.keys()].sort((a, b) => a - b);
  const onlyOneDiscListed = discList.length === 1;
  const songs = flacs.map((f) => {
    const meta = f.meta || null;
    const tags = (meta && meta.tags) || {};
    const fromName = parseSongFileName(f.name) || null;
    const tagTrack = tagNumber(tags.TRACKNUMBER || tags.TRACK || "");
    const tagDisc = parseInt(tags.DISCNUMBER || tags.DISC || "", 10);
    const disc = fromName ? fromName.disc : Number.isFinite(tagDisc) && tagDisc > 0 ? tagDisc : 1;
    const track = fromName ? fromName.track : Number.isFinite(tagTrack) && tagTrack > 0 ? tagTrack : null;

    // The setlist entry: the track-th song listed on this disc.
    let entry = null;
    if (track != null && setlist.length) {
      const onDisc = discs.get(disc);
      if (onDisc && onDisc[track - 1]) entry = onDisc[track - 1];
      else if (onlyOneDiscListed && disc > 1) entry = null;
    }
    const overall = entry ? setlist.indexOf(entry) + 1 : null;

    const stem = String(f.name || "").replace(/\.[^.]+$/, "");
    let title = "";
    let from = "file";
    const tagTitle = cleanTitle(tags.TITLE || "");
    const listTitle = entry ? cleanTitle(entry.title) : "";
    if (!isPlaceholder(tagTitle, stem)) {
      title = tagTitle;
      from = "tags";
    } else if (!isPlaceholder(listTitle, stem)) {
      title = listTitle;
      from = "setlist";
    } else {
      title = tagTitle || listTitle || stem;
      from = "file";
    }
    const seconds = meta && meta.seconds ? meta.seconds : 0;
    return {
      name: f.name,
      size: f.size || 0,
      disc,
      track,
      trackNumber: overall || (track != null ? (disc > 1 ? (disc - 1) * 100 + track : track) : null),
      title,
      from,
      unknownName: isPlaceholder(title, stem) || from === "file",
      set: entry ? entry.set || "" : "",
      seconds,
      plan: bitrateFor(seconds),
      matched: Boolean(entry),
      tagArtist: (tags.ARTIST || tags.ALBUMARTIST || "").trim(),
      tagAlbum: (tags.ALBUM || "").trim(),
    };
  });
  songs.sort((a, b) => a.disc - b.disc || (a.track ?? 999) - (b.track ?? 999) || a.name.localeCompare(b.name));

  // Two songs with one number (v0.38.0): they'd be stored alike and confused
  // with each other later ("Already imported", Edit details), so say so.
  const byNumber = new Map();
  for (const s of songs) if (s.trackNumber != null) byNumber.set(s.trackNumber, (byNumber.get(s.trackNumber) || 0) + 1);
  const shared = [...byNumber].filter(([, k]) => k > 1).map(([n]) => n).sort((a, b) => a - b);
  for (const s of songs) s.sharedNumber = s.trackNumber != null && byNumber.get(s.trackNumber) > 1;

  let note = "";
  if (setlist.length) {
    const unmatched = songs.filter((s) => !s.matched).length;
    if (songs.length > setlist.length) {
      note = `The setlist has ${setlist.length} ${setlist.length === 1 ? "song" : "songs"} but the folder has ${songs.length} files: please check the names.`;
    } else if (unmatched) {
      note = `${unmatched} ${unmatched === 1 ? "file has" : "files have"} no matching song in the setlist: please check ${unmatched === 1 ? "its name" : "their names"}.`;
    }
  }
  const numberNote = shared.length
    ? `More than one song has the number ${shared.length === 1 ? shared[0] : `${shared.slice(0, -1).join(", ")} or ${shared[shared.length - 1]}`}: they'd be stored with the same number. Check the files' names, or fix the numbers afterwards with Edit details.`
    : "";
  return { songs, note: [note, numberNote].filter(Boolean).join(" "), sharedNumbers: shared };
}

// ---- "Where these came from" ----

/** The show's name, built "Band · Venue · Date" (R3b-5). */
export function showName({ band, venue, date }) {
  return [band, venue, date].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
}

/**
 * The form's first values (R3b-5), from the folder name, the info .txt and
 * the FLAC tags: { band, album, date, venue, place, taper, source, archiveUrl,
 * policyUrl, description }.
 */
export function prefill({ folder = "", info = null, infoText = "", songs = [], policies = {} }) {
  const f = parseFolderName(folder);
  const i = info || parseInfoText(infoText);
  const tagged = songs.find((s) => s.tagAlbum) || null;
  const fromAlbum = tagged ? parseAlbumTag(tagged.tagAlbum) : { venue: "", place: "", date: "" };
  const band = i.band || (songs.find((s) => s.tagArtist) || {}).tagArtist || "";
  const date = i.date || f.date || fromAlbum.date || "";
  const venue = i.venue || fromAlbum.venue || "";
  const place = i.place || fromAlbum.place || "";
  // The info file's own source and lineage lines win over the folder name's
  // guess, which is used only when the file says nothing (v0.38.0).
  const source = i.source || f.sourceHint || "";
  return {
    band,
    album: showName({ band, venue, date }),
    date,
    venue,
    place,
    taper: i.taper || "",
    source,
    archiveUrl: f.archiveUrl || "",
    policyUrl: policyFor(policies, band),
    description: String(infoText || "").replace(/\r\n?/g, "\n").trim(),
  };
}

// ---- the policy link, remembered per band (R3b-5) ----

export const POLICY_KEY = "foundry.mixtape.policies";
const bandKey = (band) => String(band || "").trim().replace(/\s+/g, " ").toLowerCase();

export function readPolicies(storage) {
  try {
    const raw = storage && storage.getItem(POLICY_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function policyFor(policies, band) {
  const v = policies && policies[bandKey(band)];
  return typeof v === "string" ? v : "";
}

export function rememberPolicy(storage, band, url) {
  const key = bandKey(band);
  if (!key || !storage) return;
  const all = readPolicies(storage);
  if (url) all[key] = url;
  else delete all[key];
  try {
    storage.setItem(POLICY_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked or full: just not remembered */
  }
}

// ---- the record ----

const utf8 = (s) => new TextEncoder().encode(String(s)).length;
export const LIMITS = Object.freeze({
  title: 256, artist: 256, album: 256, description: 5000,
  date: 10, venue: 256, place: 256, set: 64, taper: 256, source: 1000, archiveUrl: 2000, policyUrl: 2000,
});
const LABELS = {
  title: "Song name", artist: "Band", album: "Show name", description: "Notes", date: "Date", venue: "Venue",
  place: "Place", set: "Set", taper: "Taper", source: "Source and lineage", archiveUrl: "Archive address", policyUrl: "Sharing policy link",
};

/** Whether a text is an http(s) address. */
export function isWebAddress(s) {
  try {
    const u = new URL(String(s));
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** Problems with the show's details (the form): [{ key, message }]. */
export function showProblems(show) {
  const out = [];
  for (const key of ["artist", "album", "description", "date", "venue", "place", "taper", "source", "archiveUrl", "policyUrl"]) {
    const formKey = key === "artist" ? "band" : key;
    const v = String(show[formKey] || "").trim();
    if (!v) continue;
    if (utf8(v) > LIMITS[key]) out.push({ key: formKey, message: `${LABELS[key]}: too long (${utf8(v)} bytes; at most ${LIMITS[key]}).` });
  }
  const date = String(show.date || "").trim();
  if (date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) out.push({ key: "date", message: "Date: write it as YYYY-MM-DD, YYYY-MM or YYYY." });
  for (const key of ["archiveUrl", "policyUrl"]) {
    const v = String(show[key] || "").trim();
    if (v && !isWebAddress(v)) out.push({ key, message: `${LABELS[key]}: not a web address (it should start with https://).` });
  }
  return out;
}

/** Problems with one song's own details: [{ key, message }]. */
export function songProblems(song) {
  const out = [];
  const title = String(song.title || "").trim();
  if (!title) out.push({ key: "title", message: "Every song needs a name." });
  else if (utf8(title) > LIMITS.title) out.push({ key: "title", message: `Song name too long (${utf8(title)} bytes; at most ${LIMITS.title}).` });
  const set = String(song.set || "").trim();
  if (set && utf8(set) > LIMITS.set) out.push({ key: "set", message: `Set too long (at most ${LIMITS.set} bytes).` });
  const n = song.trackNumber;
  if (n != null && n !== "" && !(Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 999)) out.push({ key: "trackNumber", message: "Track number: a whole number from 1 to 999." });
  return out;
}

/**
 * A cafe.thunderbird.audio.track record (lexicon: pyxorium/audio-tracks).
 * show: the form's values; song: { title, trackNumber, set }; audioBlob: the
 * uploadBlob answer's blob; seconds: the song's length. Empty fields are left
 * out, and so is an empty `recording` section.
 */
export function buildTrackRecord({ show, song, audioBlob, seconds, fileType = "webm", createdAt }) {
  const t = (v) => String(v == null ? "" : v).trim();
  const record = { $type: TRACK_COLLECTION, title: t(song.title) };
  if (t(show.band)) record.artist = t(show.band);
  if (t(show.album)) record.album = t(show.album);
  const n = Number(song.trackNumber);
  if (Number.isInteger(n) && n >= 1 && n <= 999) record.trackNumber = n;
  const secs = Math.round(Number(seconds) || 0);
  if (secs >= 1) record.duration = secs;
  record.audioBlob = audioBlob;
  if (fileType) record.fileType = fileType;
  if (t(show.description)) record.description = t(show.description);
  const recording = {};
  for (const key of ["date", "venue", "place"]) if (t(show[key])) recording[key] = t(show[key]);
  if (t(song.set)) recording.set = t(song.set);
  for (const key of ["taper", "source", "archiveUrl", "policyUrl"]) if (t(show[key])) recording[key] = t(show[key]);
  if (Object.keys(recording).length) record.recording = recording;
  record.createdAt = createdAt || new Date().toISOString();
  return record;
}

/** Description too long for the record? Cuts it at a line, within the lexicon's 5,000 bytes. */
export function fitDescription(text) {
  let s = String(text || "").trim();
  if (utf8(s) <= LIMITS.description) return { text: s, cut: false };
  const enc = new TextEncoder();
  let bytes = enc.encode(s).subarray(0, LIMITS.description - 3);
  s = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/�+$/, "");
  const nl = s.lastIndexOf("\n");
  if (nl > LIMITS.description / 2) s = s.slice(0, nl);
  return { text: `${s.trimEnd()}\n…`, cut: true };
}

// ---- already imported (R3b-15) ----

/** The key that says "this song of this recording": the Archive address (or the show name) and the track number. */
export function importKey(where, trackNumber) {
  const w = String(where || "").trim().toLowerCase().replace(/\/+$/, "");
  return w && trackNumber ? `${w}#${Number(trackNumber)}` : "";
}

const titleKey = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The keys of tracks already stored (trackFromRecord's shape: { archiveUrl,
 * album, trackNumber, title }). A Set of keys; since v0.38.0 it also knows
 * which keys more than one stored song shares (`shared`) and the titles under
 * each key (`titles`), so songs stored with one number for all (Todd Snider
 * 2005) don't mark every song of the folder.
 */
export function importedKeys(tracks) {
  const keys = new Set();
  const count = new Map();
  const titles = new Map();
  for (const t of tracks || []) {
    const own = new Set([importKey(t.archiveUrl, t.trackNumber), importKey(t.album, t.trackNumber)]);
    own.delete("");
    for (const k of own) {
      keys.add(k);
      count.set(k, (count.get(k) || 0) + 1);
      if (!titles.has(k)) titles.set(k, new Set());
      titles.get(k).add(titleKey(t.title));
    }
  }
  keys.shared = new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  keys.titles = titles;
  return keys;
}

/**
 * Whether a song in the list is already stored, given the show's form values.
 * When the number alone can't tell (several stored songs share it, or several
 * songs in the folder do), the song's name must match too.
 */
export function isImported(keys, show, song) {
  const where = String(show.archiveUrl || "").trim() || String(show.album || "").trim();
  const k = importKey(where, song.trackNumber);
  if (!keys.has(k)) return false;
  const unsure = (keys.shared && keys.shared.has(k)) || song.sharedNumber;
  if (!unsure) return true;
  const names = keys.titles && keys.titles.get(k);
  return Boolean(names && names.has(titleKey(song.title)));
}
