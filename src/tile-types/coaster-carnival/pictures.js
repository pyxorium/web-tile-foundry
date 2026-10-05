// The Starting theme picture cards in the Foundry are saved pictures, made
// once (not drawn on the creator's device): public/coaster-carnival/*.png,
// each the waiting view of one sample coaster in that theme. The default
// rider (default-sprite.png) lives in the same folder.

export const PICTURE_FOLDER = "coaster-carnival";
export const themePictureFile = (id) => `theme-${id}.png`;
export const DEFAULT_SPRITE_FILE = "default-sprite.png";

/** The address of a saved picture on the Foundry's site. */
export function pictureUrl(file) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  return `${base}${PICTURE_FOLDER}/${file}`;
}
