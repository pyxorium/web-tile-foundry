import { createCoasterScene } from "./ride/scene.js";

// The card's pictures: the coaster drawn once, off screen, with the same
// scene code as the tile, so the card shows exactly what the tile will. Drawn
// only when the creator presses Publish (they take real graphics work).
//
// Sizes match the other tile types (checked against @dasl/tile-loader 2.0.0):
//   icon    256 x 256, shown at 48 x 48 on the card: close on the cart and rider
//   banner  1280 x 720 (16:9), the card's big picture: the whole coaster,
//           waiting in its starting theme, as the tile first shows it
export const ICON_SIZE = 256;
export const BANNER_WIDTH = 1280;
export const BANNER_HEIGHT = 720;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function toPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * One still picture, `width` x `height`, drawn `supersample` times bigger and
 * scaled down for smooth edges. `rider` is a loaded image (or null).
 */
async function still({ track, choices, rider, width, height, shot, supersample = 1 }) {
  const w = width * supersample;
  const h = height * supersample;
  const glCanvas = makeCanvas(w, h);
  const ride = createCoasterScene(glCanvas, { quality: 1 });
  try {
    ride.setStyle(choices.style);
    ride.setColors(choices.colors || {});
    ride.setTunnel(choices.tunnel !== false);
    ride.setTrack(track);
    ride.setTheme(choices.theme);
    if (rider) ride.setRider(rider);
    ride.renderStill(w, h, shot);
    // Copied at once, in the same moment as the drawing, while the picture is still there.
    const out = makeCanvas(width, height);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(glCanvas, 0, 0, width, height);
    return await toPngBytes(out);
  } finally {
    ride.dispose();
    // Hand the graphics back straight away (browsers allow only a few at once).
    try {
      ride.renderer.forceContextLoss();
    } catch {
      /* already gone */
    }
  }
}

/** Loads PNG bytes as an image, ready to draw. */
export async function imageFromBytes(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** { icon, banner }: PNG bytes for the card. `track` is the finished track; `sprite` the rider's PNG bytes. */
export async function makeCardArt({ track, choices, sprite }) {
  const rider = sprite ? await imageFromBytes(sprite) : null;
  const icon = await still({ track, choices, rider, width: ICON_SIZE, height: ICON_SIZE, shot: "rider", supersample: 2 });
  const banner = await still({ track, choices, rider, width: BANNER_WIDTH, height: BANNER_HEIGHT, shot: "wide" });
  return { icon, banner };
}
