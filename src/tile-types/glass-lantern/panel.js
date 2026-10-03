import { getShape } from "./geometry/index.js";
import { seededRandom } from "./geometry/gem.js";
import { KITS, getKit, kitLook } from "./lantern/kits.js";
import { METALS, alternateColours } from "./lantern/settings.js";

// The creator's panel in the Foundry, as plain data and rules (no page, no
// three.js), so it can be tested in Node. Agreed with the user Oct 3 2026
// (plan doc, section 16).
//
// The panel's values:
//   shape        "d4" ... "d20", "chestahedron" or "gem"
//   gemSeed, gemFacets   the gem's seed and number of facets (gem only)
//   kit          the style: "tiffany", "victorian" or "steampunk"
//   colorMode    "easy" or "handson"
//   palette      Easy: the ticked colors, "#rrggbb", in the order offered
//   spread       Easy: "alternate", "random" or "fade"
//   spreadSeed   Easy: the seed behind "random"
//   brush        Hands-on: the color a tap paints
//   faceColors   Hands-on: one color per facet (null until Hands-on is first used)
//   metal, background, tabletop, lamp, filament   "Metal, light and background"
//   name, description   the card

export const SHAPE_OPTIONS = Object.freeze([
  ...["d4", "d6", "d8", "d10", "d12", "d20"].map((id) => ({ value: id, label: id })),
  { value: "chestahedron", label: "Chestahedron" },
  { value: "gem", label: "Gem" },
]);

export const KIT_OPTIONS = Object.freeze(KITS.map((k) => ({ value: k.id, label: k.label })));

/** The glass colors on offer: the five of each style, in style order. */
export const GLASS_COLORS = Object.freeze([
  { value: "#d68a24", label: "Amber" },
  { value: "#5d8f3a", label: "Leaf green" },
  { value: "#2c4fa3", label: "Cobalt" },
  { value: "#a11c30", label: "Ruby" },
  { value: "#eadfc6", label: "Milky opal" },
  { value: "#7a1022", label: "Garnet" },
  { value: "#0f5e3c", label: "Emerald" },
  { value: "#1d3b8c", label: "Sapphire" },
  { value: "#5b2a86", label: "Amethyst" },
  { value: "#c9a043", label: "Old gold" },
  { value: "#c77a1a", label: "Deep amber" },
  { value: "#4a4038", label: "Smoked" },
  { value: "#1f6f6a", label: "Teal" },
  { value: "#e0a642", label: "Honey" },
  { value: "#8a3b1c", label: "Rust" },
]);

export const COLOR_MODE_OPTIONS = Object.freeze([
  { value: "easy", label: "Easy" },
  { value: "handson", label: "Hands-on" },
]);

export const SPREAD_OPTIONS = Object.freeze([
  { value: "alternate", label: "Alternate" },
  { value: "random", label: "Random" },
  { value: "fade", label: "Fade, top to bottom" },
]);

export const METAL_OPTIONS = Object.freeze(
  Object.entries(METALS).map(([value, color]) => ({ value, label: value[0].toUpperCase() + value.slice(1), color }))
);

export const BACKGROUND_OPTIONS = Object.freeze([
  { value: "none", label: "None" },
  { value: "plain", label: "Plain" },
  { value: "parlour", label: "Parlour" },
  { value: "damask", label: "Damask" },
  { value: "workshop", label: "Workshop" },
]);

/** Lamp colors, in kelvin. "style" keeps the style's own tuned lamp. */
export const LAMPS = Object.freeze({ style: null, cool: 3400, warm: 2400, candle: 1850 });
export const LAMP_OPTIONS = Object.freeze([
  { value: "style", label: "Style's own" },
  { value: "cool", label: "Cool" },
  { value: "warm", label: "Warm" },
  { value: "candle", label: "Candle" },
]);

export const GEM_DEFAULT_SEED = 20261003;
export const GEM_DEFAULT_FACETS = 14;

