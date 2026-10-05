// Coaster Carnival track generator tests (stage 2 and the track switch: maths only, no visuals).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTrack, GENERATOR_VERSION, RANGES, FIXED } from "../src/tile-types/coaster-carnival/track/index.js";
import { checkTrackInput, intensitySettings } from "../src/tile-types/coaster-carnival/track/options.js";
import { designLoop, designCorkscrew } from "../src/tile-types/coaster-carnival/track/elements.js";
import { shapeAt } from "../src/tile-types/coaster-carnival/track/ride.js";
import { checkClearance, boundsOf } from "../src/tile-types/coaster-carnival/track/checks.js";
import { smootherstep, plateau, plateauRate, angleBetween, length, sub, dot, cross } from "../src/tile-types/coaster-carnival/track/vec.js";
import { detourOnTurn, splitTurnForSwitch } from "../src/tile-types/coaster-carnival/track/switch.js";
import { walkPiece } from "../src/tile-types/coaster-carnival/track/plan.js";

// Rides here use a roomy time cap (60 played seconds) unless a test is about
// the cap, so they show the full shapes and don't depend on the cap's value.
const ROOMY = { timeCap: 60 };
const cache = new Map();
function ride(input, options = ROOMY) {
  const key = JSON.stringify([input, options]);
  if (!cache.has(key)) cache.set(key, generateTrack(input, options));
  return cache.get(key);
}

// A spread of settings: every intensity, small to large requests, two seeds.
const SAMPLES = [];
for (const intensity of [1, 3, 5]) {
  for (const [drops, loops, corkscrews] of [
    [1, 0, 0],
    [1, 1, 1],
    [2, 1, 1],
    [3, 0, 0],
    [2, 2, 2],
    [3, 2, 2],
  ]) {
    for (const seed of [1, 4096]) SAMPLES.push({ drops, loops, corkscrews, intensity, seed });
  }
}

const deg = (r) => (r * 180) / Math.PI;

// ---------- input ----------

test("inputs are checked; the version is filled in; the theme is not part of the layout", () => {
  const ok = { drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 5 };
  assert.deepEqual(checkTrackInput(ok), { ...ok, trackSwitch: false, version: GENERATOR_VERSION });
  assert.equal(checkTrackInput({ ...ok, trackSwitch: true }).trackSwitch, true);
  for (const [key, bad] of [
    ["drops", 0],
    ["drops", 5],
    ["loops", -1],
    ["corkscrews", 4],
    ["intensity", 6],
    ["drops", 1.5],
    ["seed", -1],
    ["seed", 2 ** 32],
    ["seed", "7"],
    ["version", 99],
    ["trackSwitch", "yes"],
  ]) {
    assert.throws(() => checkTrackInput({ ...ok, [key]: bad }), undefined, `${key}=${bad}`);
  }
  // A theme (or anything else extra) is ignored: switching themes never changes the ride.
  assert.equal(generateTrack({ ...ok, theme: "spooky" }, ROOMY).fingerprint, ride(ok).fingerprint);
});

test("slider ranges and defaults are sensible", () => {
  for (const [key, r] of Object.entries(RANGES)) {
    assert.ok(Number.isInteger(r.min) && Number.isInteger(r.max) && r.min < r.max, key);
    assert.ok(r.default >= r.min && r.default <= r.max, key);
  }
  assert.equal(RANGES.drops.min, 1, "every ride has at least one drop");
});

// ---------- the same every time ----------

test("same input gives exactly the same ride; different seeds give different rides", () => {
  const input = { drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 77 };
  const a = generateTrack(input, ROOMY);
  const b = generateTrack(input, ROOMY);
  assert.deepEqual(a, b);
  const prints = new Set([1, 2, 3, 4, 5, 6].map((seed) => ride({ ...input, seed }).fingerprint));
  assert.equal(prints.size, 6);
});

// These fingerprints lock in exact rides. While Coaster Carnival is being
// tuned (before its first publish) they are updated on purpose whenever the
// shapes are tuned. After the first publish, generator version 1 is frozen:
// a change here means published rides would change, so it must become a new
// generator version instead.
const LOCKED = [
  [{ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 }, {}, "b044e6ab"],
  [{ drops: 1, loops: 0, corkscrews: 0, intensity: 1, seed: 7 }, {}, "be464cb8"],
  [{ drops: 3, loops: 1, corkscrews: 1, intensity: 5, seed: 42 }, ROOMY, "d2a95090"],
  [{ drops: 2, loops: 2, corkscrews: 0, intensity: 2, seed: 2026 }, ROOMY, "2a815cfe"],
];

