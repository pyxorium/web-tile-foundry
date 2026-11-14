import { kitById } from "./kits.js";

// The card's pictures: a cassette in the tape's kit colors, drawn with the
// browser's 2D canvas (no 3D, so it's quick), with the label written on it.
//
// A tape's length (tape.json label.length, v0.33.0) is printed on the label,
// and longer tapes wind fuller reels: a C120's tape was thinner, so more of it
// fits on a reel (and it famously jammed).
//
// Sizes match the other tile types:
//   icon    256 x 256, shown at 48 x 48 on the card: the cassette alone, no text
//   banner  1280 x 720 (16:9): the cassette with its label, side lengths and maker

export const ICON_SIZE = 256;
export const BANNER_WIDTH = 1280;
export const BANNER_HEIGHT = 720;

// No web fonts in the Foundry either: whatever handwriting font the computer has.
const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive';
const PLAIN = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function toPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The card picture couldn't be made.");
  return new Uint8Array(await blob.arrayBuffer());
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** "0:32", "23:10" */
function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The largest font size (up to `max`) at which `text` fits in `width`. */
function fitFont(ctx, text, family, max, min, width, weight = "") {
  for (let size = max; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`.trim();
    if (ctx.measureText(text).width <= width) return size;
  }
  ctx.font = `${weight} ${min}px ${family}`.trim();
  return min;
}

/** Text cut to fit `width`, with an ellipsis. Uses the current font. */
function clip(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const chars = [...text];
  while (chars.length && ctx.measureText(chars.join("") + "…").width > width) chars.pop();
  return chars.join("").trimEnd() + "…";
}

function reel(ctx, cx, cy, r, wound, k) {
  // Tape wound on the reel.
  ctx.fillStyle = "#3a2a22";
  ctx.beginPath();
  ctx.arc(cx, cy, r * wound, 0, Math.PI * 2);
  ctx.fill();
  // Hub.
  ctx.fillStyle = "#f4f1ea";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = k.edge;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
  // Teeth.
  ctx.fillStyle = "#f4f1ea";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25);
    ctx.rotate(a);
    ctx.fillRect(-r * 0.09, -r * 0.05, r * 0.12, r * 0.1);
    ctx.restore();
  }
}

function screw(ctx, x, y, r, k) {
  ctx.fillStyle = k.edge;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = Math.max(1, r * 0.25);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y);
  ctx.lineTo(x + r * 0.6, y);
  ctx.stroke();
}

/** How full the two reels look for a tape length: [left (side A still to play), right]. */
export const REELS = Object.freeze({ C60: [0.98, 0.62], C90: [1.06, 0.58], C120: [1.13, 0.55] });

/**
 * A cassette at (x, y), `w` wide (63 % as tall, like a real one).
 * words: { label, sub, left, right } or null for no writing (the icon).
 * length: "C60", "C90", "C120" or null (printed on the label; sets the reels).
 */
export function drawCassette(ctx, x, y, w, k, words, length = null) {
  const h = w * 0.63;
  const u = w / 1000; // one unit of the drawing

  // Shell, with a shadow under it.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 18 * u;
  roundRect(ctx, x, y, w, h, 34 * u);
  ctx.fillStyle = k.shell;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 34 * u);
  ctx.lineWidth = 6 * u;
  ctx.strokeStyle = k.edge;
  ctx.stroke();
  // A soft light along the top edge.
  const sheen = ctx.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  roundRect(ctx, x, y, w, h, 34 * u);
  ctx.fillStyle = sheen;
  ctx.fill();

  // Screws in the corners.
  const sr = 13 * u;
  for (const [sx, sy] of [[x + 32 * u, y + 32 * u], [x + w - 32 * u, y + 32 * u], [x + 32 * u, y + h - 32 * u], [x + w - 32 * u, y + h - 32 * u]]) screw(ctx, sx, sy, sr, k);

  // The label.
  const lx = x + 70 * u, ly = y + 52 * u, lw = w - 140 * u, lh = h * 0.66;
  roundRect(ctx, lx, ly, lw, lh, 18 * u);
  ctx.fillStyle = k.paper;
  ctx.fill();

  // Stripes across the label, behind the window.
  const sy = ly + lh * 0.46;
  ctx.fillStyle = k.stripe2;
  ctx.fillRect(lx, sy, lw, 22 * u);
  ctx.fillStyle = k.stripe1;
  ctx.fillRect(lx, sy + 22 * u, lw, 22 * u);

  // The window with the two reels.
  const ww = lw * 0.56, wh = lh * 0.38;
  const wx = x + (w - ww) / 2, wy = ly + lh * 0.42;
  roundRect(ctx, wx, wy, ww, wh, wh / 2);
  ctx.fillStyle = "#16131a";
  ctx.fill();
  ctx.lineWidth = 5 * u;
  ctx.strokeStyle = k.edge;
  ctx.stroke();
  const rr = wh * 0.42;
  // Tape running between the reels.
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(wx + wh / 2, wy + wh / 2 + rr * 0.55, ww - wh, 6 * u);
  const wound = Object.hasOwn(REELS, length || "") ? REELS[length] : REELS.C60;
  reel(ctx, wx + wh / 2 + 6 * u, wy + wh / 2, rr, wound[0], k);
  reel(ctx, wx + ww - wh / 2 - 6 * u, wy + wh / 2, rr, wound[1], k);
  // A little window in the middle of the window.
  roundRect(ctx, x + w / 2 - 60 * u, wy + wh * 0.3, 120 * u, wh * 0.4, 8 * u);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  // The tape head opening at the bottom.
  const bw = w * 0.6, bh = h * 0.16;
  const bx = x + (w - bw) / 2, by = y + h - bh;
  ctx.beginPath();
  ctx.moveTo(bx, by + bh);
  ctx.lineTo(bx + bh * 0.7, by);
  ctx.lineTo(bx + bw - bh * 0.7, by);
  ctx.lineTo(bx + bw, by + bh);
  ctx.closePath();
  ctx.fillStyle = k.edge;
  ctx.fill();
  ctx.fillStyle = "#0c0b0e";
  for (const fx of [0.3, 0.7]) {
    ctx.beginPath();
    ctx.arc(bx + bw * fx, by + bh * 0.55, 14 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(bx + bw * 0.46, by + bh * 0.4, bw * 0.08, bh * 0.35);

  if (!words) {
    // The icon: no writing but the length, large on the label.
    if (length && Object.hasOwn(REELS, length)) {
      ctx.fillStyle = k.ink;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = `bold ${84 * u}px ${PLAIN}`;
      ctx.fillText(length, x + w / 2, ly + 66 * u);
      ctx.textAlign = "left";
    }
    return;
  }

  // The handwritten label line, and the side letter.
  ctx.fillStyle = k.ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `bold ${56 * u}px ${PLAIN}`;
  ctx.fillText("A", lx + 28 * u, ly + 64 * u);
  const textX = lx + 100 * u;
  // The length, printed small at the label's right end, as on a real cassette.
  const printed = length && Object.hasOwn(REELS, length) ? length : null;
  const lengthW = printed ? 120 * u : 0;
  if (printed) {
    ctx.textAlign = "right";
    ctx.font = `bold ${34 * u}px ${PLAIN}`;
    ctx.fillText(printed, lx + lw - 28 * u, ly + 64 * u);
    ctx.textAlign = "left";
  }
  const textW = lw - 130 * u;
  // The label line shares its row with the length; the line under it doesn't.
  fitFont(ctx, words.label, HAND, 74 * u, 34 * u, textW - lengthW);
  ctx.fillText(clip(ctx, words.label, textW - lengthW), textX, ly + 66 * u);
  if (words.sub) {
    ctx.font = `${26 * u}px ${PLAIN}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(clip(ctx, words.sub, textW), textX, ly + 128 * u);
    ctx.globalAlpha = 1;
  }
  // Side lengths, either side of the window, under the stripes.
  const nameY = sy + 44 * u + 34 * u;
  const sideText = (pair, cx) => {
    ctx.textAlign = "center";
    ctx.font = `bold ${24 * u}px ${PLAIN}`;
    ctx.fillText(pair[0], cx, nameY);
    ctx.font = `${28 * u}px ${PLAIN}`;
    ctx.fillText(pair[1], cx, nameY + 36 * u);
  };
  if (words.left) sideText(words.left, (lx + wx) / 2);
  if (words.right) sideText(words.right, (wx + ww + lx + lw) / 2);
  ctx.textAlign = "left";
}

