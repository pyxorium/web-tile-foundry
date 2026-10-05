// What the track generator takes in, and the tunable numbers behind it.
//
// Input: { drops, loops, corkscrews, intensity, seed, trackSwitch?, version }
//
// trackSwitch (true or false, default false): one track switch in the middle
// of the ride, where the viewer can pick a second route (see switch.js).
//
// The theme is deliberately NOT an input: switching themes changes how a ride
// looks and sounds, never its layout.
//
// GENERATOR_VERSION is stored in every recipe. Version 1 must keep producing
// exactly the same track for the same input forever (tests lock this by
// fingerprint). Any change to the shapes below is a new version, kept beside
// the old one, never an edit of it.

export const GENERATOR_VERSION = 1;
export const SUPPORTED_VERSIONS = Object.freeze([1]);

// Slider ranges (starting guesses, to tune in the ride lab).
export const RANGES = Object.freeze({
  drops: Object.freeze({ min: 1, max: 3, default: 2 }),
  loops: Object.freeze({ min: 0, max: 2, default: 1 }),
  corkscrews: Object.freeze({ min: 0, max: 2, default: 1 }),
  intensity: Object.freeze({ min: 1, max: 5, default: 3 }),
});

export const SEED_MAX = 0xffffffff;

/** Checks an input and fills in the version. Throws a plain message if something is off. */
export function checkTrackInput(input) {
  const out = {};
  for (const key of Object.keys(RANGES)) {
    const value = input?.[key];
    const { min, max } = RANGES[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be a whole number from ${min} to ${max}.`);
    }
    out[key] = value;
  }
  const seed = input?.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
    throw new Error(`The layout seed must be a whole number from 0 to ${SEED_MAX}.`);
  }
  out.seed = seed;
  const trackSwitch = input?.trackSwitch ?? false;
  if (typeof trackSwitch !== "boolean") throw new Error("trackSwitch must be true or false.");
  out.trackSwitch = trackSwitch;
  const version = input?.version ?? GENERATOR_VERSION;
  if (!SUPPORTED_VERSIONS.includes(version)) throw new Error(`Unknown track generator version ${version}.`);
  out.version = version;
  return out;
}

export const G = 9.81; // m/s²

// Fixed parts of every ride (version 1).
export const FIXED = Object.freeze({
  stationHeight: 1.5, // track height in the station, m
  valleyHeight: 2.5, // track height at the bottom of drops, m
  stationLength: 16, // m, the cart starts and ends in the middle
  brakeLength: 26, // m, flat, just before the station
  stationSpeed: 4, // m/s leaving the brakes into the station
  startPush: 1.5, // m/s² the station tires speed the cart up at
  liftSpeed: 7.5, // m/s on the chain lift (and the run up to it)
  crestLength: 5, // m, the short flat top of the lift
  friction: 0.012, // height lost per meter of track (rolling + air), m/m
  minSpeed: 3.5, // m/s, nowhere slower than this outside station and brakes
  // The ride plays a little faster than real time: shapes and forces are
  // worked out with real physics, then shown at this speed, so a full ride
  // fits a feed. The cap is in played seconds, from leaving the station to
  // stopping in it (40 played = 52 real).
  playbackSpeed: 1.3,
  timeCap: 40, // s, played
  maxTurnAngle: (150 * Math.PI) / 180,
  turnRadiusRange: Object.freeze([10, 40]), // tightest point of a turn, m
  loopJog: 6, // m sideways over the whole loop, so its way out passes beside its way in
  corkscrewRadius: 1.5, // m from the axis the track winds around
  clearance: 4.5, // m, closest two separate parts of track may come
  box: Object.freeze({ width: 300, depth: 200, height: 50 }), // m, everything must fit inside
  sampleStep: 1, // m between stored points
  // The track switch (see switch.js): the thrill route is this many played
  // seconds longer than the chill route (aiming for the most), and may run
  // that far past the time cap.
  switchExtra: Object.freeze([4, 7]),
  // The thrill route may reach a little beyond the usual box (the ride is framed to include it).
  switchBox: Object.freeze({ width: 340, depth: 240, height: 50 }),
});

// What the intensity slider changes (1 gentle to 5 wild).
export function intensitySettings(intensity) {
  const t = (intensity - 1) / 4; // 0 to 1
  const lerp = (a, b) => a + (b - a) * t;
  return {
    liftHeight: lerp(22, 36), // m
    maxGs: lerp(3.5, 5.0), // strongest push into the seat
    minAirtimeGs: lerp(0.15, -0.35), // over hilltops: below 0 means a little float
    maxDropAngle: lerp(48, 62) * (Math.PI / 180),
    hillShare: [lerp(0.5, 0.65), lerp(0.75, 0.9)], // share of the available height each hill uses
  };
}
