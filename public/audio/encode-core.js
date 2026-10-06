// The Foundry's MP3 encoding steps, as a plain script so both the encoder
// worker (encode-worker.js) and the tests (Node) can load it. It defines
// FoundryEncode on the global object. lamejs (../vendor/lamejs/lame.min.js)
// does the actual encoding; this file only prepares the samples and feeds them.

(function (root) {
  "use strict";

  // lamejs mis-encodes (near silence) when encodeBuffer is given more than one
  // MP3 frame's worth of samples per call, so it always gets exactly this many
  // (the last call may get fewer).
  var BLOCK = 1152;

  /** Linear fade-in over the first `fadeIn` seconds and fade-out over the last `fadeOut` seconds, in place. */
  function applyFades(left, right, rate, fadeIn, fadeOut) {
    var n = left.length;
    var fi = Math.min(n, Math.max(0, Math.round((fadeIn || 0) * rate)));
    var fo = Math.min(n, Math.max(0, Math.round((fadeOut || 0) * rate)));
    for (var i = 0; i < fi; i++) {
      var g = i / fi;
      left[i] *= g; right[i] *= g;
    }
    for (var j = 0; j < fo; j++) {
      var k = n - fo + j, h = 1 - (j + 1) / fo;
      left[k] *= h; right[k] *= h;
    }
  }

  /** Loudness of the samples as RMS in dB (0 dB = full scale); -Infinity for silence. */
  function rmsDb(left, right) {
    var sum = 0, n = left.length;
    if (!n) return -Infinity;
    for (var i = 0; i < n; i++) sum += left[i] * left[i] + right[i] * right[i];
    var rms = Math.sqrt(sum / (2 * n));
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  function toInt16(src, dst, start, count) {
    for (var i = 0; i < count; i++) {
      var s = src[start + i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      dst[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
  }

  /**
   * Encodes stereo float samples (-1..1) to MP3 bytes.
   * lame: the lamejs object; onProgress(0..100) is optional.
   */
  function encodePcm(lame, left, right, rate, kbps, onProgress) {
    if (left.length !== right.length) throw new Error("left and right have different lengths");
    var enc = new lame.Mp3Encoder(2, rate, kbps);
    var l16 = new Int16Array(BLOCK), r16 = new Int16Array(BLOCK);
    var parts = [], total = 0, lastPct = -1, n = left.length;

    function keep(out) {
      if (out && out.length) {
        parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice());
        total += out.length;
      }
    }

    for (var pos = 0; pos < n; pos += BLOCK) {
      var count = Math.min(BLOCK, n - pos);
      var lb = count === BLOCK ? l16 : new Int16Array(count);
      var rb = count === BLOCK ? r16 : new Int16Array(count);
      toInt16(left, lb, pos, count);
      toInt16(right, rb, pos, count);
      keep(enc.encodeBuffer(lb, rb));
      if (onProgress) {
        var pct = Math.floor(pos / n * 100);
        if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
      }
    }
    keep(enc.flush());

    var mp3 = new Uint8Array(total), at = 0;
    for (var p = 0; p < parts.length; p++) { mp3.set(parts[p], at); at += parts[p].length; }
    return mp3;
  }

  root.FoundryEncode = { BLOCK: BLOCK, applyFades: applyFades, rmsDb: rmsDb, encodePcm: encodePcm };
})(typeof self !== "undefined" ? self : globalThis);
