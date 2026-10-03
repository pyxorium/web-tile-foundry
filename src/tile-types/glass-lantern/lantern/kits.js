import { DEFAULT_SETTINGS } from "./settings.js";

// The three style kits. Picking a kit sets the glass, metal, lamp and
// background in one go; creators can then adjust.
//
// All three were tuned by the user on the phone in the look lab (Oct 3 2026).
// The shared base is the user's first tuning: clear glass with no bending,
// thin, flat, satin came. Each kit sets its own colours, metal, lamp and
// texture. Once tiles using a kit are published, a change to that kit's
// look must bump its version (old tiles keep what they were made with: the
// recipe stores the full settings).

/** Settings that belong to the device, not the look: a kit never changes them. */
export const DEVICE_KEYS = Object.freeze(["realGlass", "glassResolution", "pixelRatio", "maxPixels", "reflections", "rippleOn", "opalOn"]);

/** The user's tuning (Oct 3), shared by every kit. */
export const KIT_BASE = Object.freeze({
  ior: 1,
  thickness: 0,
  frost: 0,
  dispersion: 0,
  farSide: true,
  cameWidth: 0.02,
  cameFlatten: 0.38,
  metalRoughness: 0.47,
});

export const KITS = Object.freeze([
  Object.freeze({
    id: "tiffany",
    label: "Tiffany",
    version: 1,
    tuned: "2026-10-03", // tuned by the user on the phone
    settings: Object.freeze({
      palette: Object.freeze(["#d68a24", "#5d8f3a", "#2c4fa3", "#a11c30", "#eadfc6"]), // amber, leaf green, cobalt, ruby, milky opal
      ripple: 0.47,
      rippleScale: 12,
      opal: 0.33, //   milky opalescent glass, the Tiffany signature
      opalScale: 2.8,
      opalGlow: 1.06,
      bezelWidth: 0.038,
      bezelDepth: 0.03,
      metal: "bronze",
      cameWidth: 0.02,
      cameFlatten: 0.38,
      metalRoughness: 0.15, // polished bronze
      rivets: false,
      lampWarmth: 2400,
      lampBrightness: 2.5,
      lampSize: 0.55,
      keyLight: 1.2,
      envIntensity: 1,
      bgTop: "#3a2618", // warm dark wood
      bgBottom: "#0e0907",
      bgHalo: 0.55,
      bgVignette: 0.6,
    }),
  }),
  Object.freeze({
    id: "victorian",
    label: "Victorian",
    version: 1,
    tuned: "2026-10-03", // tuned by the user on the phone
    settings: Object.freeze({
      palette: Object.freeze(["#7a1022", "#0f5e3c", "#1d3b8c", "#5b2a86", "#c9a043"]), // garnet, emerald, sapphire, amethyst, old gold
      ripple: 0.2,
      rippleScale: 12,
      opal: 0, //   clear jewel glass (user's choice)
      opalScale: 3,
      opalGlow: 0.6,
      bezelWidth: 0.035,
      bezelDepth: 0.03,
      metal: "blackened", // blackened silver
      cameWidth: 0.02,
      cameFlatten: 0.61,
      metalRoughness: 0.44,
      rivets: false,
      lampWarmth: 3050, //  gaslight: a little cooler than a bulb
      lampBrightness: 2.5,
      lampSize: 0.55,
      keyLight: 1.2,
      envIntensity: 1.5, // stronger reflections on the dark metal
      bgTop: "#2a1426", //  plum velvet
      bgBottom: "#0a0509",
      bgHalo: 0.45,
      bgVignette: 0.65,
    }),
  }),
  Object.freeze({
    id: "steampunk",
    label: "Steampunk",
    version: 1,
    tuned: "2026-10-03", // tuned by the user on the phone
    settings: Object.freeze({
      palette: Object.freeze(["#c77a1a", "#4a4038", "#1f6f6a", "#e0a642", "#8a3b1c"]), // amber, smoked, teal, honey, rust
      ripple: 0.5,
      rippleScale: 6,
      opal: 0.09,
      opalScale: 7.1,
      opalGlow: 0.6,
      thickness: 0.11, //  a little bending, unlike the base: chunkier workshop glass
      ior: 1.29,
      frost: 0,
      dispersion: 0,
      bezelWidth: 0.038,
      bezelDepth: 0.022,
      metal: "brass",
      cameWidth: 0.026,
      cameFlatten: 0.87, // nearly round: brass rods rather than flat lead
      metalRoughness: 0.24, // shinier than the base
      rivets: true,
      lampWarmth: 2600,
      lampBrightness: 2.5,
      lampSize: 0.36,
      keyLight: 1.3,
      envIntensity: 0.65,
      bgTop: "#2b2622", //   sooty workshop
      bgBottom: "#0b0a09",
      bgHalo: 0.4,
      bgVignette: 0.7,
    }),
  }),
]);

export function getKit(id) {
  const kit = KITS.find((k) => k.id === id);
  if (!kit) throw new Error(`Unknown kit "${id}".`);
  return kit;
}

/**
 * The full look for a kit: defaults, then the shared base, then the kit.
 * Device settings are left out, so applying a kit never changes them.
 */
export function kitLook(id) {
  const look = { ...DEFAULT_SETTINGS, ...KIT_BASE, ...getKit(id).settings };
  for (const k of DEVICE_KEYS) delete look[k];
  look.palette = [...look.palette];
  return look;
}
