// Converting a song to Opus in WebM for keeping on the PDS (Foundry v0.35.0,
// Mixtape Burndown's importer; claude/mixtape-v2-plan.md R3-A2, and
// claude/mixtape-3b-importer-notes.md R3b-9 and R3b-14).
//
// Decode with the browser at 48 kHz (Opus's own rate), encode with WebCodecs'
// AudioEncoder (Edge and Chrome; Safari 26 and Firefox 130 on computers too),
// wrap the packets in WebM (webm.js, our own writer), then check the result
// the way convert.js checks tape MP3s: decode it again, and it must be about
// as long as the original and not much quieter.
//
// Stored songs are 96 kbps; a song too big for one file at 96 is stored at 64
// for that song only (bitrateFor).

import { muxOpusWebm, MIME_WEBM } from "../../tile-types/mixtape/webm.js";
import { rmsDb, MAX_LOUDNESS_DROP_DB, SILENCE_DB } from "./convert.js";

export const OPUS_RATE = 48000;
export const OPUS_KBPS = 96;
export const OPUS_LONG_KBPS = 64;
/** Bluesky-hosted accounts take files up to 50 MB (claude/mixtape-v2-plan.md, "Findings"). */
export const BLOB_LIMIT = 50 * 1000 * 1000;
/** WebM and Opus framing on top of the audio itself (measured Nov 14 on a real FLAC: about 3.4 %). */
const OVERHEAD = 1.05;
/** How far the stored song's length may differ from the original's. */
export const MAX_LENGTH_DIFF_SECONDS = 0.5;

/** A stored song's size in bytes at `kbps` (an estimate, slightly on the high side). */
export function estimateBytes(seconds, kbps = OPUS_KBPS) {
  return Math.ceil(((Math.max(0, seconds) * kbps * 1000) / 8) * OVERHEAD);
}

/**
 * The bitrate a song is stored at: { kbps, long, tooLong, bytes }.
 * 96 kbps; 64 when 96 wouldn't fit in one file; tooLong when 64 wouldn't either.
 */
export function bitrateFor(seconds, limit = BLOB_LIMIT) {
  const at96 = estimateBytes(seconds, OPUS_KBPS);
  if (at96 <= limit) return { kbps: OPUS_KBPS, long: false, tooLong: false, bytes: at96 };
  const at64 = estimateBytes(seconds, OPUS_LONG_KBPS);
  return { kbps: OPUS_LONG_KBPS, long: true, tooLong: at64 > limit, bytes: at64 };
}

/** Whether this browser can encode Opus (resolves true or false). */
export async function canEncodeOpus() {
  const Enc = globalThis.AudioEncoder;
  if (typeof Enc !== "function" || typeof Enc.isConfigSupported !== "function") return false;
  try {
    const r = await Enc.isConfigSupported({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate: OPUS_KBPS * 1000 });
    return Boolean(r && r.supported);
  } catch {
    return false;
  }
}

/** Decodes audio bytes with the browser at 48 kHz: { channels: [Float32Array…] (1 or 2), rate, seconds }. */
export async function decodeAt48k(bytes) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio.");
  const ctx = new Ctx(2, OPUS_RATE, OPUS_RATE);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let buf;
  try {
    buf = await ctx.decodeAudioData(copy);
  } catch (e) {
    throw new Error(`The song couldn't be read (${(e && e.message) || "unknown format"}).`);
  }
  const n = Math.min(2, buf.numberOfChannels);
  const channels = [];
  for (let c = 0; c < n; c++) channels.push(buf.getChannelData(c));
  return { channels, rate: buf.sampleRate, seconds: buf.duration };
}

const CHUNK = OPUS_RATE; // one second of audio per AudioData
const MAX_QUEUE = 8;

/**
 * Encodes decoded audio to Opus packets with WebCodecs.
 * pcm: { channels: [Float32Array…], rate }. Resolves to { packets, opusHead }.
 * `signal` stops it (rejects with an AbortError).
 */
