import { APP_PICTURE_SOURCES } from "../../core/app-pictures.js";
import { describePages } from "../../core/gallery-fill.js";
import { lookOf, lookColors, isLightInk } from "./looks.js";
import { PAGE_SIZES } from "./runtime/reader.js";
import { cleanMarks, stickersUsed, markColors } from "./marks.js";
import { soundForReader, soundPath, SOUND_COST, QUOTE_SOUND_COST } from "./sound.js";
import { tileForReader, tapeForReader, ATMOSYNTH_HOME } from "./piece.js";
import { bookForReader, BOOKHIVE } from "./books.js";
import { activityForReader, TREELINE } from "./activities.js";
export { cropRect } from "../../core/pictures.js";

// The pages of a Zine Scene zine and what each can hold, plus the reader's
// config made from them. Kept free of the browser so the tests can use it.
//
// The classic 8-page mini-zine: cover, pages 1 to 6, back (or, since stage 6,
// 4 pages: cover, 1, 2, back; or 2: cover and back; see PAGE_COUNTS).
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
  // Stage 5, part 2: one of the creator's Bookhive books (cover, title, author,
  // stars, where they are with it) and a line from their review (see books.js).
  { value: "book", label: "A book", shows: ["piece", "words"], labels: { piece: "Your book", words: "Line from your review (optional)" } },
  // One of the creator's Treeline activities: the route, an elevation profile,
  // the title, sport, date and stats, and words of their own (see activities.js).
  { value: "activity", label: "An activity", shows: ["piece", "words"], labels: { piece: "Your activity", words: "Your own words (optional)" } },
]);

export const PAGES = Object.freeze([
  {
    id: "cover", label: "Cover", short: "C", kind: "cover", fields: ["picture", "subtitle"],
    note: "The title and “by @you” are added from the zine's title and your account.",
  },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, label: `Page ${n}`, short: String(n), kind: "page", layouts: true })),
  {
    id: "back", label: "Back", short: "B", kind: "back", layouts: true,
    note: "A small footer is added at the bottom: Made by @you, the month, a “Make your own zine” link, and Credits when something came from another app.",
  },
]);

// Page counts (stage 6, owner Oct 11): 8 (the classic one-sheet booklet), 4 (a
// card: the cover, pages 1 and 2, the back) or 2 (front and back: the cover and
// the back). The panel's values always keep all eight pages; a shorter zine
// puts the others aside (kept, so switching back restores them, but not shown,
// counted, published or put in the recipe).
export const PAGE_COUNTS = Object.freeze([8, 4, 2]);
export const DEFAULT_PAGE_COUNT = 8;
const KEPT = Object.freeze({ 4: ["cover", "p1", "p2", "back"], 2: ["cover", "back"] });
export const PAGE_COUNT_OPTIONS = Object.freeze(PAGE_COUNTS.map((n) => ({ value: n, label: `${n} pages` })));

/** A page count made safe: 2, 4 or 8 (older zines, with none, are 8). */
export function pageCountOf(count) {
  const n = Number(count);
  return PAGE_COUNTS.includes(n) ? n : DEFAULT_PAGE_COUNT;
}

/** The page specs a zine of this many pages uses, in reading order. */
export function pagesFor(count) {
  const keep = KEPT[pageCountOf(count)];
  return keep ? PAGES.filter((spec) => keep.includes(spec.id)) : PAGES.slice();
}

/** Whether a page is part of the zine (not put aside by a shorter page count). */
export function pageInUse(spec, values) {
  const id = typeof spec === "string" ? spec : spec && spec.id;
  return pagesFor(values && values.pageCount).some((s) => s.id === id);
}

/** The panel's pages that are in use, in the same order as pagesFor(count). */
export function pagesInUse(pages, count) {
  return pagesFor(count).map((spec) => (pages || [])[PAGES.indexOf(spec)] || { id: spec.id });
}

/** Whether a page has anything on it (as the page strip marks it). */
export function pageHasContent(p) {
  return Boolean(p && (p.picture || String(p.heading || "").trim() || String(p.words || "").trim() || String(p.subtitle || "").trim()
    || p.sprite || p.sound || (Array.isArray(p.marks) && p.marks.length > 0) || (p.piece && p.piece.uri)));
}

/**
 * The line under the page choice while work is put aside, or null:
 * "Pages 3 to 6 are put aside, not published. Switch back to 8 to get them back."
 * It names only the put-aside pages with something on them, and the smallest
 * count that would bring them all back.
 */
