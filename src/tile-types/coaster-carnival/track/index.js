import { seededRandom, randomSeed } from "../../glass-lantern/geometry/gem.js";
import { fingerprintOf } from "../../glass-lantern/geometry/polyhedron.js";
import { checkTrackInput, intensitySettings, FIXED, GENERATOR_VERSION, RANGES } from "./options.js";
import { layoutPieces, LayoutFail } from "./layout.js";
import { balanceTurns, closeCircuit, sampleTrack, footprint, walkAll, walkPiece } from "./plan.js";
import { resample, shapeAt, speeds, upVectors, feltForces } from "./ride.js";
import { checkSmooth, checkClearance, checkBetween, checkBox, checkClosed, checkSpeed, checkForces, boundsOf } from "./checks.js";
import { detourOnTurn, splitTurnForSwitch } from "./switch.js";
import { roundMm, round3, PLATEAU_RAMP } from "./vec.js";

// Coaster Carnival's track generator: slider values and a seed in, a whole
// ride out. Pure maths, no drawing; runs the same in Node and the browser.
//
//   generateTrack({ drops, loops, corkscrews, intensity, seed, trackSwitch?, version? })
//
// Same input → same track, every time (locked by fingerprints in the tests).
// Like Glass Lantern's gems, the Foundry will run this once and store the
// finished points in the tile, so a tile never depends on a browser's
// floating-point details.
//
// How it works:
//   1. layout.js   the order and size of the pieces
//   2. plan.js     lay them on the ground, size the turns so the circuit closes
//                  compactly, close it exactly, sample the 3D shape
//   3. ride.js     even spacing, banking, speed, timing, felt forces
//   4. checks.js   smooth, clear of itself, inside the box, closed, fast enough,
//                  comfortable
// A layout that fails a check is thrown away and the next one is drawn from
// the same seeded sequence. If the ride would run longer than the time cap,
// the last piece in riding order is left out and the track made again; the
// same happens when the cart can't have the speed or room for everything
// asked. The result says what was left out, so the panel can tell the creator.
//
// With trackSwitch, the middle turn is laid out extra wide, and the finished
// ride gets a second route (switch.js): the water route, swinging out around
// that turn (or, failing that, another turn: low ones first, then nearest the
// middle). The main ride is the woods route, taken when no choice is made. The water route is checked as a whole
// ride of its own, must stay clear of the main line, and may run up to
// FIXED.switchExtraTime past the time cap. If no turn of a ride has room for
// it, the next layouts are tried; if none does, the first ride is kept
// without a switch and the result says the switch was left out.

const MAX_ATTEMPTS = 30;
const LAYOUT_CHOICES = 6; // layouts drawn per attempt; the most compact one is kept
const GIVE_UP_AFTER = 3; // attempts in a row that failed for a reason more tries won't fix
const TWO_PI = 2 * Math.PI;
const SWITCH_SALT = 0x5317c4; // the switch's own random sequence, apart from the layout's
const SWITCH_DESIGNS = 2; // water routes tried per turn
const SHARED = 25; // m at either end where the two routes share the track
const LOW_TURN = 6; // m: turns this low are tried first (the water route stays near the ground)

export { GENERATOR_VERSION, RANGES, FIXED, randomSeed };

function attempt(counts, s, rand, wantSwitch = false) {
  // Draw a few layouts and keep the one that needs the least extra straight
  // track to close the circuit (tighter layouts, less waiting).
  let best = null;
  let fail = "could not close the circuit compactly";
  for (let k = 0; k < LAYOUT_CHOICES; k++) {
    let layout;
    try {
      layout = layoutPieces(counts, s, rand, wantSwitch);
    } catch (e) {
      if (e instanceof LayoutFail) {
        fail = e.message;
        continue;
      }
      throw e;
    }
    const balanced = balanceTurns(layout.pieces, FIXED.maxTurnAngle, PLATEAU_RAMP);
    const closed = closeCircuit(wantSwitch ? splitTurnForSwitch(balanced) : balanced);
    if (!closed) continue;
    // A quick look at the footprint first: no point building one that can't fit.
    const [long, short] = footprint(closed.pieces);
    if (long > FIXED.box.width * 0.97 || short > FIXED.box.depth * 0.97) {
      fail = "too wide";
      continue;
    }
    if (!best || closed.filler < best.filler) best = { ...closed, order: layout.order };
  }
  if (!best) return { fail, hopeless: true }; // no speed for it, or it won't close compactly
  const { pieces, order } = best;
  const raw = sampleTrack(pieces);
  const { dense, move } = orient(raw);
  const closed = checkClosed(dense);
  if (closed.length) return { fail: closed[0] };

  const main = rideOf(dense, pieces, s);
  const problems = main.problems;
  if (problems.length) return { fail: problems[0], hopeless: problems[0].startsWith("too wide") || problems[0].startsWith("too deep") };
  return { ...main, pieces, order, raw, move };
}

