import { createLantern } from "./lantern/scene.js";

// The card's pictures: the lantern drawn once, off screen, with the same scene
// code as the tile, so the card shows exactly what the tile will.
//
// Sizes match Sprite Walker's (checked against @dasl/tile-loader 2.0.0):
//   icon    256 x 256, shown at 48 x 48 on the card
//   banner  1280 x 720 (16:9), the card's big picture
export const ICON_SIZE = 256;
export const BANNER_WIDTH = 1280;
export const BANNER_HEIGHT = 720;

const ICON_FILL = 0.94; //   the icon is tiny on the card: let the lantern fill it
const BANNER_FILL = 0.84; // the same framing as the tile

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

// While pictures are being drawn the page is briefly busy; a live lantern on
// the same page (the Foundry's preview) hears about it and holds off judging
// the device's speed (see "glass-lantern:busy" in runtime/mount.js).
let drawing = 0;
function setBusy(change) {
  drawing += change;
  if (typeof dispatchEvent === "function" && typeof CustomEvent === "function") {
    dispatchEvent(new CustomEvent("glass-lantern:busy", { detail: { busy: drawing > 0 } }));
  }
}

/**
 * One still picture of the lantern, `width` x `height`. Drawn `supersample`
 * times bigger and scaled down, for smooth edges.
 */
async function still({ shape, colors, look, width, height, fill, supersample = 1 }) {
  const w = width * supersample;
  const h = height * supersample;
  setBusy(1);
  const glCanvas = makeCanvas(w, h);
  // Full look: card pictures are drawn once, so there is no need to save effort.
  const lantern = createLantern(glCanvas, { ...look, pixelRatio: "1", maxPixels: Infinity, glassResolution: "full" }, { fill });
  try {
    lantern.setShape(shape);
    if (colors) lantern.setColours(colors);
    lantern.resize(w, h);
    lantern.render();
    // Copied at once, in the same moment as the drawing, while the picture is still there.
    const out = makeCanvas(width, height);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(glCanvas, 0, 0, width, height);
    return await toPngBytes(out);
  } finally {
    lantern.dispose();
    // Hand the graphics back straight away (browsers allow only a few at once).
    lantern.renderer.forceContextLoss();
    setBusy(-1);
  }
}

/** { icon, banner }: PNG bytes for the card. `shape` is a full shape (with normals). */
export async function makeCardArt({ shape, colors, look }) {
  const icon = await still({ shape, colors, look, width: ICON_SIZE, height: ICON_SIZE, fill: ICON_FILL, supersample: 2 });
  const banner = await still({ shape, colors, look, width: BANNER_WIDTH, height: BANNER_HEIGHT, fill: BANNER_FILL });
  return { icon, banner };
}

// The picture cards for Shape and Style in the Foundry (same size as Sprite Walker's).
export const SWATCH_WIDTH = 192;
export const SWATCH_HEIGHT = 120;

/**
 * A small picture of the lantern, for a picture card, at `scale` times the
 * card size (2 stays sharp on high-resolution screens). Used only to make the
 * saved pictures (lab/lantern-pictures.html); the Foundry shows those files.
 */
export function makeSwatch({ shape, colors, look, scale = 2 }) {
  return still({ shape, colors, look, width: SWATCH_WIDTH * scale, height: SWATCH_HEIGHT * scale, fill: 0.86, supersample: 2 });
}
