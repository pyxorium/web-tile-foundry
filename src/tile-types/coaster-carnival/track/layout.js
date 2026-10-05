import { FIXED, G } from "./options.js";
import { PLATEAU_RAMP } from "./vec.js";
import { designLoop, designCorkscrew } from "./elements.js";

// Step 1 of making a track: the order and size of its pieces.
//
// A piece is a stretch of track with a straight or turning ground path and a
// height that eases from h0 to h1 (flat, rise or drop). Every piece starts
// and ends level, so pieces can follow each other in any order and flat
// "filler" runs can be slipped in anywhere (that is how the circuit closes,
// see plan.js).
//
//   { kind, length, h0, h1, turn?, element?, slot? }
//
//   kind     station-out, lift, crest, drop, valley, loop, corkscrew, rise,
//            hilltop, turn, return, brakes, station-in, filler
//   length   meters along the ground
//   turn     signed angle in radians (turn pieces only)
//   element  { type: "loop", xs, ys, angles, arc, jog }  or  { type: "corkscrew", radius, side }
//            (a loop's `length` is how far forward it ends up; see elements.js)
//
// Sizes come from the speed the cart is expected to have there (an estimate
// from height and friction). The real speed is worked out afterwards from the
// finished shape, and checks.js throws the layout away if the estimate was off.

// The steepest point of a smootherstep curve is 15/8 of its average slope,
// and its sharpest bend is 10/√3 times (height / length²).
const PEAK_SLOPE = 1.875;
const PEAK_BEND = 10 / Math.sqrt(3);

const GAP_BETWEEN_ELEMENTS = 8; // m of flat between two loops or corkscrews
const HILLTOP_LENGTH = 4;
const RETURN_LENGTH = 14;
const MIN_CREST_SPEED = 6; // m/s over a hilltop
const MIN_HILL = 5; // m, a hill lower than this above the valley isn't worth having
const LIFT_ANGLE = (45 * Math.PI) / 180;
const BANK_AIM = (65 * Math.PI) / 180;
// The turn the track switch sits on (see switch.js) is made this much wider
// than the speed needs, so the thrill route has room to swing out around it
// with turns of its own that are still gentle enough.
const SWITCH_WIDEN = 2;
const SWITCH_MAX_RADIUS = 60; // m

/** Length a height change needs so slope, push into the seat and float all stay in bounds. */
export function easeLength(dh, vLow, vHigh, s) {
  const h = Math.abs(dh);
  if (h < 1e-9) return 0;
  const bySlope = (PEAK_SLOPE * h) / Math.tan(s.maxDropAngle);
  const byPush = Math.sqrt((PEAK_BEND * h * vLow * vLow) / (G * (s.maxGs - 1))); // bend at the bottom
  const byFloat = Math.sqrt((PEAK_BEND * h * vHigh * vHigh) / (G * (1 - s.minAirtimeGs))); // bend at the top
  return Math.max(bySlope, byPush, byFloat);
}

/** Picks a random whole number from lo to hi inclusive. */
const pick = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Plans the pieces for one attempt. Returns { pieces, order }, where `order`
 * lists the drops, loops and corkscrews in riding order. Throws LayoutFail
 * when the cart wouldn't have the speed for what was asked.
 *
 * With `wantSwitch`, the turn nearest the middle of the ride is made wider
 * and marked `forSwitch`: the track switch will sit on it.
 */
