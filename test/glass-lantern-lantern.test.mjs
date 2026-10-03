// Glass Lantern look tests (stage 3): the lantern's geometry and settings.
// These run in Node: three.js geometry needs no screen. The look itself is
// judged by eye in the look lab (lab/glass-lantern.html).
import { test } from "node:test";
import assert from "node:assert/strict";

import { getShape, SHAPE_GROUPS } from "../src/tile-types/glass-lantern/geometry/index.js";
import { buildPanes, buildCame, insetPolygon, maxInset } from "../src/tile-types/glass-lantern/lantern/meshes.js";
import { DEFAULT_SETTINGS, METALS, kelvinToHex, alternateColours } from "../src/tile-types/glass-lantern/lantern/settings.js";

const everyShape = () => [
  ...SHAPE_GROUPS[0].shapes.map((s) => getShape({ group: "classic", id: s.id })),
  getShape({ group: "special", id: "chestahedron" }),
  ...[10, 14, 18, 24].map((facets) => getShape({ group: "gem", id: "gem", seed: 7 + facets, facets })),
];

test("panes: every face gets a pane and a bevel, with sensible numbers", () => {
  for (const shape of everyShape()) {
    const colours = alternateColours(shape.faces.length, DEFAULT_SETTINGS.palette);
    const g = buildPanes(shape, colours, DEFAULT_SETTINGS);
    const { position, normal, color, aFace, aRim } = g.attributes;
    for (const a of [position, normal, color]) assert.ok(a.array.every(Number.isFinite), `${shape.id}: no NaN`);
    const faces = new Set(aFace.array);
    assert.equal(faces.size, shape.faces.length, `${shape.id}: every face is there`);
    // Triangles per face: a fan of n for the pane, 2n for the bevel.
    const expected = shape.faces.reduce((s, f) => s + 3 * f.length, 0) * 3;
    assert.equal(position.count, expected, shape.id);
    assert.ok(aRim.array.some((r) => r === 1) && aRim.array.some((r) => r === 0));
  }
});

test("panes sit inside the shape and face outward", () => {
  for (const shape of everyShape()) {
    const g = buildPanes(shape, ["#ffffff"], DEFAULT_SETTINGS);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const face = g.attributes.aFace.array;
    for (let v = 0; v < g.attributes.position.count; v++) {
      const fn = shape.normals[face[v]];
      const pt = [p[3 * v], p[3 * v + 1], p[3 * v + 2]];
      // No point of a pane sticks out past its own face's plane.
      const plane = fn[0] * shape.centres[face[v]][0] + fn[1] * shape.centres[face[v]][1] + fn[2] * shape.centres[face[v]][2];
      assert.ok(fn[0] * pt[0] + fn[1] * pt[1] + fn[2] * pt[2] <= plane + 1e-6, `${shape.id}: pane outside its face`);
      // Normals point the same way as the face (bevels lean, but never inward).
      assert.ok(fn[0] * n[3 * v] + fn[1] * n[3 * v + 1] + fn[2] * n[3 * v + 2] > 0.2, `${shape.id}: normal points inward`);
    }
  }
});

test("each face's colour lands on that face", () => {
  const shape = getShape({ group: "classic", id: "d6" });
  const colours = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
  const g = buildPanes(shape, colours, DEFAULT_SETTINGS);
  const c = g.attributes.color.array;
  const face = g.attributes.aFace.array;
  for (let v = 0; v < face.length; v++) {
    const want = colours[face[v]];
    const rgb = [c[3 * v], c[3 * v + 1], c[3 * v + 2]].map((x) => (x > 0.5 ? "ff" : "00")).join("");
    assert.equal(`#${rgb}`, want);
  }
});

