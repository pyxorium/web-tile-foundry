import { smootherstep, plateau } from "./vec.js";
import { corkscrewAngle } from "./elements.js";

// Step 2: lay the pieces out on the ground and close the circuit.
//
// Ground directions are angles in the x-z plane: angle a points along
// (cos a, 0, sin a). Turns bend smoothly: their curvature eases in from zero,
// holds steady and eases out, so there is never a sudden jolt sideways.
//
// Closing the circuit: all turns go the same way and add up to one full
// circle, so the cart ends up facing the way it started. Its position is
// generally off by some gap D. Two flat filler runs fix that exactly: pick the
// two directions the track faces at some point that lie either side of the
// direction needed to close D (there always are two, because no turn is wider
// than 150°), and solve for their lengths. Both come out zero or positive.
// Before that, balanceTurns resizes the turns so the fillers come out short.

const DENSE_STEP = 0.05; // m along the ground between dense samples
const MAX_FILLER = 90; // m; longer than this and the layout is too stretched

/** Direction (angle) of the ground path at fraction u through a turn piece. */
function turnHeading(start, turn, u) {
  return start + turn * plateau(u);
}

/**
 * Ground positions through one piece starting at heading `a`, at the dense
 * sample spacing, relative to where it starts. Returns
 * { n, xs, zs, heading(u), endHeading } (n + 1 positions, the last one being
 * where the next piece starts).
 * A turn's positions are added up in small steps (midpoint rule); a straight's
 * are exact. The same numbers are used for closing the circuit and for the
 * final shape, so the circuit closes exactly.
 */
function walkPiece(piece, a) {
  let n = Math.max(1, Math.ceil(piece.length / DENSE_STEP));
  if (piece.element?.type === "corkscrew") n = Math.max(n, Math.ceil((3 * piece.length) / DENSE_STEP));
  const xs = new Float64Array(n + 1);
  const zs = new Float64Array(n + 1);
  if (piece.kind === "turn") {
    const ds = piece.length / n;
    for (let i = 0; i < n; i++) {
      const th = turnHeading(a, piece.turn, (i + 0.5) / n);
      xs[i + 1] = xs[i] + Math.cos(th) * ds;
      zs[i + 1] = zs[i] + Math.sin(th) * ds;
    }
    return { n, xs, zs, heading: (u) => turnHeading(a, piece.turn, u), endHeading: a + piece.turn };
  }
  const [c, s] = [Math.cos(a), Math.sin(a)];
  if (piece.element?.type === "loop") {
    // Sampled along the loop's own track length; the ground path is its
    // forward travel plus the sideways jog.
    const { xs: fx, jog } = piece.element;
    const m = fx.length - 1;
    const lx = new Float64Array(m + 1);
    const lz = new Float64Array(m + 1);
    for (let i = 0; i <= m; i++) {
      const side = jog * smootherstep(i / m);
      lx[i] = c * fx[i] + s * side;
      lz[i] = s * fx[i] - c * side;
    }
    return { n: m, xs: lx, zs: lz, heading: () => a, endHeading: a };
  }
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    xs[i] = c * piece.length * u;
    zs[i] = s * piece.length * u;
  }
  return { n, xs, zs, heading: () => a, endHeading: a };
}

/** Just where a piece ends (no samples kept): [dx, dz, endHeading]. A quick estimate for turns (Simpson's rule). */
function pieceEnd(piece, a) {
  if (piece.kind === "turn") {
    const n = QUICK_TURN_STEPS;
    let x = 0;
    let z = 0;
    for (let i = 0; i <= n; i++) {
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      const th = turnHeading(a, piece.turn, i / n);
      x += w * Math.cos(th);
      z += w * Math.sin(th);
    }
    const k = piece.length / (3 * n);
    return [x * k, z * k, a + piece.turn];
  }
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const side = piece.element?.type === "loop" ? piece.element.jog : 0;
  return [c * piece.length + s * side, s * piece.length - c * side, a];
}

/**
 * Where each piece starts (ground position and heading), and the closing gap.
 * Normally this matches sampleTrack exactly; `quick` is a close estimate for
 * balancing the turns and checking the footprint.
 */
function walkAll(pieces, quick = false) {
  let x = 0;
  let z = 0;
  let a = 0;
  const starts = [];
  for (const p of pieces) {
    starts.push({ x, z, a });
    const [dx, dz, na] = quick ? pieceEnd(p, a) : endOfWalk(walkPiece(p, a));
    x += dx;
    z += dz;
    a = na;
  }
  return { starts, gap: [x, z], endHeading: a };
}

const endOfWalk = (w) => [w.xs[w.n], w.zs[w.n], w.endHeading];