test("exact rides are locked by fingerprint", () => {
  for (const [input, options, print] of LOCKED) assert.equal(generateTrack(input, options).fingerprint, print, JSON.stringify(input));
});

// ---------- every ride is a good ride ----------

test("every ride closes: it ends where it starts, level, facing the same way", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    const n = t.points.length;
    const gap = length(sub(t.points[0], t.points[n - 1]));
    assert.ok(Math.abs(gap - t.spacing) < 0.01, `${JSON.stringify(input)}: last point ${gap.toFixed(3)} m from the first`);
    assert.ok(Math.abs(t.points[0][1] - FIXED.stationHeight) < 0.01, "starts at station height");
    const { tangents } = shapeAt(t);
    assert.ok(deg(angleBetween(tangents[0], tangents[n - 1])) < 3, "facing the same way");
  }
});

test("every ride is smooth: no kinks, no sudden rolls", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    const { tangents } = shapeAt(t);
    const n = tangents.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      assert.ok(deg(angleBetween(tangents[i], tangents[j])) <= 15, `${JSON.stringify(input)}: kink at ${i}`);
      assert.ok(deg(angleBetween(t.ups[i], t.ups[j])) <= 15.5, `${JSON.stringify(input)}: sudden roll at ${i}`);
    }
  }
});

test("the rider's up is a unit vector at right angles to the track", () => {
  for (const input of SAMPLES.slice(0, 8)) {
    const t = ride(input);
    const { tangents } = shapeAt(t);
    t.ups.forEach((u, i) => {
      assert.ok(Math.abs(length(u) - 1) < 1e-3, "unit length");
      assert.ok(Math.abs(dot(u, tangents[i])) < 0.02, "at right angles");
    });
  }
});

test("every ride stays clear of itself", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    const { tangents } = shapeAt(t);
    assert.deepEqual(checkClearance(t, tangents, t.ups), [], JSON.stringify(input));
  }
});

test("every ride fits the box, centered, above the ground, with the station at the front", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    const b = boundsOf(t.points);
    assert.ok(b.size[0] <= FIXED.box.width && b.size[2] <= FIXED.box.depth && b.max[1] <= FIXED.box.height, JSON.stringify(input));
    assert.ok(b.min[1] >= 1, "above the ground");
    assert.ok(Math.abs(b.min[0] + b.max[0]) < 0.01 && Math.abs(b.min[2] + b.max[2]) < 0.01, "centered");
    assert.ok(b.size[0] >= b.size[2] - 0.01, "long side along x");
    assert.ok(t.points[0][2] >= 0, "station in front");
  }
});

test("every ride keeps moving and stays comfortable for its intensity", () => {
  const G = 9.81;
  for (const input of SAMPLES) {
    const t = ride(input);
    const s = intensitySettings(input.intensity);
    const { tangents, bends } = shapeAt(t);
    const lift = t.pieces.find((p) => p.kind === "lift");
    const brakes = t.pieces.find((p) => p.kind === "brakes");
    const elementAt = new Array(t.points.length).fill(false);
    for (const p of t.pieces) if (p.kind === "loop" || p.kind === "corkscrew") for (let i = p.from; i <= p.to; i++) elementAt[i] = true;
    for (let i = lift.to + 1; i < brakes.from; i++) {
      const v = t.speed[i];
      assert.ok(v >= FIXED.minSpeed, `${JSON.stringify(input)}: ${v} m/s at ${i}`);
      const felt = [bends[i][0] * v * v, bends[i][1] * v * v + G, bends[i][2] * v * v];
      const up = dot(felt, t.ups[i]) / G;
      const side = dot(felt, cross(tangents[i], t.ups[i])) / G;
      assert.ok(up <= s.maxGs + 0.5, `${JSON.stringify(input)}: ${up.toFixed(2)} g at ${i}`);
      if (t.ups[i][1] < -0.2) assert.ok(up >= 0.2, `${JSON.stringify(input)}: not held in upside down at ${i}`);
      assert.ok(Math.abs(side) <= (elementAt[i] ? 1.5 : 0.6) + 0.01, `${JSON.stringify(input)}: ${side.toFixed(2)} g sideways at ${i}`);
    }
  }
});

