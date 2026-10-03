import { BufferGeometry, Float32BufferAttribute, Color, CylinderGeometry, SphereGeometry, Matrix4, Vector3 } from "three";

// Turns a stage 2 shape ({ vertices, faces }) into the lantern's geometry:
//
//   panes: one BufferGeometry holding every pane and its bevelled rim.
//          Attributes: position, normal, color (the face's glass colour),
//          aFace (which face, for tapping in Hands-on mode later) and
//          aRim (0 on the pane, 1 on the bevel, so the bevel can glow less).
//   came:  one BufferGeometry: a strip along every edge plus a joint at
//          every corner (bigger "rivets" when asked).
//
// Each pane is the face pulled in from its edges (a true inset, not a scale,
// so every pane has the same metal margin) and set back a little; the bevel
// joins the face's outer margin, tucked under the came, to the sunken pane.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

function faceNormal(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return norm(n);
}

function insetPoints(pts, inward, w) {
  const m = pts.length;
  return pts.map((p, i) => {
    const d1 = inward[(i + m - 1) % m];
    const d2 = inward[i];
    return add(p, mul(add(d1, d2), w / (1 + dot(d1, d2))));
  });
}
const inwardDirections = (pts, n) => pts.map((p, i) => norm(cross(n, sub(pts[(i + 1) % pts.length], p))));
// Valid while no edge has shrunk to nothing or flipped over.
const stillValid = (pts, out) => out.every((p, i) => dot(sub(out[(i + 1) % out.length], p), sub(pts[(i + 1) % pts.length], pts[i])) > 1e-9);

/** The largest inset a convex polygon can take before an edge vanishes (found by halving). */
export function maxInset(pts, n) {
  const inward = inwardDirections(pts, n);
  let lo = 0;
  let hi = 2; // shapes have radius 1, so no inset can be bigger
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stillValid(pts, insetPoints(pts, inward, mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Pulls a convex polygon (counter-clockwise around n) in by distance w, each
 * edge moving inward in parallel. Never pulls in further than 95% of what the
 * polygon can take.
 */
export function insetPolygon(pts, n, w) {
  w = Math.min(w, 0.95 * maxInset(pts, n));
  return { points: insetPoints(pts, inwardDirections(pts, n), w), w };
}

/** Builds the panes geometry. `colours` is one CSS colour per face. */
export function buildPanes(shape, colours, { cameWidth, bezelWidth, bezelDepth }) {
  const pos = [];
  const nor = [];
  const col = [];
  const face = [];
  const rim = [];
  const c = new Color();
  const push = (p, n, fi, r) => {
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    col.push(c.r, c.g, c.b);
    face.push(fi);
    rim.push(r);
  };

  shape.faces.forEach((loop, fi) => {
    c.set(colours[fi % colours.length]);
    const pts = loop.map((i) => shape.vertices[i]);
    const n = faceNormal(pts);
    // Share what the pane can take between the metal margin and the bevel,
    // so small panes on gems keep a (narrower) bevel that never turns inside out.
    const room = maxInset(pts, n);
    const outerW = Math.min(cameWidth * 0.85, room * 0.45);
    const innerW = Math.min(outerW + bezelWidth, room * 0.9);
    const outer = insetPolygon(pts, n, outerW);
    const inner = insetPolygon(pts, n, Math.max(innerW, outerW));
    const sunk = inner.points.map((p) => sub(p, mul(n, bezelDepth)));

    // The pane: a fan from its centre.
    const mid = mul(sunk.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / sunk.length);
    for (let i = 0; i < sunk.length; i++) {
      push(mid, n, fi, 0);
      push(sunk[i], n, fi, 0);
      push(sunk[(i + 1) % sunk.length], n, fi, 0);
    }
    // The bevel: one sloping quad per edge, from the outer margin down to the pane.
    for (let i = 0; i < sunk.length; i++) {
      const j = (i + 1) % sunk.length;
      const a = outer.points[i];
      const b = outer.points[j];
      const p = sunk[j];
      const q = sunk[i];
      const qn = norm(cross(sub(p, a), sub(q, b))); // across the diagonals: steady even if one side is tiny
      const nn = dot(qn, n) < 0 ? mul(qn, -1) : qn;
      for (const v of [a, b, p, a, p, q]) push(v, nn, fi, 1);
    }
  });

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("aFace", new Float32BufferAttribute(face, 1));
  g.setAttribute("aRim", new Float32BufferAttribute(rim, 1));
  return g;
}

/** Joins non-indexed copies of several geometries (position and normal only). */
function merge(geometries) {
  const pos = [];
  const nor = [];
  for (const g0 of geometries) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  return out;
}

/** Builds the came: a flattened strip along each edge and a joint at each corner. */
export function buildCame(shape, { cameWidth, cameFlatten, rivets }) {
  // Which faces meet at each edge, so each strip can lie flat against both.
  const edgeFaces = new Map();
  shape.faces.forEach((loop, fi) => {
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k).push(fi);
    });
  });
  const faceNormals = shape.faces.map((loop) => faceNormal(loop.map((i) => shape.vertices[i])));

  const parts = [];
  const m = new Matrix4();
  for (const [a, b] of shape.edges) {
    const pa = shape.vertices[a];
    const pb = shape.vertices[b];
    const along = sub(pb, pa);
    const len = Math.hypot(...along);
    const y = norm(along);
    const [f1, f2] = edgeFaces.get(`${a},${b}`);
    const z = norm(add(faceNormals[f1], faceNormals[f2])); // outward, between the two faces
    const x = cross(y, z);
    const g = new CylinderGeometry(cameWidth, cameWidth, len, 12, 1, true);
    g.scale(1, 1, cameFlatten);
    m.makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...z));
    m.setPosition(...mul(add(pa, pb), 0.5));
    g.applyMatrix4(m);
    parts.push(g);
  }
  const joint = cameWidth * (rivets ? 1.55 : 1.04);
  for (const v of shape.vertices) {
    const g = new SphereGeometry(joint, 14, 10);
    g.translate(v[0], v[1], v[2]);
    parts.push(g);
  }
  return merge(parts);
}
