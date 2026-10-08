// Making a creator's picture small enough for a tile, in the browser.
//
// A photo from a phone is often 3 to 8 MB; a tile has a few MB for everything.
// shrinkPicture() reads the picture (turned upright, the way the camera meant
// it), scales it so its long side is at most `maxSide` pixels, and saves it as
// WebP (or JPEG where the browser can't make WebP, as older Safari can't).
// Nothing leaves the computer.

export const PICTURE_MAX_SIDE = 1200;
export const PICTURE_QUALITY = 0.82;
/** Pictures bigger than this before shrinking are refused (they'd need too much memory). */
export const PICTURE_MAX_INPUT_BYTES = 40 * 1024 * 1024;

const READABLE = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"];

/** The size a picture is scaled to: long side at most maxSide, never enlarged. */
export function fitSize(width, height, maxSide = PICTURE_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A plain sentence when a file can't be used as a picture, or null when it can be tried. */
export function pictureFileProblem(file) {
  const type = String((file && file.type) || "").toLowerCase();
  const name = String((file && file.name) || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || /\.hei[cf]$/.test(name)) {
    return "This is an iPhone HEIC photo, which most browsers can't open. Save it as a JPEG first (on the iPhone: Share, then Save as JPEG, or set Camera > Formats to Most Compatible).";
  }
  if (type && !READABLE.includes(type)) return "Choose a JPEG, PNG or WebP picture.";
  if (file && file.size > PICTURE_MAX_INPUT_BYTES) return "This picture is very large (over 40 MB). Choose a smaller copy.";
  return null;
}

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function toBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrinks a picture (a File or Blob). Returns
 *   { bytes: Uint8Array, contentType: "image/webp" | "image/jpeg", width, height }
 * Throws an Error with a plain message when it can't.
 */
export async function shrinkPicture(file, { maxSide = PICTURE_MAX_SIDE, quality = PICTURE_QUALITY } = {}) {
  const problem = pictureFileProblem(file);
  if (problem) throw new Error(problem);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This picture couldn't be opened. Try saving it as a JPEG or PNG first.");
  }
  try {
    const size = fitSize(bitmap.width, bitmap.height, maxSide);
    const canvas = canvasOf(size.width, size.height);
    const g = canvas.getContext("2d");
    // Transparent parts (PNG) go onto white, like a picture on a page.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size.width, size.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, size.width, size.height);
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) throw new Error("This browser couldn't save the picture.");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type, width: size.width, height: size.height };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

/**
 * Where a picture sits in a frame it fills (a "Fill" crop): { x, y, w, h } in
 * the frame's pixels. (cx, cy) is the point of the picture, 0 to 1 across and
 * down, kept at the frame's middle as far as the picture's edges allow; zoom
 * (1 or more) enlarges it beyond just covering the frame.
 * Self-contained (no outside names), so a tile's page can carry its source too.
 */
export function cropRect(picW, picH, boxW, boxH, cx, cy, zoom) {
  var s = Math.max(boxW / picW, boxH / picH) * Math.max(1, zoom || 1);
  var w = picW * s, h = picH * s;
  var x = Math.min(0, Math.max(boxW - w, boxW / 2 - cx * w));
  var y = Math.min(0, Math.max(boxH - h, boxH / 2 - cy * h));
  return { x: x, y: y, w: w, h: h };
}

/** The crop point moved as far as it can still matter (no further than the edges allow). */
export function clampCrop(picW, picH, boxW, boxH, crop) {
  const r = cropRect(picW, picH, boxW, boxH, 0.5, 0.5, crop.zoom);
  const limit = (v, size, box) => (size <= box ? 0.5 : Math.min(1 - box / (2 * size), Math.max(box / (2 * size), v)));
  return { x: limit(crop.x, r.w, boxW), y: limit(crop.y, r.h, boxH), zoom: crop.zoom };
}