export function asideNote(values) {
  const count = pageCountOf(values && values.pageCount);
  const pages = (values && values.pages) || [];
  const aside = PAGES.filter((spec, i) => !pageInUse(spec, values) && pageHasContent(pages[i]));
  if (!aside.length) return null;
  const back = PAGE_COUNTS.slice().reverse().find((n) => n > count && aside.every((spec) => pagesFor(n).includes(spec))) || DEFAULT_PAGE_COUNT;
  const where = describePages(aside.map((spec) => spec.id), PAGES);
  const one = aside.length === 1;
  const name = where.charAt(0).toUpperCase() + where.slice(1);
  return `${name} ${one ? "is" : "are"} put aside, not published. Switch back to ${back} to get ${one ? "it" : "them"} back.`;
}

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
// "book" (stage 5) is the line from the review under a book's cover, title,
// author, stars and status (no heading). Measured Oct 9 in all looks, both
// papers, page and back, with and without the sprite's lane and the sound band:
// a typical book (one-line title, one author) keeps its cover at 80% or more;
// an extra-long one (three-line title, two authors) fits with its cover made
// smaller (the reader's fitBook). About 5% kept spare. The sprite's lane and the
// sound band take BOOK_SPRITE_COST / BOOK_SOUND_COST of it. (An A4 back page
// with both has no room left for a review line.)
export const BOOK_ROOM = Object.freeze({ letter: { page: 560, back: 360 }, a4: { page: 460, back: 280 } });
export const BOOK_SPRITE_COST = 200;
export const BOOK_SOUND_COST = 150;
// "activity": the creator's own words under an activity's route and stats (no
// heading). Measured Oct 10 in all looks, both papers, page and back, with and
// without the elevation profile, the sprite's lane and the sound band, with a
// one-line and a two-line title (256 cases), keeping the route at least 80
// design px tall; about 5% kept spare. The profile, the sprite's lane and the
// sound band take their costs from it. (An A4 back page with all three has no
// room left for words; the route then gives up some height so the page still fits.)
export const ACTIVITY_ROOM = Object.freeze({ letter: { page: 715, back: 520 }, a4: { page: 575, back: 425 } });
export const ACTIVITY_SPRITE_COST = 205;
export const ACTIVITY_SOUND_COST = 155;
export const ACTIVITY_PROFILE_COST = 205;