test("inset keeps every pane edge parallel to the face edge, and backs off when too wide", () => {
  const tri = [[0, 0, 0], [1, 0, 0], [0.5, 0.8, 0]];
  const { points, w } = insetPolygon(tri, [0, 0, 1], 0.1);
  assert.equal(w, 0.1);
  points.forEach((p) => assert.ok(p[1] > 0.099)); // every corner moved up off the bottom edge
  const big = insetPolygon(tri, [0, 0, 1], 5);
  const inradius = maxInset(tri, [0, 0, 1]);
  assert.ok(Math.abs(inradius - 0.27712) < 1e-4, `triangle inradius ${inradius}`);
  assert.ok(big.w <= 0.95 * inradius + 1e-12, "an inset wider than the triangle is reduced");
});

test("came: one strip per edge and one joint per corner, no NaN; rivets make bigger joints", () => {
  for (const shape of everyShape()) {
    const g = buildCame(shape, DEFAULT_SETTINGS);
    assert.ok(g.attributes.position.array.every(Number.isFinite), shape.id);
    assert.ok(g.attributes.position.count > 0);
  }
  const d6 = getShape({ group: "classic", id: "d6" });
  const reach = (g) => Math.max(...Array.from(g.attributes.position.array, Math.abs));
  assert.ok(reach(buildCame(d6, { ...DEFAULT_SETTINGS, rivets: true })) > reach(buildCame(d6, DEFAULT_SETTINGS)));
});

test("settings: every metal is a colour, the lamp warmth maps to warm and cool colours", () => {
  for (const hex of Object.values(METALS)) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.ok(METALS[DEFAULT_SETTINGS.metal]);
  assert.equal(kelvinToHex(6600), "#ffffff");
  const warm = kelvinToHex(2000);
  assert.ok(parseInt(warm.slice(1, 3), 16) > parseInt(warm.slice(5, 7), 16), "2000 K is redder than blue");
  assert.deepEqual(alternateColours(7, ["a", "b", "c"]), ["a", "b", "c", "a", "b", "c", "a"]);
});

// ---------- automatic quality ----------
import { createQualityGovernor, overridesFor, QUALITY_STEPS, SAFE_SETTINGS } from "../src/tile-types/glass-lantern/lantern/quality.js";
import { pixelRatioFor } from "../src/tile-types/glass-lantern/lantern/settings.js";

// Feeds the governor frames `ms` apart for `seconds`, returning every step-down it made.
function run(governor, ms, seconds, start = 0) {
  const changes = [];
  let t = start;
  while (t < start + seconds * 1000) {
    t += ms;
    const c = governor.frame(t);
    if (c) changes.push(c);
  }
  return { changes, t };
}

test("quality: a fast device keeps the full look", () => {
  const g = createQualityGovernor();
  const { changes } = run(g, 1000 / 60, 4);
  assert.deepEqual(changes, []);
  assert.equal(g.state, "done");
  assert.equal(g.count, 0);
});

test("quality: a device at 30 fps steps down one level at a time, then stops when it is fast enough", () => {
  const g = createQualityGovernor();
  const first = run(g, 1000 / 30, 2.5);
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0].step.id, QUALITY_STEPS[0].id);
  const after = run(g, 1000 / 60, 4, first.t); // the step helped
  assert.deepEqual(after.changes, []);
  assert.equal(g.state, "done");
  assert.equal(g.count, 1);
});

test("quality: a hopeless device steps down quickly and ends at backup glass", () => {
  const g = createQualityGovernor();
  const { changes, t } = run(g, 400, 30);
  assert.equal(changes.length, QUALITY_STEPS.length);
  assert.equal(g.state, "done");
  assert.equal(overridesFor(g.count).realGlass, false);
  // Two very slow frames are enough to act: no waiting out the full window.
  assert.ok(t > 0 && changes.length === QUALITY_STEPS.length);
});

test("quality: overrides merge in order; safe settings are the lightest look", () => {
  assert.deepEqual(overridesFor(0), {});
  assert.deepEqual(overridesFor(2), { glassMethod: "clear", glassResolution: "half" });
  assert.equal(QUALITY_STEPS[0].id, "clear-glass", "clear glass is the first fallback");
  assert.equal(DEFAULT_SETTINGS.glassMethod, "real", "real glass by default");
  assert.equal(SAFE_SETTINGS.realGlass, false);
  assert.equal(SAFE_SETTINGS.pixelRatio, "1");
});

