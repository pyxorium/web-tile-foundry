import { seededRandom, randomSeed } from "../../glass-lantern/geometry/gem.js";
import { fingerprintOf } from "../../glass-lantern/geometry/polyhedron.js";
import { checkTrackInput, intensitySettings, FIXED, GENERATOR_VERSION, RANGES } from "./options.js";
import { layoutPieces, LayoutFail } from "./layout.js";
import { balanceTurns, closeCircuit, sampleTrack, footprint } from "./plan.js";
import { resample, shapeAt, speeds, upVectors, feltForces } from "./ride.js";
import { checkSmooth, checkClearance, checkBox, checkClosed, checkSpeed, checkForces, boundsOf } from "./checks.js";
import { roundMm, round3, PLATEAU_RAMP } from "./vec.js";

// Coaster Carnival's track generator: slider values and a seed in, a whole
// ride out. Pure maths, no drawing; runs the same in Node and the browser.
//
//   generateTrack({ drops, loops, corkscrews, intensity, seed, version? })
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

const MAX_ATTEMPTS = 30;
const LAYOUT_CHOICES = 6; // layouts drawn per attempt; the most compact one is kept
const GIVE_UP_AFTER = 3; // attempts in a row that failed for a reason more tries won't fix
const TWO_PI = 2 * Math.PI;

export { GENERATOR_VERSION, RANGES, FIXED, randomSeed };

function attempt(counts, s, rand) {
  // Draw a few layouts and keep the one that needs the least extra straight
  // track to close the circuit (tighter layouts, less waiting).
  let best = null;
  let fail = "could not close the circuit compactly";
  for (let k = 0; k < LAYOUT_CHOICES; k++) {
    let layout;
    try {
      layout = layoutPieces(counts, s, rand);
    } catch (e) {
      if (e instanceof LayoutFail) {
        fail = e.message;
        continue;
      }
      throw e;
    }
    const closed = closeCircuit(balanceTurns(layout.pieces, FIXED.maxTurnAngle, PLATEAU_RAMP));
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
  const dense = orient(sampleTrack(pieces));
  const closed = checkClosed(dense);
  if (closed.length) return { fail: closed[0] };

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
  if (problems.length) return { fail: problems[0], hopeless: problems[0].startsWith("too wide") || problems[0].startsWith("too deep") };
  return { track, kinds, pieces, ups, ride, felt, order };
}

/** Turns the layout so its long side runs along x, centers it, and puts the station at the front (+z). */
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
  points = points.map((p) => [p[0] - cx, p[1], p[2] - cz]);
  const ups = dense.ups.map((u) => (u ? rot(u) : null));
  return { ...dense, points, ups, turnedBy: ((angle % TWO_PI) + TWO_PI) % TWO_PI };
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
    let found = null;
    let lastFail = null;
    let hopeless = 0;
    for (let i = 0; i < MAX_ATTEMPTS && !found; i++) {
      const r = attempt(counts, s, rand);
      if (r.fail) lastFail = r.fail;
      else found = r;
      hopeless = r.hopeless ? hopeless + 1 : 0;
      if (hopeless >= GIVE_UP_AFTER) break; // too much asked for at this intensity: leave a piece out
    }
    if (found && found.ride.duration / FIXED.playbackSpeed <= timeCap) return finish(checked, counts, found, notes);
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

function finish(input, counts, r, notes) {
  const { track, pieces, ups, ride, felt } = r;
  const points = track.points.map(round3);
  const play = FIXED.playbackSpeed;
  const playTime = (t) => Math.round((t / play) * 1000) / 1000;
  const runs = [];
  track.piece.forEach((pi, i) => {
    const last = runs[runs.length - 1];
    if (last && last.index === pi) last.to = i;
    else runs.push({ index: pi, kind: pieces[pi].kind, from: i, to: i });
  });
  return {
    version: input.version,
    input,
    built: counts,
    leftOut: {
      drops: input.drops - counts.drops,
      loops: input.loops - counts.loops,
      corkscrews: input.corkscrews - counts.corkscrews,
    },
    notes,
    length: roundMm(track.length),
    spacing: track.spacing,
    // Times are in played seconds (real physics shown at playbackSpeed);
    // speed is the real speed in m/s (for sound, for example).
    playbackSpeed: play,
    duration: playTime(ride.duration),
    realDuration: Math.round(ride.duration * 1000) / 1000,
    points,
    ups: ups.map((u) => u.map((x) => Math.round(x * 1e4) / 1e4)),
    speed: Array.from(ride.v, (x) => Math.round(x * 1000) / 1000),
    time: Array.from(ride.t, playTime),
    pieces: runs.map(({ kind, from, to }) => ({
      kind,
      from,
      to,
      start: playTime(ride.t[from]),
      end: playTime(to + 1 < ride.t.length ? ride.t[to + 1] : ride.duration),
    })),
    peakGs: Math.round(Math.max(...felt.map((f) => f.up)) * 100) / 100,
    topSpeed: Math.round(Math.max(...ride.v) * 10) / 10,
    bounds: boundsOf(points),
    fingerprint: fingerprintOf(points, []),
  };
}