// ---------- what the ride contains ----------

test("times are played seconds: real ride time shown at the playback speed", () => {
  const t = ride({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 });
  assert.equal(t.playbackSpeed, FIXED.playbackSpeed);
  assert.ok(Math.abs(t.duration * t.playbackSpeed - t.realDuration) < 0.01);
  // The modest default ride fits the standard cap whole.
  const standard = ride({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 }, {});
  assert.deepEqual(standard.leftOut, { drops: 0, loops: 0, corkscrews: 0, trackSwitch: false });
  assert.ok(standard.duration <= FIXED.timeCap);
});

test("pieces cover the ride in order, with times that add up", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    assert.equal(t.pieces[0].kind, "station-out");
    assert.equal(t.pieces.at(-1).kind, "station-in");
    assert.equal(t.pieces[0].from, 0);
    assert.equal(t.pieces.at(-1).to, t.points.length - 1);
    for (let i = 1; i < t.pieces.length; i++) {
      assert.equal(t.pieces[i].from, t.pieces[i - 1].to + 1, "no gaps");
      assert.ok(t.pieces[i].start >= t.pieces[i - 1].start, "times go forward");
    }
    for (const kind of ["lift", "crest", "brakes"]) assert.equal(t.pieces.filter((p) => p.kind === kind).length, 1, kind);
    const count = (kind) => t.pieces.filter((p) => p.kind === kind).length;
    assert.equal(count("drop"), t.built.drops);
    assert.equal(count("loop"), t.built.loops);
    assert.equal(count("corkscrew"), t.built.corkscrews);
    assert.equal(t.speed.length, t.points.length);
    assert.equal(t.time.length, t.points.length);
    for (let i = 1; i < t.time.length; i++) assert.ok(t.time[i] > t.time[i - 1]);
    assert.ok(Math.abs(t.pieces.at(-1).end - t.duration) < 0.01);
  }
});

test("what was built plus what was left out is what was asked for", () => {
  for (const input of SAMPLES) {
    const t = ride(input);
    for (const key of ["drops", "loops", "corkscrews"]) {
      assert.equal(t.built[key] + t.leftOut[key], input[key], key);
      assert.ok(t.leftOut[key] >= 0);
    }
    assert.ok(t.built.drops >= 1);
  }
  // A modest ride at middle intensity fits whole.
  const whole = ride({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 });
  assert.deepEqual(whole.leftOut, { drops: 0, loops: 0, corkscrews: 0, trackSwitch: false });
});

test("the time cap: rides fit it, or are already the smallest ride and say so", () => {
  for (const intensity of [1, 3, 5]) {
    for (const [drops, loops, corkscrews] of [
      [1, 0, 0],
      [2, 1, 1],
      [3, 2, 2],
    ]) {
      const t = ride({ drops, loops, corkscrews, intensity, seed: 3 }, {});
      if (t.duration <= FIXED.timeCap) continue;
      assert.deepEqual(t.built, { drops: 1, loops: 0, corkscrews: 0 });
      assert.equal(t.notes.at(-1), "longer than the time cap");
    }
  }
  // A tighter cap leaves more out.
  const roomy = ride({ drops: 3, loops: 1, corkscrews: 1, intensity: 3, seed: 9 });
  const tight = ride({ drops: 3, loops: 1, corkscrews: 1, intensity: 3, seed: 9 }, { timeCap: 32 });
  const total = (t) => t.built.drops + t.built.loops + t.built.corkscrews;
  assert.ok(tight.duration <= 32 || total(tight) === 1);
  assert.ok(total(tight) <= total(roomy));
});

test("every slider combination at its extremes makes a ride, quickly", () => {
  for (const drops of [RANGES.drops.min, RANGES.drops.max]) {
    for (const loops of [RANGES.loops.min, RANGES.loops.max]) {
      for (const corkscrews of [RANGES.corkscrews.min, RANGES.corkscrews.max]) {
        for (const intensity of [RANGES.intensity.min, RANGES.intensity.max]) {
          const start = Date.now();
          const t = generateTrack({ drops, loops, corkscrews, intensity, seed: 11 });
          assert.ok(t.points.length > 100);
          assert.ok(Date.now() - start < 5000, "slow");
        }
      }
    }
  }
});

