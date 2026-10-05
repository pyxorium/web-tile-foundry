import { FIXED, G } from "./options.js";
import { PLATEAU_RAMP } from "./vec.js";
import { walkPiece } from "./plan.js";

// The track switch: one place in the middle of the ride where the viewer can
// pick a second route (version 1 has one switch; the creator can turn it off).
//
// The switch sits at the start of one of the ride's turns (the one nearest
// the middle of the ride, which layout.js makes extra wide for it). The turn
// itself is the woods route, the default when no choice is made. The water
// route leaves at the same point and swings wide, away from the middle of the
// circuit where there is open ground, then comes back onto the main line
// exactly where the turn ends, facing the same way:
//
//                water route
//             .-''''''''''''-.
//           /                  \
//   ───────'  woods route (the  `
//            ride's own turn)    |
//                                |
//
// It is three turns and two straights: a turn outward, a straight, a wider
// turn back the other way, a straight, and a turn outward again to line up.
// That shape is its own mirror image across the middle of the turn it
// replaces (as the turn is), which is what makes it land exactly on the
// turn's end: only the length of the straights has to be worked out.
//
// A water route fits best around a turn of about 60° to 100°. If the switch's
// turn ends up wider than SPLIT_ABOVE, splitTurnForSwitch() makes it two
// turns, each half as wide, one after the other, and the switch goes on the
// first.
//
// detourOnTurn() designs the water route for one turn piece, or gives null
// when the turn leaves no room to swing out with gentle enough turns.

const SPLIT_ABOVE = (105 * Math.PI) / 180;
const MIN_SWING = (10 * Math.PI) / 180;
const MAX_SWING = (40 * Math.PI) / 180;
// The water route's middle turn may be wider than the ride's own turns (no
// circuit to close here): up to this much.
const MAX_BACK_TURN = (210 * Math.PI) / 180;
const SWING_STEP = (5 * Math.PI) / 180;
const BANK_AIM = (65 * Math.PI) / 180;
// The short turns out and back in roll the rider into their banking over a
// short distance; they are made wide enough that the roll stays gentle.
const MAX_ROLL_RATE = 9; // degrees of banking per meter
const MAX_EXTRA = 70; // m: the water route is at most this much longer than the turn (about 3 to 4 s)

/**
 * turn: the turn piece (with its final angle and length). speed: the cart's
 * speed there (m/s). s: intensity settings. rand: the switch's own random
 * source (separate from the layout's, so the main ride never changes).
 * Returns { pieces, length, swing, radius } (pieces at the turn's height,
 * kind "water"), or null.
 */
export function detourOnTurn(turn, speed, s, rand) {
  const phi = Math.abs(turn.turn);
  const sign = Math.sign(turn.turn); // which way the circuit turns
  const roomToSwing = Math.min(MAX_SWING, (MAX_BACK_TURN - phi) / 2);
  if (roomToSwing < MIN_SWING) return null;

  // Turns sized for the speed, so banking takes the sideways push (as layout.js does).
  const sideways = Math.min(Math.sqrt(s.maxGs * s.maxGs - 1), Math.tan(BANK_AIM));
  const [rMin, rMax] = FIXED.turnRadiusRange;
  const radius = Math.min(rMax, Math.max(rMin, ((speed * speed) / (G * sideways)) * 1.15));
  const turnLength = (a, r = radius) => (a * r) / (1 - PLATEAU_RAMP);
  /** Smallest radius (from `radius` up) at which a turn of angle a rolls in gently enough. */
  const gentle = (a) => {
    let r = radius;
    const rate = (rr) => ((Math.atan((speed * speed) / (G * rr)) * 180) / Math.PI) / (turnLength(a, rr) * PLATEAU_RAMP);
    while (rate(r) > MAX_ROLL_RATE && r < 200) r *= 1.05;
    return r;
  };

  // Where the turn being replaced ends, from its start (heading 0).
  const end = walkPiece(turn, 0);
  const reach = Math.hypot(end.xs[end.n], end.zs[end.n]);
  const h = turn.h0;
  const curve = (a, r) => ({ kind: "water", length: turnLength(Math.abs(a), r), h0: h, h1: h, turn: a });

  // Try a wide swing first, then narrower ones, until the straights come out
  // zero or longer (a swing too wide for the space would need them negative).
  const first = Math.min(roomToSwing, ((25 + 15 * rand()) * Math.PI) / 180);
  for (let swing = first; swing >= MIN_SWING - 1e-9; swing -= SWING_STEP) {
    const out = curve(-sign * swing, gentle(swing));
    const back = curve(sign * (phi + 2 * swing), radius);
    // The three turns end to end (straights don't change the heading).
    let x = 0;
    let z = 0;
    let a = 0;
    for (const p of [out, back, out]) {
      const w = walkPiece(p, a);
      x += w.xs[w.n];
      z += w.zs[w.n];
      a = w.endHeading;
    }
    // Everything lines up along the turn's chord (the mirror image again):
    // the turns get part of the way, and the two straights between them,
    // added together, point along the chord too (backward, if the middle
    // turn is wider than a half circle). So their length is one division.
    const chord = [end.xs[end.n] / reach, end.zs[end.n] / reach];
    const dirA = -sign * swing;
    const dirB = sign * (phi + swing);
    const along = (Math.cos(dirA) + Math.cos(dirB)) * chord[0] + (Math.sin(dirA) + Math.sin(dirB)) * chord[1];
    if (Math.abs(along) < 0.05) continue; // middle turn too close to a half circle: no straight would help
    const straight = (reach - (x * chord[0] + z * chord[1])) / along;
    if (straight < 0) continue;
    const line = () => ({ kind: "water", length: straight, h0: h, h1: h });
    const pieces = straight > 1e-6 ? [out, line(), back, line(), { ...out }] : [out, back, { ...out }];
    const length = pieces.reduce((sum, p) => sum + p.length, 0);
    if (length > turn.length + MAX_EXTRA) continue; // a narrower swing is shorter
    return { pieces, length, swing, radius };
  }
  return null;
}

/** Splits the turn marked forSwitch in two if it is wider than SPLIT_ABOVE. Returns a new piece list. */
export function splitTurnForSwitch(pieces) {
  const i = pieces.findIndex((p) => p.forSwitch);
  if (i < 0 || Math.abs(pieces[i].turn) <= SPLIT_ABOVE) return pieces;
  const p = pieces[i];
  const half = { ...p, turn: p.turn / 2, length: p.length / 2 };
  const { forSwitch, ...second } = half;
  return [...pieces.slice(0, i), half, second, ...pieces.slice(i + 1)];
}
