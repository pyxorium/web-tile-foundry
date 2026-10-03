// Glass Lantern shape tests (stage 2: geometry only, no visuals).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { SHAPE_GROUPS, GEM_FACETS, getShape, shapeForTile, deriveShape } from "../src/tile-types/glass-lantern/geometry/index.js";
import { checkShape, length, sub, dot, fingerprintOf } from "../src/tile-types/glass-lantern/geometry/polyhedron.js";
import { CHESTAHEDRON_FOLD } from "../src/tile-types/glass-lantern/geometry/chestahedron.js";
import { seededRandom } from "../src/tile-types/glass-lantern/geometry/gem.js";

const dist = (s, a, b) => length(sub(s.vertices[a], s.vertices[b]));
const sideLengths = (s, f) => f.map((v, i) => dist(s, v, f[(i + 1) % f.length]));
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const spread = (xs) => Math.max(...xs) / Math.min(...xs) - 1;

const EXPECTED = {
  d4: { V: 4, E: 6, F: 4, sides: 3 },
  d6: { V: 8, E: 12, F: 6, sides: 4 },
  d8: { V: 6, E: 12, F: 8, sides: 3 },
  d10: { V: 12, E: 20, F: 10, sides: 4 },
  d12: { V: 20, E: 30, F: 12, sides: 5 },
  d20: { V: 12, E: 30, F: 20, sides: 3 },
};

// A spread of gem settings used by several tests.
const GEM_SAMPLES = [];
for (let facets = GEM_FACETS.min; facets <= GEM_FACETS.max; facets++) {
  for (const seed of [0, 1, 42, 2026, 123456789, 0xffffffff]) GEM_SAMPLES.push({ seed, facets });
}

// ---------- every shape ----------

function allShapes() {
  const shapes = [];
  for (const g of SHAPE_GROUPS) {
    for (const s of g.shapes) {
      if (g.id === "gem") for (const opts of GEM_SAMPLES.slice(0, 30)) shapes.push(getShape({ group: "gem", id: "gem", ...opts }));
      else shapes.push(getShape({ group: g.id, id: s.id }));
    }
  }
  return shapes;
}

test("every shape is a closed convex solid: Euler, flat faces, outward normals", () => {
  for (const s of allShapes()) {
    assert.deepEqual(checkShape(s), [], `${s.id} ${s.fingerprint}`);
    assert.equal(s.vertices.length - s.edges.length + s.faces.length, 2, s.id);
  }
});

test("every shape is centred and scaled so its farthest corner is at 1", () => {
  for (const s of allShapes()) {
    const radii = s.vertices.map((p) => length(p));
    assert.ok(close(Math.max(...radii), 1, 2e-9), s.id);
    const mid = s.vertices.reduce((m, p) => m.map((x, k) => x + p[k] / s.vertices.length), [0, 0, 0]);
    assert.ok(length(mid) < 1e-8, `${s.id} is not centred`);
  }
});

test("normals, centres and areas line up with faces; edges are unique and sorted", () => {
  for (const s of allShapes()) {
    assert.equal(s.normals.length, s.faces.length);
    assert.equal(s.centres.length, s.faces.length);
    assert.equal(s.areas.length, s.faces.length);
    s.normals.forEach((n) => assert.ok(close(length(n), 1, 1e-12)));
    s.areas.forEach((a) => assert.ok(a > 0));
    const keys = s.edges.map(([a, b]) => `${a},${b}`);
    assert.equal(new Set(keys).size, keys.length);
    s.edges.forEach(([a, b]) => assert.ok(a < b));
  }
});

test("faces are in the fixed order: top to bottom", () => {
  for (const s of allShapes()) {
    for (let i = 1; i < s.centres.length; i++) {
      assert.ok(s.centres[i][2] <= s.centres[i - 1][2] + 1e-6, `${s.id}: face ${i} is above face ${i - 1}`);
    }
  }
});

test("coordinates are rounded to 9 decimal places, with no negative zero", () => {
  for (const s of allShapes()) {
    for (const p of s.vertices) {
      for (const x of p) {
        assert.ok(close(Math.round(x * 1e9) / 1e9, x, 1e-15));
        assert.ok(!Object.is(x, -0));
      }
    }
  }
});

// ---------- classic dice ----------

test("classic dice have the right corners, edges, faces and face shapes", () => {
  for (const [id, want] of Object.entries(EXPECTED)) {
    const s = getShape({ group: "classic", id });
    assert.equal(s.vertices.length, want.V, id);
    assert.equal(s.edges.length, want.E, id);
    assert.equal(s.faces.length, want.F, id);
    assert.ok(s.faces.every((f) => f.length === want.sides), `${id} face sides`);
  }
});

