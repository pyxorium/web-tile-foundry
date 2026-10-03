// Shared geometry for Glass Lantern shapes.
//
// Every shape, whatever made it, ends up as the same plain data:
//   { id, group, vertices: [[x, y, z], ...],
//     faces: [[i, j, k, ...], ...],   corner loops, counter-clockwise seen from outside
//     normals, centres, areas,        one per face, same order as faces
//     edges: [[a, b], ...],           a < b, sorted
//     fingerprint }                   short, stable id of the exact geometry
//
// Conventions, so that every shape behaves the same way in the lantern:
//   - z is up. The shape is centred on the origin and scaled so its farthest
//     corner is at distance 1 (switching shapes keeps the framing).
//   - Vertices and faces are in a fixed order: top to bottom, then around
//     (by angle from +x towards +y). Face colours are stored by this order,
//     so it must never change for a published shape.
//   - Coordinates are rounded to 9 decimal places, so the data embedded in a
//     tile is short and identical every time it is computed.
//
// No dependencies: runs in Node (tests) and in the browser (Foundry).

export const ROUND = 1e9;
const KEY = 1e6; // precision used only for ordering

// ---------- small vector helpers ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / length(a));

const round = (x) => {
  const r = Math.round(x * ROUND) / ROUND;
  return r === 0 ? 0 : r; // no negative zero
};
const key = (x) => Math.round(x * KEY);
const angleOf = (p) => {
  const a = Math.atan2(key(p[1]), key(p[0]));
  return a < 0 ? a + 2 * Math.PI : a;
};
// Top to bottom, then around.
const byHeightThenAngle = (p, q) => key(q[2]) - key(p[2]) || angleOf(p) - angleOf(q);

/** Newell's method: area-weighted normal of a polygon (length = 2 x area). */
function newell(points) {
  let n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return n;
}

/** Area centroid of a planar polygon (by fan triangles). */
function polygonCentre(points) {
  const o = points[0];
  let total = 0;
  let c = [0, 0, 0];
  for (let i = 1; i < points.length - 1; i++) {
    const a = length(cross(sub(points[i], o), sub(points[i + 1], o))) / 2;
    const g = scale(add(add(o, points[i]), points[i + 1]), 1 / 3);
    c = add(c, scale(g, a));
    total += a;
  }
  return scale(c, 1 / total);
}

/**
 * The faces of the convex hull of a small set of points, each face listing
 * every point that lies on it (so a cube gets squares, not triangles), loops
 * counter-clockwise seen from outside. Brute force, fine for a few dozen points.
 */
export function hullFaces(points, tol = 1e-9) {
  const n = points.length;
  const faces = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        let normal = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        if (length(normal) < tol) continue;
        normal = normalize(normal);
        let d = dot(normal, points[i]);
        let above = 0;
        let below = 0;
        for (const p of points) {
          const s = dot(normal, p) - d;
          if (s > tol) above++;
          else if (s < -tol) below++;
        }
        if (above && below) continue;
        if (above) {
          normal = scale(normal, -1);
          d = -d;
        }
        const on = [];
        for (let m = 0; m < n; m++) if (Math.abs(dot(normal, points[m]) - d) <= tol) on.push(m);
        const id = on.join(",");
        if (seen.has(id)) continue;
        seen.add(id);
        faces.push(orderLoop(on, points, normal));
      }
    }
  }
  return faces;
}

/** Orders the points of one face counter-clockwise around `normal`. */
export function orderLoop(indices, points, normal) {
  const c = scale(indices.reduce((s, i) => add(s, points[i]), [0, 0, 0]), 1 / indices.length);
  const u = normalize(sub(points[indices[0]], c));
  const v = cross(normal, u);
  return [...indices].sort((a, b) => {
    const pa = sub(points[a], c);
    const pb = sub(points[b], c);
    return Math.atan2(dot(pa, v), dot(pa, u)) - Math.atan2(dot(pb, v), dot(pb, u));
  });
}