/** Even spacing, speed, banking and forces for one whole route, and its checks. */
function rideOf(dense, pieces, s) {
  const track = resample(dense, FIXED.sampleStep);
  const kinds = track.piece.map((i) => pieces[i].kind);
  const elements = track.piece.map((i) => Boolean(pieces[i].element));
  const { tangents, bends } = shapeAt(track);
  const ride = speeds(track, kinds);
  const mayLean = track.piece.map((i) => pieces[i].element?.type === "loop");
  const ups = upVectors(track, tangents, bends, ride.v, mayLean);
  const felt = feltForces(tangents, bends, ups, ride.v);

  const problems = [
    ...checkBox(track.points),
    ...checkSmooth(track, tangents, ups),
    ...checkSpeed(ride.v, kinds),
    ...checkForces(felt, ups, kinds, elements, s),
  ];
  if (!problems.length) problems.push(...checkClearance(track, tangents, ups)); // the slow one, last
  return { track, kinds, ups, ride, felt, tangents, problems };
}

/**
 * Tries to give a finished ride its water route. Turns are tried low ones
 * first, then nearest the middle of the ride. Returns
 * { turn, water, allPieces, design } or null.
 */
function addSwitch(r, s, rand, timeCap) {
  const { pieces, track, ride } = r;
  const first = pieces.findIndex((p) => p.kind === "crest");
  const last = pieces.findIndex((p) => p.kind === "brakes");
  const middle = ride.duration / 2;
  const candidates = [];
  pieces.forEach((p, i) => {
    if (p.kind !== "turn" || i <= first || i >= last) return;
    const at = track.piece.indexOf(i);
    if (at < 0) return;
    candidates.push({ i, at, wide: Boolean(p.forSwitch), low: p.h0 <= LOW_TURN, away: Math.abs(ride.t[at] - middle) });
  });
  candidates.sort((a, b) => b.wide - a.wide || b.low - a.low || a.away - b.away || a.i - b.i);
  const { starts } = walkAll(pieces);
  for (const c of candidates) {
    for (let k = 0; k < SWITCH_DESIGNS; k++) {
      const design = detourOnTurn(pieces[c.i], ride.v[c.at], s, rand);
      if (!design) break; // no room to swing out on this turn
      const dense = waterDense(r.raw, pieces, c.i, design.pieces, starts);
      if (!dense) continue;
      const allPieces = [...pieces, ...design.pieces];
      const water = rideOf(r.move(dense), allPieces, s);
      if (!water.problems.length) water.problems.push(...betweenRoutes(r, water, c.i));
      if (water.problems.length) continue;
      if (water.ride.duration / FIXED.playbackSpeed > timeCap + FIXED.switchExtraTime) continue;
      return { turn: c.i, water, allPieces, design };
    }
  }
  return null;
}

/**
 * The water route as dense samples (before turning and centering): the main
 * line up to the chosen turn, the detour, then the main line again from where
 * the turn ended. Null if the detour doesn't land exactly there.
 */
function waterDense(raw, pieces, turnIndex, detour, starts) {
  const points = [];
  const ups = [];
  const piece = [];
  const keep = (k) => {
    points.push(raw.points[k]);
    ups.push(raw.ups[k]);
    piece.push(raw.piece[k]);
  };
  let k = 0;
  while (raw.piece[k] < turnIndex) keep(k++);
  let { x, z, a } = starts[turnIndex];
  detour.forEach((p, j) => {
    const w = walkPiece(p, a);
    for (let i = 0; i < w.n; i++) {
      points.push([x + w.xs[i], p.h0, z + w.zs[i]]);
      ups.push(null);
      piece.push(pieces.length + j);
    }
    x += w.xs[w.n];
    z += w.zs[w.n];
    a = w.endHeading;
  });
  const end = starts[turnIndex + 1];
  const miss = Math.hypot(x - end.x, z - end.z);
  const facing = Math.abs(Math.atan2(Math.sin(a - end.a), Math.cos(a - end.a)));
  if (miss > 1e-6 || facing > 1e-9) return null;
  while (raw.piece[k] === turnIndex) k++;
  while (k < raw.points.length) keep(k++);
  return { points, ups, piece, closingError: raw.closingError, closingTurn: raw.closingTurn };
}

/**
 * The two routes must stay clear of each other where they run side by side
 * (the water route against the turn it replaces), except at either end,
 * where they share the track.
 */
