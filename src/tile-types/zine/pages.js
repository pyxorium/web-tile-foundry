import { lookOf, lookColors } from "./looks.js";
import { PAGE_SIZES } from "./runtime/reader.js";
import { cleanMarks, stickersUsed, markColors } from "./marks.js";
import { soundForReader, soundPath, SOUND_COST, QUOTE_SOUND_COST } from "./sound.js";
import { tileForReader, tapeForReader } from "./piece.js";
export { cropRect } from "../../core/pictures.js";

// The pages of a Zine Scene zine and what each can hold, plus the reader's
// config made from them. Kept free of the browser so the tests can use it.
//
// The classic 8-page mini-zine: cover, pages 1 to 6, back.
//   Cover: the zine's title (from the card title) and "by @handle" are added
//          automatically; the creator adds an optional picture and short line.
//   Pages 1 to 6 and the back: a layout (picture and words / picture / words /
//          words over picture / big quote), with an optional heading. The back
//          also gets a small footer.

export const PAPERS = Object.freeze([
  { value: "letter", label: "Letter" },
  { value: "a4", label: "A4" },
]);

export const LAYOUTS = Object.freeze([
  { value: "both", label: "Picture and words", shows: ["picture", "heading", "words"] },
  { value: "picture", label: "Picture", shows: ["picture"] },
  { value: "words", label: "Words", shows: ["heading", "words"] },
  // Stage 2: a full-page picture (always filled, edge to edge) with the heading
  // and a few words on a band near the bottom; and one short line set large.
  { value: "overlay", label: "Words over picture", shows: ["picture", "heading", "words"], fill: "always" },
  { value: "quote", label: "Big quote", shows: ["words", "subtitle"], labels: { words: "Quote", subtitle: "Who said it (optional)" } },
  // Stage 4: one of the creator's own published tiles, live on the page (tap to
  // start), with an optional heading and words below (see piece.js).
  { value: "tile", label: "A web tile", shows: ["piece", "heading", "words"], labels: { piece: "Your tile", words: "Words (optional)" } },
  // Stage 4, part 2: one of the creator's tapes as its J-card (banner, title,
  // songs by side, dedication), a line of their own, a link out to the tape.
  { value: "tape", label: "A mixtape", shows: ["piece", "subtitle"], labels: { piece: "Your tape", subtitle: "Your own line (optional)" } },
]);

export const PAGES = Object.freeze([
  {
    id: "cover", label: "Cover", short: "C", kind: "cover", fields: ["picture", "subtitle"],
    note: "The title and “by @you” are added from the zine's title and your account.",
  },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, label: `Page ${n}`, short: String(n), kind: "page", layouts: true })),
  {
    id: "back", label: "Back", short: "B", kind: "back", layouts: true,
    note: "A small footer is added at the bottom: Made by @you, the month, and a “Make your own zine” link.",
  },
]);

export const HEADING_MAX = 60;
export const SUBTITLE_MAX = 80;
export const TITLE_MAX = 64;
export const DESCRIPTION_MAX = 200;

// How much room words take: each character, plus about 20 for every line break
// (a short line still uses a whole line). Measured in a browser (Chromium,
// system fonts) at the smallest text size the reader allows; the reader
// shrinks long words a little to fit. See the stage 1 notes in the plan.
export const NEWLINE_COST = 20;
export function wordSize(text) {
  const t = String(text || "");
  return t.length + NEWLINE_COST * (t.match(/\n/g) || []).length;
}

// [without a heading, with a heading], for pages 1 to 6 and for the back
// (which also has its footer). "both" is picture and words, measured with a
// tall picture (the most room a picture takes).
// "overlay" (words over picture) is the band's room; "quote" is the most a big
// quote holds at its smallest size (it has no heading). "tile" is the words under
// a tile (its box takes half the page; measured in all looks, with and without
// the sprite's lane and the sound band, Oct 8). "tile" is the words under
// a tile (its box takes half the page; measured in all looks, with and without
// the sprite's lane and the sound band, Oct 8).
export const WORD_LIMITS = Object.freeze({
  letter: {
    words: { page: [1380, 1230], back: [1230, 990] }, both: { page: [560, 450], back: [450, 250] },
    overlay: { page: [300, 220], back: [240, 160] }, quote: { page: [180, 180], back: [180, 180] },
    tile: { page: [560, 380], back: [420, 230] },
  },
  a4: {
    words: { page: [1230, 1090], back: [1090, 890] }, both: { page: [540, 390], back: [350, 160] },
    overlay: { page: [280, 200], back: [220, 140] }, quote: { page: [180, 180], back: [180, 180] },
    tile: { page: [510, 320], back: [320, 180] },
  },
});

