import { FIXED, G } from "./options.js";
import { PLATEAU_RAMP, smootherstep } from "./vec.js";
import { walkPiece } from "./plan.js";
import { easeLength } from "./layout.js";

// The track switch: one place in the middle of the ride where the viewer
// picks which way to go (version 1 has one switch; the creator can turn it
// off). The two ways are "Chill" and "Thrill", and they have to feel
// different, so the names are true on every ride:
//
//   Chill   the ride's own turn (the one nearest the middle of the ride, which
//           layout.js makes extra wide for it): one smooth banked curve. Also
//           the way the cart goes when no choice is made.
//   Thrill  leaves where the turn starts and swings wide, away from the middle
//           of the circuit where there is open ground, then comes back onto
//           the main line exactly where the turn ends, facing the same way.
//           On the way it dives toward the ground and sweeps round low and
//           fast (or, when the switch is low, climbs and sweeps round high and
//           slow). It is 4 to 7
//           played seconds longer (FIXED.switchExtra), aiming for 7.
//
//                  thrill
//             .--.
//           /                  \
//   ───────'   chill (the ride's  `
//               own turn)         |
//
// On the ground the thrill route is three turns and two straights: a turn
// outward, a straight, a wider turn back the other way, a straight, and a
// turn outward again to line up. That shape is its own mirror image across
// the middle of the turn (as the turn is), which is what makes it land
// exactly on the turn's end: only the length of the straights has to be
// worked out. Bigger swings and wider middle turns make it longer (past a
// half circle, the middle turn makes it a long loop out and back). Its
// height (design.profile) dives (or climbs) over the first turn and
// straight, stays down there (or up there) round the middle turn, which is
// sized for the speed the cart has there, and comes back over the rest.

// A thrill route fits best around a turn of about 60° to 100°. If the switch's
// turn ends up wider than SPLIT_ABOVE, splitTurnForSwitch() makes it two
// turns, each half as wide, one after the other, and the switch goes on the
// first.
//
// thrillRoutes() designs several thrill routes for one turn, best first (the
// closest to 7 seconds longer, by estimate). index.js builds them in turn and
// keeps the first that passes every check and really is 4 to 7 seconds longer.

const SPLIT_ABOVE = (105 * Math.PI) / 180;
const SWINGS = [65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10].map((d) => (d * Math.PI) / 180);
const WIDER = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]; // the middle turn, this many times as wide as the speed needs
// The middle turn may be wider than the ride's own turns (no circuit to close here).
const MAX_BACK_TURN = (210 * Math.PI) / 180;
const BANK_AIM = (65 * Math.PI) / 180;
// The short turns out and back in roll the rider into their banking over a
// short distance; they are made long enough that the roll stays gentle.
const MAX_ROLL_RATE = 7; // degrees of banking per meter
const MIN_OUT_TURN = 20; // m
const DIP_ABOVE = 8; // m: a switch higher than this above the valley floor gets dips; lower, hills
const MAX_DIP = 18; // m
const MAX_HILL = 10; // m
const MIN_FEATURE = 4; // m: shallower than this isn't worth calling a dip (or hill)
const MIN_CREST_SPEED = 7; // m/s over the top of a hill
const MAX_RADIUS = 80; // m, the widest middle turn

/**
 * turn: the turn piece (with its final angle and length). speed: the cart's
 * speed there (m/s). s: intensity settings.
 * Returns a list of { pieces, length, extra, feature, depth } (pieces kind
 * "thrill"; feature "dip" or "hill"; depth in meters; extra = estimated
 * extra played seconds), best first; empty if the turn leaves no room.
 */
