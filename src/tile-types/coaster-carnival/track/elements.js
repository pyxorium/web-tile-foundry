import { G, FIXED } from "./options.js";
import { plateau, plateauRate } from "./vec.js";

// Loops and corkscrews: their shapes, and how big each must be for the speed
// the cart has going in.
//
// LOOP: shaped the way real loops are, point by point from the speed. Going
// up, the bend at each point is exactly what gives the rider the push we
// want there: it eases in from nothing, holds near the peak through the lower
// half, and relaxes to a gentler push over the top (the cart is slowest
// there, so the top comes out tight, the classic teardrop). The second half
// is the mirror image of the first. A faster entry makes a bigger loop. It
// also slides sideways a little (the "jog", in plan.js) so its way out passes
// beside its way in.
//
// CORKSCREW: the track winds once around a straight line (the axis) 1.5 m
// up, so riders roll a full turn, held in by the swing round the axis. The
// roll eases in and out gently. Its length is found by trying lengths from short to long and
// taking the first that keeps the push under the limit and holds riders in
// when upside down.

const STEP = 0.025; // m, integration step
const KEEP = 2; // keep every 2nd point: 0.05 m apart, the dense sample spacing
const TIGHTEST = 1 / 4.5; // bend limit: no part of a loop tighter than a 4.5 m radius
const START_EASE = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Designs a loop for entry speed vIn. Returns
 *   { xs, ys, angles, forward, height, arc }
 * (forward/height/angle of travel at points 0.05 m apart along the loop) or null.
 *   peak   push held through the lower half, g
 *   top    push over the top, g
 *   ease   meters over which the push builds up at the entry
 */
export function designLoop(vIn, { peak, top, ease }) {
  let angle = 0;
  let x = 0;
  let y = 0;
  let run = 0;
  const xs = [0];
  const ys = [0];
  const angles = [0];
  for (let step = 1; ; step++) {
    const vSq = vIn * vIn - 2 * G * y - 2 * G * FIXED.friction * run;
    if (vSq < 16 || step > 40000) return null; // slower than 4 m/s, or absurdly long: no loop here
    const wanted = top + (peak - top) * Math.sqrt((1 + Math.cos(angle)) / 2);
    const push = 1 + (wanted - 1) * START_EASE(run / ease);
    let bend = (G * (push - Math.cos(angle))) / vSq;
    if (bend > TIGHTEST) {
      // Too slow up here for the push we wanted without a hairpin top: round it
      // off, as long as riders are still held in firmly.
      bend = TIGHTEST;
      if (Math.cos(angle) < -0.2 && (vSq * bend + G * Math.cos(angle)) / G < HOLD_IN) return null;
    }
    const mid = angle + (bend * STEP) / 2;
    const nx = x + Math.cos(mid) * STEP;
    const ny = y + Math.sin(mid) * STEP;
    const na = angle + bend * STEP;
    if (na >= Math.PI) {
      // Stop exactly at the top.
      const f = (Math.PI - angle) / (na - angle);
      xs.push(x + (nx - x) * f);
      ys.push(y + (ny - y) * f);
      angles.push(Math.PI);
      break;
    }
    [x, y, angle] = [nx, ny, na];
    run += STEP;
    if (step % KEEP === 0) {
      xs.push(x);
      ys.push(y);
      angles.push(angle);
    }
  }
  // The way down is the way up, mirrored.
  const topIndex = xs.length - 1;
  const xTop = xs[topIndex];
  for (let i = topIndex - 1; i >= 0; i--) {
    xs.push(2 * xTop - xs[i]);
    ys.push(ys[i]);
    angles.push(2 * Math.PI - angles[i]);
  }
  ys[ys.length - 1] = 0;
  let arc = 0;
  for (let i = 1; i < xs.length; i++) arc += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return { xs, ys, angles, forward: 2 * xTop, height: ys[topIndex], arc };
}

/** How far round a corkscrew has rolled at fraction u along it (0 to 2π). */
export function corkscrewAngle(u) {
  return 2 * Math.PI * plateau(u, CORK_RAMP);
}

// The roll eases in over the first half and out over the second: a gentle
// start matters more than a steady middle (a quick start shoves riders sideways).
const CORK_RAMP = 0.5;

const CHECKS = 160;
// Shortest corkscrew: keeps the fastest part of the roll under 13° per meter,
// so riders turn over evenly.
const SHORTEST_CORKSCREW = Math.ceil(360 / ((1 - CORK_RAMP) * 13));
const PUSH_MARGIN = 0.35; // g kept in hand below the limit (the final checks allow 0.5 over)
const HOLD_IN = 0.4; // g, at least this into the seat when upside down

// The corkscrew's roll angle and roll rate at the check points never change,
// so they are worked out once.
const CORK_ANGLE = Float64Array.from({ length: CHECKS + 1 }, (_, k) => corkscrewAngle(k / CHECKS));
const CORK_RATE = Float64Array.from({ length: CHECKS + 1 }, (_, k) => plateauRate(k / CHECKS, CORK_RAMP));
// How fast the roll rate itself changes (per unit of u), from the easing curve.
const easeSlope = (x) => 30 * x * x * (1 - x) * (1 - x); // slope of smootherstep
const CORK_RATE_CHANGE = Float64Array.from({ length: CHECKS + 1 }, (_, k) => {
  const u = k / CHECKS;
  const r = CORK_RAMP;
  const d = u < r ? easeSlope(u / r) / r : u > 1 - r ? -easeSlope((1 - u) / r) / r : 0;
  return d / (1 - r);
});
const SIDE_LIMIT = 1.4; // g; the final check allows 1.5 in elements

/**
 * What a rider feels through a corkscrew of axis length `len`: the most push
 * into the seat, the least when upside down, and the most sideways (gravity
 * while rolled onto their side, plus the shove from the roll speeding up or
 * slowing down).
 */
function corkscrewFeel(len, radius, vIn) {
  let most = -Infinity;
  let leastInverted = Infinity;
  let sideways = 0;
  for (let k = 0; k <= CHECKS; k++) {
    const a = CORK_ANGLE[k];
    const c = Math.cos(a);
    const w = (2 * Math.PI * CORK_RATE[k]) / len; // roll per meter of axis
    const dw = (2 * Math.PI * CORK_RATE_CHANGE[k]) / (len * len); // change in roll rate per meter
    const bend = (radius * w * w) / (1 + radius * radius * w * w);
    const vSq = vIn * vIn - 2 * G * radius * (1 - c);
    if (vSq <= 0) return null;
    const felt = (vSq * bend + G * c) / G;
    if (felt > most) most = felt;
    if (c < -0.2 && felt < leastInverted) leastInverted = felt;
    sideways = Math.max(sideways, (radius * Math.abs(dw) * vSq) / G + Math.abs(Math.sin(a)));
  }
  return { most, leastInverted, sideways };
}

/** Shortest comfortable corkscrew for entry speed vIn, plus a little seeded variety; null if none works. */
export function designCorkscrew(vIn, maxGs, rand) {
  const radius = FIXED.corkscrewRadius;
  const ok = (len) => {
    const f = corkscrewFeel(len, radius, vIn);
    return f && f.most <= maxGs - PUSH_MARGIN && f.leastInverted >= HOLD_IN && f.sideways <= SIDE_LIMIT;
  };
  for (let len = SHORTEST_CORKSCREW; len <= 140; len += 0.5) {
    if (!ok(len)) continue;
    const roomier = len + 6 * rand();
    return { length: ok(roomier) ? roomier : len, radius };
  }
  return null;
}