test("pixel budget: a phone is untouched, an ultrawide window is drawn at lower resolution", () => {
  const phone = pixelRatioFor({ width: 412, height: 891, devicePixelRatio: 3, pixelRatio: "2", maxPixels: DEFAULT_SETTINGS.maxPixels });
  assert.deepEqual(phone, { ratio: 2, capped: false });
  const wide = pixelRatioFor({ width: 3440, height: 1440, devicePixelRatio: 1, pixelRatio: "2", maxPixels: DEFAULT_SETTINGS.maxPixels });
  assert.ok(wide.capped && wide.ratio < 1);
  assert.ok(3440 * 1440 * wide.ratio * wide.ratio <= DEFAULT_SETTINGS.maxPixels + 1);
  assert.equal(pixelRatioFor({ width: 800, height: 600, devicePixelRatio: 2, pixelRatio: "device" }).ratio, 2);
});

// ---------- kits ----------
import { KITS, KIT_BASE, DEVICE_KEYS, kitLook, getKit } from "../src/tile-types/glass-lantern/lantern/kits.js";

test("kits: Tiffany, Victorian and Steampunk, each using only real settings with valid values", () => {
  assert.deepEqual(KITS.map((k) => k.id), ["tiffany", "victorian", "steampunk"]);
  for (const kit of KITS) {
    assert.ok(Number.isInteger(kit.version) && kit.version >= 1);
    for (const key of Object.keys({ ...KIT_BASE, ...kit.settings })) {
      assert.ok(key in DEFAULT_SETTINGS, `${kit.id}: unknown setting ${key}`);
      assert.ok(!DEVICE_KEYS.includes(key), `${kit.id}: a kit must not set ${key}`);
    }
    assert.ok(METALS[kit.settings.metal], `${kit.id}: unknown metal`);
    assert.equal(kit.settings.palette.length, 5);
    for (const c of [...kit.settings.palette, kit.settings.bgTop, kit.settings.bgBottom]) assert.match(c, /^#[0-9a-f]{6}$/);
  }
});

test("kits: a kit's look carries the shared base and never the device settings", () => {
  const look = kitLook("victorian");
  assert.equal(look.ior, KIT_BASE.ior);
  assert.equal(look.metal, "blackened");
  for (const k of DEVICE_KEYS) assert.ok(!(k in look), `${k} leaked into a kit`);
  look.palette[0] = "#000000";
  assert.notEqual(getKit("victorian").settings.palette[0], "#000000", "kits are not changed by editing a copy");
  assert.throws(() => getKit("gothic"));
});

test("kits: Steampunk carries the user's tuning from the phone", () => {
  const look = kitLook("steampunk");
  assert.equal(getKit("steampunk").tuned, "2026-10-03");
  assert.equal(look.cameFlatten, 0.87);
  assert.equal(look.ior, 1.29);
  assert.equal(look.rivets, true);
});

test("kits: Victorian carries the user's tuning from the phone", () => {
  const look = kitLook("victorian");
  assert.equal(getKit("victorian").tuned, "2026-10-03");
  assert.equal(look.metal, "blackened");
  assert.equal(look.envIntensity, 1.5);
  assert.equal(look.ior, 1);
});

test("kits: all three are tuned; Tiffany carries the user's opal and ripple", () => {
  for (const kit of KITS) assert.equal(kit.tuned, "2026-10-03", `${kit.id} is still a draft`);
  const look = kitLook("tiffany");
  assert.equal(look.opal, 0.33);
  assert.equal(look.opalGlow, 1.06);
  assert.equal(look.ripple, 0.47);
  assert.equal(look.metalRoughness, 0.15);
  assert.equal(kitLook("victorian").opal, 0);
  assert.equal(kitLook("steampunk").opal, 0.09);
});

// ---------- backgrounds and tabletop ----------
import { BACKGROUNDS } from "../src/tile-types/glass-lantern/lantern/background.js";
import { lightPools } from "../src/tile-types/glass-lantern/lantern/pools.js";

test("backgrounds: plain glow, parlour, damask, workshop; each kit picks one and a tabletop setting", () => {
  assert.deepEqual(BACKGROUNDS.map((b) => b.id), ["plain", "parlour", "damask", "workshop"]);
  assert.equal(new Set(BACKGROUNDS.map((b) => b.style)).size, 4);
  assert.equal(DEFAULT_SETTINGS.background, "plain");
  const picks = Object.fromEntries(KITS.map((k) => [k.id, [kitLook(k.id).background, kitLook(k.id).tabletop]]));
  assert.deepEqual(picks, { tiffany: ["parlour", true], victorian: ["damask", false], steampunk: ["workshop", false] });
  for (const k of KITS) assert.match(kitLook(k.id).bgAccent, /^#[0-9a-f]{6}$/);
});

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const d6Pools = (rotation) => {
  const shape = getShape({ group: "classic", id: "d6" });
  const colours = shape.faces.map((_, i) => [i / 10, 0, 0]);
  return { shape, pools: lightPools({ normals: shape.normals, centres: shape.centres, areas: shape.areas, colours, rotation, tableY: -1.2 }) };
};

test("light pools: a d6 sitting square puts its bottom pane's colour straight down", () => {
  const { shape, pools } = d6Pools(IDENTITY);
  assert.equal(pools.length, 1, "only the bottom face points down");
  const bottom = shape.normals.findIndex((n) => n[1] < -0.99);
  assert.ok(Math.abs(pools[0].x) < 1e-9 && Math.abs(pools[0].z) < 1e-9);
  assert.deepEqual(pools[0].colour, [bottom / 10, 0, 0]);
  assert.ok(pools[0].radius > 0 && pools[0].strength > 0);
});

test("light pools follow the lantern as it turns, strongest first", () => {
  const c = Math.cos(0.6), s = Math.sin(0.6);
  const tiltX = [1, 0, 0, 0, c, s, 0, -s, c]; // rotation about x, column-major
  const { pools } = d6Pools(tiltX);
  assert.equal(pools.length, 2, "tilted, two faces point down");
  assert.ok(pools[0].strength >= pools[1].strength);
  assert.ok(pools.every((p) => Math.abs(p.x) < 1e-9), "tilting about x moves pools along z only");
  assert.ok(pools.some((p) => Math.abs(p.z) > 0.1));
});

test("kits: Tiffany carries the user's parlour and tabletop tuning", () => {
  const look = kitLook("tiffany");
  assert.equal(look.background, "parlour");
  assert.equal(look.bgSoftness, 1);
  assert.equal(look.bgContrast, 0);
  assert.equal(look.poolStrength, 0.6);
  assert.equal(look.envIntensity, 0.8);
});

test("kits: Victorian carries the user's damask tuning", () => {
  const look = kitLook("victorian");
  assert.equal(look.background, "damask");
  assert.equal(look.bgScale, 4);
  assert.equal(look.bgSoftness, 0.36);
  assert.equal(look.bgHalo, 0.14);
});

test("kits: Steampunk carries the user's workshop tuning", () => {
  const look = kitLook("steampunk");
  assert.equal(look.background, "workshop");
  assert.equal(look.bgScale, 2.04);
  assert.equal(look.bgContrast, 1.21);
  assert.equal(look.bgSoftness, 0.15);
});

// ---------- clear glass ----------
import { resolveGlassMethod, GLASS_METHODS } from "../src/tile-types/glass-lantern/lantern/settings.js";
import { stepIsUseful } from "../src/tile-types/glass-lantern/lantern/quality.js";

test("glass method: auto picks clear glass when nothing bends, real glass when it does", () => {
  assert.deepEqual(GLASS_METHODS, ["auto", "real", "clear", "backup"]);
  const base = { ...DEFAULT_SETTINGS, glassMethod: "auto" };
  assert.equal(resolveGlassMethod({ ...base, ior: 1, thickness: 0 }), "clear");
  assert.equal(resolveGlassMethod({ ...base, ior: 1.29, thickness: 0.11 }), "real");
  assert.equal(resolveGlassMethod({ ...kitLook("tiffany"), glassMethod: "auto", realGlass: true }), "clear");
  assert.equal(resolveGlassMethod({ ...kitLook("victorian"), glassMethod: "auto", realGlass: true }), "clear");
  assert.equal(resolveGlassMethod({ ...kitLook("steampunk"), glassMethod: "auto", realGlass: true }), "real");
  assert.equal(resolveGlassMethod({ ...base, glassMethod: "real", ior: 1, thickness: 0 }), "real", "chosen by hand");
  assert.equal(resolveGlassMethod({ ...base, realGlass: false }), "backup", "auto quality's last step and safe mode still win");
});

test("quality: steps that change nothing are skipped (clear glass needs no half resolution)", () => {
  const clearKit = { ...kitLook("tiffany"), ...DEFAULT_SETTINGS, ...kitLook("tiffany"), glassMethod: "auto", realGlass: true };
  assert.equal(stepIsUseful(QUALITY_STEPS[0], clearKit), false, "already clear");
  assert.equal(stepIsUseful(QUALITY_STEPS[1], clearKit), false, "half resolution does nothing for clear glass");
  const g = createQualityGovernor({ isUseful: (step, before) => stepIsUseful(step, { ...clearKit, ...before }) });
  const { changes } = run(g, 1000 / 30, 2.5);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].step.id, "no-far-side", "the first step that matters for a clear-glass kit");
  const bending = { ...DEFAULT_SETTINGS, ...kitLook("steampunk"), glassMethod: "auto", realGlass: true };
  assert.equal(stepIsUseful(QUALITY_STEPS[0], bending), true);
  assert.equal(stepIsUseful(QUALITY_STEPS[1], bending), true, "a bending kit can fall back to clear glass");
});

