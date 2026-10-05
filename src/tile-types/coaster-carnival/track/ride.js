import { FIXED, G } from "./options.js";
import { add, sub, scale, dot, cross, length, normalize, perpendicular, rotateAround } from "./vec.js";

// Step 3: from the dense shape to the ride itself.
//
//   resample()     evenly spaced points along the real 3D track
//   shapeAt()      direction of travel and bend at each point
//   speeds()       how fast the cart goes everywhere, and when it gets there
//   upVectors()    which way is "up" for the rider (banking, rolls)
//   feltForces()   what the rider feels
//
// Speed: the station tires push the cart out to lift speed, the chain lift
// keeps it steady, and from the top of the lift on, speed comes from height:
//   v² = v_lift² + 2g (h_top − h) − 2g · friction · (distance since the top)
// The brakes slow it down evenly to station speed; it stops in the station.
//
// `drag` (optional, one number per sample) scales the friction there: the
// track switch's thrill route has drive tires along it that make up for its
// extra length, so the cart comes back onto the main line with the same
// speed whichever way it went (see switch.js).

const BANK_LIMIT = (70 * Math.PI) / 180;
const BANK_SMOOTHING = 4; // samples either side
const LEAN_LIMIT = (25 * Math.PI) / 180;
const UP = [0, 1, 0];

/** Evenly spaced points along the closed dense polyline, `step` meters apart (adjusted to fit exactly). */
export function resample(dense, step) {
  const { points, ups, piece } = dense;
  const n = points.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + length(sub(points[(i + 1) % n], points[i]));
  const total = cum[n];
  const count = Math.max(8, Math.round(total / step));
  const spacing = total / count;
  const out = { points: [], ups: [], piece: [], spacing, length: total };
  let j = 0;
  for (let k = 0; k < count; k++) {
    const at = k * spacing;
    while (cum[j + 1] < at) j++;
    const f = (at - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = points[j];
    const b = points[(j + 1) % n];
    out.points.push(add(a, scale(sub(b, a), f)));
    const ua = ups[j];
    const ub = ups[(j + 1) % n];
    out.ups.push(ua && ub ? normalize(add(scale(ua, 1 - f), scale(ub, f))) : null);
    out.piece.push(piece[f < 0.5 ? j : (j + 1) % n]);
  }
  return out;
}

/** Direction of travel and bend vector at every sample (closed track). */
export function shapeAt(track) {
  const { points, spacing } = track;
  const n = points.length;
  const tangents = [];
  const bends = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    tangents.push(normalize(sub(next, prev)));
    // Second difference: the bend (curvature) vector, pointing toward the inside.
    bends.push(scale(sub(add(next, prev), scale(points[i], 2)), 1 / (spacing * spacing)));
  }
  return { tangents, bends };
}

/** Speed and arrival time at every sample. `kinds` gives each sample's piece kind. */
export function speeds(track, kinds, drag = null) {
  const { points, spacing } = track;
  const n = points.length;
  const v = new Float64Array(n);
  const liftEnd = lastIndexOf(kinds, "lift");
  const brakeStart = kinds.indexOf("brakes");
  const stationIn = kinds.indexOf("station-in");
  const top = points[liftEnd + 1]?.[1] ?? points[liftEnd][1];
  const vs = FIXED.stationSpeed;
  const vl = FIXED.liftSpeed;
  let dragRun = 0; // meters since the top of the lift, each counted at its drag

  for (let i = 0; i < n; i++) {
    const d = i * spacing;
    if (i <= liftEnd) {
      // Station tires push the cart up to lift speed; the chain keeps it there.
      v[i] = Math.min(vl, Math.sqrt(0.25 + 2 * FIXED.startPush * d));
    } else if (i < brakeStart) {
      if (drag) dragRun += drag[i] * spacing;
      const run = drag ? dragRun : (i - liftEnd) * spacing;
      v[i] = Math.sqrt(Math.max(0, vl * vl + 2 * G * (top - points[i][1]) - 2 * G * FIXED.friction * run));
    } else if (i < stationIn) {
      const vb = v[brakeStart - 1];
      const f = (i - brakeStart) / (stationIn - brakeStart);
      v[i] = vb > vs ? Math.sqrt(vb * vb + (vs * vs - vb * vb) * f) : vs; // brakes (or a gentle push) to station speed
    } else {
      const f = (i - stationIn) / (n - stationIn);
      v[i] = Math.max(0.5, vs * Math.sqrt(1 - f)); // easing to a stop in the station
    }
  }
  // Arrival times, assuming speed changes evenly between samples.
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + (2 * spacing) / (v[i - 1] + v[i]);
  const duration = t[n - 1] + (2 * spacing) / (v[n - 1] + 0.5);
  return { v, t, duration };
}

