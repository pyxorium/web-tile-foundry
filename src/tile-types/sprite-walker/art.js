import { paintShadow } from "./shadow.js";

// Pictures drawn from the sprite's idle pose (row 0, column 1) standing in the
// chosen background: the card's icon and banner, and the background swatches
// shown in the Foundry. All use the same scene code as the tile, so they match.
//
// Card sizes, checked against @dasl/tile-loader 2.0.0's renderCard (Oct 2 2026):
//   - the banner (first `screenshots` entry) fills a 16:9 box, cropped to
//     cover and centred, so it is made exactly 16:9;
//   - the icon (first `icons` entry) is shown at 48x48; 256 stays sharp even
//     on 3x screens.
export const ICON_SIZE = 256;
export const BANNER_WIDTH = 1280;
export const BANNER_HEIGHT = 720;
export const SWATCH_WIDTH = 192;
export const SWATCH_HEIGHT = 120;

const IDLE_COLUMN = 1;
const FRONT_ROW = 0;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function toPngBytes(canvas) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function loadSheet(spriteBytes) {
  return spriteBytes ? createImageBitmap(new Blob([spriteBytes], { type: "image/png" })) : null;
}

/** Draws one still picture: the scene, and the sprite (if any) standing in it. */
async function render(scene, sheet, geometry, w, h, heightShare) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const fh = geometry ? geometry.frameHeight : 48;
  const scale = Math.max(1, Math.floor((h * heightShare) / fh));
  ctx.imageSmoothingEnabled = false;
  const groundY = scene.paint(ctx, w, h, Math.max(1, Math.round(scale / 2)), 0);
  if (sheet) {
    const { frameWidth: fw } = geometry;
    const sw = fw * scale;
    const sh = fh * scale;
    paintShadow(ctx, w / 2, groundY, sw);
    ctx.imageSmoothingEnabled = false;
    const x = Math.round(w / 2 - sw / 2);
    const y = Math.round(groundY - sh + Math.round(sh * 0.04));
    ctx.drawImage(sheet, IDLE_COLUMN * fw, FRONT_ROW * fh, fw, fh, x, y, sw, sh);
  }
  return toPngBytes(canvas);
}

/** The card's icon and banner, as PNG bytes. */
export async function makeCardArt(spriteBytes, geometry, scene) {
  const sheet = await loadSheet(spriteBytes);
  try {
    const icon = await render(scene, sheet, geometry, ICON_SIZE, ICON_SIZE, 0.6);
    const banner = await render(scene, sheet, geometry, BANNER_WIDTH, BANNER_HEIGHT, 0.55);
    return { icon, banner };
  } finally {
    if (sheet && sheet.close) sheet.close();
  }
}

/** A small preview of a background, with the sprite in it when there is one. */
export async function makeSwatch(scene, spriteBytes, geometry) {
  const sheet = await loadSheet(spriteBytes);
  try {
    return await render(scene, sheet, geometry, SWATCH_WIDTH, SWATCH_HEIGHT, 0.5);
  } finally {
    if (sheet && sheet.close) sheet.close();
  }
}
