// A small pool of MP3 encoder workers (public/audio/encode-worker.js), so
// several songs convert at once on computers with several cores. Jobs wait in
// order; each worker does one job at a time and is reused.

/** How many workers to use: one per core, leaving one for the page, at most 4. */
export function defaultPoolSize(cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2) {
  return Math.max(1, Math.min(4, cores - 1));
}

/** The encoder worker's address on the Foundry's site. */
export function encoderWorkerUrl() {
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  return `${base}audio/encode-worker.js`;
}

/**
 * createWorker(): returns a Worker-like object ({ postMessage, terminate,
 * onmessage, onerror }); the tests pass a stand-in.
 * Returns { encode(job, { onProgress }) -> Promise<{ mp3, inputDb }>, size, pending(), dispose() }.
 * job: { left, right, rate, kbps, fadeIn?, fadeOut? } (Float32Arrays; handed over, not copied).
 */
export function createEncoderPool({ size = defaultPoolSize(), createWorker = () => new Worker(encoderWorkerUrl()) } = {}) {
  const idle = [];
  const busy = new Set();
  const queue = [];
  let made = 0;
  let nextId = 1;
  let disposed = false;

  function getWorker() {
    if (idle.length) return idle.pop();
    if (made < size) {
      made++;
      return createWorker();
    }
    return null;
  }

  function pump() {
    while (queue.length) {
      const w = getWorker();
      if (!w) return;
      run(w, queue.shift());
    }
  }

  function finish(w, broken) {
    busy.delete(w);
    if (broken || disposed) {
      try { w.terminate(); } catch { /* already gone */ }
      made--;
    } else {
      idle.push(w);
    }
    pump();
  }

  function run(w, item) {
    busy.add(w);
    const id = nextId++;
    w.onmessage = (e) => {
      const d = e.data || {};
      if (d.id !== id) return;
      if (d.progress !== undefined) {
        if (item.onProgress) item.onProgress(d.progress);
      } else if (d.error) {
        finish(w, false);
        item.reject(new Error(d.error));
      } else if (d.done) {
        finish(w, false);
        item.resolve({ mp3: d.mp3, inputDb: d.inputDb });
      }
    };
    w.onerror = (e) => {
      finish(w, true);
      item.reject(new Error((e && e.message) || "The encoder stopped unexpectedly."));
    };
    const { left, right, rate, kbps, fadeIn = 0, fadeOut = 0 } = item.job;
    w.postMessage({ id, left, right, rate, kbps, fadeIn, fadeOut }, [left.buffer, right.buffer]);
  }

  return {
    size,
    encode(job, { onProgress } = {}) {
      if (disposed) return Promise.reject(new Error("The encoder pool was closed."));
      return new Promise((resolve, reject) => {
        queue.push({ job, onProgress, resolve, reject });
        pump();
      });
    },
    /** Jobs waiting plus jobs running. */
    pending() {
      return queue.length + busy.size;
    },
    dispose() {
      disposed = true;
      for (const item of queue.splice(0)) item.reject(new Error("The encoder pool was closed."));
      for (const w of idle.splice(0)) {
        try { w.terminate(); } catch { /* already gone */ }
      }
      made = busy.size;
    },
  };
}