function betweenRoutes(main, water, turnIndex) {
  const woods = [];
  main.track.piece.forEach((p, i) => p === turnIndex && woods.push(i));
  const detour = [];
  water.kinds.forEach((kind, i) => kind === "water" && detour.push(i));
  const ends = (count, k, spacing) => ({ start: k * spacing < SHARED, end: (count - 1 - k) * spacing < SHARED });
  const pairs = [];
  woods.forEach((i, a) => {
    const ea = ends(woods.length, a, main.track.spacing);
    detour.forEach((j, b) => {
      const eb = ends(detour.length, b, water.track.spacing);
      if (!((ea.start && eb.start) || (ea.end && eb.end))) pairs.push([i, j]);
    });
  });
  return checkBetween(main, water, pairs);
}

/**
 * Turns the layout so its long side runs along x, centers it, and puts the
 * station at the front (+z). Returns the result and `move`, which turns and
 * moves other samples (the water route) the same way.
 */
function orient(dense) {
  const pts = dense.points;
  let mx = 0;
  let mz = 0;
  for (const p of pts) {
    mx += p[0];
    mz += p[2];
  }
  mx /= pts.length;
  mz /= pts.length;
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const p of pts) {
    const dx = p[0] - mx;
    const dz = p[2] - mz;
    cxx += dx * dx;
    czz += dz * dz;
    cxz += dx * dz;
  }
  let angle = -0.5 * Math.atan2(2 * cxz, cxx - czz);
  const turn = (a) => {
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return (p) => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  };
  let rot = turn(angle);
  let points = pts.map(rot);
  let b = boundsOf(points);
  // Station at the front.
  const station = points[0];
  if (station[2] < (b.min[2] + b.max[2]) / 2) {
    angle += Math.PI;
    rot = turn(angle);
    points = pts.map(rot);
    b = boundsOf(points);
  }
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const turnedBy = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  const move = (d) => ({
    ...d,
    points: d.points.map((p) => {
      const q = rot(p);
      return [q[0] - cx, q[1], q[2] - cz];
    }),
    ups: d.ups.map((u) => (u ? rot(u) : null)),
    turnedBy,
  });
  return { dense: move(dense), move };
}

/** Takes one piece away after a failed or too-long ride. Null if nothing is left to take. */
function leaveOne(counts, order, seed) {
  const next = { ...counts };
  if (order) {
    // The last piece in riding order (never the only drop).
    for (let i = order.length - 1; i >= 0; i--) {
      const kind = order[i];
      const key = kind === "drop" ? "drops" : kind === "loop" ? "loops" : "corkscrews";
      if (key === "drops" && next.drops <= 1) continue;
      next[key] -= 1;
      return next;
    }
    return null;
  }
  // No ride to go by: take from whichever there is most of. Ties between
  // loops and corkscrews go one way or the other by the seed, so neither
  // always loses; drops go last.
  const elements = seed % 2 ? ["loops", "corkscrews"] : ["corkscrews", "loops"];
  const options = [
    [elements[0], next[elements[0]], 0],
    [elements[1], next[elements[1]], 1],
    ["drops", next.drops - 1, 2],
  ].filter(([, n]) => n > 0);
  if (!options.length) return null;
  options.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  next[options[0][0]] -= 1;
  return next;
}

/**
 * `options.timeCap` (played seconds) is for the ride lab and tests: it
 * replaces the standard cap. Tiles always use the standard one.
 */
export function generateTrack(input, options = {}) {
  const checked = checkTrackInput(input);
  const timeCap = options.timeCap ?? FIXED.timeCap;
  const s = intensitySettings(checked.intensity);
  let counts = { drops: checked.drops, loops: checked.loops, corkscrews: checked.corkscrews };
  const notes = [];

  for (;;) {
    const rand = seededRandom(checked.seed);
    const switchRand = seededRandom((checked.seed ^ SWITCH_SALT) >>> 0);
    let found = null;
    let lastFail = null;
    let hopeless = 0;
    let i = 0;
    for (; i < MAX_ATTEMPTS && !found; i++) {
      const r = attempt(counts, s, rand, checked.trackSwitch);
      if (r.fail) lastFail = r.fail;
      else found = r;
      hopeless = r.hopeless ? hopeless + 1 : 0;
      if (hopeless >= GIVE_UP_AFTER) break; // too much asked for at this intensity: leave a piece out
    }
    const fits = (r) => r.ride.duration / FIXED.playbackSpeed <= timeCap;
    if (found && fits(found) && checked.trackSwitch) {
      // Give it a water route; if it has no room for one, look a little
      // further for a ride that does, else keep this one without a switch.
      let withSwitch = { ...found, trackSwitch: addSwitch(found, s, switchRand, timeCap) };
      for (; !withSwitch.trackSwitch && i < MAX_ATTEMPTS; i++) {
        const r = attempt(counts, s, rand, true);
        if (r.fail || !fits(r)) continue;
        const sw = addSwitch(r, s, switchRand, timeCap);
        if (sw) withSwitch = { ...r, trackSwitch: sw };
      }
      if (withSwitch.trackSwitch) return finish(checked, counts, withSwitch, notes);
      return finish(checked, counts, found, [...notes, "switch left out: no turn had room for the water route"]);
    }
    if (found && fits(found)) return finish(checked, counts, found, notes);
    const reason = found ? "ride too long" : lastFail;
    const next = leaveOne(counts, found?.order, checked.seed);
    if (!next) {
      if (found) return finish(checked, counts, found, [...notes, "longer than the time cap"]);
      throw new Error(`Could not make a track from ${JSON.stringify(checked)} (${lastFail}).`);
    }
    notes.push(reason);
    counts = next;
  }
}

