import { Quaternion, Vector3 } from "three";

// Rolling the lantern: the maths, kept apart from the page so it can be tested.
//
// A roll picks a face fairly (every face equally likely, whatever the shape:
// so the chestahedron and gems are fair too), works out the turn that brings
// that face round to face the viewer, and tumbles there: a few whole extra
// turns about a random axis that unwind as it settles.

/** A fair random face. `random` returns [0, 1); the browser's crypto is used when there. */
export function pickFace(count, random = secureRandom) {
  return Math.min(count - 1, Math.floor(random() * count));
}

export function secureRandom() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && c.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
}

/**
 * The orientation that turns `normal` (a face's outward normal, the lantern's
 * own coordinates) to point along `viewDir` (from the lantern towards the
 * camera), then twists it by `twist` radians about that direction.
 */
export function faceTowards(normal, viewDir, twist = 0) {
  const n = new Vector3(...normal).normalize();
  const v = new Vector3(...viewDir).normalize();
  const align = new Quaternion().setFromUnitVectors(n, v);
  const spin = new Quaternion().setFromAxisAngle(v, twist);
  return spin.multiply(align);
}

/**
 * The tumble at progress e (0..1, already eased): the way from `from` to `to`,
 * with `turns` whole extra turns about `axis` that unwind to nothing at the end.
 * At e = 0 it is exactly `from`; at e = 1 exactly `to`.
 */
export function tumbleAt(from, to, axis, turns, e, out = new Quaternion()) {
  out.slerpQuaternions(from, to, e);
  const extra = new Quaternion().setFromAxisAngle(axis, turns * 2 * Math.PI * (1 - e));
  return out.premultiply(extra);
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * The roll's feel (tuned by the user, Oct 3: "longer, heavier, luxurious; a
 * gentler slowdown; a short wind-up; a slight settle"):
 *   rollDuration  seconds from tap to rest, settle included
 *   rollSpins     whole extra turns for show (plus the turn to the chosen pane)
 *   rollWindUp    seconds spent gathering speed at the start
 *   rollEase      shape of the slowdown: 1 = even, higher = more of the motion early
 *   rollSettle    degrees it drifts past the landing point before rocking back
 */
// Tuned by the user in the lab (Oct 3): slow, heavy, nearly even unwinding.
export const ROLL_DEFAULTS = Object.freeze({ rollDuration: 3.55, rollSpins: 2, rollWindUp: 0.61, rollEase: 0.85, rollSettle: 4 });

const SETTLE_SECONDS = 0.5;

/**
 * Progress through a roll (0 at the tap, 1 at rest) as a function of seconds.
 * The speed rises smoothly over the wind-up, then falls off as
 * (1 - u)^rollEase until the landing, then a gentle bump past 1 and back
 * makes the settle. Returns { progress(t), duration }.
 */
export function makeRollCurve(options = {}) {
  const o = { ...ROLL_DEFAULTS, ...options };
  const duration = Math.max(0.3, o.rollDuration);
  const settle = Math.max(0, o.rollSettle);
  const tail = settle > 0 ? Math.min(SETTLE_SECONDS, duration * 0.3) : 0;
  const land = duration - tail; //  when the main motion reaches the chosen pane
  const windUp = Math.min(Math.max(0, o.rollWindUp), land * 0.5);
  const ease = Math.max(0.5, o.rollEase);
  const speed = (t) => {
    if (windUp > 0 && t < windUp) {
      const u = t / windUp;
      return u * u * (3 - 2 * u);
    }
    return Math.max(0, 1 - (t - windUp) / Math.max(1e-6, land - windUp)) ** ease;
  };
  // The main motion is the running total of the speed, scaled to end exactly at 1.
  const N = 2000;
  const table = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) table[i] = table[i - 1] + speed(((i - 0.5) / N) * land);
  const total = table[N];
  const main = (t) => {
    if (t <= 0) return 0;
    if (t >= land) return 1;
    const x = (t / land) * N;
    const i = Math.floor(x);
    return (table[i] + (table[Math.min(N, i + 1)] - table[i]) * (x - i)) / total;
  };
  // Settle: a smooth bump past the landing and back, as an extra fraction of the spin.
  const spins = Math.max(0, Math.round(o.rollSpins)); // whole turns, so a roll starts exactly where it was
  const amount = settle / (Math.max(spins, 0.5) * 360);
  const bumpFrom = Math.max(0, land - 0.35);
  const bump = (t) => (tail === 0 || t <= bumpFrom || t >= duration ? 0 : amount * Math.sin((Math.PI * (t - bumpFrom)) / (duration - bumpFrom)) ** 2);
  return { duration, spins, progress: (t) => (t >= duration ? 1 : main(t) + bump(t)) };
}

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A tap (roll), not a drag: barely moved and quick. */
export const TAP_MAX_MOVE = 10; //  CSS pixels
export const TAP_MAX_MS = 400;
export function isTap({ moved, ms, fingers }) {
  return fingers <= 1 && moved <= TAP_MAX_MOVE && ms <= TAP_MAX_MS;
}

/** The winning pane's glow after a roll: a quick rise, then a slow fade (seconds since it landed). */
export function glowAt(t) {
  if (t < 0) return 0;
  if (t < 0.18) return t / 0.18;
  return Math.max(0, 1 - (t - 0.18) / 1.3);
}