test("quality: a slow device on real glass falls back to clear glass first, then skips half resolution", () => {
  const realKit = { ...DEFAULT_SETTINGS, ...kitLook("tiffany"), glassMethod: "real", realGlass: true };
  const g = createQualityGovernor({ isUseful: (step, before) => stepIsUseful(step, { ...realKit, ...before }) });
  const first = run(g, 1000 / 30, 2.5);
  assert.equal(first.changes[0].step.id, "clear-glass");
  const second = run(g, 1000 / 30, 2.5, first.t);
  assert.equal(second.changes[0].step.id, "no-far-side", "half resolution and rainbow edges change nothing on clear glass");
});

// ---------- stage 4: rolling ----------
import { Quaternion, Vector3 } from "three";
import { pickFace, faceTowards, tumbleAt, isTap, glowAt, easeOutCubic } from "../src/tile-types/glass-lantern/lantern/roll.js";

test("roll: every face of every shape can be brought round to face the viewer", () => {
  const views = [[0, 0, 1], [0, Math.sin(0.24), Math.cos(0.24)]]; // straight on, and tilted down for the tabletop
  for (const shape of everyShape()) {
    for (const view of views) {
      shape.normals.forEach((n, i) => {
        for (const twist of [0, 0.7, -1.2]) {
          const q = faceTowards(n, view, twist);
          const turned = new Vector3(...n).applyQuaternion(q);
          assert.ok(turned.dot(new Vector3(...view).normalize()) > 0.99999, `${shape.id} face ${i}`);
        }
      });
    }
  }
});