// A page with the creator's sprite keeps a lane along its bottom for it to walk
// in, so its words have this much less room (in wordSize units; measured).
export const SPRITE_LANE = 58; // design pixels, added to the page's bottom padding
export const SPRITE_COST = 190;

/** Whether a sprite can be shown (an rpg.actor sheet: at least 3 columns and 3 rows). */
export function usableSprite(sprite) {
  const g = sprite && sprite.geometry;
  return Boolean(sprite && sprite.bytes && sprite.bytes.length && g && g.columns >= 3 && g.rows >= 3 && g.frameWidth > 0 && g.frameHeight > 0);
}

/** How much room (see wordSize) the words on page `spec` can take, as laid out. */
export function wordLimit(spec, page, values = {}) {
  const paper = WORD_LIMITS[values.paper] ? values.paper : "letter";
  const layout = page && WORD_LIMITS[paper][page.layout] ? page.layout : "words";
  const where = spec.kind === "back" ? "back" : "page";
  const heading = page && String(page.heading || "").trim() ? 1 : 0;
  // The sprite's lane takes room from words that fill the page; the band of
  // words over a picture and a big quote keep theirs (measured).
  const fills = layout === "words" || layout === "both" || layout === "tile";
  const lane = fills && page && page.sprite && usableSprite(values.sprite) ? SPRITE_COST : 0;
  // The sound band (stage 3) takes its room the same way, as soon as the switch
  // is on; a big quote loses a little; words over a picture keep theirs (measured).
  const band = page && page.sound ? (fills ? SOUND_COST : layout === "quote" ? QUOTE_SOUND_COST : 0) : 0;
  return Math.max(0, WORD_LIMITS[paper][layout][where][heading] - lane - band);
}

/** Letter in the Americas where it's the usual paper, A4 elsewhere. */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "CR", "GT", "PA", "DO", "PR", "SV", "NI", "HN", "BZ"]);
export function paperForLocale(locale) {
  const m = /[-_]([A-Za-z]{2})\b/.exec(String(locale || ""));
  return m && LETTER_REGIONS.has(m[1].toUpperCase()) ? "letter" : "a4";
}
export function defaultPaper() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const locale = nav && ((nav.languages && nav.languages[0]) || nav.language);
  return locale ? paperForLocale(locale) : "letter";
}

/** The starting pages: everything empty, pages laid out "picture and words". */
export function emptyPages() {
  return PAGES.map((p) => (p.kind === "cover" ? { id: p.id, subtitle: "", picture: null } : { id: p.id, layout: "both", heading: "", words: "", picture: null }));
}

export function showsOf(spec, page) {
  if (!spec.layouts) return spec.fields;
  return (LAYOUTS.find((l) => l.value === (page && page.layout)) || LAYOUTS[0]).shows;
}

const EXT = { "image/webp": "webp", "image/jpeg": "jpg" };
/** Where a page's picture goes in the tile. */
export function picturePath(page) {
  const ext = EXT[page.picture && page.picture.contentType];
  if (!ext) throw new Error(`The picture on ${page.id} has an unknown type.`);
  return `/pictures/${page.id}.${ext}`;
}

/** Text as it goes into the zine: plain, newlines tidied, trimmed. */
export function cleanText(s, max) {
  let t = String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  t = t.split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return max ? t.slice(0, max) : t;
}

/** "October 2026" (in English, the month the zine is made). */
export function madeLabel(date = new Date()) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Fill (stage 2): a picture can fill its space instead of fitting inside it.
// On the cover and on picture-only pages it fills the whole page, edge to
// edge; on picture-and-words pages it fills the picture area inside the
// margins. The creator chooses what stays in: crop.x and crop.y are the point
// of the picture (0 to 1 across and down) kept at the middle as far as the
// edges allow, and crop.zoom (1 to 2) enlarges it beyond just covering.
export const FILL_ZOOM_MAX = 2;
export const BOTH_PICTURE_SHARE = 0.48; // a picture-and-words page's picture area: this much of the page height
export const COLLAGE_PICTURE_SHARE = 0.38;
const PAGE_PAD = 22;

/** The size (design pixels) a filled picture covers on this page, or null when it doesn't fill. */
export function fillFrame(spec, page, { paper, look } = {}) {
  const pic = page && page.picture;
  const layout = spec.layouts ? (page.layout || "both") : "picture";
  const always = (LAYOUTS.find((l) => l.value === layout) || {}).fill === "always";
  if (!pic || (!pic.fill && !always)) return null;
  const size = PAGE_SIZES[paper] || PAGE_SIZES.letter;
  if (spec.kind === "cover" || layout === "picture" || layout === "overlay") return { w: size.w, h: size.h, bleed: true };
  if (lookOf(look) === "collage") return { w: size.w - 2 * PAGE_PAD - 28, h: Math.round(size.h * COLLAGE_PICTURE_SHARE), bleed: false };
  return { w: size.w - 2 * PAGE_PAD, h: Math.round(size.h * BOTH_PICTURE_SHARE), bleed: false };
}

