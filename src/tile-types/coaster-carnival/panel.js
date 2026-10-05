import { generateTrack, RANGES, FIXED, randomSeed } from "./track/index.js";
import { THEME_IDS, THEMES, DEFAULT_THEME } from "./ride/themes.js";
import { STEEL_SCHEMES, WOOD_FINISHES, CART_COLORS, DEFAULT_COLORS } from "./ride/colors.js";

// The Coaster Carnival panel's rules: its options, starting values, and how
// the panel's values become a track and the tile's choices. Pure (no page,
// no three.js), so it is tested in Node.
//
// Values (one per panel input, plus `handle`, filled in from the signed-in
// account for the "Built by @handle" line):
//   sprite                         the creator's rpg.actor sprite, or null (the default rider)
//   theme                          the starting theme (viewers can switch)
//   drops, loops, corkscrews, intensity, seed   the track
//   trackSwitch, tunnel            "Add a switch", "Add a tunnel"
//   style, steelColors, woodColors, cartColors  the track's look and the cart
//   name, description              the link preview card

export const THEME_OPTIONS = THEME_IDS.map((id) => ({ value: id, label: THEMES[id].label }));
export const STYLE_OPTIONS = [
  { value: "steel", label: "Steel" },
  { value: "wood", label: "Wooden" },
];
export const STEEL_OPTIONS = STEEL_SCHEMES.map((s) => ({ value: s.id, label: s.label, color: s.spine }));
export const WOOD_OPTIONS = WOOD_FINISHES.map((w) => ({ value: w.id, label: w.label, color: w.supports }));
export const CART_OPTIONS = CART_COLORS.map((c) => ({ value: c.id, label: c.label, color: c.body }));
export const TRACK_RANGES = RANGES;
export const SEED_MAX = 999999999;

export function panelDefaults({ handle } = {}) {
  return {
    sprite: null,
    theme: DEFAULT_THEME,
    drops: RANGES.drops.default,
    loops: RANGES.loops.default,
    corkscrews: RANGES.corkscrews.default,
    intensity: RANGES.intensity.default,
    seed: randomSeed() % (SEED_MAX + 1),
    trackSwitch: true,
    tunnel: true,
    style: "steel",
    steelColors: DEFAULT_COLORS.steel,
    woodColors: DEFAULT_COLORS.wood,
    cartColors: DEFAULT_COLORS.cart,
    handle: handle || null,
    name: handle ? `@${handle}'s coaster` : "My coaster",
    description: "A roller coaster to ride: tap to board.",
  };
}

const whole = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);

/** What the track generator is given, from the panel's values (always in range). */
export function trackInput(values) {
  const r = RANGES;
  return {
    drops: whole(values.drops, r.drops.min, r.drops.max, r.drops.default),
    loops: whole(values.loops, r.loops.min, r.loops.max, r.loops.default),
    corkscrews: whole(values.corkscrews, r.corkscrews.min, r.corkscrews.max, r.corkscrews.default),
    intensity: whole(values.intensity, r.intensity.min, r.intensity.max, r.intensity.default),
    seed: whole(values.seed, 0, SEED_MAX, 1),
    trackSwitch: values.trackSwitch !== false,
  };
}

// Making a track can take up to about a second, so the last few are kept:
// the preview, its caption and the tile's build all ask for the same one.
const cache = new Map();
const CACHE_SIZE = 6;
const keyOf = (values) => JSON.stringify(trackInput(values));

/** The finished track for these values (made once, then kept). */
export function trackFor(values) {
  const key = keyOf(values);
  if (cache.has(key)) return cache.get(key);
  const track = generateTrack(trackInput(values));
  cache.set(key, track);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return track;
}

/** The track if it has already been made, else null (never makes one: for the caption). */
export function cachedTrack(values) {
  return cache.get(keyOf(values)) || null;
}

/** The tile's choices (see runtime/template.js, which checks them again). */
export function choicesOf(values) {
  return {
    theme: values.theme,
    style: values.style,
    colors: { steel: values.steelColors, wood: values.woodColors, cart: values.cartColors },
    tunnel: values.tunnel !== false,
    handle: values.handle || null,
  };
}

/** The rider: the creator's sprite if it is the standard 3 x 4 sheet the cart uses, else null (the default rider). */
export function usableSprite(values) {
  const s = values.sprite;
  if (!s || !s.bytes || !s.geometry) return null;
  return s.geometry.columns === 3 && s.geometry.rows === 4 ? s : null;
}

/** What /foundry.json records about the rider (where it came from, never the picture itself). */
export function riderRecipe(values) {
  const s = usableSprite(values);
  if (!s) return { kind: "default" };
  const origin = s.origin && s.origin.kind === "record" ? { kind: "record", uri: s.origin.uri, generator: s.origin.generator ?? null } : { kind: "local-file" };
  return { kind: "sprite", cid: s.cid, origin, width: s.width, height: s.height, ...s.geometry };
}

/** The panel's choices for /foundry.json. */
export function panelRecipe(values) {
  return { ...trackInput(values), theme: values.theme, style: values.style, steelColors: values.steelColors, woodColors: values.woodColors, cartColors: values.cartColors, tunnel: values.tunnel !== false };
}

/**
 * Why pieces were left out, from the generator's notes (one per piece it had
 * to leave out): "time" (the ride would run past the cap), "speed" (the cart
 * ran out of speed for it), or "room" (it didn't fit in the park: too wide,
 * couldn't close compactly, or too close to itself). The most common wins.
 */
export function leftOutReason(track) {
  const count = { time: 0, room: 0, speed: 0 };
  for (const note of track.notes || []) {
    if (/switch left out/.test(note)) continue;
    if (/too long|time cap/.test(note)) count.time++;
    else if (/speed|too slow/.test(note)) count.speed++;
    else count.room++;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "room";
}

/** The plain-words line about what was left out, and why (empty if everything fitted). */
export function leftOutLine(track, intensity = null) {
  const left = Object.entries(track.leftOut)
    .filter(([k, n]) => k !== "trackSwitch" && n > 0)
    .map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "") : k}`);
  if (!left.length) return "";
  const what = left.join(" and ");
  const many = left.length > 1 || /^[2-9]/.test(left[0]);
  const reason = leftOutReason(track);
  if (reason === "time") return `${what} left out to keep the ride under ${FIXED.timeCap} seconds`;
  if (reason === "speed") {
    const nudge = intensity == null || intensity < RANGES.intensity.max ? ". Try more intensity" : "";
    return `${what} left out: the cart ran out of speed for ${many ? "them" : "it"}${nudge}`;
  }
  return `${what} left out: ${many ? "they" : "it"} didn't fit in the park. Try a new track shape`;
}

/** The line under the preview: the shape's number, the ride's length, and what fitted. */
export function describeTrack(values, track = cachedTrack(values)) {
  if (!track) return "Making the track…";
  const parts = [`Shape ${trackInput(values).seed}`, `${Math.round(track.duration)} s ride`];
  if (track.trackSwitch) parts.push("switch");
  else if (values.trackSwitch !== false) parts.push("no room for the switch");
  const left = leftOutLine(track, trackInput(values).intensity);
  if (left) parts.push(left);
  if (values.sprite && !usableSprite(values)) parts.push("your sprite isn't the standard 3 × 4 sheet, so the default rider rides");
  return parts.join(" · ");
}