test("roll: the tumble starts exactly where it was and ends exactly on the chosen face", () => {
  const from = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.1);
  const to = new Quaternion().setFromAxisAngle(new Vector3(-2, 1, 0).normalize(), 2.3);
  const axis = new Vector3(0.3, -0.5, 0.8).normalize();
  const same = (a, b) => Math.abs(a.dot(b)) > 0.999999; // q and -q are the same turn
  assert.ok(same(tumbleAt(from, to, axis, 2, 0), from));
  assert.ok(same(tumbleAt(from, to, axis, 2, 1), to));
  const mid = tumbleAt(from, to, axis, 2, 0.5);
  assert.ok(Math.abs(mid.length() - 1) < 1e-9, "stays a pure rotation");
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
});

test("roll: faces are picked fairly, always in range", () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const counts = new Array(7).fill(0); // the chestahedron's seven faces
  for (let i = 0; i < 70000; i++) counts[pickFace(7, rand)]++;
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 500, `uneven: ${counts.join(", ")}`);
  assert.equal(pickFace(20, () => 0.999999999), 19);
  assert.equal(pickFace(20, () => 0), 0);
});

test("taps are told apart from drags; the winning pane's glow rises then fades", () => {
  assert.equal(isTap({ moved: 3, ms: 150, fingers: 1 }), true);
  assert.equal(isTap({ moved: 40, ms: 150, fingers: 1 }), false, "moved: a drag");
  assert.equal(isTap({ moved: 2, ms: 900, fingers: 1 }), false, "held: not a tap");
  assert.equal(isTap({ moved: 2, ms: 150, fingers: 2 }), false, "a pinch is never a roll");
  assert.equal(glowAt(0), 0);
  assert.equal(glowAt(0.18), 1);
  assert.ok(glowAt(0.8) > 0 && glowAt(0.8) < 1);
  assert.equal(glowAt(3), 0);
});

