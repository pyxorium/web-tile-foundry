import { lookOf, lookColors } from "./looks.js";

// Stickers and drawing (stage 2): "marks" the creator puts on a page, on top
// of everything else. Each page keeps a list, drawn in order:
//   { t: "s", id, x, y, s, r }   a sticker from the built-in set: centre (x, y)
//                                in design pixels, size s (1 = 60 px across),
//                                rotation r in degrees
//   { t: "p", pen, w, d }        a pen stroke: pen slot (a, b, c, hi), width
//                                "fine" or "thick", d = [x0, y0, x1, y1, ...]
// Pens and sticker colours follow the zine's look (see PEN_SLOTS and
// markColors), so changing the look recolours the marks to suit it.
// marksDefs and marksMarkup make the SVG for a page: they are self-contained
// so the tile's page carries their source (like cropRect).

export const MAX_MARKS = 24;
export const MAX_POINTS = 400;
export const STICKER_SIZE = 60; // design pixels across at size 1
export const STICKER_SCALE = [0.4, 3];

// The sticker set: drawn on a 100 x 100 grid, centred on (50, 50). Parts:
//   f  filled with the sticker's colour, outlined in the line colour
//   o  filled with the sticker's colour, no outline
//   s  a stroke in the sticker's colour
//   l  a stroke in the line colour
//   k  filled with the line colour
//   w  filled with the paper colour
function starPoints(cx, cy, outer, inner, n, turn = -90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = ((turn + (i * 180) / n) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export const STICKERS = Object.freeze([
  { id: "star", label: "Star", fill: "#ffd23f", svg: `<polygon class="f" points="${starPoints(50, 53, 44, 19, 5)}"/>` },
  { id: "heart", label: "Heart", fill: "#ef476f", svg: `<path class="f" d="M50 86C22 66 8 48 13 31C18 15 40 11 50 28C60 11 82 15 87 31C92 48 78 66 50 86Z"/>` },
  { id: "arrow", label: "Arrow", fill: "#118ab2", svg: `<path class="f" d="M8 40H58V22L92 50L58 78V60H8Z"/>` },
  { id: "speech", label: "Speech bubble", fill: "#ffffff", svg: `<path class="f" d="M14 16H86Q92 16 92 22V60Q92 66 86 66H44L24 86L28 66H14Q8 66 8 60V22Q8 16 14 16Z"/>` },
  { id: "thought", label: "Thought bubble", fill: "#ffffff", svg: `<ellipse class="f" cx="54" cy="40" rx="38" ry="28"/><circle class="f" cx="22" cy="76" r="8"/><circle class="f" cx="10" cy="91" r="4.5"/>` },
  { id: "new", label: "NEW! burst", fill: "#ffd23f", svg: `<polygon class="f" points="${starPoints(50, 50, 47, 33, 14)}"/><text class="k" x="50" y="58" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="23">NEW!</text>` },
  { id: "smiley", label: "Smiley", fill: "#ffd23f", svg: `<circle class="f" cx="50" cy="50" r="40"/><circle class="k" cx="36" cy="40" r="5"/><circle class="k" cx="64" cy="40" r="5"/><path class="l" d="M30 58Q50 80 70 58"/>` },
  { id: "sparkle", label: "Sparkle", fill: "#ffd23f", svg: `<path class="f" d="M50 6Q56 44 94 50Q56 56 50 94Q44 56 6 50Q44 44 50 6Z"/>` },
  { id: "bolt", label: "Lightning", fill: "#ffb000", svg: `<polygon class="f" points="58,4 18,56 46,56 38,96 82,40 54,40"/>` },
  { id: "note", label: "Music note", fill: "#ffffff", svg: `<ellipse class="k" cx="34" cy="76" rx="16" ry="12" transform="rotate(-20 34 76)"/><path class="k" d="M46 74V12H52Q56 30 80 36V46Q60 42 52 32V74Z"/>` },
  { id: "flower", label: "Flower", fill: "#ff8fab", svg: `<circle class="f" cx="50" cy="24" r="17"/><circle class="f" cx="75" cy="42" r="17"/><circle class="f" cx="66" cy="72" r="17"/><circle class="f" cx="34" cy="72" r="17"/><circle class="f" cx="25" cy="42" r="17"/><circle class="w" cx="50" cy="50" r="13"/><circle class="l" cx="50" cy="50" r="13"/>` },
  { id: "check", label: "Check mark", fill: "#06a77d", svg: `<path class="s" d="M14 54L38 78L88 22" stroke-width="14"/>` },
  { id: "tape", label: "Tape", fill: "#efe2bd", svg: `<path class="o" d="M4 34L10 38L4 42L10 46L4 50L10 54L4 58L10 62L4 66H96L90 62L96 58L90 54L96 50L90 46L96 42L90 38L96 34Z" opacity=".85"/>` },
  { id: "circle", label: "Circle scribble", fill: "#ef476f", svg: `<path class="s" d="M60 14C26 8 6 30 10 54C14 80 52 92 78 78C98 66 96 34 74 20C62 13 44 14 34 18" stroke-width="5"/>` },
  { id: "underline", label: "Underline", fill: "#ef476f", svg: `<path class="s" d="M4 52C18 44 26 60 40 52C54 44 62 60 76 52C86 46 92 54 96 50" stroke-width="7"/>` },
  { id: "bang", label: "!!!", fill: "#ffffff", svg: `<text class="k" x="50" y="78" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="78">!!!</text>` },
]);

/** Pen slots each look offers in the panel, with names; strokes keep their slot when the look changes. */
export const PEN_SLOTS = Object.freeze({
  clean: [["a", "Black"], ["b", "Red"], ["c", "Blue"], ["hi", "Highlighter"]],
  collage: [["a", "Black"], ["b", "Red"], ["c", "Blue"], ["hi", "Highlighter"]],
  photocopy: [["a", "Black"], ["b", "White-out"]],
  riso: [["a", "First ink"], ["b", "Second ink"]],
});
export const PEN_WIDTHS = Object.freeze({ fine: 2.5, thick: 6, hiFine: 10, hiThick: 18 });

/** The colours marks are drawn in for a look: line, paper, pens, and each sticker's fill. */
export function markColors(look, ink) {
  const l = lookOf(look);
  const fills = Object.fromEntries(STICKERS.map((st) => [st.id, st.fill]));
  if (l === "photocopy") {
    return { line: "#111111", paper: "#f6f5f1", pens: { a: "#111111", b: "#f6f5f1", c: "#111111", hi: "#111111" }, hiOpacity: 0.22, fills, mono: true };
  }
  if (l === "riso") {
    const c = lookColors("riso", ink);
    const riso = Object.fromEntries(STICKERS.map((st) => [st.id, st.fill === "#ffffff" ? c.paper : c.b]));
    return { line: c.text, paper: c.paper, pens: { a: c.text, b: c.b, c: c.text, hi: c.b }, hiOpacity: 0.45, fills: riso, mono: false };
  }
  const paper = l === "collage" ? "#fbf6ea" : "#ffffff";
  return { line: "#1b1a17", paper, pens: { a: "#1b1a17", b: "#d23b2e", c: "#2f5fb3", hi: "#ffe100" }, hiOpacity: 0.45, fills, mono: false };
}

const STICKER_IDS = new Set(STICKERS.map((s) => s.id));
const SLOTS = new Set(["a", "b", "c", "hi"]);
const round = (v) => Math.round(v * 10) / 10;

/** Marks made safe: known stickers and pens only, numbers in range, limits kept. */
export function cleanMarks(marks, { w = 330, h = 510 } = {}) {
  if (!Array.isArray(marks)) return [];
  const out = [];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const m of marks) {
    if (out.length >= MAX_MARKS || !m || typeof m !== "object") continue;
    if (m.t === "s" && STICKER_IDS.has(m.id) && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      out.push({
        t: "s", id: m.id,
        x: round(clamp(m.x, -40, w + 40)), y: round(clamp(m.y, -40, h + 40)),
        s: round(clamp(Number.isFinite(m.s) ? m.s : 1, STICKER_SCALE[0], STICKER_SCALE[1]) * 10) / 10,
        r: Math.round(((((Number.isFinite(m.r) ? m.r : 0) + 180) % 360) + 360) % 360 - 180),
      });
    } else if (m.t === "p" && SLOTS.has(m.pen) && Array.isArray(m.d) && m.d.length >= 2) {
      const d = [];
      for (let i = 0; i + 1 < m.d.length && d.length < MAX_POINTS * 2; i += 2) {
        if (Number.isFinite(m.d[i]) && Number.isFinite(m.d[i + 1])) d.push(round(clamp(m.d[i], -10, w + 10)), round(clamp(m.d[i + 1], -10, h + 10)));
      }
      if (d.length >= 2) out.push({ t: "p", pen: m.pen, w: m.w === "thick" ? "thick" : "fine", d });
    }
  }
  return out;
}

/** Drops points closer than `min` design pixels to the last one kept (a stroke as drawn). */
export function simplifyStroke(d, min = 1.5) {
  if (d.length <= 4) return d.slice();
  const out = [d[0], d[1]];
  for (let i = 2; i + 1 < d.length; i += 2) {
    const dx = d[i] - out[out.length - 2], dy = d[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= min * min || i + 2 >= d.length) out.push(d[i], d[i + 1]);
  }
  return out.slice(0, MAX_POINTS * 2);
}

/** The sticker shapes used on a page, as SVG <symbol>s (ids "st-<id>"), with their styles. Self-contained. */
export function marksDefs(stickers, colors) {
  var css = ".f{fill:var(--f);stroke:" + colors.line + ";stroke-width:4;stroke-linejoin:round}" +
    ".o{fill:var(--f)}" +
    ".s{fill:none;stroke:var(--f);stroke-linecap:round;stroke-linejoin:round}" +
    ".l{fill:none;stroke:" + colors.line + ";stroke-width:5;stroke-linecap:round}" +
    ".k{fill:" + colors.line + "}" +
    ".w{fill:" + colors.paper + "}";
  var out = "<style>" + css + "</style><defs>";
  for (var id in stickers) out += '<symbol id="st-' + id + '" viewBox="0 0 100 100" overflow="visible">' + stickers[id] + "</symbol>";
  return out + "</defs>";
}

/** A page's marks as SVG (the inside of an <svg viewBox="0 0 W H">), in order. Self-contained. */
export function marksMarkup(marks, colors) {
  var widths = { fine: 2.5, thick: 6, hiFine: 10, hiThick: 18 };
  var out = "";
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    if (m.t === "s") {
      var size = 60 * m.s;
      out += '<g data-i="' + i + '" transform="translate(' + m.x + " " + m.y + ") rotate(" + m.r + ')">' +
        '<use href="#st-' + m.id + '" x="' + (-size / 2) + '" y="' + (-size / 2) + '" width="' + size + '" height="' + size + '" style="--f:' + (colors.fills[m.id] || "#ffd23f") + '"/></g>';
    } else if (m.t === "p") {
      var d = m.d, path = "M" + d[0] + " " + d[1];
      if (d.length === 2) path += "L" + (d[0] + 0.1) + " " + d[1];
      for (var k = 2; k + 3 < d.length; k += 2) {
        path += "Q" + d[k] + " " + d[k + 1] + " " + ((d[k] + d[k + 2]) / 2) + " " + ((d[k + 1] + d[k + 3]) / 2);
      }
      if (d.length >= 4) path += "L" + d[d.length - 2] + " " + d[d.length - 1];
      var hi = m.pen === "hi";
      var w = hi ? (m.w === "thick" ? widths.hiThick : widths.hiFine) : (m.w === "thick" ? widths.thick : widths.fine);
      out += '<path data-i="' + i + '" d="' + path + '" fill="none" stroke="' + colors.pens[m.pen] + '" stroke-width="' + w + '" stroke-linecap="' + (hi ? "butt" : "round") + '" stroke-linejoin="round"' +
        (hi ? ' stroke-opacity="' + colors.hiOpacity + '" style="mix-blend-mode:multiply"' : "") + "/>";
    }
  }
  return out;
}

/** The shapes (inner SVG) of the stickers these pages use, for the reader's config. */
export function stickersUsed(pages) {
  const used = {};
  for (const p of pages || []) for (const m of (p && p.marks) || []) if (m.t === "s") used[m.id] = STICKERS.find((s) => s.id === m.id).svg;
  return used;
}

/** A complete SVG picture of one page's marks (for the card art and the panel's sticker buttons). */
export function marksSvg(marks, colors, w, h) {
  const stickers = stickersUsed([{ marks }]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${marksDefs(stickers, colors)}${marksMarkup(marks, colors)}</svg>`;
}