const TWO_PI = 2 * Math.PI;
const wrap = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/** How much filler closing would need (Infinity if it can't), from a quick walk. */
function fillerNeeded(pieces) {
  const { starts, gap } = walkAll(pieces, true);
  const need = [-gap[0], -gap[1]];
  if (Math.hypot(need[0], need[1]) < 1e-9) return 0;
  const first = pieces.findIndex((p) => p.kind === "crest") + 1;
  const last = pieces.findIndex((p) => p.kind === "brakes");
  const headings = [];
  for (let i = first; i <= last; i++) headings.push(wrap(starts[i].a));
  const pair = bracket(headings, wrap(Math.atan2(need[1], need[0])));
  if (!pair) return Infinity;
  const [lenA, lenB] = solvePair(need, pair[0], pair[1]);
  return lenA < -1e-6 || lenB < -1e-6 ? Infinity : lenA + lenB;
}

const QUICK_TURN_STEPS = 16;

/**
 * A quick estimate of the ground footprint [long side, short side] once the
 * layout is turned to lie along x (as index.js does), from where the pieces
 * start plus the middle of each turn.
 */
export function footprint(pieces) {
  const { starts } = walkAll(pieces, true);
  const pts = [];
  pieces.forEach((p, i) => {
    pts.push([starts[i].x, starts[i].z]);
    if (p.kind === "turn") {
      const half = pieceEnd({ ...p, length: p.length / 2, turn: p.turn * plateau(0.5) }, starts[i].a);
      pts.push([starts[i].x + half[0], starts[i].z + half[1]]);
    }
  });
  const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const mz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let [cxx, czz, cxz] = [0, 0, 0];
  for (const [x, z] of pts) {
    cxx += (x - mx) ** 2;
    czz += (z - mz) ** 2;
    cxz += (x - mx) * (z - mz);
  }
  const ang = -0.5 * Math.atan2(2 * cxz, cxx - czz);
  const [c, sn] = [Math.cos(ang), Math.sin(ang)];
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of pts) {
    const rx = x * c - z * sn;
    const rz = x * sn + z * c;
    [x0, x1, z0, z1] = [Math.min(x0, rx), Math.max(x1, rx), Math.min(z0, rz), Math.max(z1, rz)];
  }
  return [x1 - x0, z1 - z0];
}

/** The two headings either side of `target` (going round the circle), or null. */
function bracket(headings, target) {
  const hs = [...new Set(headings.map((h) => h.toFixed(9)))].map(Number).sort((p, q) => p - q);
  if (hs.length < 2) return null;
  let lo = hs[hs.length - 1];
  let hi = hs[0];
  for (const h of hs) {
    if (h <= target) lo = h;
  }
  for (const h of hs) {
    if (h > target) {
      hi = h;
      break;
    }
  }
  if (lo === hi) return null;
  const gap = wrap(hi - lo);
  return gap < Math.PI - 1e-9 ? [lo, hi] : null;
}

/** Lengths a, b with a·(direction lo) + b·(direction hi) = need. */
function solvePair(need, lo, hi) {
  const ua = [Math.cos(lo), Math.sin(lo)];
  const ub = [Math.cos(hi), Math.sin(hi)];
  const det = ua[0] * ub[1] - ua[1] * ub[0];
  return [(need[0] * ub[1] - need[1] * ub[0]) / det, (ua[0] * need[1] - ua[1] * need[0]) / det];
}

/**
 * Resizes the turns (keeping each turn's tightness, still adding up to one
 * full circle, none wider than the maximum) so the circuit needs as little
 * filler as possible to close. A simple search: nudge one turn's share up or
 * down, keep the change if it helps, take smaller nudges when nothing helps.
 * No randomness, so the same pieces always give the same result.
 */
export function balanceTurns(pieces, maxTurn, ramp) {
  const turns = pieces.map((p, i) => (p.kind === "turn" ? i : -1)).filter((i) => i >= 0);
  if (turns.length < 3) return pieces;
  const sign = Math.sign(pieces[turns[0]].turn);
  const radius = turns.map((i) => (pieces[i].length * (1 - ramp)) / Math.abs(pieces[i].turn));
  const withShares = (shares) => {
    const total = shares.reduce((a, b) => a + b, 0);
    const angles = shares.map((w) => (2 * Math.PI * w) / total);
    if (angles.some((a) => a > maxTurn + 1e-9 || a < 0.2)) return null;
    const out = pieces.slice();
    turns.forEach((i, k) => {
      out[i] = { ...pieces[i], turn: sign * angles[k], length: (angles[k] * radius[k]) / (1 - ramp) };
    });
    return out;
  };
  let shares = turns.map((i) => Math.abs(pieces[i].turn));
  let best = withShares(shares);
  if (!best) return pieces;
  let score = fillerNeeded(best);
  let nudge = 0.25;
  for (let round = 0; round < 40 && nudge > 0.004; round++) {
    let improved = false;
    for (let k = 0; k < shares.length; k++) {
      for (const dir of [1, -1]) {
        const trial = shares.slice();
        trial[k] *= 1 + dir * nudge;
        const candidate = withShares(trial);
        if (!candidate) continue;
        const s = fillerNeeded(candidate);
        if (s < score - 1e-6) {
          [shares, best, score, improved] = [trial, candidate, s, true];
        }
      }
    }
    if (!improved) nudge /= 2;
  }
  return best;
}