const lower = (c) => String(c).toLowerCase();

/** The settings a style brings to the panel. */
function kitPanel(kitId) {
  const look = kitLook(kitId);
  return {
    kit: kitId,
    palette: look.palette.map(lower),
    brush: lower(look.palette[0]),
    metal: look.metal,
    background: look.background,
    tabletop: Boolean(look.tabletop),
    lamp: "style",
  };
}

export function panelDefaults(context = {}) {
  return {
    shape: "d12",
    gemSeed: GEM_DEFAULT_SEED,
    gemFacets: GEM_DEFAULT_FACETS,
    ...kitPanel("tiffany"),
    colorMode: "easy",
    spread: "alternate",
    spreadSeed: 1,
    faceColors: null,
    filament: true,
    name: context.handle ? `@${context.handle}'s glass lantern` : "My glass lantern",
    description: "A stained glass die. Drag to turn it, tap to roll it.",
  };
}

/** The geometry choice for these values (see geometry/index.js). */
export function shapeChoiceFor(values) {
  if (values.shape === "gem") return { group: "gem", id: "gem", seed: values.gemSeed, facets: values.gemFacets };
  if (values.shape === "chestahedron") return { group: "special", id: "chestahedron" };
  return { group: "classic", id: values.shape };
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((x, i) => Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, "0")).join("");
}

/** Easy mode's colors: the ticked colors spread over the facets. */
export function easyColors(values, shape) {
  const palette = (values.lookOverride && values.lookOverride.palette) || values.palette;
  const colors = palette && palette.length ? palette.map(lower) : [GLASS_COLORS[0].value];
  const n = shape.faces.length;
  if (values.spread === "random") {
    const rand = seededRandom(values.spreadSeed >>> 0);
    return Array.from({ length: n }, () => colors[Math.min(colors.length - 1, Math.floor(rand() * colors.length))]);
  }
  if (values.spread === "fade") {
    // Top to bottom by each facet's height, through the colors in order.
    const zs = shape.centres.map((c) => c[2]);
    const top = Math.max(...zs);
    const bottom = Math.min(...zs);
    return zs.map((z) => {
      if (colors.length === 1 || top - bottom < 1e-9) return colors[0];
      const t = ((top - z) / (top - bottom)) * (colors.length - 1);
      const i = Math.min(colors.length - 2, Math.floor(t));
      return mix(colors[i], colors[i + 1], t - i);
    });
  }
  return alternateColours(n, colors);
}

/** One color per facet: the painted ones in Hands-on, otherwise Easy's. */
export function faceColorsFor(values, shape) {
  const painted = values.faceColors;
  if (values.colorMode === "handson" && Array.isArray(painted) && painted.length === shape.faces.length) return painted.map(lower);
  return easyColors(values, shape);
}

/** Whether facets have been painted by hand (so a reset would lose work). */
export function isHandPainted(values) {
  const painted = values.faceColors;
  if (!Array.isArray(painted)) return false;
  const shape = getShape(shapeChoiceFor(values));
  if (painted.length !== shape.faces.length) return false;
  const easy = easyColors(values, shape);
  return painted.some((c, i) => lower(c) !== easy[i]);
}

/** The full look for these values: the style, with the panel's choices on top. */
export function lookFor(values) {
  const base = kitLook(values.kit);
  if (values.lookOverride) return { ...base, ...values.lookOverride }; // development only (lab/tile-test.html)
  const look = {
    ...base,
    palette: values.palette && values.palette.length ? values.palette.map(lower) : base.palette,
    metal: values.metal in METALS ? values.metal : base.metal,
    tabletop: Boolean(values.tabletop),
    showGlow: values.filament !== false, // "Show the filament": only the glowing spot; the lamp still lights the glass
    showBulb: false,
    lampWarmth: LAMPS[values.lamp] || base.lampWarmth,
  };
  if (values.background === "none") {
    // No background: a flat dark color, with no glow or shading behind the lantern.
    Object.assign(look, { background: "plain", bgTop: base.bgBottom, bgHalo: 0, bgVignette: 0 });
  } else if (BACKGROUND_OPTIONS.some((o) => o.value === values.background)) {
    look.background = values.background;
  }
  return look;
}

