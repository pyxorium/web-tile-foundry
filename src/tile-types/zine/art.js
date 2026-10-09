import { PAGE_SIZES, RISO_CURVES } from "./runtime/reader.js";
import { zinePages, cleanText, TITLE_MAX } from "./pages.js";
import { lookOf, lookColors, hexToRgb } from "./looks.js";
import { cropRect } from "../../core/pictures.js";
import { marksSvg, markColors } from "./marks.js";

// The zine's card pictures, drawn in the browser from the creator's own pages:
//   banner 1280x720: the cover with page 1 beside it, open on the desk
//   icon 256x256: the cover
// A simple drawing in the zine's look (the reader's colors, fonts and picture
// treatment), not a screenshot of the reader.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = '"Courier New", Courier, "Liberation Mono", ui-monospace, monospace';
const TILTS = [-2.2, 1.8];

/** Colors and fonts for a look (matching the reader's styles). */
export function artStyle(look, ink) {
  const l = lookOf(look);
  const riso = lookColors(l, ink);
  const base = { look: l, desk: "#e9e6df", paper: "#ffffff", ink: "#1b1a17", soft: "#6c675d", heading: SANS, accent: null, riso: null };
  if (l === "photocopy") return { ...base, desk: "#d6d4ce", paper: "#f6f5f1", ink: "#121212", soft: "#3d3d3d", heading: MONO };
  if (l === "collage") return { ...base, desk: "#c7b28c", paper: "#fbf6ea", ink: "#2a241c", soft: "#6d6253", accent: "#a3402c" };
  if (l === "riso") return { ...base, desk: "#ddd7cb", paper: riso.paper, ink: riso.text, soft: riso.text, riso };
  return base;
}

/** Ink coverage from a riso curve (feFuncA "table": evenly spaced values, linear between). */
export function curveAt(table, x) {
  const v = String(table).trim().split(/\s+/).map(Number);
  const n = v.length - 1;
  const t = Math.max(0, Math.min(1, x)) * n;
  const k = Math.min(n - 1, Math.floor(t));
  return v[k] + (v[k + 1] - v[k]) * (t - k);
}

/** One pixel in two inks on paper (0..255 channels), as the reader's filters print it. */
export function risoPixel(darkA, darkB, riso) {
  const paper = hexToRgb(riso.paper), a = hexToRgb(riso.a), b = hexToRgb(riso.b);
  const ca = curveAt(RISO_CURVES.a, darkA), cb = curveAt(RISO_CURVES.b, darkB);
  return paper.map((p, i) => p * (1 - ca * (1 - a[i] / 255)) * (1 - cb * (1 - b[i] / 255)));
}

