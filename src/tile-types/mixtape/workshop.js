// Keeping the song list's audio in step with its order and transitions.
//
// Each song on the tape is converted with the fades its place calls for
// (transitions.js). Moving a song or changing a "Then" can change the fades of
// up to three songs; only those are converted again. Every conversion is kept,
// by (song, fade-in, fade-out), so moving a song back is instant, and each
// song's original file is downloaded once.
//
// Two parts:
//   normalizeTracks(tracks, sides)  pure: fills in suggested transitions and
//       marks songs whose audio no longer fits their place as converting. The
//       tile type runs it on every change to the list (applyChange).
//   createWorkshop({ ... })  does the downloading and converting, a few songs
//       at a time (each converting song holds its decoded audio in memory).

import { shapesFor, fadesOf, sameFades, suggestTransition } from "./transitions.js";

/** Seconds a side holds (a C60 cassette: 30 minutes a side). */
export const SIDE_SECONDS = 30 * 60;

/** The song list with suggested transitions filled in and out-of-date songs marked; the same array if nothing changed. */
export function normalizeTracks(tracks, sides) {
  if (!Array.isArray(tracks)) return [];
  let out = tracks;
  const set = (i, change) => {
    if (out === tracks) out = tracks.slice();
    out[i] = { ...out[i], ...change };
  };
  // Suggested transitions follow their neighbours until the creator picks one.
  for (const side of sides) {
    const idx = [];
    out.forEach((t, i) => t && t.side === side && idx.push(i));
    for (let k = 0; k < idx.length - 1; k++) {
      const t = out[idx[k]];
      if (t.transitionChosen) continue;
      const want = suggestTransition(t, out[idx[k + 1]]);
      if (t.transition !== want) set(idx[k], { transition: want });
    }
  }
  // Songs whose audio was made for a different place convert again.
  const shapes = shapesFor(out, sides);
  out.forEach((t, i) => {
    const shape = shapes.get(t.id);
    if (shape && t.status === "ready" && !sameFades(t.fades, fadesOf(shape))) set(i, { status: "converting", progress: undefined });
  });
  return out;
}

/** Which side a new song goes on: A, unless A is full and it fits on a later side. */
export function sideFor(tracks, sides, seconds) {
  const used = (side) => tracks.filter((t) => t.side === side).reduce((n, t) => n + (Number(t.seconds) || 0), 0);
  for (const side of sides) if (used(side) + seconds <= SIDE_SECONDS) return side;
  return sides[0];
}

/**
 * A song from the picker (plyr.js songFromRecord) as an entry in the song list.
 * Its id is the record's address, so the same song is never on a tape twice.
 */
export function trackFromSong(song, side) {
  return {
    id: song.uri,
    title: song.title,
    artist: song.artist || undefined,
    album: song.album || undefined,
    trackNumber: song.trackNumber ?? undefined,
    side,
    seconds: song.seconds,
    status: "converting",
    source: { record: { uri: song.uri, cid: song.cid } },
    blobCid: song.blob.cid,
  };
}

/** Simple limit on how many jobs run at once. */
function limiter(max) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= max || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    next();
  });
}

const keyOf = (id, fades) => `${id}|${fades.fadeIn}|${fades.fadeOut}`;

/**
 * download(track) -> Promise<Uint8Array>: the song's original file.
 * convert(bytes, fades, onProgress(stage, pct)) -> Promise<{ bytes, seconds }>.
 * setTracks(fn): change the song list (fn gets the latest list).
 * Returns { sync(tracks), retry(id), dispose() }; call sync after every change.
 */
export function createWorkshop({ download, convert, setTracks, sides, parallel = 2 }) {
  const originals = new Map(); // id -> Promise<bytes>
  const results = new Map(); // key -> { bytes, seconds }
  const running = new Set(); // keys
  const limit = limiter(parallel);
  let disposed = false;

  // The list as the panel will have it (suggested transitions filled in), in
  // case a change arrives before the panel has caught up.
  const wanted = (list, id) => {
    const shape = shapesFor(normalizeTracks(list, sides), sides).get(id);
    return shape ? fadesOf(shape) : null;
  };
  // Change one song, but only if it still wants these fades.
  const patchIf = (id, fades, change) =>
    setTracks((list) => {
      const t = list.find((x) => x.id === id);
      if (!t || !sameFades(wanted(list, id), fades) || (t.status === "ready" && sameFades(t.fades, fades) && !change.status)) return list;
      return list.map((x) => (x.id === id ? { ...x, ...change } : x));
    });

  function original(t) {
    if (!originals.has(t.id)) {
      const p = Promise.resolve().then(() => download(t));
      p.catch(() => originals.delete(t.id));
      originals.set(t.id, p);
    }
    return originals.get(t.id);
  }

  function start(t, fades) {
    const key = keyOf(t.id, fades);
    running.add(key);
    let lastPct = -1;
    limit(async () => {
      if (disposed) throw new Error("stopped");
      const bytes = await original(t);
      return convert(bytes, fades, (stage, pct) => {
        const p = stage === "encoding" ? Math.round(pct) : stage === "checking" ? 100 : 0;
        if (p !== lastPct && !disposed) {
          lastPct = p;
          patchIf(t.id, fades, { progress: p });
        }
      });
    }).then(
      (r) => {
        running.delete(key);
        results.set(key, r);
        if (!disposed) patchIf(t.id, fades, { status: "ready", bytes: r.bytes, seconds: r.seconds, fades, progress: undefined, error: undefined });
      },
      (err) => {
        running.delete(key);
        if (!disposed) patchIf(t.id, fades, { status: "error", error: (err && err.message) || String(err), progress: undefined });
      }
    );
  }

  return {
    sync(tracks) {
      if (disposed || !Array.isArray(tracks)) return;
      const shapes = shapesFor(tracks, sides);
      for (const t of tracks) {
        if (t.status === "error") continue;
        const shape = shapes.get(t.id);
        if (!shape) continue;
        const fades = fadesOf(shape);
        if (t.status === "ready" && sameFades(t.fades, fades)) continue;
        const key = keyOf(t.id, fades);
        const done = results.get(key);
        if (done) patchIf(t.id, fades, { status: "ready", bytes: done.bytes, seconds: done.seconds, fades, progress: undefined, error: undefined });
        else if (!running.has(key)) start(t, fades);
      }
    },
    /** Try a song that failed again (downloading it again too, if that was what failed). */
    retry(id) {
      setTracks((list) => list.map((x) => (x.id === id && x.status === "error" ? { ...x, status: "converting", error: undefined } : x)));
    },
    /** How many conversions are kept (for tests). */
    kept: () => results.size,
    dispose() {
      disposed = true;
    },
  };
}