test("stronger intensity means a taller, faster ride", () => {
  const top = (i) => Math.max(...ride({ drops: 1, loops: 0, corkscrews: 0, intensity: i, seed: 2 }).points.map((p) => p[1]));
  const speed = (i) => ride({ drops: 1, loops: 0, corkscrews: 0, intensity: i, seed: 2 }).topSpeed;
  assert.ok(top(1) < top(3) && top(3) < top(5));
  assert.ok(speed(1) < speed(3) && speed(3) < speed(5));
});

// ---------- the building blocks ----------

test("easing curves run 0 to 1 smoothly", () => {
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  assert.ok(Math.abs(smootherstep(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(plateau(0)) < 1e-12 && Math.abs(plateau(1) - 1) < 1e-12);
  let area = 0;
  let last = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    area += plateauRate((i + 0.5) / N) / N;
    const p = plateau((i + 1) / N);
    assert.ok(p >= last - 1e-12, "never goes backwards");
    last = p;
  }
  assert.ok(Math.abs(area - 1) < 1e-6, "rate averages 1");
  assert.equal(plateauRate(0), 0);
  assert.equal(plateauRate(1), 0);
});

test("a loop is a mirror-image teardrop that ends level, further forward", () => {
  const loop = designLoop(22, { peak: 3.5, top: 0.8, ease: 10 });
  assert.ok(loop);
  const n = loop.xs.length;
  assert.equal(loop.ys[0], 0);
  assert.equal(loop.ys[n - 1], 0);
  assert.ok(Math.abs(loop.angles[n - 1] - 2 * Math.PI) < 1e-9);
  assert.ok(loop.forward > 5, "exits ahead of where it went in");
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(loop.ys[i] - loop.ys[n - 1 - i]) < 1e-9, "mirror image");
  }
  assert.ok(loop.height > 8 && loop.height < 30);
  // Faster in, bigger loop.
  assert.ok(designLoop(26, { peak: 3.5, top: 0.8, ease: 10 }).height > loop.height);
  // Far too slow: no loop.
  assert.equal(designLoop(8, { peak: 3.5, top: 0.8, ease: 10 }), null);
});

test("a corkscrew gets longer as the cart gets faster; too slow, no corkscrew", () => {
  const zero = () => 0;
  const slow = designCorkscrew(18, 4, zero);
  const fast = designCorkscrew(24, 4, zero);
  assert.ok(slow && fast);
  assert.ok(fast.length > slow.length);
  // Below about 18 m/s riders wouldn't be held in over the top.
  assert.equal(designCorkscrew(14, 4, zero), null);
});

// ---------- the track switch ----------


const SWITCH_SAMPLES = SAMPLES.map((input) => ({ ...input, trackSwitch: true }));
const nearestOn = (points, p) => Math.min(...points.map((q) => length(sub(p, q))));

test("the water route lands exactly where the turn it replaces ends, facing the same way", () => {
  const s = intensitySettings(3);
  let made = 0;
  for (const deg of [40, 60, 80, 100, 120, 150]) {
    for (const radius of [20, 40, 60]) {
      const phi = (deg * Math.PI) / 180;
      const turn = { kind: "turn", length: (phi * radius) / (1 - 0.25), h0: 2.5, h1: 2.5, turn: phi };
      const d = detourOnTurn(turn, 18, s, () => 0.5);
      if (!d) continue;
      made++;
      let [x, z, a] = [0, 0, 0];
      for (const p of d.pieces) {
        const w = walkPiece(p, a);
        x += w.xs[w.n];
        z += w.zs[w.n];
        a = w.endHeading;
      }
      const end = walkPiece(turn, 0);
      assert.ok(Math.hypot(x - end.xs[end.n], z - end.zs[end.n]) < 1e-6, `${deg}° r${radius}: lands on the turn's end`);
      assert.ok(Math.abs(a - phi) < 1e-9, "facing the same way");
      assert.ok(d.length > turn.length, "the water route is the longer way round");
      assert.ok(d.pieces.every((p) => p.h0 === 2.5 && p.h1 === 2.5 && p.kind === "water"));
    }
  }
  assert.ok(made >= 5, "many turns have room for a water route");
  // A turn wider than about 105° is split in two, and the switch goes on the first half.
  const wide = [{ kind: "turn", length: 90, turn: 2.4, h0: 2, h1: 2, forSwitch: true }];
  const split = splitTurnForSwitch(wide);
  assert.equal(split.length, 2);
  assert.ok(split[0].forSwitch && !split[1].forSwitch);
  assert.ok(Math.abs(split[0].turn + split[1].turn - 2.4) < 1e-12);
});