const play = FIXED.playbackSpeed;
const playTime = (t) => Math.round((t / play) * 1000) / 1000;

/** One route's stored arrays: points, ups, speeds, times and pieces (rounded). */
function routeData(track, pieces, ups, ride) {
  const runs = [];
  track.piece.forEach((pi, i) => {
    const last = runs[runs.length - 1];
    if (last && last.index === pi) last.to = i;
    else runs.push({ index: pi, kind: pieces[pi].kind, from: i, to: i });
  });
  // The water route's pieces read as one stretch.
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.kind === "water" && run.kind === "water") last.to = run.to;
    else merged.push({ ...run });
  }
  return {
    length: roundMm(track.length),
    spacing: track.spacing,
    duration: playTime(ride.duration),
    realDuration: Math.round(ride.duration * 1000) / 1000,
    points: track.points.map(round3),
    ups: ups.map((u) => u.map((x) => Math.round(x * 1e4) / 1e4)),
    speed: Array.from(ride.v, (x) => Math.round(x * 1000) / 1000),
    time: Array.from(ride.t, playTime),
    pieces: merged.map(({ kind, from, to }) => ({
      kind,
      from,
      to,
      start: playTime(ride.t[from]),
      end: playTime(to + 1 < ride.t.length ? ride.t[to + 1] : ride.duration),
    })),
  };
}

function finish(input, counts, r, notes) {
  const { track, pieces, ups, ride, felt } = r;
  const main = routeData(track, pieces, ups, ride);
  const points = main.points;
  const sw = r.trackSwitch;
  let trackSwitch = null;
  if (sw) {
    const water = routeData(sw.water.track, sw.allPieces, sw.water.ups, sw.water.ride);
    const turn = main.pieces.find((p) => track.piece[p.from] === sw.turn);
    const detour = water.pieces.find((p) => p.kind === "water");
    trackSwitch = {
      // Where the routes part: played seconds and sample (the same on both
      // routes up to there). Offer the choice a few seconds before.
      at: turn.start,
      // The woods route is the main ride's turn; the water route is a whole
      // ride of its own (identical to the main one before `at`).
      woods: { from: turn.from, to: turn.to, end: turn.end },
      water: { ...water, from: detour.from, to: detour.to, end: detour.end },
    };
  }
  const allFelt = sw ? [...felt, ...sw.water.felt] : felt;
  const allSpeed = sw ? [...ride.v, ...sw.water.ride.v] : ride.v;
  const allPoints = trackSwitch ? [...points, ...trackSwitch.water.points] : points;
  return {
    version: input.version,
    input,
    built: { ...counts, trackSwitch: Boolean(trackSwitch) },
    leftOut: {
      drops: input.drops - counts.drops,
      loops: input.loops - counts.loops,
      corkscrews: input.corkscrews - counts.corkscrews,
      trackSwitch: input.trackSwitch && !trackSwitch,
    },
    notes,
    // The main ride (with a switch, the woods route: taken when no choice is made).
    // Times are in played seconds (real physics shown at playbackSpeed);
    // speed is the real speed in m/s (for sound, for example).
    playbackSpeed: play,
    ...main,
    // null, or where the switch is and the whole water route.
    trackSwitch,
    peakGs: Math.round(Math.max(...allFelt.map((f) => f.up)) * 100) / 100,
    topSpeed: Math.round(Math.max(...allSpeed) * 10) / 10,
    bounds: boundsOf(allPoints),
    // The main ride's points alone without a switch (as always); both routes with one.
    fingerprint: fingerprintOf(allPoints, []),
  };
}
