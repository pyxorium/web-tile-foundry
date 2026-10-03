// Every look setting the lantern understands, with its starting value.
//
// These are what the look lab's sliders change. The values we settle on while
// tuning become the three kits (Tiffany, Victorian, Steampunk). The starting
// values here are a rough Tiffany-ish placeholder, not a finished kit.
//
// Plain data only (no three.js), so tests and the Foundry can read it.

export const METALS = Object.freeze({
  brass: "#b58a3c",
  copper: "#b46a3c",
  bronze: "#8c6239",
  pewter: "#8b8e90",
  silver: "#c8c8c6",
  blackened: "#3b3734",
});

export const PIXEL_RATIOS = Object.freeze(["1", "1.5", "2", "device"]);
export const GLASS_RESOLUTIONS = Object.freeze(["full", "half"]);

/**
 * The pixel ratio to draw at: the chosen sharpness, but never more pixels than
 * the budget (an ultrawide window can be 5 million pixels at ratio 1).
 */
export function pixelRatioFor({ width, height, devicePixelRatio = 1, pixelRatio = "2", maxPixels = Infinity }) {
  const wanted = pixelRatio === "device" ? devicePixelRatio : Math.min(devicePixelRatio, Number(pixelRatio));
  const budget = Math.sqrt(maxPixels / Math.max(1, width * height));
  const ratio = Math.min(wanted, budget);
  return { ratio, capped: ratio < wanted };
}

export const DEFAULT_SETTINGS = Object.freeze({
  // Glass (both kinds)
  palette: Object.freeze(["#d68a24", "#5d8f3a", "#2c4fa3", "#a11c30", "#eadfc6"]),
  ripple: 0.35, //        rippled cathedral glass (0 = smooth)
  rippleScale: 9,
  opal: 0.0, //           milky opalescent swirl (0 = clear)
  opalScale: 3,
  opalGlow: 0.6, //       how brightly milky glass glows with the lamp (real glass)

  // Real glass (the main look)
  thickness: 0.12, //     how chunky the panes feel
  ior: 1.52, //           bending: 1 = none, 1.5 = window glass, 2+ = jewel
  frost: 0.08, //         0 = crystal clear, higher = softly blurred
  dispersion: 0.25, //    rainbow edges
  farSide: true, //       see the far panes through the near ones

  // Backup glass (cheap glow, for slower devices)
  glow: 1.6, //           how strongly the inner lamp shines through the panes
  surface: 0.22, //       how much the glass shows its colour in outside light
  glassRoughness: 0.12, // blur of reflections on the backup glass

  // Panes set into the metal
  bezelWidth: 0.035, //   width of the bevelled rim round each pane
  bezelDepth: 0.03, //    how far each pane sits in

  // Came (the metal strips)
  metal: "brass",
  cameWidth: 0.045, //    radius of the strip
  cameFlatten: 0.55, //   1 = round rod, lower = flatter strip
  metalRoughness: 0.32,
  rivets: false, //       bigger joints at the corners (steampunk)

  // Lamp (inside the lantern)
  lampWarmth: 2400, //    colour temperature, in kelvin
  lampBrightness: 2.5,
  lampSize: 0.55, //      size of the soft glow
  showBulb: false, //     the old round bulb, for comparison

  // Light
  keyLight: 1.2, //       light from outside, upper left
  envIntensity: 1.0,

  // Background (placeholder until the kit backgrounds exist)
  bgTop: "#3a2618",
  bgBottom: "#0e0907",
  bgHalo: 0.55, //        warm glow behind the lantern
  bgVignette: 0.6,

  // Expensive parts, switchable for the phone check
  reflections: true, //   generated studio environment for metal and glass
  rippleOn: true,
  opalOn: true,
  realGlass: true, //     three.js refraction (transmission); off = backup glass
  glassResolution: "full", // "half" draws what's seen through the glass at half size (much cheaper)
  pixelRatio: "2",
  maxPixels: 1600000, //  pixel budget (a big phone at sharpness 2 is about 1.5 million): bigger canvases draw at lower resolution and scale up
});

/** Colour temperature (kelvin) to an RGB hex string. Tanner Helland's approximation. */
export function kelvinToHex(k) {
  const t = k / 100;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}

/** One colour per face from a palette, repeating in the fixed face order. */
export function alternateColours(faceCount, palette) {
  return Array.from({ length: faceCount }, (_, i) => palette[i % palette.length]);
}