/**
 * Inserts the two filler runs that close the circuit. Returns
 * { pieces, filler } (the new piece list and the total filler length), or
 * null if closing would need a run longer than MAX_FILLER.
 */
export function closeCircuit(pieces) {
  const { starts, gap } = walkAll(pieces);
  const need = [-gap[0], -gap[1]];
  const size = Math.hypot(need[0], need[1]);
  if (size < 1e-9) return { pieces, filler: 0 };

  // Places a filler may go: between two pieces after the top of the lift and
  // before the brakes, where the cart is moving fast (a long straight at
  // station speed would waste ride time). Heading there = the next piece's start.
  const first = pieces.findIndex((p) => p.kind === "crest") + 1;
  const last = pieces.findIndex((p) => p.kind === "brakes");
  const spots = [];
  for (let i = first; i <= last; i++) spots.push({ index: i, a: starts[i].a, height: pieces[i - 1].h1 });

  // The pair of headings either side of the direction needed.
  const pair = bracket(spots.map((sp) => wrap(sp.a)), wrap(Math.atan2(need[1], need[0])));
  if (!pair) return null;
  const [lo, hi] = pair;
  const [lenA, lenB] = solvePair(need, lo, hi);
  if (lenA < -1e-6 || lenB < -1e-6 || lenA > MAX_FILLER || lenB > MAX_FILLER) return null;

  // Lowest spot facing each chosen direction (faster there, so less ride time).
  const best = (h) =>
    spots.filter((sp) => Math.abs(wrap(sp.a) - h) < 1e-6 || Math.abs(Math.abs(wrap(sp.a) - h) - TWO_PI) < 1e-6).sort((p, q) => p.height - q.height || p.index - q.index)[0];
  const inserts = [
    { spot: best(lo), length: Math.max(0, lenA) },
    { spot: best(hi), length: Math.max(0, lenB) },
  ].filter((f) => f.length > 1e-6);
  const out = [...pieces];
  // Insert from the back so earlier indices stay valid.
  inserts.sort((p, q) => q.spot.index - p.spot.index);
  for (const f of inserts) {
    const h = f.spot.height;
    out.splice(f.spot.index, 0, { kind: "filler", length: f.length, h0: h, h1: h });
  }
  return { pieces: out, filler: lenA + lenB };
}

/**
 * Dense samples of the whole closed track (the last sample stops just short
 * of the first, which closes the loop):
 *   { points: [[x,y,z]...], ups: [[...] | null ...], piece: [index...] }
 * Loops and corkscrews give their own "up" (toward the loop's middle or the
 * corkscrew's axis); everywhere else up is left null and worked out from the
 * banking later.
 */
export function sampleTrack(pieces) {
  const points = [];
  const ups = [];
  const piece = [];
  let x = 0;
  let z = 0;
  let a = 0;
  pieces.forEach((p, index) => {
    const w = walkPiece(p, a);
    for (let i = 0; i < w.n; i++) {
      const u = i / w.n;
      const y = p.h0 + (p.h1 - p.h0) * smootherstep(u);
      const base = [x + w.xs[i], y, z + w.zs[i]];
      let point = base;
      let up = null;
      const e = p.element;
      if (e?.type === "loop") {
        // The ground position (walkPiece) already includes the loop's forward
        // travel and jog; add its height. Up is tilted back by the loop's
        // angle, so it points to the loop's middle.
        const th = w.heading(u);
        const fwd = [Math.cos(th), 0, Math.sin(th)];
        const ang = e.angles[i];
        point = [base[0], p.h0 + e.ys[i], base[2]];
        up = [-Math.sin(ang) * fwd[0], Math.cos(ang), -Math.sin(ang) * fwd[2]];
      } else if (e?.type === "corkscrew") {
        const th = w.heading(u);
        const side = [Math.sin(th), 0, -Math.cos(th)];
        const ang = corkscrewAngle(u);
        const lateral = e.side * e.radius * Math.sin(ang);
        point = [base[0] + side[0] * lateral, base[1] + e.radius * (1 - Math.cos(ang)), base[2] + side[2] * lateral];
        // Up points at the axis the track winds around.
        const toAxis = [-side[0] * lateral, e.radius * Math.cos(ang), -side[2] * lateral];
        const len = Math.hypot(toAxis[0], toAxis[1], toAxis[2]);
        up = [toAxis[0] / len, toAxis[1] / len, toAxis[2] / len];
      }
      points.push(point);
      ups.push(up);
      piece.push(index);
    }
    x += w.xs[w.n];
    z += w.zs[w.n];
    a = w.endHeading;
  });
  // How far the end misses the start: position, and facing (after a full circle).
  const facing = Math.abs(((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI);
  return { points, ups, piece, closingError: Math.hypot(x, z), closingTurn: facing };
}

export { DENSE_STEP, MAX_FILLER };
export const _internal = { walkAll }; // for tests