function backdrop(ctx, w, h, k) {
  const g = ctx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, k.backdrop[0]);
  g.addColorStop(1, k.backdrop[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * What the cassette says, from the tape (the tape.json object):
 * { label, sub, left: ["SIDE A", "23:10"], right }.
 */
export function cassetteWords(tape) {
  const title = (tape && tape.title) || "Mixtape";
  const labelText = tape && tape.label && tape.label.text;
  const maker = tape && tape.madeBy && (tape.madeBy.name || (tape.madeBy.handle ? `@${tape.madeBy.handle}` : ""));
  const subParts = [];
  if (labelText && labelText !== title) subParts.push(title);
  if (maker) subParts.push(`made by ${maker}`);
  const sides = (tape && tape.sides) || [];
  const side = (i) => {
    const s = sides[i];
    if (!s) return null;
    const total = s.tracks.reduce((n, t) => n + (Number(t.duration) || 0), 0);
    const name = s.name && s.name.length <= 2 ? `SIDE ${s.name}` : String(s.name || "").toUpperCase().slice(0, 12);
    return [name, clock(total)];
  };
  return { label: labelText || title, sub: subParts.join(" · "), left: side(0), right: side(1) };
}

/** The tape's length from tape.json (label.length), or null for tapes without one. */
export function tapeLengthOf(tape) {
  const l = tape && tape.label && tape.label.length;
  return typeof l === "string" && Object.hasOwn(REELS, l) ? l : null;
}

/** { icon, banner }: PNG bytes, for a tape (the tape.json object) and kit id. */
export async function makeCardArt({ tape, kit }) {
  const k = kitById(kit);

  const banner = makeCanvas(BANNER_WIDTH, BANNER_HEIGHT);
  const b = banner.getContext("2d");
  backdrop(b, BANNER_WIDTH, BANNER_HEIGHT, k);
  const cw = 940;
  const length = tapeLengthOf(tape);
  drawCassette(b, (BANNER_WIDTH - cw) / 2, (BANNER_HEIGHT - cw * 0.63) / 2 - 6, cw, k, cassetteWords(tape), length);

  const icon = makeCanvas(ICON_SIZE, ICON_SIZE);
  const i = icon.getContext("2d");
  backdrop(i, ICON_SIZE, ICON_SIZE, k);
  const iw = 224;
  drawCassette(i, (ICON_SIZE - iw) / 2, (ICON_SIZE - iw * 0.63) / 2, iw, k, null, length);

  return { icon: await toPngBytes(icon), banner: await toPngBytes(banner) };
}