/** A crop made safe: numbers in range, missing parts filled in. */
export function cleanCrop(crop) {
  const n = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const c = crop || {};
  return { x: n(c.x, 0, 1, 0.5), y: n(c.y, 0, 1, 0.5), zoom: n(c.zoom, 1, FILL_ZOOM_MAX, 1) };
}

/**
 * The pages as the zine shows them: only what each page's layout shows,
 * cleaned. `src(page)` gives a picture's address (its tile path, or in the
 * Foundry preview a data: address). `paper` and `look` size filled pictures.
 */
export function zinePages(pages, src = picturePath, { paper, look, sprite = false, soundSrc = (p) => soundPath(p.id), tileSrc = null } = {}) {
  return PAGES.map((spec, i) => {
    const p = pages[i] || { id: spec.id };
    const shows = showsOf(spec, p);
    const out = { id: spec.id, kind: spec.kind, label: spec.label, shows: shows.slice() };
    if (spec.layouts) out.layout = p.layout;
    if (sprite && p.sprite) out.sprite = true;
    const sound = soundForReader({ ...p, id: spec.id }, soundSrc);
    if (sound) out.sound = sound;
    if (shows.includes("heading")) out.heading = cleanText(p.heading, HEADING_MAX).replace(/\n+/g, " ");
    if (shows.includes("subtitle")) out.subtitle = cleanText(p.subtitle, SUBTITLE_MAX).replace(/\n+/g, " ");
    if (shows.includes("words")) out.words = cleanText(p.words);
    if (shows.includes("piece")) {
      const at = tileSrc ? (path) => tileSrc(spec.id, path) : undefined;
      const tile = p.layout === "tile" ? tileForReader(p, spec.id, at) : null;
      if (tile) out.tile = tile;
      const tape = p.layout === "tape" ? tapeForReader(p, spec.id, at) : null;
      if (tape) out.tape = tape;
    }
    const marks = cleanMarks(p.marks, PAGE_SIZES[paper] || PAGE_SIZES.letter);
    if (marks.length) out.marks = marks;
    out.picture = null;
    if (shows.includes("picture") && p.picture) {
      out.picture = { src: src({ ...p, id: spec.id }), width: p.picture.width, height: p.picture.height, alt: cleanText(p.picture.alt, 200).replace(/\n+/g, " ") };
      const frame = fillFrame(spec, { ...p, layout: p.layout }, { paper, look });
      if (frame) {
        out.picture.fill = true;
        out.picture.crop = cleanCrop(p.picture.crop);
        out.picture.frame = frame;
      }
    }
    return out;
  });
}

export const MAKE_URL = "https://foundry.thunderbird.cafe/";
export const CONFIG_VERSION = 1;

/** The reader's config (see runtime/reader.js). */
export const SPRITE_PATH = "/sprite.png";

/** Whether any page shows the creator's sprite. */
export function usesSprite(pages, sprite) {
  return usableSprite(sprite) && (pages || []).some((p) => p && p.sprite);
}

export function zineConfig({ title, handle, paper, look, ink, pages, made, src, sprite = null, spriteSrc = SPRITE_PATH, soundSrc, tileSrc, preview = false }) {
  const withSprite = usesSprite(pages, sprite);
  const config = {
    version: CONFIG_VERSION,
    paper: paper === "a4" ? "a4" : "letter",
    look: lookOf(look),
    title: cleanText(title, TITLE_MAX).replace(/\n+/g, " "),
    handle: String(handle || "").replace(/^@/, "").trim(),
    made: made || "",
    makeUrl: MAKE_URL,
    pages: zinePages(pages, src, { paper, look, sprite: withSprite, ...(soundSrc ? { soundSrc } : {}), ...(tileSrc ? { tileSrc } : {}) }),
  };
  // Sounds (stage 3): the back page credits plyr.fm.
  if (config.pages.some((p) => p.sound)) config.sounds = true;
  if (withSprite) {
    const g = sprite.geometry;
    config.sprite = { src: spriteSrc, frameWidth: g.frameWidth, frameHeight: g.frameHeight, columns: g.columns, rows: g.rows };
  }
  const colors = lookColors(config.look, ink);
  if (colors) config.ink = colors;
  // Stickers and drawing: the shapes of the stickers used, and the colours for the look.
  if (config.pages.some((p) => p.marks)) {
    config.stickers = stickersUsed(config.pages);
    config.markColors = markColors(config.look, ink);
  }
  if (preview) config.preview = true;
  return config;
}
