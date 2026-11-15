// A small WebM writer for one Opus audio track (Foundry v0.35.0, the importer).
//
// Written here rather than vendored (owner, Nov 14: R3b-14 in
// claude/mixtape-3b-importer-notes.md): only the narrow case the importer
// needs. One Opus track, no video, the whole file written at once from
// packets already encoded (WebCodecs AudioEncoder chunks). Because the file is
// written at the end, it carries its Duration and a Cues index, so players
// show the length and can seek straight away.
//
// The format: Matroska's EBML (https://www.matroska.org/technical/elements.html),
// restricted to WebM (https://www.webmproject.org/docs/container/), with Opus
// as Matroska maps it (https://www.matroska.org/technical/codec_specs.html,
// A_OPUS: CodecPrivate is the OpusHead, CodecDelay is the pre-skip in
// nanoseconds, SeekPreRoll 80 ms). Timestamps are in milliseconds
// (TimestampScale 1,000,000 ns).
//
// No DOM here, so Node (tests) can import it.
//
//   muxOpusWebm({ packets, opusHead, channels, sampleRate, durationMs, app })
//     packets    [{ data: Uint8Array, timestampUs }] in order (from the encoder)
//     opusHead   the encoder's decoderConfig.description, or null to write one
//     channels   1 or 2
//     sampleRate the input's rate (written into the OpusHead if one is made)
//     durationMs the song's length (the input's length, not the padded output's)
//   -> Uint8Array

export const MIME_WEBM = "audio/webm";
const OPUS_RATE = 48000; // Opus always decodes at 48 kHz
const SEEK_PRE_ROLL_NS = 80000000;
const CLUSTER_MS = 5000; // a cluster (and a cue) every 5 seconds

export const ID = Object.freeze({
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
});

// ---- bytes ----

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An element ID's bytes (IDs carry their own length marker). */
function idBytes(id) {
  const out = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return Uint8Array.from(out);
}

