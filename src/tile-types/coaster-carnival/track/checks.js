import { FIXED } from "./options.js";
import { sub, dot, cross, angleBetween } from "./vec.js";

// The checks every finished track must pass. Each returns a list of plain
// problems (empty = fine), like Glass Lantern's checkShape.
//
//   smooth     no kinks in the track or sudden flips of the rider's "up"
//   clearance  separate parts of the track never come too close: 3 m beside,
//              4.5 m above or below (measured around the rider)
//   box        fits inside the box that frames well in a 400 high tile
//   closed     ends exactly where it started, facing the same way
//   speed      never slower than the minimum between the lift and the brakes
//   forces     push into the seat, float over hills and sideways push all
//              stay within the intensity's limits (sideways: 0.6 g on
//              ordinary track, 1.5 g in loops and corkscrews, where riders
//              are briefly rolled onto their side)

const MAX_BEND_PER_SAMPLE = (15 * Math.PI) / 180;
const MAX_ROLL_PER_SAMPLE = (15 * Math.PI) / 180;
const SIDE_GAP = 3;
const STACK_GAP = FIXED.clearance;
const IGNORE_NEARBY = 20; // m along the track: closer than this is the same stretch

export function checkSmooth(track, tangents, ups) {
  const problems = [];
  const n = tangents.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (angleBetween(tangents[i], tangents[j]) > MAX_BEND_PER_SAMPLE) problems.push(`kink at ${Math.round(i * track.spacing)} m`);
    if (angleBetween(ups[i], ups[j]) > MAX_ROLL_PER_SAMPLE) problems.push(`sudden roll at ${Math.round(i * track.spacing)} m`);
    if (problems.length > 3) break;
  }
  return problems;
}

export function checkClearance(track, tangents, ups) {
  const { points, spacing } = track;
  const n = points.length;
  const skip = Math.ceil(IGNORE_NEARBY / spacing);
  const sides = ups.map((u, i) => cross(tangents[i], u));
  const tooClose = (i, d) => {
    const along = dot(d, tangents[i]);
    const side = dot(d, sides[i]);
    const stack = dot(d, ups[i]);
    return (along * along + side * side) / (SIDE_GAP * SIDE_GAP) + (stack * stack) / (STACK_GAP * STACK_GAP) < 1;
  };
  for (let i = 0; i < n; i++) {
    const p = points[i];
    for (let j = i + skip; j < n; j++) {
      if (n - j + i < skip) break; // the closed track wraps around: j is close to i that way
      const q = points[j];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const dz = q[2] - p[2];
      if (dx * dx + dy * dy + dz * dz >= STACK_GAP * STACK_GAP) continue; // quick reject
      const d = [dx, dy, dz];
      if (tooClose(i, d) || tooClose(j, sub([0, 0, 0], d))) {
        return [`track passes too close to itself at ${Math.round(i * spacing)} m and ${Math.round(j * spacing)} m`];
      }
    }
  }
  return [];
}

/**
 * Clearance between two routes of a track switch: for each [i, j] pair, point
 * i of route a and point j of route b must be as far apart as two separate
 * parts of one track (same rule as checkClearance).
 */
export function checkBetween(a, b, pairs) {
  const near = (p, t, up, d) => {
    const side = cross(t, up);
    const along = dot(d, t);
    const across = dot(d, side);
    const stack = dot(d, up);
    return (along * along + across * across) / (SIDE_GAP * SIDE_GAP) + (stack * stack) / (STACK_GAP * STACK_GAP) < 1;
  };
  for (const [i, j] of pairs) {
    const p = a.track.points[i];
    const q = b.track.points[j];
    const d = sub(q, p);
    if (dot(d, d) >= STACK_GAP * STACK_GAP) continue;
    if (near(p, a.tangents[i], a.ups[i], d) || near(q, b.tangents[j], b.ups[j], sub([0, 0, 0], d))) {
      return [`the two routes pass too close at ${Math.round(i * a.track.spacing)} m`];
    }
  }
  return [];
}

export function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function checkBox(points) {
  const b = boundsOf(points);
  const problems = [];
  if (b.size[0] > FIXED.box.width) problems.push(`too wide (${b.size[0].toFixed(0)} m)`);
  if (b.size[2] > FIXED.box.depth) problems.push(`too deep (${b.size[2].toFixed(0)} m)`);
  if (b.max[1] > FIXED.box.height) problems.push(`too tall (${b.max[1].toFixed(0)} m)`);
  if (b.min[1] < 1) problems.push("goes into the ground");
  return problems;
}

export function checkClosed(dense) {
  const problems = [];
  if (dense.closingError > 1e-6) problems.push(`does not close (off by ${dense.closingError.toFixed(6)} m)`);
  if (dense.closingTurn > 1e-9) problems.push("does not end facing the way it started");
  return problems;
}

/** Indices of the free-running part: after the chain lets go, before the brakes. */
export function rideZone(kinds) {
  let liftEnd = -1;
  for (let i = kinds.length - 1; i >= 0; i--) if (kinds[i] === "lift") { liftEnd = i; break; }
  return { from: liftEnd + 1, to: kinds.indexOf("brakes") };
}

export function checkSpeed(v, kinds) {
  const { from, to } = rideZone(kinds);
  for (let i = from; i < to; i++) {
    if (v[i] < FIXED.minSpeed) return [`too slow (${v[i].toFixed(1)} m/s) at sample ${i}`];
  }
  return [];
}

export function checkForces(felt, ups, kinds, elementFlags, s) {
  const { from, to } = rideZone(kinds);
  const problems = [];
  for (let i = from; i < to; i++) {
    const f = felt[i];
    const inElement = elementFlags[i];
    if (f.up > s.maxGs + 0.5) problems.push(`too strong a push (${f.up.toFixed(1)} g) at sample ${i}`);
    if (ups[i][1] < -0.2 && f.up < 0.2) problems.push(`not held in when upside down (${f.up.toFixed(2)} g) at sample ${i}`);
    if (!inElement && f.up < s.minAirtimeGs - 0.3) problems.push(`too much float (${f.up.toFixed(2)} g) at sample ${i}`);
    if (Math.abs(f.side) > (inElement ? 1.5 : 0.6)) problems.push(`too strong a sideways push (${f.side.toFixed(2)} g) at sample ${i}`);
    if (problems.length) break;
  }
  return problems;
}