/** Whether an activity page shows its elevation profile (on unless switched off, and only with elevations). */
export function showsProfile(page) {
  const p = page && page.piece;
  return Boolean(p && p.kind === "activity" && p.showProfile !== false && p.activity && Array.isArray(p.activity.elevations) && p.activity.elevations.length > 1);
}
export const WORD_LIMITS = Object.freeze({
  letter: {
    words: { page: [1380, 1230], back: [1230, 990] }, both: { page: [560, 450], back: [450, 250] },
    overlay: { page: [300, 220], back: [240, 160] }, quote: { page: [180, 180], back: [180, 180] },
    tile: { page: [560, 380], back: [420, 230] },
    book: { page: [BOOK_ROOM.letter.page, BOOK_ROOM.letter.page], back: [BOOK_ROOM.letter.back, BOOK_ROOM.letter.back] },
    activity: { page: [ACTIVITY_ROOM.letter.page, ACTIVITY_ROOM.letter.page], back: [ACTIVITY_ROOM.letter.back, ACTIVITY_ROOM.letter.back] },
  },
  a4: {
    words: { page: [1230, 1090], back: [1090, 890] }, both: { page: [540, 390], back: [350, 160] },
    overlay: { page: [280, 200], back: [220, 140] }, quote: { page: [180, 180], back: [180, 180] },
    tile: { page: [510, 320], back: [320, 180] },
    book: { page: [BOOK_ROOM.a4.page, BOOK_ROOM.a4.page], back: [BOOK_ROOM.a4.back, BOOK_ROOM.a4.back] },
    activity: { page: [ACTIVITY_ROOM.a4.page, ACTIVITY_ROOM.a4.page], back: [ACTIVITY_ROOM.a4.back, ACTIVITY_ROOM.a4.back] },
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
  // A book page (stage 5) loses room for its line from the review in the same way (measured).
  const book = layout === "book";
  const act = layout === "activity";
  const lane = (fills || book || act) && page && page.sprite && usableSprite(values.sprite) ? (book ? BOOK_SPRITE_COST : act ? ACTIVITY_SPRITE_COST : SPRITE_COST) : 0;
  // The sound band (stage 3) takes its room the same way, as soon as the switch
  // is on; a big quote loses a little; words over a picture keep theirs (measured).
  const band = page && page.sound ? (fills ? SOUND_COST : book ? BOOK_SOUND_COST : act ? ACTIVITY_SOUND_COST : layout === "quote" ? QUOTE_SOUND_COST : 0) : 0;
  const profile = act && showsProfile(page) ? ACTIVITY_PROFILE_COST : 0;
  return Math.max(0, WORD_LIMITS[paper][layout][where][heading] - lane - band - profile);
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
export function zinePages(pages, src = picturePath, { paper, look, sprite = false, soundSrc = (p) => soundPath(p.id), tileSrc = null, count } = {}) {
  const used = pagesInUse(pages, count);
  return pagesFor(count).map((spec, i) => {
    const p = used[i] || { id: spec.id };
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
      const book = p.layout === "book" ? bookForReader(p, spec.id, at) : null;
      if (book) out.book = book;
      const activity = p.layout === "activity" ? activityForReader(p, paper) : null;
      if (activity) out.activity = activity;
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
export function usesSprite(pages, sprite, count) {
  return usableSprite(sprite) && pagesInUse(pages, count).some((p) => p && p.sprite);
}

/**
 * The zine's credits: [{ what, app, href, pages }], one per app something came
 * from, in a fixed order (sprite, songs, then the apps), with the pages it's on
 * ("the cover, pages 1 to 5 and the back", as describePages in src/core/gallery-fill.js words it).
 * `shown` are the pages as the reader gets them (zinePages).
 */
export function zineCredits(pages, shown, withSprite, count) {
  const out = [];
  const specs = pagesFor(count);
  const used = pagesInUse(pages, count);
  const where = (fn) => describePages(specs.filter((spec, i) => fn(shown[i] || {}, used[i] || {})).map((spec) => spec.id), specs);
  const add = (what, app, href, fn) => {
    const at = where(fn);
    if (at) out.push({ what, app, href, pages: at });
  };
  if (withSprite) add("Sprite", "rpg.actor", "https://rpg.actor/", (z) => z.sprite);
  add("Songs", "plyr.fm", "https://plyr.fm/", (z) => z.sound);
  for (const a of Object.keys(APP_PICTURE_SOURCES)) {
    const s = APP_PICTURE_SOURCES[a];
    add(s.what, s.app, s.home, (z, raw) => z.picture && raw.picture && raw.picture.source && raw.picture.source.app === a);
  }
  add("Books", BOOKHIVE.app, BOOKHIVE.home, (z) => z.book);
  add("Activities", TREELINE.app, TREELINE.home, (z) => z.activity);
  add("Synth patches", "ATMOSYNTH", ATMOSYNTH_HOME, (z) => z.tile && z.tile.atmo);
  return out;
}

export function zineConfig({ title, handle, paper, look, ink, pages, pageCount, made, src, sprite = null, spriteSrc = SPRITE_PATH, soundSrc, tileSrc, preview = false }) {
  const count = pageCountOf(pageCount);
  const withSprite = usesSprite(pages, sprite, count);
  const config = {
    version: CONFIG_VERSION,
    pageCount: count,
    paper: paper === "a4" ? "a4" : "letter",
    look: lookOf(look),
    title: cleanText(title, TITLE_MAX).replace(/\n+/g, " "),
    handle: String(handle || "").replace(/^@/, "").trim(),
    made: made || "",
    makeUrl: MAKE_URL,
    pages: zinePages(pages, src, { paper, look, count, sprite: withSprite, ...(soundSrc ? { soundSrc } : {}), ...(tileSrc ? { tileSrc } : {}) }),
  };
  // Credits (stage 5): what came from other apps, and on which pages. The back
  // page's footer has a "Credits" button that opens them as a sheet.
  const credits = zineCredits(pages, config.pages, withSprite, count);
  if (credits.length) config.credits = credits;
  if (withSprite) {
    const g = sprite.geometry;
    config.sprite = { src: spriteSrc, frameWidth: g.frameWidth, frameHeight: g.frameHeight, columns: g.columns, rows: g.rows };
  }
  const colors = lookColors(config.look, ink);
  if (colors) config.ink = isLightInk(colors.b) ? { ...colors, light: true } : colors;
  // Stickers and drawing: the shapes of the stickers used, and the colours for the look.
  if (config.pages.some((p) => p.marks)) {
    config.stickers = stickersUsed(config.pages);
    config.markColors = markColors(config.look, ink);
  }
  if (preview) config.preview = true;
  return config;
}
