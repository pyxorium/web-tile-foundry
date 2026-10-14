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

const READABLE = ["image/jpeg", "image/png", "image/apng", "image/webp", "image/gif", "image/avif", "image/bmp"];

// Animated pictures (v0.30.0): a GIF, an animated WebP or an APNG keeps its own
// bytes (redrawing it would keep only its first frame), up to this size each.
// A still of its first frame is made too: for readers whose device asks for
// less motion, and for the card pictures. Plan: claude/zine-v030-plan.md.
export const ANIMATED_MAX_BYTES = 3 * 1024 * 1024;
export const STILL_MAX_SIDE = 900;
export const ANIMATED_TYPES = Object.freeze(["image/gif", "image/webp", "image/png"]);

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
  if (type && !READABLE.includes(type)) return "Choose a JPEG, PNG, WebP or GIF picture.";
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

// ---- Animated pictures (v0.30.0) ----

function u32be(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
function u32le(b, i) { return b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0); }
function tag(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }

/** Whether GIF bytes hold more than one image (an animation). */
export function gifFrames(b) {
  if (b.length < 13 || tag(b, 0) !== "GIF8") return 0;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1)); // the global colour table
  let frames = 0;
  const blocks = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; };
  while (i < b.length) {
    const kind = b[i];
    if (kind === 0x3b) break; // the end
    if (kind === 0x21) { i += 2; blocks(); continue; } // an extension
    if (kind !== 0x2c) break; // not a GIF block: stop counting
    frames++;
    if (frames > 1) return frames;
    const flags = b[i + 9];
    i += 10;
    if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1)); // a local colour table
    i += 1; // the LZW code size
    blocks();
  }
  return frames;
}

/** Whether WebP bytes are an animated WebP (an ANIM chunk, or the VP8X animation flag). */
export function webpAnimated(b) {
  if (b.length < 21 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WEBP") return false;
  let i = 12;
  while (i + 8 <= b.length) {
    const id = tag(b, i), size = u32le(b, i + 4);
    if (id === "VP8X" && (b[i + 8] & 0x02)) return true;
    if (id === "ANIM" || id === "ANMF") return true;
    i += 8 + size + (size & 1);
  }
  return false;
}

/** Whether PNG bytes are an APNG: an acTL chunk (with more than one frame) before the first IDAT. */
export function pngAnimated(b) {
  if (b.length < 16 || b[0] !== 0x89 || tag(b, 1).slice(0, 3) !== "PNG") return false;
  let i = 8;
  while (i + 12 <= b.length) {
    const size = u32be(b, i), id = tag(b, i + 4);
    if (id === "acTL") return u32be(b, i + 8) > 1;
    if (id === "IDAT" || id === "IEND") return false;
    i += 12 + size;
  }
  return false;
}

/** The type of an animated picture ("image/gif", "image/webp" or "image/png"), or null for a still one. */
export function animatedType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (gifFrames(b) > 1) return "image/gif";
  if (webpAnimated(b)) return "image/webp";
  if (pngAnimated(b)) return "image/png";
  return null;
}

/** "This animation is 7.2 MB; a page can hold one up to 3 MB. …" */
export function animationTooBig(size) {
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
  return `This animation is ${mb(size)}; a page can hold one up to ${mb(ANIMATED_MAX_BYTES)}. Try a shorter or smaller one, or save it as an animated WebP (often much smaller than a GIF).`;
}

/**
 * A picture for a page, from the creator's computer: an animated one keeps
 * its own bytes, with a still of its first frame; any other is shrunk as
 * before (shrinkPicture). Returns shrinkPicture's shape, plus for an animation
 *   { animated: true, still: { bytes, contentType, width, height } }
 */
export async function preparePicture(file) {
  const problem = pictureFileProblem(file);
  if (problem) throw new Error(problem);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = animatedType(bytes);
  if (!type) return shrinkPicture(file);
  if (bytes.length > ANIMATED_MAX_BYTES) throw new Error(animationTooBig(bytes.length));
  // Its first frame, for its size and its still.
  const still = await shrinkPicture(new Blob([bytes], { type }), { maxSide: STILL_MAX_SIDE });
  let width = still.width, height = still.height;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type }));
    width = bitmap.width; height = bitmap.height;
    if (bitmap.close) bitmap.close();
  } catch { /* the still's size, scaled the same way, is close enough */ }
  return { bytes, contentType: type, width, height, animated: true, still };
}
