import { finishShape, hullFaces, cross, sub, dot, normalize, scale } from "./polyhedron.js";

// The classic dice: d4, d6, d8, d10, d12, d20.
// Each is described by its corner points; the faces come from the convex hull.

const PHI = (1 + Math.sqrt(5)) / 2;

// Every sign combination of a point, e.g. [±1, ±1, 0].
function signs(p) {
  let out = [[]];
  for (const x of p) out = out.flatMap((q) => (x === 0 ? [[...q, 0]] : [[...q, x], [...q, -x]]));
  return out;
}
// The three cyclic rotations of each point: (x, y, z), (y, z, x), (z, x, y).
const cyclic = (pts) => pts.flatMap(([x, y, z]) => [[x, y, z], [y, z, x], [z, x, y]]);

/**
 * d10: the pentagonal trapezohedron, made as the dual of the regular pentagonal
 * antiprism (two pentagons, ten equilateral triangles). Each face plane of the
 * antiprism becomes a corner of the d10 (its pole, normal / distance), so the
 * ten kites come out exactly flat and identical: the familiar d10.
 */
function d10Points() {
  const s18 = Math.sin(Math.PI / 10);
  const s36 = Math.sin(Math.PI / 5);
  const half = Math.sqrt(s36 * s36 - s18 * s18); // half height of the antiprism, radius 1, all edges equal
  const antiprism = [];
  for (let k = 0; k < 5; k++) {
    const a = (2 * k * Math.PI) / 5;
    antiprism.push([Math.cos(a), Math.sin(a), half]);
    antiprism.push([Math.cos(a + Math.PI / 5), Math.sin(a + Math.PI / 5), -half]);
  }
  return hullFaces(antiprism).map((face) => {
    const pts = face.map((i) => antiprism[i]);
    const n = normalize(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    return scale(n, 1 / dot(n, pts[0]));
  });
}

const POINTS = {
  d4: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  d6: signs([1, 1, 1]),
  d8: cyclic(signs([1, 0, 0])).filter((p, i, all) => all.findIndex((q) => q.join() === p.join()) === i),
  d10: d10Points(),
  d12: [...signs([1, 1, 1]), ...cyclic(signs([0, 1 / PHI, PHI]))],
  d20: cyclic(signs([0, 1, PHI])),
};

export const CLASSIC_DICE = Object.freeze([
  { id: "d4", label: "d4", faces: 4 },
  { id: "d6", label: "d6", faces: 6 },
  { id: "d8", label: "d8", faces: 8 },
  { id: "d10", label: "d10", faces: 10 },
  { id: "d12", label: "d12", faces: 12 },
  { id: "d20", label: "d20", faces: 20 },
]);

export function classicDie(id) {
  const points = POINTS[id];
  if (!points) throw new Error(`Unknown die "${id}".`);
  return finishShape({ id, group: "classic", points });
}
