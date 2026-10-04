// Small 3D vector helpers for the track maths. Vectors are plain [x, y, z]
// arrays. The world is in meters, with y pointing up and the ground at y = 0.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.sqrt(dot(a, a));
export const distance = (a, b) => length(sub(a, b));

export function normalize(a) {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}

/** a plus k times b. */
export const addScaled = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** The part of v at right angles to the unit vector t. */
export function perpendicular(v, t) {
  return normalize(sub(v, scale(t, dot(v, t))));
}

/** Turns v around the unit axis by angle (radians), right-hand rule. */
export function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * k, v[1] * c + x[1] * s + axis[1] * k, v[2] * c + x[2] * s + axis[2] * k];
}

/** Angle between two unit vectors, in radians. */
export function angleBetween(a, b) {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** Rounds to millimeters, so stored tracks don't carry noise digits. */
export const roundMm = (x) => Math.round(x * 1000) / 1000;
export const round3 = (p) => p.map(roundMm);

/** 0 to 1 with zero slope and zero curvature at both ends (Perlin's smootherstep). */
export function smootherstep(u) {
  const x = Math.max(0, Math.min(1, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// "Plateau" progress, for turns and corkscrews: the rate of turning eases in
// over the first `ramp` share, holds steady, and eases out over the last
// `ramp` share. plateau(u) runs 0 to 1; plateauRate(u) is its rate (average 1,
// steady part 1 / (1 − ramp)).
export const PLATEAU_RAMP = 0.25;
const smootherIntegral = (x) => x * x * x * x * (x * (x - 3) + 2.5); // ∫ smootherstep, 0 to x

export function plateau(u, ramp = PLATEAU_RAMP) {
  const x = Math.max(0, Math.min(1, u));
  let area;
  if (x < ramp) area = ramp * smootherIntegral(x / ramp);
  else if (x <= 1 - ramp) area = ramp / 2 + (x - ramp);
  else area = 1 - ramp - ramp * smootherIntegral((1 - x) / ramp);
  return area / (1 - ramp);
}

export function plateauRate(u, ramp = PLATEAU_RAMP) {
  const x = Math.max(0, Math.min(1, u));
  const shape = x < ramp ? smootherstep(x / ramp) : x <= 1 - ramp ? 1 : smootherstep((1 - x) / ramp);
  return shape / (1 - ramp);
}
