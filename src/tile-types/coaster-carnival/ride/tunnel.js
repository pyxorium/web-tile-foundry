// Where the tunnel goes ("Add a tunnel", the creator's choice). Pure maths,
// no three.js, so it is tested in Node; tunnel-mesh.js builds it.
//
// The tunnel is scenery round one stretch of the main ride: it never changes
// the track, the ride or the fingerprint. It goes on the longest stretch that
// is low, fairly level, gently curved and only a little banked, with nothing
// else in the way, keeping clear of the station, the track switch, lifts,
// hilltops, loops and corkscrews. A long stretch gets a tunnel up to
// TUNNEL.longest; a shorter one gets a shorter tunnel, down to TUNNEL.shortest.
// It looks in three passes and keeps the first that finds a place:
//
//   "snug"    low and level (the bottom of a drop, a valley run)
//   "roomy"   a little higher, steeper, more curved or more banked (the hill
//             round it grows to match)
//   "home"    the slow run back into the station (low and level on nearly
//             every layout), as a last resort
//
//   findTunnel(track) → null | { from, to, length, pass }   (samples of the main ride)

export const TUNNEL = Object.freeze({
  shortest: 9, // m: anything shorter looks like a bridge you flash under
  longest: 34, // m: past this the dark stops being a thrill and becomes a wait
  station: 14, // m: no nearer the station's middle than this
  halfWidth: 3.4, // m: inside, from the middle to each wall (see tunnel-mesh.js)
  crown: 5.8, // m: inside, from the rails up to the top of the arch
  cover: 2, // m: hill above the arch
});

const RULES = Object.freeze({
  snug: Object.freeze({ high: 4, grade: 0.12, upright: 0.94, radius: 22 }),
  roomy: Object.freeze({ high: 8, grade: 0.25, upright: 0.82, radius: 16 }),
});
const NEVER = new Set(["loop", "corkscrew", "lift", "crest", "hilltop", "station-out", "station-in"]);
const HOME = new Set(["return", "filler", "brakes"]); // the run back in, once nothing else follows

/** How far the hill spreads from the middle at the ground, for track this high. */
export function hillHalfWidth(railHeight) {
  return TUNNEL.halfWidth + 5 + Math.max(0, railHeight) * 1.1;
}

export function findTunnel(track) {
  const n = track.points.length;
  const kinds = new Array(n).fill("");
  for (const piece of track.pieces) for (let i = piece.from; i <= piece.to; i++) kinds[i] = piece.kind;
  // The run home: the last pieces of the ride, if they are all of the "home" kinds.
  const home = new Array(n).fill(false);
  const pieces = track.pieces.filter((p) => p.kind !== "station-in");
  for (let k = pieces.length - 1; k >= 0 && HOME.has(pieces[k].kind); k--) for (let i = pieces[k].from; i <= pieces[k].to; i++) home[i] = true;
  const blocked = blockedSamples(track, kinds);
  const shape = track.points.map((_, i) => shapeAt(track, i));

  const passes = [
    ["snug", RULES.snug, (i) => !home[i]],
    ["roomy", RULES.roomy, (i) => !home[i]],
    ["home", RULES.roomy, (i) => home[i]],
  ];
  for (const [pass, rule, allowed] of passes) {
    const ok = (i) => !blocked[i] && allowed(i) && fits(shape[i], rule) && clearOfTrack(track, i, rule);
    let best = null;
    for (let i = 0; i < n; ) {
      if (!ok(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < n && ok(j + 1)) j++;
      const candidate = trim(track, i, j, pass);
      if (candidate && (!best || better(candidate, best, track))) best = candidate;
      i = j + 1;
    }
    if (best) return best;
  }
  return null;
}

/** Samples the tunnel may never cover: special pieces, near the station, round the track switch. */
function blockedSamples(track, kinds) {
  const n = track.points.length;
  const station = track.points[0];
  const blocked = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const p = track.points[i];
    if (NEVER.has(kinds[i]) || Math.hypot(p[0] - station[0], p[2] - station[2]) < TUNNEL.station) blocked[i] = true;
  }
  const sw = track.trackSwitch;
  if (sw) {
    // From before the fork sign (see switch-sign.js) to where the ways meet again.
    const before = Math.round(14 / track.spacing);
    for (let i = Math.max(0, sw.chill.from - before); i <= Math.min(n - 1, sw.chill.to + 3); i++) blocked[i] = true;
  }
  return blocked;
}