export function thrillRoutes(turn, speed, s) {
  const phi = Math.abs(turn.turn);
  const sign = Math.sign(turn.turn); // which way the circuit turns
  const h = turn.h0;
  const sideways = Math.min(Math.sqrt(s.maxGs * s.maxGs - 1), Math.tan(BANK_AIM));
  const [rMin] = FIXED.turnRadiusRange;
  const tight = (v) => Math.max(rMin, ((v * v) / (G * sideways)) * 1.15);
  const turnLength = (a, r) => (a * r) / (1 - PLATEAU_RAMP);
  /** Radius for a turn of angle a: wide enough to roll in gently, and at least MIN_OUT_TURN long. */
  const gentle = (a) => {
    let r = Math.max(tight(speed), (MIN_OUT_TURN * (1 - PLATEAU_RAMP)) / a);
    const rate = (rr) => ((Math.atan((speed * speed) / (G * rr)) * 180) / Math.PI) / (turnLength(a, rr) * PLATEAU_RAMP);
    while (rate(r) > MAX_ROLL_RATE && r < 300) r *= 1.05;
    return r;
  };

  // A dive down toward the ground (from a high switch), or a climb up (from a
  // low one), with the middle turn taken down there (or up there).
  const above = h - FIXED.valleyHeight;
  const feature = above >= DIP_ABOVE ? "dip" : "hill";
  const deepest = feature === "dip" ? Math.min(MAX_DIP, above) : Math.min(MAX_HILL, (speed * speed - MIN_CREST_SPEED ** 2) / (2 * G));
  if (deepest < MIN_FEATURE) return [];
  const depths = [...new Set([1, 0.8, 0.6, 0.45, 0.3].map((k) => Math.round(deepest * k)))].filter((d) => d >= MIN_FEATURE);

  const [fewest, most] = FIXED.switchExtra;

  // Where the turn being replaced ends, from its start (heading 0).
  const end = walkPiece(turn, 0);
  const reach = Math.hypot(end.xs[end.n], end.zs[end.n]);
  const chord = [end.xs[end.n] / reach, end.zs[end.n] / reach];

  const found = [];
  for (const depth of depths) {
    const level = feature === "dip" ? h - depth : h + depth;
    const vThere = Math.sqrt(Math.max(MIN_CREST_SPEED ** 2, speed * speed + 2 * G * (h - level)));
    // Ground length the dive (or climb) needs, within the intensity's limits.
    const slope = Math.max(4, feature === "dip" ? easeLength(depth, vThere, speed, s) : easeLength(depth, speed, vThere, s));
    // Meters per played second: the cart spends about 70% of the route down
    // there (or up there).
    const perSecond = FIXED.playbackSpeed / (0.3 / speed + 0.7 / vThere);
    for (const swing of SWINGS) {
      if (phi + 2 * swing > MAX_BACK_TURN) continue;
      const out = { kind: "thrill", length: turnLength(swing, gentle(swing)), h0: h, h1: h, turn: -sign * swing };
      for (const wider of WIDER) {
        const backRadius = Math.min(MAX_RADIUS, tight(vThere) * wider);
        const back = { kind: "thrill", length: turnLength(phi + 2 * swing, backRadius), h0: h, h1: h, turn: sign * (phi + 2 * swing) };
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
        const dirA = -sign * swing;
        const dirB = sign * (phi + swing);
        const along = (Math.cos(dirA) + Math.cos(dirB)) * chord[0] + (Math.sin(dirA) + Math.sin(dirB)) * chord[1];
        if (Math.abs(along) < 0.05) continue; // middle turn too close to a half circle
        const straight = (reach - (x * chord[0] + z * chord[1])) / along;
        if (straight < 0 || out.length + straight < slope) continue; // no room to dive (or climb) before the middle turn
        const pieces = [out, { kind: "thrill", length: straight, h0: h, h1: h }, back, { kind: "thrill", length: straight, h0: h, h1: h }, { ...out }];
        const length = pieces.reduce((sum, p) => sum + p.length, 0);
        const extra = (length - turn.length) / perSecond;
        if (extra < fewest * 0.6 || extra > most * 1.5) continue; // estimates: index.js measures exactly
        // Dive over the first turn and straight, level round the middle turn, climb back over the rest.
        const profile = { from: h, to: level, over: out.length + straight, length };
        found.push({ pieces, length, extra, feature, depth, profile });
      }
    }
  }
  // Closest to the most extra time first; deeper dips (taller hills) win ties.
  return found.sort((p, q) => Math.abs(p.extra - most) - Math.abs(q.extra - most) || q.depth - p.depth || p.length - q.length);
}

/**
 * The thrill route's height `d` meters along it (on the ground): easing from
 * the switch's height to the dip's (or hill's) over the first `over` meters,
 * level through the middle turn, and easing back over the last `over`.
 */
export function profileHeight(profile, d) {
  const { from, to, over, length } = profile;
  const u = Math.max(0, Math.min(1, Math.min(d, length - d) / over));
  return from + (to - from) * smootherstep(u);
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