export function layoutPieces(counts, s, rand, wantSwitch = false) {
  const { drops, loops, corkscrews } = counts;

  // Which valley each loop and corkscrew sits in. Earlier valleys are
  // favored: the cart is fastest there.
  const tokens = shuffle([...Array(loops).fill("loop"), ...Array(corkscrews).fill("corkscrew")], rand);
  const valleys = Array.from({ length: drops }, () => []);
  for (const t of tokens) valleys[Math.min(drops - 1, Math.floor(Math.pow(rand(), 1.6) * drops))].push(t);

  // Where the turns go. All turn the same way, which keeps the ground path a
  // simple outline that can't cross itself. Turns cost less ride time where the cart is fast (a turn's size grows
  // with speed squared, its time only with speed), so the valleys, hills and
  // the run home come first; the top of the lift only when needed.
  const fast = [];
  for (let k = 0; k < drops; k++) {
    fast.push(`valley-${k}`);
    if (k < drops - 1) fast.push(`hill-${k}`);
  }
  fast.push("before-brakes");
  const turnCount = Math.max(3, pick(rand, 3, Math.min(4, fast.length)));
  const picked = shuffle([...fast], rand).slice(0, turnCount);
  if (picked.length < turnCount) picked.push("after-crest");
  const chosen = new Set(picked);
  // The switch goes on the turn nearest the middle of the ride: the one with
  // closest to half the drops, loops and corkscrews before it. Hilltop turns
  // win ties: the cart is slower there, so the turns are smaller and the
  // thrill route costs less time and room.
  let switchSlot = null;
  if (wantSwitch) {
    const half = (drops + loops + corkscrews) / 2;
    const slots = [["after-crest", 0, 1]];
    let before = 0;
    for (let k = 0; k < drops; k++) {
      before += 1 + valleys[k].length;
      slots.push([`valley-${k}`, before, 0], [`hill-${k}`, before, 1]);
    }
    slots.push(["before-brakes", drops + loops + corkscrews, 0]);
    // Not the top of the lift if there's any other turn (too early, and slow).
    let usable = slots.filter(([slot]) => chosen.has(slot) && slot !== "after-crest");
    if (!usable.length) usable = slots.filter(([slot]) => chosen.has(slot));
    usable.sort((a, b) => Math.abs(a[1] - half) - Math.abs(b[1] - half) || b[2] - a[2]);
    switchSlot = usable[0][0];
  }
  const sign = rand() < 0.5 ? 1 : -1;
  const angles = turnAngles(turnCount, rand);
  let nextTurn = 0;

  const pieces = [];
  const order = [];
  const H0 = FIXED.stationHeight;
  const HV = FIXED.valleyHeight;
  const head0 = s.liftHeight + (FIXED.liftSpeed * FIXED.liftSpeed) / (2 * G);
  let run = 0; // estimated track length since the chain let go, m
  let h = H0;
  const speedAt = (height, extra = 0) => Math.sqrt(Math.max(0, 2 * G * (head0 - FIXED.friction * (run + extra) - height)));

  const push = (piece) => {
    pieces.push(piece);
    if (piece.after) run += piece.after;
  };
  const turnIfChosen = (slot, speed) => {
    if (!chosen.has(slot)) return;
    const angle = sign * angles[nextTurn++];
    // Tightest radius the speed allows: within the push limit, and gentle
    // enough that banking (up to 70°, aiming for 65°) takes all the sideways push.
    const sideways = Math.min(Math.sqrt(s.maxGs * s.maxGs - 1), Math.tan(BANK_AIM));
    const tight = (speed * speed) / (G * sideways);
    const [rMin, rMax] = FIXED.turnRadiusRange;
    const forSwitch = slot === switchSlot;
    const usual = Math.min(rMax, Math.max(rMin, tight * 1.15));
    const radius = forSwitch ? Math.min(SWITCH_MAX_RADIUS, Math.max(rMin, tight * 1.15) * SWITCH_WIDEN) : usual;
    const length = (Math.abs(angle) * radius) / (1 - PLATEAU_RAMP); // turning eases in, holds, eases out
    push({ kind: "turn", length, h0: h, h1: h, turn: angle, slot, after: length, ...(forSwitch ? { forSwitch } : {}) });
  };
  const ease = (kind, to, vLow, vHigh) => {
    const length = Math.max(4, easeLength(to - h, vLow, vHigh, s));
    const piece = { kind, length, h0: h, h1: to };
    piece.after = Math.hypot(length, to - h) * 1.04;
    h = to;
    push(piece);
    return piece;
  };

  // Station, chain lift, crest.
  push({ kind: "station-out", length: FIXED.stationLength / 2, h0: H0, h1: H0 });
  const liftLength = (PEAK_SLOPE * (s.liftHeight - H0)) / Math.tan(LIFT_ANGLE);
  push({ kind: "lift", length: liftLength, h0: H0, h1: s.liftHeight });
  h = s.liftHeight;
  push({ kind: "crest", length: FIXED.crestLength, h0: h, h1: h, after: FIXED.crestLength });
  turnIfChosen("after-crest", FIXED.liftSpeed);

  let lastTop = s.liftHeight;
  for (let k = 0; k < drops; k++) {
    // Drop into the valley.
    const vTop = speedAt(h);
    const vBottom = speedAt(HV, Math.hypot(h - HV, 2 * (h - HV)));
    ease("drop", HV, vBottom, vTop);
    order.push("drop");

    // Loops and corkscrews on the valley floor.
    valleys[k].forEach((type, i) => {
      if (i > 0) push({ kind: "valley", length: GAP_BETWEEN_ELEMENTS, h0: HV, h1: HV, after: GAP_BETWEEN_ELEMENTS });
      const vIn = speedAt(HV);
      if (type === "loop") {
        // A firmer loop is smaller and faster over the top; try the seeded
        // choice first, then the firmest allowed.
        const top = 0.7 + 0.3 * rand();
        const easeIn = 8 + 6 * rand();
        const loop =
          designLoop(vIn, { peak: s.maxGs - 0.45 - 0.3 * rand(), top, ease: easeIn }) ??
          designLoop(vIn, { peak: s.maxGs - 0.45, top, ease: easeIn });
        if (!loop) throw new LayoutFail("not enough speed for a loop");
        const jog = sign * FIXED.loopJog; // sideways, toward the outside of the circuit
        push({ kind: "loop", length: loop.forward, h0: HV, h1: HV, element: { type: "loop", ...loop, jog }, after: loop.arc });
      } else {
        const cork = designCorkscrew(vIn, s.maxGs, rand);
        if (!cork) throw new LayoutFail("not enough speed for a corkscrew");
        const side = rand() < 0.5 ? 1 : -1;
        const turnsPerMeter = (2 * Math.PI) / cork.length;
        push({
          kind: "corkscrew",
          length: cork.length,
          h0: HV,
          h1: HV,
          element: { type: "corkscrew", radius: cork.radius, side },
          after: cork.length * Math.hypot(1, cork.radius * turnsPerMeter),
        });
      }
      order.push(type);
    });
    turnIfChosen(`valley-${k}`, speedAt(HV));

    if (k === drops - 1) break;

    // Climb the next hill, lower than the last, leaving enough speed for its top.
    const room = Math.min(head0 - FIXED.friction * (run + 40) - (MIN_CREST_SPEED * MIN_CREST_SPEED) / (2 * G) - 0.5, lastTop - 2);
    const share = s.hillShare[0] + (s.hillShare[1] - s.hillShare[0]) * rand();
    const top = HV + share * (room - HV);
    if (top - HV < MIN_HILL) throw new LayoutFail("not enough speed for another hill");
    const vLow = speedAt(HV);
    const vHigh = speedAt(top, Math.hypot(top - HV, 2 * (top - HV)));
    ease("rise", top, vLow, vHigh);
    lastTop = top;
    push({ kind: "hilltop", length: HILLTOP_LENGTH, h0: top, h1: top, after: HILLTOP_LENGTH });
    turnIfChosen(`hill-${k}`, speedAt(top));
  }

  // Home: ease down to station height, brake, roll into the station.
  const vHome = speedAt(HV);
  const ret = ease("return", H0, vHome, vHome);
  ret.length = Math.max(ret.length, RETURN_LENGTH);
  turnIfChosen("before-brakes", speedAt(H0));
  pieces.push({ kind: "brakes", length: FIXED.brakeLength, h0: H0, h1: H0 });
  pieces.push({ kind: "station-in", length: FIXED.stationLength / 2, h0: H0, h1: H0 });

  for (const p of pieces) delete p.after;
  return { pieces, order };
}

export class LayoutFail extends Error {}

/** Turn sizes that add up to one full circle, none larger than the maximum. */
function turnAngles(count, rand) {
  const weights = Array.from({ length: count }, () => 0.6 + 0.8 * rand());
  const total = weights.reduce((a, b) => a + b, 0);
  let angles = weights.map((w) => (2 * Math.PI * w) / total);
  // Cap any that are too big and share the excess among the others.
  for (let pass = 0; pass < count; pass++) {
    const over = angles.filter((a) => a > FIXED.maxTurnAngle);
    if (!over.length) break;
    const excess = over.reduce((sum, a) => sum + a - FIXED.maxTurnAngle, 0);
    const under = angles.filter((a) => a < FIXED.maxTurnAngle).length;
    angles = angles.map((a) => (a > FIXED.maxTurnAngle ? FIXED.maxTurnAngle : a + excess / under));
  }
  return angles;
}
