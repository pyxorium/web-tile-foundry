// MP3 tools for audio tile types: read a file's frames, join files into one
// continuous side, and cut silence to a length.
//
// Each file is reduced to its bare audio frames: ID3 and APE tags are dropped,
// and so is the Xing/Info/VBRI header frame that encoders put first (it states
// that one file's length, which would make a joined side look as short as its
// first track). Files only join when they match: same MPEG version, Layer III,
// sample rate, mono/stereo and a constant bitrate. Same rules as Tileman's
// mp3join.js, which joins tape sides on the phone.

/** The format every converted song is in (see convert.js). */
export const TAPE_FORMAT = Object.freeze({
  mimeType: "audio/mpeg",
  kbps: 96,
  sampleRate: 32000, // LAME's own choice at 96 kbps
  channels: 2,
  decodeRate: 44100, // the rate songs are decoded at before encoding
});

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 Layer III
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function header(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[i + 1] >> 1) & 3; // 1 = Layer III
  const brIdx = b[i + 2] >> 4;
  const srIdx = (b[i + 2] >> 2) & 3;
  const pad = (b[i + 2] >> 1) & 1;
  const mode = b[i + 3] >> 6; // 3 = mono
  if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const kbps = BITRATES[ver === 3 ? 1 : 2][brIdx];
  const rate = RATES[ver][srIdx];
  const len = ver === 3 ? Math.floor((144000 * kbps) / rate) + pad : Math.floor((72000 * kbps) / rate) + pad;
  return {
    ver, kbps, rate, mono: mode === 3, len,
    samples: ver === 3 ? 1152 : 576,
    sideInfo: ver === 3 ? (mode === 3 ? 17 : 32) : mode === 3 ? 9 : 17,
  };
}

function text(b, i, s) {
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
}

/**
 * Reads an MP3's frames. Returns
 *   { frames: [[start, end], ...], count, rate, mono, ver, kbps (null if variable), samplesPerFrame, seconds }
 * Throws if the file isn't usable MP3 audio.
 */
export function scanMp3(bytes) {
  const b = bytes;
  let i = 0;
  let end = b.length;
  while (end - i >= 10 && text(b, i, "ID3")) {
    const size = ((b[i + 6] & 0x7f) << 21) | ((b[i + 7] & 0x7f) << 14) | ((b[i + 8] & 0x7f) << 7) | (b[i + 9] & 0x7f);
    i += 10 + size + (b[i + 5] & 0x10 ? 10 : 0);
  }
  if (end >= 128 && text(b, end - 128, "TAG")) end -= 128;
  if (end >= 32 && text(b, end - 32, "APETAGEX")) {
    const apeSize = b[end - 20] | (b[end - 19] << 8) | (b[end - 18] << 16) | (b[end - 17] << 24);
    end -= Math.min(end, apeSize + 32);
  }
  const limit = Math.min(end, i + 65536);
  while (i < limit) {
    const h = header(b, i);
    if (h && header(b, i + h.len)) break;
    i++;
  }
  const first = header(b, i);
  if (!first) throw new Error("no MP3 audio found");

  const frames = [];
  const kbpsSeen = new Set();
  let n = 0;
  while (i < end) {
    const h = header(b, i);
    if (!h) {
      if (end - i < 2048) break; // a little junk at the very end
      throw new Error("the MP3 data is damaged or unusual");
    }
    if (h.ver !== first.ver || h.rate !== first.rate || h.mono !== first.mono) {
      throw new Error("the format changes partway through the file");
    }
    if (i + h.len > end) break; // incomplete last frame
    const isInfo =
      n === 0 &&
      (text(b, i + 4 + h.sideInfo, "Xing") || text(b, i + 4 + h.sideInfo, "Info") || text(b, i + 36, "VBRI"));
    if (!isInfo) {
      frames.push([i, i + h.len]);
      kbpsSeen.add(h.kbps);
    }
    i += h.len;
    n++;
  }
  if (!frames.length) throw new Error("no MP3 audio found");
  return {
    frames,
    count: frames.length,
    rate: first.rate,
    mono: first.mono,
    ver: first.ver,
    kbps: kbpsSeen.size === 1 ? [...kbpsSeen][0] : null,
    samplesPerFrame: first.samples,
    seconds: (frames.length * first.samples) / first.rate,
  };
}

/** "96 kbps, 32000 Hz, stereo" */
export function describeFormat(s) {
  return `${s.kbps ? s.kbps + " kbps" : "variable bitrate"}, ${s.rate} Hz, ${s.mono ? "mono" : "stereo"}`;
}

/** Whether a scanned file is in TAPE_FORMAT. */
export function isTapeFormat(s) {
  return s.kbps === TAPE_FORMAT.kbps && s.rate === TAPE_FORMAT.sampleRate && !s.mono;
}

/**
 * Joins MP3 files (Uint8Arrays) end to end into one continuous file.
 * Returns { bytes, starts, durations, total, format }; throws an Error saying
 * why if the files don't match.
 */
export function joinMp3(files) {
  if (!files.length) throw new Error("nothing to join");
  const scans = files.map((f, k) => {
    try {
      return scanMp3(f);
    } catch (e) {
      throw new Error(`track ${k + 1}: ${e.message}`);
    }
  });
  const a = scans[0];
  if (!a.kbps) throw new Error("track 1 has a variable bitrate");
  scans.forEach((s, k) => {
    if (s.ver !== a.ver || s.rate !== a.rate || s.mono !== a.mono || s.kbps !== a.kbps) {
      throw new Error(`track ${k + 1} is ${describeFormat(s)}, track 1 is ${describeFormat(a)}`);
    }
  });
  let size = 0;
  for (const s of scans) for (const f of s.frames) size += f[1] - f[0];
  const out = new Uint8Array(size);
  const starts = [];
  const durations = [];
  let pos = 0;
  let t = 0;
  scans.forEach((s, k) => {
    starts.push(t);
    durations.push(s.seconds);
    t += s.seconds;
    for (const f of s.frames) {
      out.set(files[k].subarray(f[0], f[1]), pos);
      pos += f[1] - f[0];
    }
  });
  return { bytes: out, starts, durations, total: t, format: describeFormat(a) };
}

/**
 * Cuts `seconds` of silence (rounded to whole frames) from a longer silent MP3
 * made by the same encoder (see makeSilence in convert.js), so it can be put
 * between songs and still join.
 */
export function cutSilence(silenceMp3, seconds) {
  const s = scanMp3(silenceMp3);
  const want = Math.max(0, Math.round((seconds * s.rate) / s.samplesPerFrame));
  if (want > s.count) throw new Error(`only ${s.seconds.toFixed(1)} s of silence available`);
  const picked = s.frames.slice(0, want);
  const size = picked.reduce((n, f) => n + (f[1] - f[0]), 0);
  const out = new Uint8Array(size);
  let pos = 0;
  for (const f of picked) {
    out.set(silenceMp3.subarray(f[0], f[1]), pos);
    pos += f[1] - f[0];
  }
  return out;
}
