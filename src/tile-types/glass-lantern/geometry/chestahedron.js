import { finishShape } from "./polyhedron.js";

// The chestahedron (Frank Chester, 2000): seven faces, four equilateral
// triangles and three kites, all seven of equal area. 7 corners, 12 edges.
//
// How it is built here:
//   - A base: an equilateral triangle L0 L1 L2 with side 1, flat at z = 0.
//   - Over each base edge, a second equilateral triangle (side 1) hinged on
//     that edge and folded up by an angle `fold` from the ground plane. Its
//     free corner is U.
//   - A tip P on the vertical axis. Each kite is P, U, L, U' around one base
//     corner L. Because the two U's are mirror images across the plane through
//     the axis and L, the kite is flat exactly when P lies on the line from L
//     through the midpoint of U U'. That fixes P for any fold.
//   - That leaves one free number, the fold. As the fold rises the kites
//     shrink, so exactly one fold makes each kite's area equal to a triangle's.
//     It is found below by bisection: 85.17 degrees, which puts the triangles
//     at 94.83 degrees to the base, the angle usually quoted for Chester's
//     chestahedron. The tests check the result: four equilateral triangles,
//     three kites, seven equal areas.
//
// The coordinates are computed once, deterministically, and then embedded in
// each tile (the tile never recomputes them).

const SQRT3 = Math.sqrt(3);
const TRIANGLE_AREA = SQRT3 / 4;
const BASE_ANGLES = [90, 210, 330].map((d) => (d * Math.PI) / 180);
const BASE = BASE_ANGLES.map((a) => [Math.cos(a) / SQRT3, Math.sin(a) / SQRT3, 0]);

function cornersFor(fold) {
  // U[i] stands over base edge BASE[i-1]..BASE[i].
  const U = BASE.map((b, i) => {
    const a = BASE[(i + 2) % 3];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const out = Math.hypot(mx, my);
    const reach = (SQRT3 / 2) * Math.cos(fold); // the triangle's height, projected outward
    return [mx + (mx / out) * reach, my + (my / out) * reach, (SQRT3 / 2) * Math.sin(fold)];
  });
  // Tip: on the axis, on the line from BASE[0] through the midpoint of U[0] U[1].
  const L = BASE[0];
  const M = [(U[0][0] + U[1][0]) / 2, (U[0][1] + U[1][1]) / 2, (U[0][2] + U[1][2]) / 2];
  const d = [M[0] - L[0], M[1] - L[1], M[2] - L[2]];
  const t = -(L[0] * d[0] + L[1] * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  const P = [0, 0, L[2] + t * d[2]];
  const kiteArea = 0.5 * Math.hypot(P[0] - L[0], P[1] - L[1], P[2] - L[2]) * Math.hypot(U[0][0] - U[1][0], U[0][1] - U[1][1], U[0][2] - U[1][2]);
  return { U, P, kiteArea };
}

/** Finds the fold (radians) at which kites and triangles have equal area. */
function solveFold() {
  let lo = (60 * Math.PI) / 180; // kites larger than triangles here
  let hi = (89.9 * Math.PI) / 180; // smaller here
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cornersFor(mid).kiteArea > TRIANGLE_AREA) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const CHESTAHEDRON_FOLD = solveFold();

export function chestahedron() {
  const { U, P } = cornersFor(CHESTAHEDRON_FOLD);
  // Point indices: 0 P, 1-3 U0..U2, 4-6 L0..L2. Faces listed by hand so the
  // structure is explicit (finishShape fixes winding and order).
  const points = [P, ...U, ...BASE];
  const faces = [
    [4, 5, 6], // base triangle
    [6, 4, 1], // U0 over L2-L0
    [4, 5, 2], // U1 over L0-L1
    [5, 6, 3], // U2 over L1-L2
    [0, 1, 4, 2], // kite around L0
    [0, 2, 5, 3], // kite around L1
    [0, 3, 6, 1], // kite around L2
  ];
  return finishShape({ id: "chestahedron", group: "special", points, faces });
}
