// The looks a zine can have (stage 2), and the Riso ink pairs. Pure data and
// small helpers, so the panel, the tile and the tests share them.
//
//   clean      white pages, crisp type, photos in full color (stage 1)
//   photocopy  black-and-white, grainy, typewriter headings, like a photocopied zine
//   collage    cream pages on a kraft desk, photos tilted and taped, cut-paper headings
//   riso       two bright inks on off-white paper, photos printed in the two inks
//
// A look changes how the zine is shown, never the creator's pictures: the
// reader treats them as it draws the page. Body text keeps the same font and
// size in every look, so the word limits (pages.js) hold for all of them.

export const LOOKS = Object.freeze([
  { value: "clean", label: "Clean" },
  { value: "photocopy", label: "Photocopy" },
  { value: "collage", label: "Collage" },
  { value: "riso", label: "Riso" },
]);
export const DEFAULT_LOOK = "clean";

/** Riso ink pairs: `a` prints the text and dark parts, `b` is the bright second ink. */
export const RISO_INKS = Object.freeze([
  { value: "blue-pink", label: "Blue + Pink", a: "#0078bf", b: "#ff48b0" },
  { value: "teal-orange", label: "Teal + Orange", a: "#00838a", b: "#ff6c2f" },
  { value: "purple-green", label: "Purple + Green", a: "#765ba7", b: "#00a95c" },
  { value: "burgundy-yellow", label: "Burgundy + Yellow", a: "#914e72", b: "#ffe800" },
  { value: "navy-sunflower", label: "Navy + Sunflower", a: "#3d5588", b: "#ffb511" },
  { value: "black-red", label: "Black + Red", a: "#000000", b: "#f15060" },
]);
export const DEFAULT_INK = "blue-pink";
export const RISO_PAPER = "#f6f1e7";

export function lookOf(value) {
  return LOOKS.some((l) => l.value === value) ? value : DEFAULT_LOOK;
}
export function inkOf(value) {
  return RISO_INKS.find((i) => i.value === value) || RISO_INKS.find((i) => i.value === DEFAULT_INK);
}

// Contrast (WCAG): text needs at least 4.5 to 1 against its paper.
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The ink darkened just enough (mixed with black) for small text on `paper`. */
export function textInk(ink, paper = RISO_PAPER, min = 4.6) {
  const rgb = hexToRgb(ink);
  for (let k = 0; k <= 20; k++) {
    const hex = rgbToHex(rgb.map((v) => v * (1 - k * 0.05)));
    if (contrast(hex, paper) >= min) return hex;
  }
  return "#000000";
}

/** The colors the reader and the card art use for a look (only Riso has choices). */
export function lookColors(look, ink) {
  if (look !== "riso") return null;
  const pair = inkOf(ink);
  return { pair: pair.value, a: pair.a, b: pair.b, text: textInk(pair.a), paper: RISO_PAPER };
}

// Little pictures for the panel's choices (SVG, made here, no files needed).
function svgUri(svg) {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function miniPage(look) {
  const desk = { clean: "#e9e6df", photocopy: "#d8d6d0", collage: "#c9b48f", riso: "#ddd7cb" }[look];
  const paper = { clean: "#ffffff", photocopy: "#f6f5f1", collage: "#fbf6ea", riso: RISO_PAPER }[look];
  const ink = look === "riso" ? "#0078bf" : look === "collage" ? "#2a241c" : "#1b1a17";
  let pic = `<rect x="62" y="34" width="68" height="44" fill="#7fa7c9"/><circle cx="114" cy="46" r="7" fill="#ffd36b"/><path d="M62 78 L84 56 L98 68 L112 52 L130 78Z" fill="#3e6b4f"/>`;
  let head = `<rect x="62" y="20" width="44" height="7" rx="1" fill="${ink}"/>`;
  if (look === "photocopy") {
    pic = `<rect x="62" y="34" width="68" height="44" fill="#9a9a9a"/><circle cx="114" cy="46" r="7" fill="#e6e6e6"/><path d="M62 78 L84 56 L98 68 L112 52 L130 78Z" fill="#2a2a2a"/>`;
    head = `<rect x="62" y="20" width="52" height="6" fill="#111"/>`;
  }
  if (look === "collage") {
    pic = `<g transform="rotate(-4 96 56)"><rect x="60" y="32" width="72" height="48" fill="#fff"/><rect x="64" y="36" width="64" height="40" fill="#7fa7c9"/><path d="M64 76 L84 56 L98 68 L112 52 L128 76Z" fill="#3e6b4f"/><rect x="54" y="28" width="18" height="7" fill="#efe2bd" opacity=".85" transform="rotate(-30 63 31)"/><rect x="122" y="28" width="18" height="7" fill="#efe2bd" opacity=".85" transform="rotate(30 131 31)"/></g>`;
    head = `<rect x="60" y="15" width="50" height="11" fill="#2a241c" transform="rotate(-2 85 20)"/>`;
  }
  if (look === "riso") {
    pic = `<rect x="62" y="34" width="68" height="44" fill="#f7a6d2"/><path d="M62 78 L84 56 L98 68 L112 52 L130 78Z" fill="#3a3f8f"/><circle cx="114" cy="46" r="7" fill="#fbd3e8"/>`;
    head = `<rect x="62" y="22" width="44" height="5" fill="#ff48b0" opacity=".6"/><rect x="62" y="19" width="44" height="6" fill="#0078bf"/>`;
  }
  const lines = [86, 93, 100].map((y, i) => `<rect x="62" y="${y}" width="${i === 2 ? 40 : 68}" height="3" rx="1" fill="${ink}" opacity=".55"/>`).join("");
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 120" width="192" height="120"><rect width="192" height="120" fill="${desk}"/><rect x="52" y="8" width="88" height="106" fill="${paper}"/>${head}${pic}${lines}</svg>`);
}
function inkSwatch(pair) {
  // Where the two inks overlap they print darker (multiplied), as on a real riso.
  const both = rgbToHex(hexToRgb(pair.a).map((v, i) => (v * hexToRgb(pair.b)[i]) / 255));
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 120" width="192" height="120"><defs><clipPath id="a"><circle cx="80" cy="60" r="36"/></clipPath></defs><rect width="192" height="120" fill="${RISO_PAPER}"/><circle cx="80" cy="60" r="36" fill="${pair.a}"/><circle cx="112" cy="60" r="36" fill="${pair.b}"/><circle cx="112" cy="60" r="36" fill="${both}" clip-path="url(#a)"/></svg>`);
}

export const LOOK_OPTIONS = Object.freeze(LOOKS.map((l) => ({ ...l, image: miniPage(l.value) })));
export const INK_OPTIONS = Object.freeze(RISO_INKS.map((p) => ({ value: p.value, label: p.label, image: inkSwatch(p) })));