/** Short stable id (FNV-1a, 32 bit, hex) of exact geometry. */
export function fingerprintOf(vertices, faces) {
  const text = JSON.stringify([vertices.map((p) => p.map((x) => x.toFixed(6))), faces]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Turns raw points + faces into a finished shape: centred, scaled to radius 1,
 * rounded, in canonical order, with normals, centres, areas, edges, fingerprint.
 * `faces` may be omitted, in which case the convex hull of the points is used.
 */
export function finishShape({ id, group, points, faces }, extra = {}) {
  faces = faces || hullFaces(points);

  // Centre on the middle of the corners, scale so the farthest corner is at 1.
  const used = [...new Set(faces.flat())];
  const mid = scale(used.reduce((s, i) => add(s, points[i]), [0, 0, 0]), 1 / used.length);
  const radius = Math.max(...used.map((i) => length(sub(points[i], mid))));
  const placed = new Map(used.map((i) => [i, scale(sub(points[i], mid), 1 / radius).map(round)]));

  // Make every loop counter-clockwise from outside (outward normal).
  faces = faces.map((f) => {
    const pts = f.map((i) => placed.get(i));
    const outward = dot(newell(pts), polygonCentre(pts)) > 0;
    return outward ? f : [...f].reverse();
  });

  // Canonical vertex order.
  const order = [...used].sort((a, b) => byHeightThenAngle(placed.get(a), placed.get(b)));
  const renumber = new Map(order.map((old, i) => [old, i]));
  const vertices = order.map((old) => placed.get(old));

  // Renumber, start each loop at its lowest index, then canonical face order.
  faces = faces.map((f) => {
    const g = f.map((i) => renumber.get(i));
    const start = g.indexOf(Math.min(...g));
    return [...g.slice(start), ...g.slice(0, start)];
  });
  const centreOf = (f) => polygonCentre(f.map((i) => vertices[i]));
  faces.sort((a, b) => byHeightThenAngle(centreOf(a), centreOf(b)));

  return deriveShape({ id, group, ...extra, vertices, faces });
}

/**
 * Rebuilds a full shape from just its vertices and faces, keeping their order
 * exactly as given. A tile only stores vertices and faces; this gives it back
 * the normals, centres, areas and edges. finishShape uses it too, so the two
 * always agree.
 */
export function deriveShape(shape) {
  const { vertices, faces } = shape;
  const normals = [];
  const centres = [];
  const areas = [];
  for (const f of faces) {
    const pts = f.map((i) => vertices[i]);
    const n = newell(pts);
    normals.push(normalize(n));
    areas.push(length(n) / 2);
    centres.push(polygonCentre(pts));
  }

  const edgeSet = new Set();
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      edgeSet.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  }
  const edges = [...edgeSet].map((s) => s.split(",").map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  return { ...shape, vertices, faces, normals, centres, areas, edges, fingerprint: fingerprintOf(vertices, faces) };
}

/**
 * Checks that a shape is a closed, convex solid with flat faces and outward
 * normals. Returns a list of problems (empty when all is well).
 */
export function checkShape(shape, tol = 1e-7) {
  const problems = [];
  const { vertices: V, faces: F, normals: N } = shape;
  if (V.length - shape.edges.length + F.length !== 2) problems.push("Euler's formula V - E + F = 2 fails");

  // Closed and consistently wound: every directed edge appears once, its reverse once.
  const directed = new Map();
  for (const f of F) {
    if (f.length < 3) problems.push("a face has fewer than 3 corners");
    for (let i = 0; i < f.length; i++) {
      const k = `${f[i]},${f[(i + 1) % f.length]}`;
      directed.set(k, (directed.get(k) || 0) + 1);
    }
  }
  for (const [k, count] of directed) {
    const [a, b] = k.split(",");
    if (count !== 1 || directed.get(`${b},${a}`) !== 1) {
      problems.push(`edge ${a}-${b} is not shared by exactly two faces`);
      break;
    }
  }

  F.forEach((f, fi) => {
    const n = N[fi];
    const d = dot(n, V[f[0]]);
    for (const i of f) if (Math.abs(dot(n, V[i]) - d) > tol) problems.push(`face ${fi} is not flat`);
    for (const p of V) if (dot(n, p) - d > tol) problems.push(`not convex at face ${fi}`);
    if (dot(n, shape.centres[fi]) <= 0) problems.push(`face ${fi} normal points inward`);
  });
  return [...new Set(problems)];
}