/** A size as an EBML variable-length integer (shortest form; `width` forces a length). */
export function vint(n, width = 0) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Bad EBML size: ${n}`);
  let len = 1;
  while (len < 8 && n >= 2 ** (7 * len) - 1) len++;
  if (width) {
    if (width < len) throw new Error(`${n} doesn't fit in ${width} bytes`);
    len = width;
  }
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function uintBytes(n, width = 0) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Bad unsigned integer: ${n}`);
  const out = [];
  let v = n;
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  while (out.length < width) out.unshift(0);
  return Uint8Array.from(out);
}

function el(id, body) {
  return concat([idBytes(id), vint(body.length), body]);
}
const uint = (id, n, width) => el(id, uintBytes(n, width));
const str = (id, s) => el(id, new TextEncoder().encode(s));
function float(id, x) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return el(id, b);
}
const master = (id, children) => el(id, concat(children));

// ---- Opus ----

/** An OpusHead (RFC 7845, section 5.1) for a stereo or mono stream, mapping family 0. */
export function makeOpusHead({ channels = 2, preSkip = 312, inputRate = OPUS_RATE } = {}) {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode("OpusHead"), 0);
  const dv = new DataView(b.buffer);
  b[8] = 1; // version
  b[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, inputRate, true);
  dv.setInt16(16, 0, true); // output gain
  b[18] = 0; // channel mapping family
  return b;
}

/** The pre-skip (samples at 48 kHz) an OpusHead asks for, or null if it isn't one. */
export function preSkipOf(head) {
  if (!head || head.length < 19) return null;
  const magic = new TextDecoder().decode(head.subarray(0, 8));
  if (magic !== "OpusHead") return null;
  return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
}

function asBytes(x) {
  if (!x) return null;
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  return null;
}

// ---- the file ----

/** Writes the WebM file (see the top of this file). */
export function muxOpusWebm({ packets, opusHead = null, channels = 2, sampleRate = OPUS_RATE, durationMs, app = "Web Tile Foundry" }) {
  if (!Array.isArray(packets) || !packets.length) throw new Error("There's no encoded audio to write.");
  if (channels !== 1 && channels !== 2) throw new Error(`Only mono or stereo Opus is written here (not ${channels} channels).`);
  let head = asBytes(opusHead);
  if (preSkipOf(head) == null) head = makeOpusHead({ channels, inputRate: sampleRate });
  const preSkip = preSkipOf(head);
  const firstUs = packets[0].timestampUs || 0;
  const lastMs = Math.round(((packets[packets.length - 1].timestampUs || 0) - firstUs) / 1000);
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : lastMs + 20;

  const ebml = master(ID.EBML, [
    uint(ID.EBMLVersion, 1),
    uint(ID.EBMLReadVersion, 1),
    uint(ID.EBMLMaxIDLength, 4),
    uint(ID.EBMLMaxSizeLength, 8),
    str(ID.DocType, "webm"),
    uint(ID.DocTypeVersion, 4),
    uint(ID.DocTypeReadVersion, 2),
  ]);

  const info = master(ID.Info, [
    uint(ID.TimestampScale, 1000000),
    float(ID.Duration, duration),
    str(ID.MuxingApp, app),
    str(ID.WritingApp, app),
  ]);

  const tracks = master(ID.Tracks, [
    master(ID.TrackEntry, [
      uint(ID.TrackNumber, 1),
      uint(ID.TrackUID, 1),
      uint(ID.TrackType, 2),
      uint(ID.FlagLacing, 0),
      str(ID.CodecID, "A_OPUS"),
      el(ID.CodecPrivate, head),
      uint(ID.CodecDelay, Math.round((preSkip * 1e9) / OPUS_RATE)),
      uint(ID.SeekPreRoll, SEEK_PRE_ROLL_NS),
      master(ID.Audio, [float(ID.SamplingFrequency, OPUS_RATE), uint(ID.Channels, channels)]),
    ]),
  ]);

  // Clusters: a new one every CLUSTER_MS (block times are 16-bit offsets from the cluster's).
  const clusters = []; // { time, bytes }
  let blocks = [];
  let clusterTime = null;
  const flush = () => {
    if (clusterTime == null) return;
    clusters.push({ time: clusterTime, bytes: master(ID.Cluster, [uint(ID.Timestamp, clusterTime), ...blocks]) });
    blocks = [];
    clusterTime = null;
  };
  for (const p of packets) {
    const data = asBytes(p.data);
    if (!data || !data.length) continue;
    const t = Math.max(0, Math.round(((p.timestampUs || 0) - firstUs) / 1000));
    if (clusterTime != null && t - clusterTime >= CLUSTER_MS) flush();
    if (clusterTime == null) clusterTime = t;
    const rel = t - clusterTime;
    if (rel > 32767) throw new Error("A gap in the encoded audio is too long for a WebM block.");
    const header = new Uint8Array(4);
    header[0] = 0x81; // track 1, as a one-byte vint
    new DataView(header.buffer).setInt16(1, rel);
    header[3] = 0x80; // keyframe (every Opus packet can be decoded on its own after the pre-roll)
    blocks.push(el(ID.SimpleBlock, concat([header, data])));
  }
  flush();
  if (!clusters.length) throw new Error("There's no encoded audio to write.");

  // Positions are counted from the start of the Segment's contents. The
  // SeekHead comes first, with fixed-width positions so its size is known.
  const seekEntry = (id, pos) => master(ID.Seek, [el(ID.SeekID, idBytes(id)), uint(ID.SeekPosition, pos, 8)]);
  const seekHeadSize = master(ID.SeekHead, [seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)]).length;
  const infoPos = seekHeadSize;
  const tracksPos = infoPos + info.length;
  let at = tracksPos + tracks.length;
  const cuePoints = [];
  for (const c of clusters) {
    cuePoints.push(
      master(ID.CuePoint, [uint(ID.CueTime, c.time), master(ID.CueTrackPositions, [uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, at)])])
    );
    at += c.bytes.length;
  }
  const cuesPos = at;
  const cues = master(ID.Cues, cuePoints);
  const seekHead = master(ID.SeekHead, [seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, cuesPos)]);
  if (seekHead.length !== seekHeadSize) throw new Error("The WebM index came out the wrong size.");

  const segment = master(ID.Segment, [seekHead, info, tracks, ...clusters.map((c) => c.bytes), cues]);
  return concat([ebml, segment]);
}

// ---- reading back (tests and the importer's own check) ----

function readVint(b, at, keepMarker = false) {
  const first = b[at];
  if (first === undefined) throw new Error("Unexpected end of the WebM file.");
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error("A bad EBML number in the WebM file.");
  let v = keepMarker ? first : first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + b[at + i];
  return { value: v, length: len };
}

/**
 * The elements in `bytes` from `start` to `end`: [{ id, start, dataStart, size }].
 * Children are read by calling it again on an element's data.
 */
export function readElements(bytes, start = 0, end = bytes.length) {
  const out = [];
  let at = start;
  while (at < end) {
    const id = readVint(bytes, at, true);
    const size = readVint(bytes, at + id.length);
    const dataStart = at + id.length + size.length;
    out.push({ id: id.value, start: at, dataStart, size: size.value });
    at = dataStart + size.value;
  }
  if (at !== end) throw new Error("An element runs past the end of the WebM file.");
  return out;
}

/** An unsigned integer element's value. */
export function readUint(bytes, e) {
  let v = 0;
  for (let i = 0; i < e.size; i++) v = v * 256 + bytes[e.dataStart + i];
  return v;
}

/** A float element's value. */
export function readFloat(bytes, e) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + e.dataStart, e.size);
  return e.size === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
}
