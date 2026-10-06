// Converting a song to the tape format (TAPE_FORMAT in mp3.js): decode it with
// the browser, encode it with lamejs in the worker pool, then check the result.
//
// Two checks, both learned in the mixtape audio lab (Oct 2026):
//   - the result must be in TAPE_FORMAT, so songs join into one continuous side;
//   - the result must not have come out much quieter than the original (an
//     encoder misused once produced near-silence that was still a valid MP3).

import { TAPE_FORMAT, scanMp3, isTapeFormat, describeFormat, cutSilence } from "./mp3.js";

/** Loudness as RMS in dB (0 dB = full scale); -Infinity for silence. */
export function rmsDb(left, right) {
  const n = left.length;
  if (!n) return -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += left[i] * left[i] + right[i] * right[i];
  const rms = Math.sqrt(sum / (2 * n));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** How much quieter (in dB) a converted song may come out before it counts as broken. */
export const MAX_LOUDNESS_DROP_DB = 10;
/** Below this, a song is treated as silence and not checked for loudness. */
export const SILENCE_DB = -60;

/**
 * Decodes audio bytes with the browser, at TAPE_FORMAT.decodeRate.
 * Resolves to { left, right, rate, seconds } (copies, safe to hand to a worker).
 */
export async function decodeWithBrowser(bytes) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio.");
  const rate = TAPE_FORMAT.decodeRate;
  const ctx = new Ctx(2, rate, rate);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let buf;
  try {
    buf = await ctx.decodeAudioData(copy);
  } catch (e) {
    throw new Error(`The song couldn't be read (${(e && e.message) || "unknown format"}).`);
  }
  const left = buf.getChannelData(0).slice();
  const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
  return { left, right, rate: buf.sampleRate, seconds: buf.duration };
}

/**
 * Converts one song. Options:
 *   pool        an encoder pool (pool.js)
 *   fadeIn      seconds of fade-in at the start (default 0)
 *   fadeOut     seconds of fade-out at the end (default 0)
 *   onProgress  (stage, percent): stage is "decoding", "encoding" or "checking"
 *   decode      decoder (default decodeWithBrowser; the tests pass a stand-in)
 * Resolves to { bytes, seconds, format, inputDb, outputDb }.
 */
export async function convertSong(bytes, { pool, fadeIn = 0, fadeOut = 0, onProgress = () => {}, decode = decodeWithBrowser } = {}) {
  if (!pool) throw new Error("convertSong needs an encoder pool.");
  onProgress("decoding", 0);
  const pcm = await decode(bytes);
  onProgress("encoding", 0);
  const { mp3, inputDb } = await pool.encode(
    { left: pcm.left, right: pcm.right, rate: pcm.rate, kbps: TAPE_FORMAT.kbps, fadeIn, fadeOut },
    { onProgress: (p) => onProgress("encoding", p) }
  );

  onProgress("checking", 0);
  const scan = scanMp3(mp3);
  if (!isTapeFormat(scan)) {
    throw new Error(`The converted song came out as ${describeFormat(scan)}, not the tape format.`);
  }

  // Decode the result again and compare loudness with what went in.
  let outputDb = null;
  if (inputDb > SILENCE_DB) {
    const back = await decode(mp3);
    outputDb = rmsDb(back.left, back.right);
    if (!(outputDb >= inputDb - MAX_LOUDNESS_DROP_DB)) {
      throw new Error(
        `The converted song came out much quieter than the original (${fmtDb(outputDb)} instead of ${fmtDb(inputDb)}), so something went wrong while converting.`
      );
    }
  }
  onProgress("checking", 100);
  return { bytes: mp3, seconds: scan.seconds, format: describeFormat(scan), inputDb, outputDb };
}

function fmtDb(db) {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : "silence";
}

// Silence to put between songs: encoded once per pool with the same settings
// as the songs, then cut to length (cutSilence), so it joins with them.
const silenceCache = new WeakMap();

/** Resolves to `seconds` of tape-format silence (whole frames). */
export async function makeSilence(seconds, { pool }) {
  let made = silenceCache.get(pool);
  if (!made) {
    const rate = TAPE_FORMAT.decodeRate;
    const n = rate * 10; // 10 s, cut down as needed
    made = pool.encode({ left: new Float32Array(n), right: new Float32Array(n), rate, kbps: TAPE_FORMAT.kbps }).then((r) => r.mp3);
    silenceCache.set(pool, made);
  }
  return cutSilence(await made, seconds);
}
