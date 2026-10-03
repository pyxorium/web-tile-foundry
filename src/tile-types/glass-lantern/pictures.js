import { kitLook, KITS } from "./lantern/kits.js";
import { alternateColours } from "./lantern/settings.js";

// The Shape and Style picture cards in the Foundry are saved pictures, made
// once (not drawn on the creator's device): public/glass-lantern/*.png.
// This file says what each picture shows; lab/lantern-pictures.html draws
// them so they can be made again if the look changes (agreed Oct 3 2026):
//   Shape: each shape alone, clear glass with a faint frost, pewter, plain dark background.
//   Style: a d6 in each style, with the style's own background.

export const PICTURE_FOLDER = "glass-lantern";
export const SHAPE_PICTURE_IDS = ["d4", "d6", "d8", "d10", "d12", "d20", "chestahedron", "gem"];
export const STYLE_PICTURE_IDS = KITS.map((k) => k.id);

export const shapePictureFile = (id) => `shape-${id}.png`;
export const stylePictureFile = (id) => `style-${id}.png`;

/** The address of a saved picture on the Foundry's site. */
export function pictureUrl(file) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  return `${base}${PICTURE_FOLDER}/${file}`;
}

const CLEAR_GLASS = "#e4eaec";

/** The look for the shape pictures: the shape is what stands out. */
export function shapePictureLook() {
  return {
    ...kitLook("tiffany"),
    background: "plain",
    bgTop: "#26221f",
    bgBottom: "#0c0a09",
    bgHalo: 0.3,
    bgVignette: 0.55,
    tabletop: false,
    metal: "pewter",
    metalRoughness: 0.35,
    palette: [CLEAR_GLASS],
    opal: 0,
    ripple: 0.08,
    frost: 0.1,
    lampWarmth: 3200,
    lampBrightness: 1.1,
    showGlow: true,
    showBulb: false,
  };
}

export function shapePictureColors(shape) {
  return alternateColours(shape.faces.length, [CLEAR_GLASS]);
}

/** The look and colors for a style's picture (a d6). */
export function stylePicture(id, shape) {
  const look = kitLook(id);
  return { look, colors: alternateColours(shape.faces.length, look.palette) };
}