// ---------- the roll's feel ----------
import { makeRollCurve, ROLL_DEFAULTS } from "../src/tile-types/glass-lantern/lantern/roll.js";

test("roll feel: defaults are the agreed heavier roll, and live in the settings too", () => {
  assert.deepEqual(ROLL_DEFAULTS, { rollDuration: 3.55, rollSpins: 2, rollWindUp: 0.61, rollEase: 0.85, rollSettle: 4 });
  for (const [k, v] of Object.entries(ROLL_DEFAULTS)) assert.equal(DEFAULT_SETTINGS[k], v, k);
});

test("roll feel: starts at rest, winds up, lands, settles about 4 degrees past and rests exactly", () => {
  const c = makeRollCurve();
  assert.equal(c.duration, 3.55);
  assert.equal(c.progress(0), 0);
  assert.equal(c.progress(3.55), 1);
  const speed = (t) => (c.progress(t + 0.001) - c.progress(t - 0.001)) / 0.002;
  assert.ok(speed(0.01) < speed(0.61) * 0.1, "it gathers speed instead of jumping to full speed");
  let half = 0;
  for (let t = 0; t < 4; t += 0.005) if (c.progress(t) >= 0.5) { half = t; break; }
  assert.ok(half > 1.0 && half < 1.6, `half the turning by ${half}s (the first roll: 0.31s)`);
  let over = 0;
  for (let t = 2; t < 3.55; t += 0.001) over = Math.max(over, c.progress(t) - 1);
  assert.ok(Math.abs(over * 2 * 360 - 4) < 0.05, `settles ${over * 720} degrees past`);
});

test("roll feel: no settle means no overshoot; even slowdown spreads the motion out", () => {
  const flat = makeRollCurve({ rollSettle: 0 });
  for (let t = 0; t <= flat.duration; t += 0.01) assert.ok(flat.progress(t) <= 1 + 1e-12);
  const even = makeRollCurve({ rollEase: 1, rollSettle: 0 });
  const early = makeRollCurve({ rollEase: 3, rollSettle: 0 });
  assert.ok(early.progress(0.8) > even.progress(0.8), "a higher slowdown value front-loads the motion");
  assert.equal(makeRollCurve({ rollSpins: 2.4 }).spins, 2, "spins are whole turns");
});