/** Everything the tile needs from the panel: { choice, shape, look, colors, slowTurn }. */
export function resolvePanel(values) {
  const choice = shapeChoiceFor(values);
  const shape = getShape(choice);
  return { choice, shape, look: lookFor(values), colors: faceColorsFor(values, shape), slowTurn: true };
}

/** The panel's choices, as kept in the tile's public recipe. */
export function panelRecipe(values) {
  const keys = ["shape", "kit", "colorMode", "palette", "spread", "spreadSeed", "metal", "background", "tabletop", "lamp", "filament"];
  const out = Object.fromEntries(keys.map((k) => [k, values[k]]));
  if (values.shape === "gem") Object.assign(out, { gemSeed: values.gemSeed, gemFacets: values.gemFacets });
  return out;
}

/** Whether the ticked colors are exactly the style's five defaults (nothing to reset). */
export function hasStylePalette(values) {
  const style = kitPanel(values.kit).palette;
  const picked = (values.palette || []).map(lower);
  return picked.length === style.length && style.every((c) => picked.includes(c));
}

/** Fresh facet colors after the shape or style changes: Easy's colors in Hands-on, none otherwise. */
function withFreshFaces(values) {
  if (values.colorMode !== "handson") return { ...values, faceColors: null };
  return { ...values, faceColors: easyColors(values, getShape(shapeChoiceFor(values))) };
}

/**
 * The panel's rules for one change (the Foundry's applyChange):
 *   - a new style resets colors, metal, background, tabletop and lamp to the style's;
 *   - a new style or shape resets painted facets, asking first if any were painted;
 *   - switching to Hands-on starts from Easy's colors (or the painting from before);
 *   - picking Random shuffles anew;
 *   - "Reset to style default colors" ticks the style's five again;
 *   - "Start over" repaints every facet with Easy's colors, asking first.
 * `random` is for tests.
 */
export function applyPanelChange(key, value, values, random = Math.random) {
  // Buttons (action inputs): they change other values; nothing is kept under their own key.
  if (key === "resetPalette") {
    return { values: { ...values, palette: kitPanel(values.kit).palette } };
  }
  if (key === "startOver") {
    const shape = getShape(shapeChoiceFor(values));
    const changed = { ...values, faceColors: easyColors(values, shape) };
    return isHandPainted(values) ? { values: changed, confirm: "Start over? Every facet goes back to your Easy colors." } : { values: changed };
  }
  const next = { ...values, [key]: value };
  if (key === "kit") {
    getKit(value); // throws on an unknown style
    const changed = withFreshFaces({ ...next, ...kitPanel(value) });
    return isHandPainted(values) ? { values: changed, confirm: "Changing the style resets the facets you painted by hand. Go ahead?" } : { values: changed };
  }
  if (key === "shape" || key === "gemSeed" || key === "gemFacets") {
    const changed = withFreshFaces(next);
    return isHandPainted(values) ? { values: changed, confirm: "Changing the shape resets the facets you painted by hand. Go ahead?" } : { values: changed };
  }
  if (key === "colorMode" && value === "handson") {
    const shape = getShape(shapeChoiceFor(next));
    const keep = Array.isArray(values.faceColors) && values.faceColors.length === shape.faces.length;
    return { values: { ...next, faceColors: keep ? values.faceColors : easyColors(next, shape) } };
  }
  if (key === "spread" && value === "random") {
    return { values: { ...next, spreadSeed: Math.floor(random() * 4294967296) } };
  }
  return { values: next };
}