function lastIndexOf(list, value) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i] === value) return i;
  return -1;
}

/**
 * The rider's "up" everywhere. Loops and corkscrews bring their own; elsewhere
 * it is straight up, tilted (banked) into turns just enough that the push
 * the rider feels is into the seat rather than sideways (up to 70°).
 */
export function upVectors(track, tangents, bends, v, mayLean) {
  const n = track.points.length;
  const banks = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (track.ups[i]) continue;
    const t = tangents[i];
    const upRef = perpendicular(UP, t);
    const sideRef = cross(t, upRef);
    const felt = add(scale(bends[i], v[i] * v[i]), scale(UP, G));
    const angle = Math.atan2(dot(felt, sideRef), G * upRef[1]);
    banks[i] = Math.max(-BANK_LIMIT, Math.min(BANK_LIMIT, angle));
  }
  // Smooth the banking a little (only over stretches without their own up).
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (track.ups[i]) continue;
    let sum = 0;
    let weight = 0;
    for (let k = -BANK_SMOOTHING; k <= BANK_SMOOTHING; k++) {
      const j = (i + k + n) % n;
      if (track.ups[j]) continue;
      const w = BANK_SMOOTHING + 1 - Math.abs(k);
      sum += banks[j] * w;
      weight += w;
    }
    smooth[i] = sum / weight;
  }
  // In loops (mayLean) the rider leans toward the push they feel, so it
  // is mostly into the seat rather than sideways, but never more than
  // LEAN_LIMIT away from the shape's own up: where the push is weak (over the
  // top) its direction swings quickly, and following it all the way would whip
  // riders round.
  const raw = track.points.map((_, i) => {
    const t = tangents[i];
    if (!track.ups[i]) return rotateAround(perpendicular(UP, t), t, smooth[i]);
    const shapeUp = perpendicular(track.ups[i], t);
    if (!mayLean[i]) return shapeUp;
    const felt = add(scale(bends[i], v[i] * v[i]), scale(UP, G));
    const across = sub(felt, scale(t, dot(felt, t)));
    if (length(across) < 0.2 * G || dot(across, shapeUp) <= 0) return shapeUp;
    const toward = normalize(across);
    const side = cross(t, shapeUp);
    const lean = Math.atan2(dot(toward, side), dot(toward, shapeUp));
    return rotateAround(shapeUp, t, Math.max(-LEAN_LIMIT, Math.min(LEAN_LIMIT, lean)));
  });
  // A light smoothing inside elements, so the roll is even.
  return raw.map((up, i) => {
    if (!track.ups[i]) return up;
    let sum = [0, 0, 0];
    for (let k = -2; k <= 2; k++) sum = add(sum, raw[(i + k + n) % n]);
    return perpendicular(sum, tangents[i]);
  });
}

/** What the rider feels, in g: into the seat (up) and sideways. */
export function feltForces(tangents, bends, ups, v) {
  return ups.map((up, i) => {
    const felt = add(scale(bends[i], v[i] * v[i]), scale(UP, G));
    const side = cross(tangents[i], up);
    return { up: dot(felt, up) / G, side: dot(felt, side) / G };
  });
}

export { UP, BANK_LIMIT };