test("with a switch: the main ride is the woods route, and the water route is a whole ride of its own", () => {
  let fitted = 0;
  for (const input of SWITCH_SAMPLES) {
    const t = ride(input);
    const sw = t.trackSwitch;
    assert.equal(t.built.trackSwitch, Boolean(sw));
    assert.equal(t.leftOut.trackSwitch, !sw);
    if (!sw) {
      assert.ok(t.notes.some((n) => n.startsWith("switch left out")), "says why the switch was left out");
      continue;
    }
    fitted++;
    const w = sw.water;
    // Same shape of data as the main ride.
    assert.equal(w.points.length, w.ups.length);
    assert.equal(w.speed.length, w.points.length);
    assert.equal(w.time.length, w.points.length);
    assert.equal(w.pieces[0].kind, "station-out");
    assert.equal(w.pieces.at(-1).kind, "station-in");
    assert.equal(w.pieces.filter((p) => p.kind === "water").length, 1, "one water stretch");
    // The routes part at the same moment.
    assert.ok(Math.abs(t.time[sw.woods.from] - sw.at) < 0.01);
    assert.ok(Math.abs(w.time[w.from] - sw.at) < 0.1, "both routes reach the switch together (to within a sample)");
    // Off the detour, the water route runs on the main line.
    for (let i = 0; i < w.points.length; i += 7) {
      if (i >= w.from && i <= w.to) continue;
      assert.ok(nearestOn(t.points, w.points[i]) < t.spacing, `on the main line at ${i}`);
    }
    // On the detour, it swings well clear of the turn it replaces.
    const mid = w.points[Math.round((w.from + w.to) / 2)];
    assert.ok(nearestOn(t.points.slice(sw.woods.from, sw.woods.to + 1), mid) > 3, "swings out");
    // The longer way round, and within the cap plus the extra allowed.
    assert.ok(w.duration >= t.duration - 0.05);
    assert.ok(w.duration <= 60 + FIXED.switchExtraTime);
    // A good ride too: keeps moving, rider's up is sound, clear of itself.
    for (let i = w.pieces.find((p) => p.kind === "crest").from; i < w.pieces.find((p) => p.kind === "brakes").from; i++) {
      assert.ok(w.speed[i] >= FIXED.minSpeed - 1e-6, "keeps moving");
    }
    for (const u of w.ups) assert.ok(Math.abs(length(u) - 1) < 1e-3);
    const track = { points: w.points, spacing: w.spacing };
    const { tangents } = shapeAt(track);
    assert.deepEqual(checkClearance(track, tangents, w.ups), []);
  }
  assert.ok(fitted >= SWITCH_SAMPLES.length * 0.85, `the switch fits most rides (${fitted} of ${SWITCH_SAMPLES.length})`);
});

test("the switch sits near the middle of the ride, and the default ride keeps everything with it", () => {
  const t = ride({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: true }, {});
  assert.ok(t.trackSwitch);
  assert.deepEqual(t.leftOut, { drops: 0, loops: 0, corkscrews: 0, trackSwitch: false });
  const share = t.trackSwitch.at / t.duration;
  assert.ok(share > 0.3 && share < 0.7, `switch at ${Math.round(share * 100)}% of the ride`);
  assert.ok(t.duration <= FIXED.timeCap);
  assert.ok(t.trackSwitch.water.duration <= FIXED.timeCap + FIXED.switchExtraTime);
  // Same input, same ride (both routes).
  assert.equal(generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: true }).fingerprint, t.fingerprint);
});

test("switch rides are locked by fingerprint too; without a switch nothing changed", () => {
  assert.equal(generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: true }).fingerprint, "38f0dcc9");
  assert.equal(generateTrack({ drops: 3, loops: 1, corkscrews: 1, intensity: 5, seed: 42, trackSwitch: true }, ROOMY).fingerprint, "73b13b12");
  // trackSwitch: false is the same as leaving it out (the locked rides above).
  assert.equal(generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1, trackSwitch: false }, {}).fingerprint, "b044e6ab");
});