export async function encodeOpus(pcm, { kbps = OPUS_KBPS, onProgress = () => {}, signal = null } = {}) {
  const Enc = globalThis.AudioEncoder;
  const Data = globalThis.AudioData;
  if (typeof Enc !== "function" || typeof Data !== "function") throw new Error("This browser can't make Opus files. Use a current Edge or Chrome.");
  const { channels, rate } = pcm;
  const count = channels.length;
  const frames = channels[0].length;
  const packets = [];
  let opusHead = null;
  let failure = null;
  const encoder = new Enc({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, timestampUs: chunk.timestamp });
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && !opusHead) opusHead = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0));
    },
    error(e) {
      failure = e;
    },
  });
  const config = { codec: "opus", sampleRate: rate, numberOfChannels: count, bitrate: kbps * 1000 };
  const support = await Enc.isConfigSupported(config);
  if (!support || !support.supported) throw new Error("This browser can't make Opus files at this setting.");
  encoder.configure(config);
  try {
    for (let at = 0; at < frames; at += CHUNK) {
      if (signal && signal.aborted) throw new DOMException("Stopped.", "AbortError");
      if (failure) throw failure;
      const n = Math.min(CHUNK, frames - at);
      const planar = new Float32Array(n * count);
      for (let c = 0; c < count; c++) planar.set(channels[c].subarray(at, at + n), c * n);
      const data = new Data({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: count, timestamp: Math.round((at / rate) * 1e6), data: planar });
      encoder.encode(data);
      data.close();
      while (encoder.encodeQueueSize > MAX_QUEUE) await new Promise((r) => setTimeout(r, 0));
      onProgress(Math.min(99, ((at + n) / frames) * 100));
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  onProgress(100);
  return { packets, opusHead };
}

/**
 * Converts one song for keeping: Opus in WebM, checked.
 *   bytes       the original file (FLAC, or anything the browser decodes)
 *   kbps        96 or 64 (bitrateFor)
 *   onProgress  (stage, percent): "decoding" | "encoding" | "checking"
 * Resolves to { bytes, mimeType, seconds, kbps, inputDb, outputDb }.
 */
export async function makeOpusFile(bytes, { kbps = OPUS_KBPS, onProgress = () => {}, signal = null, decode = decodeAt48k } = {}) {
  onProgress("decoding", 0);
  let pcm = await decode(bytes);
  const seconds = pcm.seconds;
  const inputDb = rmsDb(pcm.channels[0], pcm.channels[1] || pcm.channels[0]);
  const { packets, opusHead } = await encodeOpus(pcm, { kbps, signal, onProgress: (p) => onProgress("encoding", p) });
  const count = pcm.channels.length;
  pcm = null; // let the decoded song go before decoding the result
  const webm = muxOpusWebm({ packets, opusHead, channels: count, sampleRate: OPUS_RATE, durationMs: Math.round(seconds * 1000) });

  onProgress("checking", 0);
  const back = await decode(webm);
  if (Math.abs(back.seconds - seconds) > MAX_LENGTH_DIFF_SECONDS) {
    throw new Error(`The converted song came out ${back.seconds.toFixed(1)} s long instead of ${seconds.toFixed(1)} s, so something went wrong while converting.`);
  }
  let outputDb = null;
  if (inputDb > SILENCE_DB) {
    outputDb = rmsDb(back.channels[0], back.channels[1] || back.channels[0]);
    if (!(outputDb >= inputDb - MAX_LOUDNESS_DROP_DB)) {
      throw new Error(`The converted song came out much quieter than the original (${outputDb.toFixed(1)} dB instead of ${inputDb.toFixed(1)} dB), so something went wrong while converting.`);
    }
  }
  onProgress("checking", 100);
  return { bytes: webm, mimeType: MIME_WEBM, seconds, kbps, inputDb, outputDb };
}