/** A photocopied grey (0..255) from a grey 0..1: contrast 1.8, brightness 1.1, as the reader's filter. */
export function tonerGrey(grey) {
  return Math.max(0, Math.min(255, ((grey - 0.5) * 1.8 + 0.5) * 1.1 * 255));
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function pngOf(c) {
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function bitmapOf(picture) {
  if (!picture || !picture.bytes) return null;
  try {
    return await createImageBitmap(new Blob([picture.bytes], { type: picture.contentType }));
  } catch {
    return null;
  }
}

/** The picture at size w x h, treated for the look (black-and-white, or two inks). */
function treated(bitmap, w, h, style) {
  const c = canvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  if (style.look !== "photocopy" && style.look !== "riso") return c;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data, W = c.width, H = c.height;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  const off = Math.max(1, Math.round(Math.min(W, H) / 220)); // the second ink, slightly out of register
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      const i = p * 4;
      if (style.look === "photocopy") {
        const v = tonerGrey(lum[p]);
        d[i] = d[i + 1] = d[i + 2] = v;
      } else {
        const q = Math.max(0, y - off) * W + Math.max(0, x - off);
        const [r, gg, b] = risoPixel(1 - lum[p], 1 - lum[q], style.riso);
        d[i] = r; d[i + 1] = gg; d[i + 2] = b;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Specks of toner or ink over a page (seeded, so the same zine draws the same way). */
function grain(g, x, y, w, h, style, u) {
  if (style.look !== "photocopy" && style.look !== "riso") return;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const count = Math.round((w * h) / (style.look === "photocopy" ? 260 : 420));
  g.save();
  g.fillStyle = style.look === "photocopy" ? "rgba(0,0,0,0.22)" : "rgba(60,40,20,0.10)";
  for (let k = 0; k < count; k++) {
    const s = (rand() < 0.9 ? 0.6 : 1.4) * u;
    g.fillRect(x + rand() * w, y + rand() * h, s, s);
  }
  g.restore();
}

/** Lines of text that fit `width` (canvas font already set), at most `max` lines. */
function wrap(g, text, width, max) {
  const out = [];
  for (const para of String(text || "").split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= width || !line) line = next;
      else { out.push(line); line = word; }
      if (out.length >= max) return out;
    }
    if (line) out.push(line);
    if (out.length >= max) return out.slice(0, max);
  }
  return out;
}

function fitInto(bw, bh, x, y, w, h) {
  const s = Math.min(w / bw, h / bh);
  const dw = bw * s, dh = bh * s;
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

function paper(g, x, y, w, h, u, style) {
  g.save();
  g.shadowColor = style.look === "collage" ? "rgba(60,40,10,0.28)" : "rgba(30,25,15,0.18)";
  g.shadowBlur = 18 * u;
  g.shadowOffsetY = 6 * u;
  g.fillStyle = style.paper;
  g.fillRect(x, y, w, h);
  g.restore();
}

/** A filled picture: cropped as the creator chose, covering the box exactly. */
function drawFilled(g, bitmap, x, y, w, h, crop, style) {
  const r = cropRect(bitmap.width, bitmap.height, w, h, crop.x, crop.y, crop.zoom);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(treated(bitmap, r.w, r.h, style), x + r.x, y + r.y, r.w, r.h);
  g.restore();
}

/**
 * The creator's sprite standing on a page (idle pose, facing the reader), the
 * size the reader shows it (frames up to 56 design pixels tall), crisp pixels.
 */
function drawSprite(g, sheet, sprite, x, y, w, h, u, style) {
  const geo = sprite.geometry;
  const k = Math.min(1, 56 / geo.frameHeight) * u;
  const sw = Math.round(geo.frameWidth * k), sh = Math.round(geo.frameHeight * k);
  const c = canvas(sw, sh);
  const cg = c.getContext("2d");
  cg.imageSmoothingEnabled = false;
  cg.drawImage(sheet, 1 * geo.frameWidth, 0, geo.frameWidth, geo.frameHeight, 0, 0, sw, sh);
  if (style.look === "photocopy") {
    const img = cg.getImageData(0, 0, sw, sh);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = tonerGrey((0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    cg.putImageData(img, 0, 0);
  }
  const left = x + w * 0.28, bottom = y + h - 18 * u;
  g.save();
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath();
  g.ellipse(left + sw / 2, bottom, sw * 0.32, 2.5 * u, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.drawImage(c, left, bottom - sh);
}

/** A page's stickers and drawing, drawn over it (from the same SVG the reader uses). */
async function drawMarks(g, marks, look, ink, size, x, y, w, h) {
  if (!marks || !marks.length) return;
  const colors = markColors(look, ink);
  const img = new Image();
  img.src = "data:image/svg+xml," + encodeURIComponent(marksSvg(marks, colors, size.w, size.h));
  try { await img.decode(); } catch { return; }
  const c = canvas(w, h);
  const cg = c.getContext("2d");
  cg.drawImage(img, 0, 0, c.width, c.height);
  if (lookOf(look) === "photocopy") {
    const data = cg.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = tonerGrey((0.2126 * data.data[i] + 0.7152 * data.data[i + 1] + 0.0722 * data.data[i + 2]) / 255);
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    }
    cg.putImageData(data, 0, 0);
  }
  g.drawImage(c, x, y, w, h);
}

/** A paper-colored band behind text that sits over a full-page picture. */
function band(g, x, y, w, h, style) {
  g.save();
  g.globalAlpha = 0.88;
  g.fillStyle = style.paper;
  g.fillRect(x, y, w, h);
  g.restore();
}

/** Draws a picture in the look, fitted into the box (a framed, taped, tilted photo for Collage). */
function drawPicture(g, bitmap, box, u, style, tilt, pic) {
  if (pic && pic.fill && pic.frame && !pic.frame.bleed) {
    const fw = pic.frame.w * u, fh = pic.frame.h * u;
    if (style.look === "collage") {
      const frame = 6 * u;
      g.save();
      g.translate(box.x + box.w / 2, box.y + 10 * u + fh / 2 + frame);
      g.rotate((tilt * Math.PI) / 180);
      g.shadowColor = "rgba(40,25,5,0.3)";
      g.shadowBlur = 6 * u;
      g.shadowOffsetY = 2 * u;
      g.fillStyle = "#ffffff";
      g.fillRect(-fw / 2 - frame, -fh / 2 - frame, fw + 2 * frame, fh + 2 * frame);
      g.shadowColor = "transparent";
      drawFilled(g, bitmap, -fw / 2, -fh / 2, fw, fh, pic.crop, style);
      g.fillStyle = "rgba(239,226,189,0.85)";
      for (const side of [-1, 1]) {
        g.save();
        g.translate(side * (fw / 2 + frame - 4 * u), -fh / 2 - frame + 2 * u);
        g.rotate((side * 32 * Math.PI) / 180);
        g.fillRect(-26 * u, -8 * u, 52 * u, 16 * u);
        g.restore();
      }
      g.restore();
      return { y: box.y, h: fh + 2 * frame + 20 * u };
    }
    drawFilled(g, bitmap, box.x, box.y, fw, fh, pic.crop, style);
    return { y: box.y, h: fh };
  }
  if (style.look === "collage") {
    const frame = 6 * u;
    const r = fitInto(bitmap.width, bitmap.height, box.x + 10 * u, box.y + 10 * u, box.w - 20 * u - 2 * frame, box.h - 20 * u - 2 * frame);
    g.save();
    g.translate(r.x + r.w / 2 + frame, r.y + r.h / 2 + frame);
    g.rotate((tilt * Math.PI) / 180);
    g.shadowColor = "rgba(40,25,5,0.3)";
    g.shadowBlur = 6 * u;
    g.shadowOffsetY = 2 * u;
    g.fillStyle = "#ffffff";
    g.fillRect(-r.w / 2 - frame, -r.h / 2 - frame, r.w + 2 * frame, r.h + 2 * frame);
    g.shadowColor = "transparent";
    g.drawImage(bitmap, -r.w / 2, -r.h / 2, r.w, r.h);
    g.fillStyle = "rgba(239,226,189,0.85)";
    for (const side of [-1, 1]) {
      g.save();
      g.translate(side * (r.w / 2 + frame - 4 * u), -r.h / 2 - frame + 2 * u);
      g.rotate((side * 32 * Math.PI) / 180);
      g.fillRect(-26 * u, -8 * u, 52 * u, 16 * u);
      g.restore();
    }
    g.restore();
    return { y: box.y, h: r.h + 2 * frame + 20 * u };
  }
  const r = fitInto(bitmap.width, bitmap.height, box.x, box.y, box.w, box.h);
  const top = box.top ? box.y : r.y;
  g.drawImage(treated(bitmap, r.w, r.h, style), r.x, top, r.w, r.h);
  return { y: top, h: r.h };
}

function drawTitle(g, x, y, width, u, title, style, banded = false) {
  g.textBaseline = "top";
  if (style.look === "photocopy") g.font = `700 ${29 * u}px ${MONO}`;
  else if (style.look === "collage") g.font = `800 ${27 * u}px ${SANS}`;
  else g.font = `800 ${30 * u}px ${SANS}`;
  const lines = wrap(g, title, width - (style.look === "collage" ? 20 * u : 0), 3);
  const lh = (style.look === "collage" ? 30 : 32) * u;
  let cy = y;
  if (style.look === "collage" && lines.length) {
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 20 * u;
    g.save();
    g.translate(x - 4 * u, cy);
    g.rotate((-1.5 * Math.PI) / 180);
    g.fillStyle = style.accent;
    g.fillRect(0, 0, w, lines.length * lh + 12 * u);
    g.fillStyle = style.paper;
    lines.forEach((line, i) => g.fillText(line, 10 * u, 6 * u + i * lh));
    g.restore();
    return cy + lines.length * lh + 22 * u;
  }
  if (banded && lines.length) {
    const w = Math.max(...lines.map((l) => g.measureText(l).width));
    band(g, x - 10 * u, cy - 6 * u, w + 20 * u, lines.length * lh + 13 * u, style);
  }
  for (const line of lines) {
    if (style.look === "riso") {
      g.fillStyle = style.riso.b;
      g.globalAlpha = 0.8;
      g.fillText(line, x + 2 * u, cy + 2 * u);
      g.globalAlpha = 1;
    }
    g.fillStyle = style.ink;
    g.fillText(line, x, cy);
    cy += lh;
  }
  return cy + 6 * u;
}

function drawHeading(g, x, y, width, u, text, style) {
  g.textBaseline = "top";
  const size = style.look === "photocopy" ? 18 : style.look === "collage" ? 17 : 19;
  g.font = `${style.look === "photocopy" ? 700 : 750} ${size * u}px ${style.heading}`;
  const lines = wrap(g, text, width - (style.look === "collage" ? 16 * u : 0), 2);
  const lh = size * 1.2 * u;
  if (style.look === "collage") {
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 16 * u;
    g.save();
    g.translate(x + 2 * u, y);
    g.rotate((-1.2 * Math.PI) / 180);
    g.fillStyle = style.ink;
    g.fillRect(0, 0, w, lines.length * lh + 7 * u);
    g.fillStyle = style.paper;
    lines.forEach((line, i) => g.fillText(line, 8 * u, 3 * u + i * lh));
    g.restore();
    return y + lines.length * lh + 17 * u;
  }
  let cy = y;
  for (const line of lines) {
    if (style.look === "riso") {
      g.fillStyle = style.riso.b;
      g.globalAlpha = 0.6;
      g.fillRect(x - 3 * u, cy + lh * 0.58, g.measureText(line).width + 6 * u, lh * 0.34);
      g.globalAlpha = 1;
    }
    g.fillStyle = style.ink;
    g.fillText(line, x, cy);
    cy += lh;
  }
  return cy + 8 * u;
}

// u = one design pixel (the reader's page is 330 design pixels wide).
function drawCover(g, x, y, w, h, u, { title, subtitle, handle, bitmap, pic, lane }, style) {
  paper(g, x, y, w, h, u, style);
  const padX = 24 * u;
  const bleed = Boolean(bitmap && pic && pic.fill && pic.frame && pic.frame.bleed);
  if (bleed) drawFilled(g, bitmap, x, y, w, h, pic.crop, style);
  let cy = drawTitle(g, x + padX, y + 28 * u, w - 2 * padX, u, title, style, bleed);
  let bottom = y + h - (lane ? 20 + 58 : 20) * u; // a sprite keeps a lane at the bottom
  const foot = [];
  if (handle) foot.push({ text: `by @${handle}`, size: 12, color: style.soft });
  if (subtitle) foot.unshift({ text: subtitle, size: 15, color: style.ink });
  g.textBaseline = "top";
  for (let i = foot.length - 1; i >= 0; i--) {
    g.font = `${foot[i].size * u}px ${SANS}`;
    const t = wrap(g, foot[i].text, w - 2 * padX, 1)[0] || "";
    bottom -= foot[i].size * 1.35 * u;
    if (bleed) band(g, x + padX - 8 * u, bottom - 3 * u, g.measureText(t).width + 16 * u, foot[i].size * 1.35 * u + 6 * u, style);
    g.fillStyle = foot[i].color;
    g.fillText(t, x + padX, bottom);
    bottom -= 4 * u;
  }
  if (bitmap && !bleed) drawPicture(g, bitmap, { x: x + padX, y: cy, w: w - 2 * padX, h: bottom - cy - 8 * u }, u, style, TILTS[0]);
  grain(g, x, y, w, h, style, u);
}

function drawPage(g, x, y, w, h, u, page, bitmap, style) {
  paper(g, x, y, w, h, u, style);
  const pic = page.picture;
  if (page.layout === "quote") {
    // Big quote: the words set large, who said it below.
    const pad = 26 * u, inner = w - 2 * pad;
    const serif = style.look === "photocopy" ? MONO : 'Georgia, "Times New Roman", serif';
    let size = 30;
    let lines;
    for (; size >= 18; size--) {
      g.font = `${style.look === "photocopy" ? 700 : 600} ${size * u}px ${serif}`;
      lines = wrap(g, page.words, inner, 99);
      if (lines.length * size * 1.2 * u < h * 0.6) break;
    }
    const lh = size * 1.2 * u;
    const block = lines.length * lh + 50 * u;
    let cy = y + (h - block) / 2;
    g.textBaseline = "top";
    g.fillStyle = style.look === "riso" ? style.riso.b : style.soft;
    g.font = `600 ${size * 2.4 * u}px ${serif}`;
    g.fillText("\u201c", x + pad, cy - size * 0.6 * u);
    cy += size * 1.3 * u;
    g.fillStyle = style.ink;
    g.font = `${style.look === "photocopy" ? 700 : 600} ${size * u}px ${serif}`;
    for (const line of lines) { g.fillText(line, x + pad, cy); cy += lh; }
    if (page.subtitle) {
      g.font = `${13 * u}px ${SANS}`;
      g.fillStyle = style.soft;
      g.fillText(`\u2014 ${page.subtitle}`, x + pad, cy + 10 * u);
    }
    grain(g, x, y, w, h, style, u);
    return;
  }
  if (bitmap && pic && pic.fill && pic.frame && pic.frame.bleed) {
    drawFilled(g, bitmap, x, y, w, h, pic.crop, style);
    if (page.layout === "overlay" && (page.heading || page.words)) {
      // Words over picture: the heading and words on a band near the bottom.
      const pad = 22 * u, inner = w - 2 * pad - 8 * u;
      g.font = `${14 * u}px ${SANS}`;
      const lines = wrap(g, page.words, inner, 6);
      const head = page.heading ? 30 * u : 0;
      const bh = head + lines.length * 20 * u + 22 * u;
      const by = y + h - (page.lane ? 84 : 26) * u - bh;
      band(g, x + pad - 10 * u, by, w - 2 * pad + 20 * u, bh, style);
      let cy = by + 11 * u;
      if (page.heading) cy = drawHeading(g, x + pad + 4 * u, cy, inner, u, page.heading, style) - 6 * u;
      g.fillStyle = style.ink;
      g.font = `${14 * u}px ${SANS}`;
      g.textBaseline = "top";
      for (const line of lines) { g.fillText(line, x + pad + 4 * u, cy); cy += 20 * u; }
    }
    grain(g, x, y, w, h, style, u);
    return;
  }
  if (page.layout === "tape" && page.tape) {
    drawJCard(g, x, y, w, h, u, page, bitmap, style);
    grain(g, x, y, w, h, style, u);
    return;
  }
  if (page.layout === "book" && page.book) {
    drawBookPage(g, x, y, w, h, u, page, bitmap, style);
    grain(g, x, y, w, h, style, u);
    return;
  }
  const pad = 22 * u;
  const inner = w - 2 * pad;
  let cy = y + pad;
  if (page.heading) cy = drawHeading(g, x + pad, cy, inner, u, page.heading, style);
  const bottom = y + h - (page.lane ? 26 + 58 : 26) * u; // a sprite keeps a lane at the bottom
  const hasWords = Boolean(page.words);
  if (bitmap) {
    // A tile (stage 4) shows its own banner in its own colors, whatever the look.
    const tile = page.layout === "tile" || page.layout === "tape";
    const maxH = hasWords ? h * (tile ? 0.5 : style.look === "collage" ? 0.4 : 0.48) : bottom - cy;
    const placed = drawPicture(g, bitmap, { x: x + pad, y: cy, w: inner, h: maxH, top: hasWords }, u, tile ? { ...style, look: "clean" } : style, tile ? 0 : TILTS[1], pic);
    cy = placed.y + placed.h + 10 * u;
  }
  if (hasWords) {
    g.fillStyle = style.ink;
    g.font = `${14 * u}px ${SANS}`;
    g.textBaseline = "top";
    const max = Math.max(0, Math.floor((bottom - cy) / (20 * u)));
    for (const line of wrap(g, page.words, inner, max)) { g.fillText(line, x + pad, cy); cy += 20 * u; }
  }
  grain(g, x, y, w, h, style, u);
}

/**
 * A tape page (stage 4) as its J-card, the way the reader shows it: the
 * cassette (the tape's own banner, in its own colors), the tape's title, the
 * songs by side, the dedication, the creator's own line, and "▶ Play this tape".
 * Whatever doesn't fit is left out from the bottom up (songs are trimmed first).
 */
function drawJCard(g, x, y, w, h, u, page, bitmap, style) {
  const pad = 22 * u;
  const inner = w - 2 * pad;
  const bottom = y + h - (page.lane ? 26 + 58 : 26) * u;
  const tape = page.tape;
  let cy = y + pad;
  if (bitmap) {
    const placed = drawPicture(g, bitmap, { x: x + pad, y: cy, w: inner, h: h * 0.34, top: true }, u, { ...style, look: "clean" }, 0, null);
    cy = placed.y + placed.h + 12 * u;
  }
  cy = drawHeading(g, x + pad, cy, inner, u, tape.title, style) - 2 * u;

  // What goes below the songs, measured first so the songs know their room.
  const LH = 16 * u;
  g.font = `italic ${12 * u}px ${SANS}`;
  // Up to two lines each, with "…" when there's more.
  const clip2 = (text) => {
    const lines = wrap(g, text, inner, 2);
    if (lines.join(" ").length < String(text).replace(/\s+/g, " ").trim().length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[,.;\s]*$/, "") + "\u2026";
    return lines;
  };
  const ded = tape.dedication ? clip2(tape.dedication) : [];
  const own = page.subtitle ? clip2(`\u2014 ${page.subtitle}`) : [];
  const play = 24 * u;
  const below = (ded.length + own.length) * LH + (ded.length || own.length ? 8 * u : 0) + play;

  g.textBaseline = "top";
  const room = Math.max(0, Math.floor((bottom - below - cy) / LH));
  const sides = tape.sides || [];
  // Each side gets an even share of the room (up to five lines).
  const share = Math.max(1, Math.min(5, Math.floor(room / Math.max(1, sides.length))));
  let used = 0;
  for (const side of sides) {
    if (used >= room) break;
    const label = `Side ${side.name}: `;
    g.font = `700 ${12 * u}px ${SANS}`;
    const lw = g.measureText(label).width;
    g.font = `${12 * u}px ${SANS}`;
    const lines = wrap(g, (side.songs || []).join(", "), inner - lw, Math.min(share, room - used));
    const all = (side.songs || []).join(", ");
    if (lines.length && lines.join(" ").length < all.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[,\s]*$/, "") + "\u2026";
    g.fillStyle = style.look === "riso" ? style.riso.b : style.ink;
    g.font = `700 ${12 * u}px ${SANS}`;
    g.fillText(label, x + pad, cy);
    g.fillStyle = style.ink;
    g.font = `${12 * u}px ${SANS}`;
    lines.forEach((line, i) => g.fillText(line, x + pad + lw, cy + i * LH));
    cy += Math.max(1, lines.length) * LH + 3 * u;
    used += Math.max(1, lines.length);
  }
  cy += 5 * u;
  g.font = `italic ${12 * u}px ${SANS}`;
  g.fillStyle = style.soft;
  for (const line of ded) { if (cy + LH > bottom - play) break; g.fillText(line, x + pad, cy); cy += LH; }
  g.fillStyle = style.ink;
  for (const line of own) { if (cy + LH > bottom - play) break; g.fillText(line, x + pad, cy); cy += LH; }

  // The play button, as on the page.
  g.font = `600 ${11 * u}px ${SANS}`;
  const label = "\u25b6 Play this tape \u2197";
  const bw = g.measureText(label).width + 24 * u, bh = 20 * u;
  const bx = x + pad, by = Math.min(bottom - bh, cy + 6 * u);
  g.fillStyle = style.look === "collage" && style.accent ? style.accent : style.ink;
  g.beginPath();
  if (g.roundRect) g.roundRect(bx, by, bw, bh, bh / 2); else g.rect(bx, by, bw, bh);
  g.fill();
  g.fillStyle = style.look === "collage" ? "#ffffff" : style.paper;
  g.textBaseline = "middle";
  g.fillText(label, bx + 12 * u, by + bh / 2 + 0.5 * u);
  g.textBaseline = "top";
}

/**
 * A book page (stage 5) as the reader shows it: the cover (the book's own,
 * framed in the look, or one drawn in the look's colours), the title, author,
 * stars and status, centred, then the line from the review in italics.
 */
function drawBookPage(g, x, y, w, h, u, page, bitmap, style) {
  const pad = 22 * u;
  const inner = w - 2 * pad;
  const bottom = y + h - (page.lane ? 26 + 58 : 26) * u;
  const book = page.book;
  let cy = y + pad;
  const coverH = h * (style.look === "collage" ? 0.34 : 0.38);
  if (bitmap) {
    const placed = drawPicture(g, bitmap, { x: x + pad, y: cy, w: inner, h: coverH, top: true }, u, style, TILTS[1], null);
    cy = placed.y + placed.h + 12 * u;
  } else {
    const ch = h * 0.38, cw = (ch * 2) / 3, cx = x + (w - cw) / 2;
    const bg = style.look === "riso" ? style.riso.b : style.look === "collage" ? style.accent : style.ink;
    const fg = style.look === "riso" ? style.ink : style.paper;
    g.fillStyle = bg;
    g.fillRect(cx, cy, cw, ch);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(cx, cy, 6 * u, ch);
    g.strokeStyle = fg;
    g.globalAlpha = 0.55;
    g.lineWidth = 1 * u;
    g.strokeRect(cx + 3.5 * u, cy + 3.5 * u, cw - 7 * u, ch - 7 * u);
    g.globalAlpha = 1;
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = `700 ${15 * u}px Georgia, "Times New Roman", serif`;
    const lines = wrap(g, book.title, cw - 24 * u, 5);
    const lh = 18 * u;
    g.font = `${11 * u}px ${SANS}`;
    const by = book.authors ? wrap(g, book.authors, cw - 24 * u, 2) : [];
    let ty = cy + (ch - lines.length * lh - (by.length ? 8 * u + by.length * 14 * u : 0)) / 2;
    g.font = `700 ${15 * u}px Georgia, "Times New Roman", serif`;
    for (const line of lines) { g.fillText(line, cx + cw / 2, ty); ty += lh; }
    g.font = `${11 * u}px ${SANS}`;
    ty += 8 * u;
    for (const line of by) { g.fillText(line, cx + cw / 2, ty); ty += 14 * u; }
    g.textAlign = "left";
    cy += ch + 12 * u;
  }
  const centre = (text, font, color, lh) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const line of wrap(g, text, inner, 2)) { g.fillText(line, x + w / 2, cy); cy += lh; }
    g.textAlign = "left";
  };
  centre(book.title, `${style.look === "photocopy" ? 700 : 750} ${18 * u}px ${style.heading}`, style.ink, 21 * u);
  cy += 2 * u;
  if (book.authors) centre(book.authors, `${13 * u}px ${SANS}`, style.soft, 17 * u);
  if (book.stars) {
    g.font = `${15 * u}px ${SANS}`;
    g.textBaseline = "top";
    const row = "\u2605\u2605\u2605\u2605\u2605";
    const sw = g.measureText(row).width;
    const sx = x + (w - sw) / 2;
    g.fillStyle = style.soft;
    g.globalAlpha = 0.4;
    g.fillText(row, sx, cy + 2 * u);
    g.globalAlpha = 1;
    g.save();
    g.beginPath();
    g.rect(sx, cy, sw * (book.stars / 10), 20 * u);
    g.clip();
    g.fillStyle = style.look === "riso" ? style.riso.b : style.look === "collage" ? style.accent : style.look === "photocopy" ? style.ink : "#c8901a";
    g.fillText(row, sx, cy + 2 * u);
    g.restore();
    cy += 20 * u;
  }
  if (book.status) centre(book.status.toUpperCase(), `${11 * u}px ${SANS}`, style.soft, 15 * u);
  if (page.words) {
    cy += 10 * u;
    g.font = `italic ${14 * u}px ${SANS}`;
    g.fillStyle = style.ink;
    g.textAlign = "center";
    g.textBaseline = "top";
    const max = Math.max(0, Math.floor((bottom - cy) / (20 * u)));
    for (const line of wrap(g, page.words.replace(/\s+/g, " "), inner, max)) { g.fillText(line, x + w / 2, cy); cy += 20 * u; }
    g.textAlign = "left";
  }
}

/**
 * Draws the card pictures. `values` are the panel's values (name, handle,
 * paper, look, ink, pages). Returns { icon, banner }: PNG bytes.
 */
export async function drawZineArt(values) {
  const size = PAGE_SIZES[values.paper] || PAGE_SIZES.letter;
  const style = artStyle(values.look, values.ink);
  const pages = zinePages(values.pages || [], () => "", { paper: values.paper, look: values.look });
  const raw = values.pages || [];
  const title = cleanText(values.name, TITLE_MAX).replace(/\n+/g, " ");
  const handle = String(values.handle || "").replace(/^@/, "");
  const coverPic = await bitmapOf(pages[0].picture && raw[0] && raw[0].picture);
  const tileBanner = (pages[1].tile || pages[1].tape) && raw[1] && raw[1].piece && (raw[1].piece.files || []).find((f) => f.path === "/banner.png");
  const bookCover = pages[1].book && raw[1] && raw[1].piece && (raw[1].piece.files || [])[0];
  const firstPic = tileBanner ? await bitmapOf({ bytes: tileBanner.bytes, contentType: "image/png" })
    : bookCover ? await bitmapOf({ bytes: bookCover.bytes, contentType: bookCover.contentType })
    : await bitmapOf(pages[1].picture && raw[1] && raw[1].picture);
  const cover = { title, subtitle: pages[0].subtitle, handle, bitmap: coverPic, pic: pages[0].picture };
  const raw0 = raw[0] || {}, raw1 = raw[1] || {};
  const sprite = values.sprite && values.sprite.geometry && values.sprite.bytes ? values.sprite : null;
  const sheet = sprite && (raw0.sprite || raw1.sprite) ? await bitmapOf({ bytes: sprite.bytes, contentType: "image/png" }) : null;

  // Banner: the zine open at its cover and page 1.
  const banner = canvas(1280, 720);
  let g = banner.getContext("2d");
  g.fillStyle = style.desk;
  g.fillRect(0, 0, 1280, 720);
  const ph = 600, u = ph / size.h, pw = size.w * u, gap = 18 * u;
  const left = (1280 - (2 * pw + gap)) / 2, top = (720 - ph) / 2;
  drawCover(g, left, top, pw, ph, u, { ...cover, lane: Boolean(sheet && raw0.sprite) }, style);
  drawPage(g, left + pw + gap, top, pw, ph, u, { ...pages[1], lane: Boolean(sheet && raw1.sprite) }, firstPic, style);
  await drawMarks(g, pages[0].marks, values.look, values.ink, size, left, top, pw, ph);
  await drawMarks(g, pages[1].marks, values.look, values.ink, size, left + pw + gap, top, pw, ph);
  if (sheet && raw0.sprite) drawSprite(g, sheet, sprite, left, top, pw, ph, u, style);
  if (sheet && raw1.sprite) drawSprite(g, sheet, sprite, left + pw + gap, top, pw, ph, u, style);

  // Icon: the cover.
  const icon = canvas(256, 256);
  g = icon.getContext("2d");
  g.fillStyle = style.desk;
  g.fillRect(0, 0, 256, 256);
  const ih = 232, iu = ih / size.h, iw = size.w * iu;
  drawCover(g, (256 - iw) / 2, (256 - ih) / 2, iw, ih, iu, { ...cover, subtitle: "", handle: "" }, style);
  await drawMarks(g, pages[0].marks, values.look, values.ink, size, (256 - iw) / 2, (256 - ih) / 2, iw, ih);

  for (const b of [coverPic, firstPic, sheet]) if (b && b.close) b.close();
  return { banner: await pngOf(banner), icon: await pngOf(icon) };
}