/** Height, steepness, banking and how tightly it curves (horizontal radius, m) at sample i. */
function shapeAt(track, i) {
  const n = track.points.length;
  const at = (k) => track.points[((k % n) + n) % n];
  const a = at(i - 2);
  const b = at(i + 2);
  const run = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1e-6;
  const grade = Math.abs(b[1] - a[1]) / run;
  const reach = Math.max(2, Math.round(5 / track.spacing));
  const radius = circleRadius(at(i - reach), at(i), at(i + reach));
  return { high: at(i)[1], grade, upright: track.ups[i][1], radius };
}

/** Radius of the circle through three points, seen from above (Infinity when they line up). */
function circleRadius(a, b, c) {
  const ab = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const bc = Math.hypot(c[0] - b[0], c[2] - b[2]);
  const ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
  const area2 = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]));
  return area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
}

function fits(s, rule) {
  return s.high <= rule.high && s.grade <= rule.grade && s.upright >= rule.upright && s.radius >= rule.radius;
}

/** Nothing else (other parts of the ride, or the thrill route) passes through the hill at sample i. */
function clearOfTrack(track, i, rule) {
  const p = track.points[i];
  const reach = hillHalfWidth(rule.high) + 1;
  const top = p[1] + TUNNEL.crown + TUNNEL.cover + 2.5; // track higher than this passes safely over
  const near = Math.round((reach * 1.6) / track.spacing); // the ride's own samples either side don't count
  const n = track.points.length;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(k - i);
    if (Math.min(d, n - d) <= near) continue;
    const q = track.points[k];
    if (q[1] < top && Math.hypot(q[0] - p[0], q[2] - p[2]) < reach) return false;
  }
  const thrill = track.trackSwitch?.thrill;
  if (thrill) {
    for (let k = thrill.from; k <= thrill.to; k++) {
      const q = thrill.points[k];
      if (q[1] < top && Math.hypot(q[0] - p[0], q[2] - p[2]) < reach) return false;
    }
  }
  return true;
}

/** A stretch from i to j, cut to the longest allowed length round its fastest part; null if too short. */
function trim(track, i, j, pass) {
  const s = track.spacing;
  const length = (j - i) * s;
  if (length < TUNNEL.shortest) return null;
  const keep = Math.min(j - i, Math.round(TUNNEL.longest / s));
  // Slide a window of `keep` samples to where the cart is fastest (a tunnel at speed is the fun kind).
  let from = i;
  let bestSum = -1;
  for (let k = i; k + keep <= j; k++) {
    let sum = 0;
    for (let m = k; m <= k + keep; m++) sum += track.speed[m];
    if (sum > bestSum) {
      bestSum = sum;
      from = k;
    }
  }
  return { from, to: from + keep, length: Math.round(keep * s * 10) / 10, pass };
}

function better(a, b, track) {
  if (Math.abs(a.length - b.length) > 0.5) return a.length > b.length;
  const avg = (c) => {
    let total = 0;
    for (let k = c.from; k <= c.to; k++) total += track.speed[k];
    return total / (c.to - c.from + 1);
  };
  return avg(a) > avg(b);
}

/**
 * For drawing and for "is the cart in the tunnel": the tunnel's middle line,
 * one entry per sample: { p (rail position), across (level, to the rider's
 * left), along (level direction) }.
 */
export function tunnelLine(track, tunnel) {
  const out = [];
  const n = track.points.length;
  for (let i = tunnel.from; i <= tunnel.to; i++) {
    const a = track.points[Math.max(0, i - 1)];
    const b = track.points[Math.min(n - 1, i + 1)];
    const fx = b[0] - a[0];
    const fz = b[2] - a[2];
    const f = Math.hypot(fx, fz) || 1;
    const along = [fx / f, 0, fz / f];
    out.push({ p: track.points[i], along, across: [along[2], 0, -along[0]] });
  }
  return out;
}

/** Whether a point (x, y, z) is inside the tunnel (between its walls, under its arch, between its ends). */
export function insideTunnel(line, x, y, z) {
  let best = Infinity;
  let at = null;
  for (const e of line) {
    const d = Math.hypot(x - e.p[0], z - e.p[2]);
    if (d < best) {
      best = d;
      at = e;
    }
  }
  if (!at || best > TUNNEL.halfWidth + 0.5) return false;
  // Past either end? (Measured along the tunnel at the end samples.)
  const first = line[0];
  const last = line[line.length - 1];
  const ahead = (e, sign) => sign * ((x - e.p[0]) * e.along[0] + (z - e.p[2]) * e.along[2]);
  if (ahead(first, -1) > 0.2 || ahead(last, 1) > 0.2) return false;
  return y > at.p[1] - 2 && y < at.p[1] + TUNNEL.crown;
}
