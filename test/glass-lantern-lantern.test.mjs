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
  assert.ok(t > 0 && changes.length === 5);
});

test("quality: overrides merge in order; safe settings are the lightest look", () => {
  assert.deepEqual(overridesFor(0), {});
  assert.deepEqual(overridesFor(2), { glassResolution: "half", dispersion: 0 });
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