test("classic dice are fair: every face the same area", () => {
  for (const id of Object.keys(EXPECTED)) {
    assert.ok(spread(getShape({ group: "classic", id }).areas) < 1e-7, id);
  }
});

test("the platonic dice have equal edges; the d10 has true kites", () => {
  for (const id of ["d4", "d6", "d8", "d12", "d20"]) {
    const s = getShape({ group: "classic", id });
    assert.ok(spread(s.edges.map(([a, b]) => dist(s, a, b))) < 1e-7, id);
  }
  const d10 = getShape({ group: "classic", id: "d10" });
  for (const f of d10.faces) {
    // A kite: two pairs of equal neighbouring sides, a, a, b, b (in some rotation), a != b.
    const [p, q, r, t] = sideLengths(d10, f);
    const kite = (close(p, q) && close(r, t)) || (close(q, r) && close(t, p));
    assert.ok(kite && !close(p, r), "d10 face is a kite");
  }
});

// ---------- chestahedron ----------

test("chestahedron: 7 corners, 12 edges, 7 faces: 4 equilateral triangles and 3 kites", () => {
  const s = getShape({ group: "special", id: "chestahedron" });
  assert.equal(s.vertices.length, 7);
  assert.equal(s.edges.length, 12);
  const triangles = s.faces.filter((f) => f.length === 3);
  const kites = s.faces.filter((f) => f.length === 4);
  assert.equal(triangles.length, 4);
  assert.equal(kites.length, 3);
  const side = dist(s, triangles[0][0], triangles[0][1]);
  for (const f of triangles) sideLengths(s, f).forEach((l) => assert.ok(close(l, side), "triangles are equilateral and the same size"));
  for (const f of kites) {
    const [p, q, r, t] = sideLengths(s, f);
    const kite = (close(p, q) && close(r, t)) || (close(q, r) && close(t, p));
    assert.ok(kite, "face is a kite");
    // The kite's two long sides are shared with triangles, so equal to a triangle's side.
    assert.ok(Math.max(p, q, r, t) - side < 1e-6);
  }
});

test("chestahedron: all seven faces have equal area", () => {
  const s = getShape({ group: "special", id: "chestahedron" });
  assert.ok(spread(s.areas) < 1e-8, `areas ${s.areas.join(", ")}`);
});

test("chestahedron: triangles meet the base at 94.83 degrees (fold 85.17)", () => {
  assert.ok(close((CHESTAHEDRON_FOLD * 180) / Math.PI, 85.169, 1e-3));
  const s = getShape({ group: "special", id: "chestahedron" });
  // The base is the bottom face (canonical order puts it last); side triangles share an edge with it.
  const base = s.faces.length - 1;
  assert.equal(s.faces[base].length, 3);
  const baseEdges = new Set(s.faces[base].map((v, i, f) => [v, f[(i + 1) % 3]].sort((a, b) => a - b).join()));
  let found = 0;
  s.faces.forEach((f, fi) => {
    if (fi === base || f.length !== 3) return;
    const shares = f.some((v, i) => baseEdges.has([v, f[(i + 1) % 3]].sort((a, b) => a - b).join()));
    if (!shares) return;
    const inside = 180 - (Math.acos(dot(s.normals[fi], s.normals[base])) * 180) / Math.PI;
    assert.ok(close(inside, 94.83, 0.01), `angle ${inside}`);
    found++;
  });
  assert.equal(found, 3);
});

// ---------- gems ----------

test("gems: the facet count asked for is the facet count you get, across the range", () => {
  for (const opts of GEM_SAMPLES) {
    const s = getShape({ group: "gem", id: "gem", ...opts });
    assert.equal(s.faces.length, opts.facets, JSON.stringify(opts));
    assert.equal(s.seed, opts.seed);
    assert.equal(s.facets, opts.facets);
  }
});

