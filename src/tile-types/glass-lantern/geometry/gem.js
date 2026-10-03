import { finishShape, orderLoop, checkShape, dot, length, sub } from "./polyhedron.js";

// Gems: irregular cut stones, made from a seed.
//
// Method: start with a ball and slice it with N flat cuts (planes), keeping
// what is inside all of them. Each cut becomes one pane, so the facet count is
// exact, the result is always convex, and the panes mostly have 4 to 7 sides like cut
// glass (wrapping random points instead would give mostly thin triangles).
//
// The cut directions are spread evenly over the ball (a Fibonacci sphere),
// turned to a random orientation, then each nudged a little at random, and
// each cut is set at a slightly random depth. The stone may also be stretched
// a little along its height.
//
// A candidate is thrown away and the next one drawn (from the same seeded
// sequence, so still deterministic) if any pane is too small to tap, any edge
// is too short to hold a came, or a cut did not make a pane at all.
//
// Same seed + same facet count = same gem, every time. The Foundry computes the
// gem once and embeds the final corners and faces in the tile, so the tile
// never depends on this code or on floating-point details of a browser.

export const GEM_FACETS = Object.freeze({ min: 10, max: 24, default: 14 });

const MIN_AREA_SHARE = 0.25; // smallest pane at least 25% of the average pane
const MIN_EDGE_SHARE = 0.12; // shortest edge at least 12% of the average edge
const MAX_ATTEMPTS = 200;

/** mulberry32: small, fast, seeded random numbers in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for the "new shape" button (not used when building). */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296);
}

export function checkGemOptions({ seed, facets }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("A gem's seed must be a whole number from 0 to 4294967295.");
  if (!Number.isInteger(facets) || facets < GEM_FACETS.min || facets > GEM_FACETS.max) {
    throw new Error(`A gem must have between ${GEM_FACETS.min} and ${GEM_FACETS.max} facets.`);
  }
}

// A uniformly random rotation (from a random unit quaternion), as a function.
function randomRotation(rand) {
  const [u1, u2, u3] = [rand(), rand(), rand()];
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const [w, x, y, z] = [a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3)];
  return ([px, py, pz]) => [
    (1 - 2 * (y * y + z * z)) * px + 2 * (x * y - w * z) * py + 2 * (x * z + w * y) * pz,
    2 * (x * y + w * z) * px + (1 - 2 * (x * x + z * z)) * py + 2 * (y * z - w * x) * pz,
    2 * (x * z - w * y) * px + 2 * (y * z + w * x) * py + (1 - 2 * (x * x + y * y)) * pz,
  ];
}

function cutPlanes(rand, facets) {
  const rotate = randomRotation(rand);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spacing = Math.sqrt((4 * Math.PI) / facets); // rough angle between neighbouring cuts
  const planes = [];
  for (let i = 0; i < facets; i++) {
    const z = 1 - (2 * (i + 0.5)) / facets;
    const r = Math.sqrt(1 - z * z);
    let n = rotate([r * Math.cos(golden * i), r * Math.sin(golden * i), z]);
    // Nudge sideways by up to ~25% of the spacing.
    const jitter = [rand() - 0.5, rand() - 0.5, rand() - 0.5].map((v) => v * spacing * 0.5);
    n = n.map((v, k) => v + jitter[k]);
    const len = length(n);
    n = n.map((v) => v / len);
    planes.push({ n, d: 1 - 0.15 * rand() });
  }
  return planes;
}

// Solve n1.x = d1, n2.x = d2, n3.x = d3 (Cramer's rule). Null if nearly parallel.
function meet(p, q, r) {
  const [a, b, c] = [p.n, q.n, r.n];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-9) return null;
  const bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
  const ca = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
  const ab = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [0, 1, 2].map((k) => (p.d * bc[k] + q.d * ca[k] + r.d * ab[k]) / det);
}

/** The solid inside every plane: corners and one face per plane, or null if a plane is wasted. */
function cutSolid(planes, tol = 1e-9) {
  const points = [];
  const n = planes.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const x = meet(planes[i], planes[j], planes[k]);
        if (!x || planes.some((p) => dot(p.n, x) > p.d + tol)) continue;
        if (!points.some((y) => length(sub(x, y)) < 1e-7)) points.push(x);
      }
    }
  }
  const faces = [];
  for (const p of planes) {
    const on = [];
    points.forEach((x, idx) => {
      if (Math.abs(dot(p.n, x) - p.d) < 1e-7) on.push(idx);
    });
    if (on.length < 3) return null;
    faces.push(orderLoop(on, points, p.n));
  }
  return { points, faces };
}

export function gem({ seed, facets = GEM_FACETS.default }) {
  checkGemOptions({ seed, facets });
  const rand = seededRandom(seed);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const planes = cutPlanes(rand, facets);
    const stretch = 1 + 0.3 * rand();
    const solid = cutSolid(planes);
    if (!solid) continue;
    const points = solid.points.map(([x, y, z]) => [x, y, z * stretch]);
    const shape = finishShape({ id: "gem", group: "gem", points, faces: solid.faces }, { seed, facets });
    if (shape.faces.length !== facets) continue;
    const mean = shape.areas.reduce((s, a) => s + a, 0) / facets;
    if (Math.min(...shape.areas) < MIN_AREA_SHARE * mean) continue;
    const edgeLengths = shape.edges.map(([a, b]) => length(sub(shape.vertices[a], shape.vertices[b])));
    const meanEdge = edgeLengths.reduce((s, e) => s + e, 0) / edgeLengths.length;
    if (Math.min(...edgeLengths) < MIN_EDGE_SHARE * meanEdge) continue;
    if (checkShape(shape).length) continue;
    return shape;
  }
  throw new Error(`Could not cut a gem with ${facets} facets from seed ${seed}.`);
}
