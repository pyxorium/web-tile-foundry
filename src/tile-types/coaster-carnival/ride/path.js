// Where things are along a finished track (the output of generateTrack):
// smooth in-between points for drawing, and the cart's position and
// orientation at any moment of the ride. Pure maths, no three.js, so it is
// tested in Node.
//
// A frame is { p, t, up, side }: position, direction of travel, the rider's
// up, and the rider's left (side = up × t). (side, up, t) is a right-handed
// set of axes, so three.js can use it directly as an object's x, y, z.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? scale(a, 1 / n) : [0, 1, 0];
};
const perp = (v, t) => norm(sub(v, scale(t, dot(v, t))));

/** Catmull-Rom position and direction between points b and c (a and d either side), at fraction f. */
function spline(a, b, c, d, f) {
  const f2 = f * f;
  const f3 = f2 * f;
  const p = [0, 1, 2].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f2 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * f3));
  const v = [0, 1, 2].map((k) => 0.5 * ((c[k] - a[k]) + 2 * (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f + 3 * (3 * b[k] - a[k] - 3 * c[k] + d[k]) * f2));
  return { p, v };
}

/** The frame a fraction f of the way from sample i to the next (the track is a closed loop). */
export function frameBetween(track, i, f) {
  const { points, ups } = track;
  const n = points.length;
  const at = (k) => points[((k % n) + n) % n];
  const { p, v } = spline(at(i - 1), at(i), at(i + 1), at(i + 2), f);
  const t = norm(v);
  const u0 = ups[((i % n) + n) % n];
  const u1 = ups[(((i + 1) % n) + n) % n];
  const up = perp(add(scale(u0, 1 - f), scale(u1, f)), t);
  return { p, t, up, side: cross(up, t) };
}

/** Frames `steps` times per sample all the way round, for drawing smooth rails. */
export function smoothFrames(track, steps = 3) {
  const out = [];
  for (let i = 0; i < track.points.length; i++) {
    for (let s = 0; s < steps; s++) out.push(frameBetween(track, i, s / steps));
  }
  return out;
}

/**
 * Where the cart is `seconds` into the ride (played seconds, as in
 * track.time). Before 0 it waits at the start; after the end it rests there.
 * Returns the frame plus { index, fraction, speed, done }.
 */
export function poseAt(track, seconds) {
  const { time, duration, speed } = track;
  const n = time.length;
  if (!(seconds > 0)) return { ...frameBetween(track, 0, 0), index: 0, fraction: 0, speed: 0, done: false };
  if (seconds >= duration) return { ...frameBetween(track, 0, 0), index: 0, fraction: 0, speed: 0, done: true };
  let i;
  let f;
  if (seconds >= time[n - 1]) {
    i = n - 1;
    f = (seconds - time[n - 1]) / (duration - time[n - 1]);
  } else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (time[mid] <= seconds) lo = mid;
      else hi = mid;
    }
    i = lo;
    f = (seconds - time[lo]) / (time[hi] - time[lo]);
  }
  const v = speed[i] + (speed[(i + 1) % n] - speed[i]) * f;
  return { ...frameBetween(track, i, f), index: i, fraction: f, speed: i === n - 1 ? speed[i] * (1 - f) : v, done: false };
}

/** Which piece of the ride (lift, drop, loop ...) a sample index belongs to. */
export function pieceAt(track, index) {
  return track.pieces.find((p) => index >= p.from && index <= p.to) || track.pieces[0];
}

export const _vec = { add, sub, scale, dot, cross, norm, perp };