test("gems: same seed and facets give identical geometry; different seeds differ", () => {
  const a = getShape({ group: "gem", id: "gem", seed: 2026, facets: 14 });
  const b = getShape({ group: "gem", id: "gem", seed: 2026, facets: 14 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const prints = new Set(GEM_SAMPLES.map((o) => getShape({ group: "gem", id: "gem", ...o }).fingerprint));
  assert.equal(prints.size, GEM_SAMPLES.length, "every seed and facet count gives a different gem");
});

test("gems: every pane is big enough to tap and no edge is a stub", () => {
  for (const opts of GEM_SAMPLES) {
    const s = getShape({ group: "gem", id: "gem", ...opts });
    const meanArea = s.areas.reduce((x, y) => x + y) / s.areas.length;
    assert.ok(Math.min(...s.areas) >= 0.25 * meanArea - 1e-9);
    const edges = s.edges.map(([a, b]) => dist(s, a, b));
    const meanEdge = edges.reduce((x, y) => x + y) / edges.length;
    assert.ok(Math.min(...edges) >= 0.12 * meanEdge - 1e-9);
  }
});

test("gems: bad seeds and facet counts are refused with a readable message", () => {
  assert.throws(() => getShape({ group: "gem", id: "gem", seed: -1, facets: 14 }), /seed/);
  assert.throws(() => getShape({ group: "gem", id: "gem", seed: 1.5, facets: 14 }), /seed/);
  assert.throws(() => getShape({ group: "gem", id: "gem", seed: 2 ** 32, facets: 14 }), /seed/);
  assert.throws(() => getShape({ group: "gem", id: "gem", seed: 1, facets: GEM_FACETS.min - 1 }), /facets/);
  assert.throws(() => getShape({ group: "gem", id: "gem", seed: 1, facets: GEM_FACETS.max + 1 }), /facets/);
  assert.equal(getShape({ group: "gem", id: "gem", seed: 1 }).faces.length, GEM_FACETS.default);
});

test("seeded random numbers repeat exactly and stay in [0, 1)", () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(seededRandom(7)(), seededRandom(8)());
});

// ---------- stability ----------

// These fingerprints lock in the exact geometry. If one changes, every
// published tile of that shape would get its face colours on different faces:
// only change them deliberately (as a new shape version).
const LOCKED = {
  d4: "8a6eb9b3",
  d6: "94d9da0d",
  d8: "d2235f0e",
  d10: "85506c16",
  d12: "6189e6db",
  d20: "bd334729",
};
const LOCKED_CHESTAHEDRON = "6645feed";
const LOCKED_GEM_42_14 = "1532655a"; // gems: same seed + facets must keep giving the same stone

test("the exact geometry of every fixed shape is locked by fingerprint", () => {
  for (const [id, print] of Object.entries(LOCKED)) assert.equal(getShape({ group: "classic", id }).fingerprint, print, id);
  const chest = getShape({ group: "special", id: "chestahedron" });
  assert.equal(chest.fingerprint, fingerprintOf(chest.vertices, chest.faces));
  assert.equal(chest.fingerprint, LOCKED_CHESTAHEDRON);
  assert.equal(getShape({ group: "gem", id: "gem", seed: 42, facets: 14 }).fingerprint, LOCKED_GEM_42_14);
});

test("unknown shapes are refused; the tile gets only corners and faces", () => {
  assert.throws(() => getShape({ group: "classic", id: "d7" }));
  assert.throws(() => getShape({ group: "special", id: "cube" }));
  assert.throws(() => getShape(null));
  const t = shapeForTile(getShape({ group: "classic", id: "d6" }));
  assert.deepEqual(Object.keys(t), ["vertices", "faces"]);
});

test("the shape groups list what the plan agreed: six dice, the chestahedron, gems", () => {
  assert.deepEqual(SHAPE_GROUPS.map((g) => g.id), ["classic", "special", "gem"]);
  assert.deepEqual(SHAPE_GROUPS[0].shapes.map((s) => s.id), ["d4", "d6", "d8", "d10", "d12", "d20"]);
  assert.deepEqual(GEM_FACETS, { min: 10, max: 24, default: 14 });
});

test("a tile rebuilds the exact same shape from just its corners and faces", () => {
  const choices = [
    ...["d4", "d6", "d8", "d10", "d12", "d20"].map((id) => ({ group: "classic", id })),
    { group: "special", id: "chestahedron" },
    { group: "gem", id: "gem", seed: 42, facets: 14 },
    { group: "gem", id: "gem", seed: 7, facets: 24 },
  ];
  for (const choice of choices) {
    const shape = getShape(choice);
    // What the tile stores goes through JSON, then comes back.
    const stored = JSON.parse(JSON.stringify(shapeForTile(shape)));
    const rebuilt = deriveShape(stored);
    for (const key of ["vertices", "faces", "normals", "centres", "areas", "edges", "fingerprint"]) {
      assert.deepEqual(rebuilt[key], shape[key], `${shape.id} ${key}`);
    }
  }
});
