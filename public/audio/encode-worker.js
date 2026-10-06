// An MP3 encoder running off the page, so the Foundry stays responsive.
// Used through src/core/audio/pool.js. One job at a time:
//   in:  { id, left, right, rate, kbps, fadeIn, fadeOut }  (Float32Arrays, transferred)
//   out: { id, progress }  while working
//        { id, done: true, mp3, inputDb }  (mp3 transferred)
//        { id, error }
// lamejs (LAME, LGPL-3.0) is loaded unmodified from ../vendor/lamejs/.

importScripts("../vendor/lamejs/lame.min.js", "encode-core.js");

self.onmessage = function (e) {
  var d = e.data;
  try {
    FoundryEncode.applyFades(d.left, d.right, d.rate, d.fadeIn, d.fadeOut);
    var inputDb = FoundryEncode.rmsDb(d.left, d.right);
    var mp3 = FoundryEncode.encodePcm(lamejs, d.left, d.right, d.rate, d.kbps, function (pct) {
      self.postMessage({ id: d.id, progress: pct });
    });
    self.postMessage({ id: d.id, done: true, mp3: mp3, inputDb: inputDb }, [mp3.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
  }
};
