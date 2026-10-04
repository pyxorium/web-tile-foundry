// Coaster Carnival ride helpers (stage 3): the pure maths behind the 3D ride.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateTrack } from "../src/tile-types/coaster-carnival/track/index.js";
import { frameBetween, smoothFrames, poseAt, pieceAt, _vec } from "../src/tile-types/coaster-carnival/ride/path.js";
import { THEMES, THEME_IDS, DEFAULT_THEME, getTheme } from "../src/tile-types/coaster-carnival/ride/themes.js";

const { dot, cross, sub } = _vec;
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const track = generateTrack({ drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 });

test("frames are unit, at right angles, and right-handed (side, up, travel)", () => {
  for (const f of smoothFrames(track, 3)) {
    for (const v of [f.t, f.up, f.side]) assert.ok(Math.abs(len(v) - 1) < 1e-6);
    assert.ok(Math.abs(dot(f.t, f.up)) < 1e-6);
    assert.ok(Math.abs(dot(f.t, f.side)) < 1e-6);
    // side × up = travel: a right-handed set, so three.js can use it as x, y, z without mirroring.
    const c = cross(f.side, f.up);
    assert.ok(len(sub(c, f.t)) < 1e-6);
  }
});

test("smooth frames pass through the track's own points", () => {
  for (const i of [0, 10, 100, track.points.length - 1]) {
    assert.ok(len(sub(frameBetween(track, i, 0).p, track.points[i])) < 1e-9);
  }
  assert.equal(smoothFrames(track, 3).length, track.points.length * 3);
});

test("the cart waits in the station, rides the whole track in order, and comes back", () => {
  const start = poseAt(track, 0);
  assert.ok(len(sub(start.p, track.points[0])) < 1e-9);
  assert.equal(start.done, false);
  assert.equal(poseAt(track, track.duration + 1).done, true);
  let last = -1;
  for (let s = 0.25; s < track.duration; s += 0.25) {
    const pose = poseAt(track, s);
    assert.ok(pose.index >= last, `goes backwards at ${s} s`);
    assert.ok(pose.fraction >= 0 && pose.fraction <= 1);
    last = pose.index;
  }
  // Partway through the lift, it is on the lift.
  const lift = track.pieces.find((p) => p.kind === "lift");
  assert.equal(pieceAt(track, poseAt(track, (lift.start + lift.end) / 2).index).kind, "lift");
});

test("three themes, each with every color the scene uses", () => {
  assert.deepEqual(THEME_IDS, ["day", "night", "spooky"]);
  assert.equal(getTheme("nope"), THEMES[DEFAULT_THEME]);
  const keys = Object.keys(THEMES.day);
  for (const id of THEME_IDS) assert.deepEqual(Object.keys(THEMES[id]).sort(), [...keys].sort(), id);
});

// ---------- scenery placement (stage 3, second check-in) ----------

import { placeProps, landmarkSpot } from "../src/tile-types/coaster-carnival/ride/placement.js";
import { SOUND_THEMES } from "../src/tile-types/coaster-carnival/ride/sound.js";

test("props stay clear of the track and the station, and the same layout gives the same scenery", () => {
  for (const id of THEME_IDS) {
    const plan = THEMES[id].props;
    const spots = placeProps(track, plan);
    const again = placeProps(track, plan);
    assert.deepEqual(spots, again, "same every time");
    for (const item of plan) {
      const list = spots[item.kind];
      assert.ok(list.length > item.count * 0.5, `${id}: enough ${item.kind}`);
      const gap = item.gap ?? 8;
      for (const s of list) {
        const nearest = Math.min(...track.points.map((p) => Math.hypot(p[0] - s.x, p[2] - s.z)));
        assert.ok(nearest >= gap - 1e-9, `${id}: ${item.kind} ${nearest.toFixed(1)} m from the track`);
        assert.ok(Math.hypot(track.points[0][0] - s.x, track.points[0][2] - s.z) >= 22, "clear of the station");
      }
    }
  }
  // A different layout number moves the scenery.
  const other = generateTrack({ ...track.input, seed: track.input.seed + 1 });
  assert.notDeepEqual(placeProps(other, THEMES.day.props).tree.slice(0, 3), placeProps(track, THEMES.day.props).tree.slice(0, 3));
});

test("landmarks stand outside the ride, behind it as seen from the waiting view", () => {
  const spot = landmarkSpot(track);
  assert.ok(spot.z < track.bounds.min[2], "behind the ride");
  const nearest = Math.min(...track.points.map((p) => Math.hypot(p[0] - spot.x, p[2] - spot.z)));
  assert.ok(nearest >= 30);
});

test("every theme has sound settings", () => {
  for (const id of THEME_IDS) assert.ok(SOUND_THEMES[id], id);
});
