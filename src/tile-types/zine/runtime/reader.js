import { cropRect } from "../../../core/pictures.js";
import { marksDefs, marksMarkup } from "../marks.js";
import { SOUND_ROW } from "../sound.js";
import { mapLayout } from "../activities.js";

// The Zine Scene reader: the program and styles built into every zine tile's
// page. Plain JavaScript (no bundler), kept as text so it can go straight into
// the page and run in Node tests too.
//
// Pages are laid out at a fixed design size (PAGE_SIZES, in CSS pixels) and the
// whole page is scaled to the space the host gives, so text wraps the same way
// everywhere. The reader picks its layout from the space, width AND height:
//   card    too small to read (a profile card, a grid): the cover, "tap to read"
//   single  one page at a time
//   spread  two pages side by side, when that doesn't make pages much smaller
// Arrows, swipe and the arrow keys turn pages.
//
// Config (JSON in #zine-config): { version, pageCount (8, 4 or 2: the pages listed
//   are only those in use), paper, look, title, handle, made,
//   makeUrl, pages: [{ id, kind: "cover"|"page"|"back", label, shows,
//   heading, subtitle, words, picture: { src, width, height, alt } | null,
//   sound?: { src, title, details?, url?, seconds },
//   tile?: { name, by, url?, page, refs: [{ ref, src }], poster? },
//   tape?: { name, title, url?, poster?, sides: [{ name, songs }], dedication? },
//   book?: { title, authors, stars?, starsLabel?, status?, cover? },
//   activity?: { title, sport, date, url, stats: [{ label, value }], route?: { w, h, d, start, end },
//                profile?: { line, area, low, high } } }], credits?: [...] }
//
// Tiles on a page (stage 4, layout "tile"): one of the creator's own tiles, its
// files copied into the zine. Since v0.28.0 a tile starts by itself when its page
// is shown (one tap on its own controls, not two): its files are fetched a page
// ahead through the same queue as pictures, and handed to a frame as blob:
// copies of its own (way C of the stage 4 host test: the nested frame needs no
// service worker). Its picture shows while it loads. It stops (the frame is
// removed) when the reader leaves the page.
//
// Loading (stage 3): pictures are fetched only as the reader nears their page:
// first the pages being shown, then the pages either side, one file at a time.
// Each file is asked for once and kept (tile hosts download every request in
// full and keep nothing; see claude/mixtape-loading-fix.md). A sound is fetched
// only when its play button is tapped, then plays on across page turns until it
// ends (a small pill stops it from any page); one plays at a time.
// In the Foundry's preview (config.preview), the page also listens to its parent
// for { zine: "config", config } and { zine: "goto", id }.

export const PAGE_SIZES = Object.freeze({ letter: { w: 330, h: 510 }, a4: { w: 330, h: 467 } });
export const READER_NAV = 52; // the strip under the pages (arrows and page name)
export const SPRITE_LANE_PX = 58; // the sprite's lane (same as SPRITE_LANE in pages.js)
export const SOUND_ROW_PX = SOUND_ROW; // the sound band's row: 8 + 32 + 6 design px
// "Still loading…", then Try again (pictures and sounds are small, so sooner than
// the Mixtape's 10 and 20 s); and how often the zine nudges its loader awake.
export const LOAD_TIMES = Object.freeze({ still: 4000, retry: 8000, keepAlive: 20000 });
export const WORDS_MIN_SCALE = 0.8;
export const ACT_ROUTE_MIN = 80; // an activity's route keeps at least this much height (design px)
export const ACT_PROFILE_H = 46; // and its elevation profile this much

/**
 * Which layout the reader uses for a space (pure, for tests). A 2-page zine
 * (stage 6) never opens as a spread: it flips like a card, one side at a time.
 */
export function chooseLayout(width, height, paper = "letter", count = 8) {
  const { w, h } = PAGE_SIZES[paper] || PAGE_SIZES.letter;
  const pad = 16, gap = 14;
  if (width < 260 || height < 230) return { mode: "card", scale: Math.min(width / w, height / h) };
  const room = height - READER_NAV - pad;
  const single = Math.min((width - pad * 2) / w, room / h, 2.4);
  const spread = Math.min((width - pad * 2 - gap) / (2 * w), room / h, 2.4);
  if (count > 2 && spread * h >= 300 && spread >= 0.85 * single) return { mode: "spread", scale: spread };
  if (single * h < 200) return { mode: "card", scale: Math.min(width / w, height / h) };
  return { mode: "single", scale: single };
}

/** The views for a layout: lists of page indexes (null = empty side). */
export function viewsFor(mode, count) {
  if (mode !== "spread") return Array.from({ length: count }, (_, i) => [i]);
  const views = [[null, 0]];
  for (let i = 1; i < count - 1; i += 2) views.push(i + 1 < count - 1 ? [i, i + 1] : [i, null]);
  views.push([count - 1, null]);
  return views;
}

// Grain textures (SVG noise as data: addresses: allowed by the tile's policy).
function noise(freq, alpha) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${alpha}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
/** Riso ink curves: ink coverage for darkness 0, 0.2, 0.4, ... 1 (shared with the card art). */
export const RISO_CURVES = Object.freeze({ a: "0 0 0.06 0.4 0.85 1", b: "0 0.4 0.72 0.78 0.55 0.4" });
export const GRAIN_TONER = noise(0.9, "-2.6 1.15");
export const GRAIN_RISO = noise(1.4, "-1.6 0.95");

export const READER_CSS = `
:root { color-scheme: light; --desk: #e9e6df; --paper: #ffffff; --ink: #1b1a17; --soft: #6c675d; --line: #d9d4ca; --accent: #2f5fb3; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--desk); color: var(--ink); overflow: hidden;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-text-size-adjust: 100%; }
#zine { position: fixed; inset: 0; display: flex; flex-direction: column; }
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.deck { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; }
.zp { position: absolute; top: 0; background: var(--paper); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 18px rgba(30,25,15,.14);
  display: flex; flex-direction: column; padding: 22px 22px 18px; overflow: hidden; visibility: hidden; opacity: 0; transition: opacity .18s ease; }
.zp.shown { visibility: visible; opacity: 1; }
.zp h2 { margin: 0 0 8px; font-size: 19px; line-height: 1.2; font-weight: 750; overflow-wrap: anywhere; }
.zp .words { flex: 1 1 auto; min-height: 0; overflow: hidden; font-size: var(--fs, 14px); overflow-wrap: anywhere; }
.zp .words p { margin: 0 0 .65em; }
.zp .pic { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; margin: 0 0 10px; }
.zp:not(.both) .pic { container-type: size; }
.zp .photo { position: relative; display: block; max-width: 100%; line-height: 0; }
.zp .photo img { display: block; width: auto; height: auto; max-width: 100cqw; max-height: 100cqh; }
.zp .photo img.lb { display: none; }
.zp.both .pic { flex: 0 0 auto; }
.zp.both .photo img { max-width: 100%; max-height: calc(var(--ph) * 0.48); }
.zp.picture .pic { margin: 0; }
.zp .num { position: absolute; bottom: 6px; left: 0; right: 0; text-align: center; font-size: 10px; color: var(--soft); }
.zp.cover { padding: 28px 24px 20px; }
.zp.cover h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.08; font-weight: 800; letter-spacing: -.01em; overflow-wrap: anywhere; }
.zp.cover .sub { margin: 10px 0 0; font-size: 15px; color: var(--ink); overflow-wrap: anywhere; }
.zp.cover .by { margin: 6px 0 0; font-size: 12px; color: var(--soft); }
.zp.cover .pic { margin: 4px 0 0; }
.zp .foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--soft); display: flex; flex-direction: column; gap: 4px; }
.zp .foot .links { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zp .foot a { color: var(--accent); text-decoration: none; }
.zp .foot a:hover { text-decoration: underline; }
.nav { flex: none; height: ${READER_NAV}px; display: flex; align-items: center; justify-content: center; gap: 14px; }
.nav button { width: 38px; height: 38px; border-radius: 50%; border: 1px solid #c9c3b7; background: #fff; color: var(--ink); font-size: 18px; line-height: 1; cursor: pointer; }
.nav button:disabled { opacity: .35; cursor: default; }
.nav button:focus-visible, .open:focus-visible { outline: 3px solid rgba(47,95,179,.45); outline-offset: 2px; }
.where { min-width: 7.5em; text-align: center; font-size: 13px; color: var(--soft); font-variant-numeric: tabular-nums; }
.card .nav { display: none; }
.open { position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: transparent; cursor: pointer; }
.open span { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); background: rgba(27,26,23,.82); color: #fff; font-size: 12px; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }

/* Photocopy: black-and-white, toner grain, typewriter headings. */
[data-look="photocopy"] { --desk: #d6d4ce; --paper: #f6f5f1; --ink: #121212; --soft: #3d3d3d; --line: #b9b6ae; --accent: #121212; }
[data-look="photocopy"] .zp { box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 6px 18px rgba(20,20,20,.16), inset 0 0 22px rgba(0,0,0,.10); }
[data-look="photocopy"] .zp::after { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: url("${GRAIN_TONER}"); background-size: 180px 180px; opacity: .32; mix-blend-mode: multiply; }
[data-look="photocopy"] .zp h1, [data-look="photocopy"] .zp h2 { font-family: "Courier New", Courier, "Liberation Mono", ui-monospace, monospace; font-weight: 700; letter-spacing: -.02em; }
[data-look="photocopy"] .zp h2 { font-size: 18px; }
[data-look="photocopy"] .zp.cover h1 { font-size: 29px; line-height: 1.05; }
[data-look="photocopy"] .zp .words, [data-look="photocopy"] .zp .sub { text-shadow: 0 0 .6px rgba(0,0,0,.65); }
[data-look="photocopy"] .zp .photo img { filter: grayscale(1) contrast(1.8) brightness(1.1); }
[data-look="photocopy"] .zp .foot a { color: var(--ink); text-decoration: underline; }

/* Collage: cream pages on kraft, photos tilted in white frames with tape, cut-paper headings. */
[data-look="collage"] { --desk: #c7b28c; --paper: #fbf6ea; --ink: #2a241c; --soft: #6d6253; --line: #e2d7c1; --accent: #a3402c; }
[data-look="collage"] .zp { box-shadow: 0 1px 2px rgba(60,40,10,.15), 0 8px 20px rgba(60,40,10,.22); }
[data-look="collage"] .zp h2 { align-self: flex-start; max-width: 100%; background: var(--ink); color: var(--paper); font-size: 17px; padding: 3px 8px 4px; margin: 0 0 10px 2px; transform: rotate(-1.2deg); }
[data-look="collage"] .zp.cover h1 { align-self: flex-start; max-width: 100%; background: var(--accent); color: var(--paper); font-size: 27px; padding: 6px 10px 7px; transform: rotate(-1.5deg); margin: 0 0 12px -4px; }
[data-look="collage"] .zp .photo { background: #fff; padding: 6px; box-shadow: 0 2px 6px rgba(40,25,5,.25); transform: rotate(var(--tilt, -2deg)); margin: 10px 0; }
[data-look="collage"] .zp:not(.both) .photo img { max-width: calc(90cqw - 12px); max-height: calc(88cqh - 32px); }
[data-look="collage"] .zp.both .photo img { max-width: calc(100% - 4px); max-height: calc(var(--ph) * 0.40); }
[data-look="collage"] .zp .photo::before, [data-look="collage"] .zp .photo::after { content: ""; position: absolute; top: -8px; width: 52px; height: 16px; background: rgba(239,226,189,.82); box-shadow: 0 1px 1px rgba(0,0,0,.08); }
[data-look="collage"] .zp .photo::before { left: -14px; transform: rotate(-32deg); }
[data-look="collage"] .zp .photo::after { right: -14px; transform: rotate(32deg); }

/* Riso: two inks on off-white paper, photos printed in the two inks, slightly out of register. */
[data-look="riso"] { --desk: #ddd7cb; --line: color-mix(in srgb, var(--ink-b) 55%, transparent); --accent: var(--ink); }
[data-look="riso"] .zp { box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 18px rgba(40,30,20,.14); }
[data-look="riso"] .zp::after { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: url("${GRAIN_RISO}"); background-size: 180px 180px; opacity: .22; mix-blend-mode: multiply; }
[data-look="riso"] .zp.cover h1 { text-shadow: 2px 2px 0 color-mix(in srgb, var(--ink-b) 80%, transparent); }
[data-look="riso"] .zp h2 { align-self: flex-start; background: linear-gradient(transparent 58%, color-mix(in srgb, var(--ink-b) 60%, transparent) 58%, color-mix(in srgb, var(--ink-b) 60%, transparent) 92%, transparent 92%); padding: 0 3px; margin-left: -3px; }
[data-look="riso"] .zp .num { color: var(--ink-b); font-weight: 700; mix-blend-mode: multiply; }
[data-look="riso"] .zp .photo { background: var(--paper); }
[data-look="riso"] .zp .photo img.la { filter: url(#riso-a); }
[data-look="riso"] .zp .photo img.lb { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; max-width: none; max-height: none; filter: url(#riso-b); mix-blend-mode: multiply; transform: translate(1.6px, 1.1px); }
[data-look="riso"] .zp.both .photo img.lb, [data-look="riso"] .zp:not(.both) .photo img.lb { max-width: none; max-height: none; }

/* Fill: a picture covering its space (crop chosen in the Foundry). Edge to edge on the cover and picture-only pages. */
.zp .crop { position: relative; display: block; overflow: hidden; }
.zp .crop img { position: absolute; max-width: none !important; max-height: none !important; }
.zp .bleed-pic { position: absolute; inset: 0; overflow: hidden; z-index: 0; }
.zp .bleed-pic .photo { position: absolute; inset: 0; padding: 0; margin: 0; background: none; box-shadow: none; transform: none; }
.zp .bleed-pic .photo::before, .zp .bleed-pic .photo::after { display: none; }
.zp.bleed > h1, .zp.bleed > .sub, .zp.bleed > .by, .zp.bleed > .foot, .zp.bleed > .pic { position: relative; z-index: 1; }
.zp.bleed > .num { z-index: 1; }
.zp.bleed h1 { align-self: flex-start; max-width: calc(100% + 10px); background: color-mix(in srgb, var(--paper) 88%, transparent); padding: 6px 10px 7px; margin-left: -10px; }
.zp.bleed .sub, .zp.bleed .by { align-self: flex-start; max-width: calc(100% + 8px); background: color-mix(in srgb, var(--paper) 88%, transparent); padding: 3px 8px; margin-left: -8px; }
.zp.bleed .num { left: 50%; right: auto; transform: translateX(-50%); background: color-mix(in srgb, var(--paper) 85%, transparent); padding: 1px 7px; border-radius: 8px; }
.zp.bleed .foot { margin: auto -22px -18px; padding: 8px 22px 10px; border-top: 0; background: color-mix(in srgb, var(--paper) 92%, transparent); }

/* The creator's sprite, walking in a lane along the bottom of the page (tap to wave). */
.zp.has-sprite { padding-bottom: calc(18px + ${SPRITE_LANE_PX}px); }
.zp.cover.has-sprite { padding-bottom: calc(20px + ${SPRITE_LANE_PX}px); }
.zp .walker { position: absolute; bottom: 18px; left: 0; z-index: 3; padding: 0; margin: 0; border: 0; background-color: transparent; background-repeat: no-repeat; image-rendering: pixelated; image-rendering: crisp-edges; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.zp .walker:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; border-radius: 4px; }
.zp .walker::after { content: ""; position: absolute; left: 18%; right: 18%; bottom: -3px; height: 5px; border-radius: 50%; background: rgba(0,0,0,.18); z-index: -1; }
[data-look="photocopy"] .zp .walker { filter: grayscale(1) contrast(1.25); }

/* Words over picture: a full-page picture, the heading and words on a band near the bottom. */
.zp.overlay .spacer { flex: 1 1 auto; }
.zp.overlay .band { position: relative; z-index: 1; display: flex; flex-direction: column; max-height: calc(var(--ph) * 0.5); margin: 0 -10px; padding: 12px 14px 10px; background: color-mix(in srgb, var(--paper) 90%, transparent); }
.zp.overlay .band h2 { margin-bottom: 6px; }
.zp.overlay .band .words p:last-child { margin-bottom: 0; }
[data-look="collage"] .zp.overlay .band { background: var(--paper); box-shadow: 0 2px 8px rgba(40,25,5,.3); transform: rotate(-1deg); margin: 0 -4px; }
[data-look="collage"] .zp.overlay .band h2 { align-self: flex-start; }
.zp.back.overlay .foot { margin-top: 10px; }
/* Big quote: one short line set large. */
.zp.quote .quote-box { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden; padding: 4px 4px 10px; }
.zp .big { margin: 0; font-family: Georgia, "Times New Roman", "Liberation Serif", serif; font-size: var(--qs, 30px); line-height: 1.2; font-weight: 600; overflow-wrap: anywhere; }
.zp .big p { margin: 0 0 .35em; }
.zp .big::before { content: "“"; display: block; font-size: 2.8em; line-height: 1; height: .5em; margin-bottom: .1em; color: var(--soft); opacity: .55; }
.zp .who { margin: 12px 0 0; font-size: 13px; color: var(--soft); }
[data-look="photocopy"] .zp .big { font-family: "Courier New", Courier, "Liberation Mono", ui-monospace, monospace; font-weight: 700; letter-spacing: -.02em; }
[data-look="collage"] .zp .big { align-self: flex-start; background: #fff; padding: 14px 16px 10px; box-shadow: 0 2px 6px rgba(40,25,5,.25); transform: rotate(-1.2deg); }
[data-look="riso"] .zp .big::before { color: var(--ink-b); opacity: .9; }

/* Stickers and drawing, on top of the page. */
.zp .marks { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; overflow: hidden; }
[data-look="photocopy"] .zp .marks { filter: grayscale(1) contrast(1.35); }
.zp .walker { z-index: 5; }

/* Decorating (the Foundry's preview only). */
.zp.decorating { outline: 3px dashed rgba(47,95,179,.75); outline-offset: 3px; }
.zp.decorating .marks { pointer-events: all; cursor: crosshair; touch-action: none; }
.zp.decorating .marks.tool-sticker, .zp.decorating .marks.tool-eraser { cursor: pointer; }
.zp.decorating .walker { pointer-events: none; }
.marks .sel rect { fill: none; stroke: #2f5fb3; stroke-width: 1.5; stroke-dasharray: 4 3; }
.marks .sel circle { fill: #fff; stroke: #2f5fb3; stroke-width: 2; cursor: nwse-resize; }

/* A sound on the page (stage 3): a band in the page's own flow, last before the
   back page's footer and above the sprite's lane, so it never covers words. */
.zp .snd-row { position: relative; z-index: 3; flex: none; margin-top: auto; padding: 8px 0 6px; }
.zp.bleed .snd-row + .foot { margin-top: 0; }
.zp .sound { display: flex; align-items: center; gap: 8px; height: 32px; box-sizing: border-box; padding: 0 10px 0 3px;
  border-radius: 17px; background: color-mix(in srgb, var(--paper) 94%, transparent); border: 1px solid var(--line); font-size: 11px; line-height: 1.2; }
.zp .sound button { font: inherit; cursor: pointer; }
.zp .snd-play { flex: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--ink); color: var(--paper); font-size: 10px; line-height: 26px; text-align: center; }
.zp .snd-play:focus-visible, .zp .sound a:focus-visible, .now button:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
.zp .snd-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.zp .snd-title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zp .snd-details { color: var(--soft); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zp .snd-details.busy { color: var(--accent); }
.zp .sound a { flex: none; font-size: 10px; color: var(--accent); text-decoration: none; }
.zp .sound a:hover { text-decoration: underline; }
.zp .snd-retry { flex: none; padding: 2px 7px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper); color: var(--ink); font-size: 10px; }
.zp .snd-retry[hidden] { display: none; }
[data-look="photocopy"] .zp .sound { background: var(--paper); border: 1.5px dashed var(--ink); }
[data-look="photocopy"] .zp .sound a { color: var(--ink); text-decoration: underline; }
[data-look="collage"] .zp .sound { background: var(--paper); border: 0; border-radius: 3px; box-shadow: 0 2px 6px rgba(40,25,5,.25); transform: rotate(-.6deg); }
[data-look="collage"] .zp .snd-play { background: var(--accent); }
[data-look="riso"] .zp .sound { border-color: var(--ink-b); }
[data-look="riso"] .zp .snd-play { background: var(--ink-b); color: var(--ink); }
.card .zp .snd-row { display: none; }
/* What's playing: a pill that stops it from any page. */
.now { position: absolute; top: 8px; right: 8px; z-index: 6; display: flex; align-items: center; gap: 7px; max-width: min(70%, 320px); padding: 4px 4px 4px 11px;
  border-radius: 999px; background: rgba(27,26,23,.86); color: #fff; font-size: 12px; line-height: 1.2; }
.now[hidden], .card .now { display: none; }
/* A tile on the page (stage 4): its banner and a play button, then the tile itself. */
.zp.tile-page .tilebox { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin: 0 0 8px; }
/* With words, the tile takes whatever room they leave, never less than half the page (v0.24.0). */
.zp.tile-page.has-words .tilebox { flex: 1 1 auto; min-height: calc(var(--ph) * 0.5); }
.zp.tile-page.has-words .words { flex: 0 1 auto; }
.zp .tileframe { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: #111; border: 1px solid var(--line); border-radius: 4px; }
.zp .tileframe img.poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.zp .tileframe iframe { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; border: 0; background: #111; }
.zp .tile-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px; }
.zp .tileframe[data-state="idle"], .zp .tileframe[data-state="failed"] { cursor: pointer; }
.zp .tile-note[hidden], .zp .tile-again[hidden] { display: none; }
.zp .tileframe .tile-plain { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 10px; color: #fff; font-weight: 700; text-align: center; }
.zp .tile-note { color: var(--accent); }
.zp .tile-again { flex: none; min-height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); font-size: 10.5px; cursor: pointer; }
.zp .tile-again:focus-visible, .zp .tcap a:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
.zp .tcap { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-height: 28px; margin: 6px 0 0; font-size: 10.5px; line-height: 1.3; color: var(--soft); }
.zp .tcap b { color: var(--ink); font-weight: 700; overflow-wrap: anywhere; }
.zp .tcap a { margin-left: auto; color: var(--accent); text-decoration: none; }
.zp .tcap a:hover { text-decoration: underline; }
[data-look="photocopy"] .zp .tileframe { border: 1.5px dashed var(--ink); border-radius: 0; }
[data-look="photocopy"] .zp .tcap a { color: var(--ink); text-decoration: underline; }
[data-look="collage"] .zp .tileframe { border: 6px solid #fff; border-radius: 2px; box-shadow: 0 2px 8px rgba(40,25,5,.3); }
[data-look="collage"] .zp .tilebox::before { content: ""; position: absolute; z-index: 3; top: -7px; left: 50%; width: 64px; height: 16px; margin-left: -32px; background: rgba(240,228,190,.78); transform: rotate(-3deg); pointer-events: none; }
[data-look="riso"] .zp .tileframe { border: 2px solid var(--ink-b); }
.card .tilebox { visibility: hidden; }
/* Tiles that talk (v0.29.0): "Message sent · Go to Alice's tile (p. 2) →" and "From Bob's tile (p. 1)". */
.zp .tile-talk { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--soft); }
.zp .tile-talk[hidden] { display: none; }
.zp .tile-go { flex: none; min-height: 26px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); font: 600 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; }
.zp .tile-go:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
[data-look="collage"] .zp .tile-go { background: var(--accent); color: #fff; }
[data-look="riso"] .zp .tile-go { background: var(--ink-b); color: var(--ink); }
/* A tape's J-card (stage 4, part 2). The banner keeps its own colours; its frame follows the look. */
.zp.tape-page .tapeframe { position: relative; display: block; flex: none; aspect-ratio: 16 / 9; overflow: hidden; background: #222; border: 1px solid var(--line); border-radius: 4px; color: inherit; }
.zp .tapeframe img.poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.zp .tapeframe .tape-plain { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 10px; color: #fff; font-weight: 700; text-align: center; }
.zp .tapeframe:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
.zp .jcard { flex: 1 1 auto; min-height: 0; overflow: hidden; margin-top: 10px; font-size: var(--js, 12.5px); line-height: 1.4; }
.zp .jcard .tape-title { margin: 0 0 6px; font-size: 17px; }
.zp .jcard p { margin: 0 0 .5em; overflow-wrap: anywhere; }
.zp .tape-side b { font-weight: 700; }
.zp .tape-ded { font-style: italic; color: var(--soft); }
.zp .tape-own { font-style: italic; }
.zp .tape-own::before { content: "— "; }
.zp .jcard.tight .tape-ded, .zp .jcard.tight .tape-own { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.zp .tcap a.tape-link { display: inline-flex; align-items: center; min-height: 28px; margin-left: 0; padding: 0 12px; border-radius: 999px; background: var(--ink); color: var(--paper); font: 600 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-decoration: none; }
.zp .tape-link:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
[data-look="photocopy"] .zp .tapeframe { border: 1.5px dashed var(--ink); border-radius: 0; }
[data-look="collage"] .zp .tapeframe { border: 6px solid #fff; border-radius: 2px; box-shadow: 0 2px 8px rgba(40,25,5,.3); }
[data-look="photocopy"] .zp .tcap a.tape-link { color: var(--paper); text-decoration: none; }
[data-look="collage"] .zp .tcap a.tape-link { background: var(--accent); color: #fff; }
[data-look="riso"] .zp .tapeframe { border: 2px solid var(--ink-b); }
[data-look="riso"] .zp .tape-side b { color: var(--ink-b); mix-blend-mode: multiply; }
[data-look="riso"] .zp .tcap a.tape-link { background: var(--ink-b); color: var(--ink); }
/* A book (stage 5, part 2): its cover (or one drawn in the look), title, author, stars, status, a line from the review. */
.zp.book-page { align-items: stretch; }
.zp.book-page .pic { flex: 0 0 auto; container-type: normal; margin: 0 0 10px; }
.zp.book-page .photo img { max-width: 100%; max-height: calc(var(--ph) * 0.38 * var(--cover-scale, 1)); }
[data-look="collage"] .zp.book-page .photo img { max-width: calc(100% - 12px); max-height: calc(var(--ph) * 0.34 * var(--cover-scale, 1)); }
.zp.book-page .photo.drawn { line-height: 1.2; }
.zp .dcover { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; height: calc(var(--ph) * 0.38 * var(--cover-scale, 1)); aspect-ratio: 2 / 3; padding: 14px 12px; box-sizing: border-box;
  background: var(--cover, var(--ink)); color: var(--paper); text-align: center; border-radius: 2px 5px 5px 2px; box-shadow: inset 6px 0 0 rgba(0,0,0,.18), inset 0 0 0 3px var(--cover, var(--ink)), inset 0 0 0 4px color-mix(in srgb, var(--paper) 55%, transparent); overflow: hidden; }
.zp .dcover b { font: 700 15px/1.2 Georgia, "Times New Roman", serif; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; }
.zp .dcover i { font: 11px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-style: normal; opacity: .85; overflow-wrap: anywhere; }
[data-look="collage"] .zp .dcover { --cover: var(--accent); height: calc(var(--ph) * 0.31 * var(--cover-scale, 1)); }
[data-look="riso"] .zp .dcover { --cover: var(--ink-b); color: var(--ink); box-shadow: inset 6px 0 0 color-mix(in srgb, var(--ink) 25%, transparent), inset 0 0 0 3px var(--ink-b), inset 0 0 0 4px color-mix(in srgb, var(--ink) 40%, transparent); }
.zp .book-info { flex: none; text-align: center; }
.zp.book-page h2.book-title { align-self: center; margin: 0 0 3px; font-size: 18px; text-align: center; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
[data-look="collage"] .zp.book-page h2.book-title, [data-look="riso"] .zp.book-page h2.book-title { margin-left: 0; }
.zp .book-by { margin: 0 0 4px; font-size: 13px; color: var(--soft); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.zp .book-stars { position: relative; display: inline-block; margin: 0 0 2px; font-size: 15px; line-height: 1; letter-spacing: 1px; color: color-mix(in srgb, var(--soft) 45%, transparent); }
.zp .book-stars .on { position: absolute; left: 0; top: 0; overflow: hidden; white-space: nowrap; color: var(--star, #c8901a); }
[data-look="photocopy"] .zp .book-stars .on { --star: var(--ink); }
[data-look="collage"] .zp .book-stars .on { --star: var(--accent); }
[data-look="riso"] .zp .book-stars .on { --star: var(--ink-b); mix-blend-mode: multiply; }
.zp .book-status { margin: 2px 0 0; font-size: 11.5px; color: var(--soft); text-transform: uppercase; letter-spacing: .06em; }
.zp.book-page .words.review { margin-top: 10px; font-style: italic; text-align: center; }
.zp.book-page .book-empty { flex: none; height: calc(var(--ph) * 0.38); display: flex; align-items: center; justify-content: center; border: 1.5px dashed var(--line); color: var(--soft); font-size: 13px; margin: 0 0 10px; }
/* An activity (Treeline): the route drawn in the look, an elevation profile, the stats, words of the creator's own. */
.zp.activity-page .act-head { flex: none; display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; font-size: 10.5px; line-height: 1.3; color: var(--soft); text-transform: uppercase; letter-spacing: .06em; }
.zp .act-head .act-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zp .act-head a { margin-left: auto; flex: none; color: var(--accent); text-decoration: none; text-transform: none; letter-spacing: 0; }
.zp .act-head a:hover { text-decoration: underline; }
.zp .act-head a:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
.zp.activity-page h2.act-title { flex: none; }
.zp .act-title .t { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.zp .act-route { position: relative; flex: 1 1 0; min-height: var(--route-min, ${ACT_ROUTE_MIN}px); margin: 2px 0 6px; display: flex; align-items: center; justify-content: center; }
.zp .act-route { --map-paper: #eef2e6; --grid: rgba(0,0,0,.08); }
.zp .act-route svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.zp .act-route .m-paper { fill: var(--map-paper); }
.zp .act-route .m-grid { stroke: var(--grid); stroke-width: 1px; fill: none; }
.zp .act-route .r-halo { fill: none; stroke: var(--map-paper); stroke-width: 7px; stroke-linejoin: round; stroke-linecap: round; }
.zp .act-route .r-line { fill: none; stroke: var(--route, var(--ink)); stroke-width: 3px; stroke-linejoin: round; stroke-linecap: round; }
.zp .act-route .r-start { fill: var(--map-paper); stroke: var(--route, var(--ink)); stroke-width: 2px; }
.zp .act-route .r-end { fill: var(--route, var(--ink)); stroke: var(--map-paper); stroke-width: 1.5px; }
.zp .act-route .m-plate { fill: var(--map-paper); fill-opacity: .9; }
.zp .act-route .m-ink { fill: var(--map-ink, var(--ink)); }
.zp .act-route .m-line { fill: none; stroke: var(--map-ink, var(--ink)); }
.zp .act-route .m-text { fill: var(--map-ink, var(--ink)); font: 700 9.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.zp .act-route .r-none { color: var(--soft); font-size: 12px; }
.zp .act-profile { flex: none; margin: 0 0 6px; }
.zp .act-profile svg { display: block; width: 100%; height: ${ACT_PROFILE_H}px; }
.zp .act-profile .p-area { fill: var(--p-fill, color-mix(in srgb, var(--soft) 22%, transparent)); stroke: none; }
.zp .act-profile .p-line { fill: none; stroke: var(--ink); stroke-width: 1.5px; stroke-linejoin: round; }
.zp .act-profile .p-range { display: flex; justify-content: space-between; margin: 2px 0 0; font-size: 9.5px; line-height: 1.2; color: var(--soft); }
.zp .act-stats { flex: none; display: grid; grid-template-columns: repeat(var(--cols, 3), 1fr); gap: 6px; margin: 0 0 6px; padding: 6px 0 0; border-top: 1px solid var(--line); }
.zp .act-stats div { min-width: 0; }
.zp .act-stats dt { margin: 0; font-size: 9.5px; line-height: 1.2; color: var(--soft); text-transform: uppercase; letter-spacing: .06em; }
.zp .act-stats dd { margin: 1px 0 0; font-size: 16px; line-height: 1.2; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zp.activity-page .words.act-words { flex: 0 1 auto; }
.zp .act-empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; border: 1.5px dashed var(--line); color: var(--soft); font-size: 13px; margin: 0 0 10px; }
[data-look="photocopy"] .zp .act-route { border: 1.5px dashed var(--ink); --map-paper: #e4e3de; --grid: rgba(0,0,0,.13); }
[data-look="photocopy"] .zp .act-route .m-text { font-family: "Courier New", Courier, "Liberation Mono", ui-monospace, monospace; }
[data-look="photocopy"] .zp .act-head a { color: var(--ink); text-decoration: underline; }
[data-look="photocopy"] .zp .act-stats dd { font-family: "Courier New", Courier, "Liberation Mono", ui-monospace, monospace; font-size: 14px; letter-spacing: -.04em; }
[data-look="photocopy"] .zp .act-profile { --p-fill: color-mix(in srgb, var(--ink) 18%, transparent); }
[data-look="collage"] .zp .act-route { --route: var(--accent); background: #fff; padding: 8px; box-shadow: 0 2px 6px rgba(40,25,5,.25); transform: rotate(var(--tilt, -1.5deg)); margin: 8px 4px 12px; }
[data-look="collage"] .zp .act-route::before { content: ""; position: absolute; z-index: 1; top: -8px; left: 50%; width: 56px; height: 16px; margin-left: -28px; background: rgba(239,226,189,.82); transform: rotate(-3deg); }
[data-look="collage"] .zp .act-route { --map-paper: #eef0e2; --grid: rgba(0,0,0,.09); }
[data-look="collage"] .zp .act-route svg { inset: 8px; width: calc(100% - 16px); height: calc(100% - 16px); }
[data-look="collage"] .zp .act-profile { --p-fill: color-mix(in srgb, var(--accent) 28%, transparent); }
[data-look="riso"] .zp .act-route { --route: var(--ink-b); --map-paper: color-mix(in srgb, var(--ink-b) 12%, var(--paper)); --grid: color-mix(in srgb, var(--ink-b) 35%, transparent); }
[data-ink-light] .zp .act-route { --route: var(--ink); }
[data-ink-light][data-look="riso"] .zp .act-route .r-line, [data-ink-light][data-look="riso"] .zp .act-route .r-end { mix-blend-mode: normal; }
[data-ink-light][data-look="riso"] .zp .act-stats dt { color: var(--ink); mix-blend-mode: normal; }
[data-look="riso"] .zp .act-route .r-line, [data-look="riso"] .zp .act-route .r-end { mix-blend-mode: multiply; }
[data-look="riso"] .zp .act-profile { --p-fill: color-mix(in srgb, var(--ink-b) 55%, transparent); }
[data-look="riso"] .zp .act-profile .p-area { mix-blend-mode: multiply; }
[data-look="riso"] .zp .act-stats dt { color: var(--ink-b); mix-blend-mode: multiply; font-weight: 700; }
/* The back page's credits (stage 5): a button in the footer, and the sheet it opens. */
.zp .foot button.credits-open { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }
.zp .foot button.credits-open:hover { text-decoration: underline; }
[data-look="photocopy"] .zp .foot button.credits-open { color: var(--ink); text-decoration: underline; }
.credits-veil { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(20,18,14,.45); }
.credits-sheet { width: min(340px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box; padding: 18px 20px 16px; background: var(--paper); color: var(--ink); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.3); font-size: 13.5px; line-height: 1.45; }
.credits-sheet h2 { margin: 0 0 10px; font-size: 19px; line-height: 1.2; }
.credits-sheet ul { list-style: none; margin: 0 0 14px; padding: 0; }
.credits-sheet li { padding: 7px 0; border-top: 1px solid var(--line); }
.credits-sheet li:first-child { border-top: 0; }
.credits-sheet b { font-weight: 700; }
.credits-sheet a { color: var(--accent); }
.credits-sheet .where-on { display: block; font-size: 12px; color: var(--soft); }
.credits-sheet .credits-close { min-height: 32px; padding: 0 16px; border: 1px solid var(--ink); border-radius: 999px; background: var(--paper); color: var(--ink); font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; }
.credits-sheet .credits-close:focus-visible, .credits-sheet a:focus-visible, .zp .foot button.credits-open:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
[data-look="photocopy"] .credits-sheet h2 { font-family: "Courier New", Courier, "Liberation Mono", ui-monospace, monospace; }
[data-look="photocopy"] .credits-sheet a { color: var(--ink); }
[data-look="collage"] .credits-sheet { border-radius: 2px; transform: rotate(-.6deg); }
[data-look="collage"] .credits-sheet h2 { display: inline-block; background: var(--ink); color: var(--paper); padding: 3px 8px 4px; transform: rotate(-1.2deg); }
[data-look="riso"] .credits-sheet h2 { color: var(--ink); text-shadow: 2px 2px 0 color-mix(in srgb, var(--ink-b) 80%, transparent); }
[data-look="riso"] .credits-sheet b { color: var(--ink-b); }
/* A slow or failed picture on the pages shown: a quiet note with Try again. */
.loadnote { position: absolute; top: 8px; left: 8px; z-index: 6; display: flex; align-items: center; gap: 8px; max-width: min(70%, 320px); padding: 4px 4px 4px 11px;
  border-radius: 999px; background: rgba(27,26,23,.78); color: #fff; font-size: 12px; line-height: 1.2; }
.loadnote[hidden], .card .loadnote { display: none; }
.loadnote button { flex: none; padding: 3px 9px; border: 0; border-radius: 999px; background: #fff; color: #1b1a17; font-size: 11px; cursor: pointer; }
.loadnote button[hidden] { display: none; }
.loadnote button:focus-visible { outline: 2px solid rgba(47,95,179,.6); outline-offset: 2px; }
.now span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.now button { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: #fff; color: #1b1a17; font-size: 10px; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .zp { transition: none; } }
`;

export const READER_JS = String.raw`
(function () {
  "use strict";
  var SIZES = { letter: { w: 330, h: 510 }, a4: { w: 330, h: 467 } };
  var NAV = ${READER_NAV};
  var RISO_A = "${RISO_CURVES.a}";
  var RISO_B = "${RISO_CURVES.b}";
  var MIN_SCALE = ${WORDS_MIN_SCALE};
  var root = document.getElementById("zine");
  var config;
  try { config = JSON.parse(document.getElementById("zine-config").textContent); } catch (e) { config = null; }
  if (!root || !config || !Array.isArray(config.pages) || !config.pages.length) {
    if (root) root.textContent = "This zine couldn't be opened.";
    return;
  }

  var stage, deck, nav, prevBtn, nextBtn, where, openBtn;
  var pageEls = [];
  var current = 0;      // index of the page being read
  var mode = "single";
  var forced = false;   // the reader tapped the card open
  var size;
  var scaleNow = 1;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function wordsBlock(text) {
    var box = el("div", "words");
    String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).forEach(function (para) {
      if (!para.trim()) return;
      var p = el("p");
      para.split("\n").forEach(function (line, i) {
        if (i) p.appendChild(document.createElement("br"));
        p.appendChild(document.createTextNode(line));
      });
      box.appendChild(p);
    });
    return box;
  }
  // Files: each asked for once (one at a time, the most wanted first) and kept
  // for as long as the page is open, as blob: addresses. Kept across rebuilds.
  var kept = {}, queue = [], fetching = false, clipAsks = {};
  // How long before a download is called slow: "Still loading…", then Try again.
  // The clock starts when that file's own download starts (files come one at a time).
  var STILL_MS = ${LOAD_TIMES.still}, RETRY_MS = ${LOAD_TIMES.retry};
  var shownNow = []; // the pages being shown (indices)
  function getBytes(src) {
    if (config.preview && /^(clip|piece):/.test(src)) {
      // In the Foundry's preview, sounds and tile files come from the Foundry (they're in memory there).
      return new Promise(function (resolve, reject) {
        clipAsks[src] = { resolve: resolve, reject: reject };
        try { window.parent.postMessage({ zine: src.slice(0, src.indexOf(":")), src: src }, "*"); } catch (e) { reject(e); }
      });
    }
    return fetch(src).then(function (res) {
      if (!res.ok) throw new Error("the host answered " + res.status);
      return res.blob();
    });
  }
  function pump() {
    if (fetching || !queue.length) return;
    fetching = true;
    var job = queue.shift();
    var w = job.watch = { slow: 0 };
    w.timers = [
      setTimeout(function () { w.slow = 1; drawLoadNote(); }, STILL_MS),
      setTimeout(function () { w.slow = 2; drawLoadNote(); }, RETRY_MS),
    ];
    getBytes(job.src).then(function (blob) { return URL.createObjectURL(blob); }).then(job.resolve, job.reject).then(function () {
      w.timers.forEach(clearTimeout);
      w.slow = 0;
      fetching = false;
      drawLoadNote();
      pump();
    });
  }
  function fileUrl(src, urgent) {
    var have = kept[src];
    if (have) {
      // Already waiting in line: move it up if it's wanted now.
      if (urgent && have.job) { var k = queue.indexOf(have.job); if (k > 0) { queue.splice(k, 1); queue.unshift(have.job); } }
      return have.promise;
    }
    if (/^(data|blob):/.test(src)) { kept[src] = { promise: Promise.resolve(src) }; return kept[src].promise; }
    var job = { src: src };
    var promise = new Promise(function (resolve, reject) { job.resolve = resolve; job.reject = reject; });
    var entry = { promise: promise, job: job };
    kept[src] = entry;
    promise.then(function () { entry.job = null; }, function () { if (kept[src] === entry) delete kept[src]; });
    if (urgent) queue.unshift(job); else queue.push(job);
    pump();
    return promise;
  }
  // A page's pictures: fetched when the reader nears the page (wantPage).
  function wantPage(i, urgent) {
    var e = pageEls[i];
    if (!e) return;
    if (mode !== "card") wantTile(i);
    Array.prototype.forEach.call(e.querySelectorAll("img[data-src]"), function (img) {
      var src = img.getAttribute("data-src");
      img.removeAttribute("data-src");
      img.setAttribute("data-want", src); // wanted, not here yet
      fileUrl(src, urgent).then(function (url) {
        img.src = url;
        img.removeAttribute("data-want");
        drawLoadNote();
      }, function () {
        img.setAttribute("data-failed", "1");
        drawLoadNote();
      });
    });
  }
  // A quiet note when a picture on the pages being shown is slow or failed:
  // "Still loading pictures…" after 4 s, Try again after 8 s.
  var loadEl = null;
  function makeLoadNote() {
    loadEl = el("div", "loadnote");
    loadEl.hidden = true;
    loadEl.setAttribute("aria-live", "polite");
    var words = el("span");
    var again = el("button", null, "Try again");
    again.type = "button";
    again.addEventListener("click", function (e) { e.stopPropagation(); retryPictures(); });
    loadEl.appendChild(words); loadEl.appendChild(again);
    return loadEl;
  }
  function waitingPictures() {
    var out = [];
    shownNow.forEach(function (i) {
      var e = pageEls[i];
      if (e) Array.prototype.forEach.call(e.querySelectorAll("img[data-want]"), function (img) { out.push(img); });
    });
    return out;
  }
  function drawLoadNote() {
    if (!loadEl) return;
    var level = 0, failed = false;
    if (mode !== "card") waitingPictures().forEach(function (img) {
      if (img.getAttribute("data-failed")) { failed = true; return; }
      var en = kept[img.getAttribute("data-want")];
      var w = en && en.job && en.job.watch;
      if (w && w.slow > level) level = w.slow;
    });
    loadEl.hidden = !(failed || level);
    loadEl.firstChild.textContent = failed ? "Some pictures couldn't load." : "Still loading pictures…";
    loadEl.lastChild.hidden = !(failed || level >= 2);
  }
  function retryPictures() {
    var stuck = false;
    waitingPictures().forEach(function (img) {
      if (img.getAttribute("data-failed")) {
        // Ask again: back in line, at the front.
        img.removeAttribute("data-failed");
        img.setAttribute("data-src", img.getAttribute("data-want"));
        img.removeAttribute("data-want");
      } else stuck = true;
    });
    // A download still on its way (the host may be stuck): start afresh on this page.
    var first = shownNow.filter(function (i) { return i != null; })[0];
    if (stuck && !config.preview && first != null) return restart(config.pages[first].id);
    shownNow.forEach(function (i) { if (i != null) wantPage(i, true); });
    drawLoadNote();
  }
  // Starting the zine afresh (Try again on a stuck download): it reopens on this page.
  function restart(pageId) {
    location.hash = "page=" + pageId;
    location.reload();
  }
  function image(pic, cls, alt) {
    var img = document.createElement("img");
    img.setAttribute("data-src", pic.src);
    img.alt = alt;
    img.className = cls;
    if (pic.width && pic.height) { img.width = pic.width; img.height = pic.height; }
    img.draggable = false;
    return img;
  }
  // A picture in its frame. Riso prints it twice, once in each ink (the second
  // copy is decoration, hidden from screen readers). A filled picture sits in a
  // crop box the size of its frame, placed as the creator chose (cropRect); on
  // the cover and picture-only pages it covers the whole page, behind the rest.
  var cropRect = ${cropRect.toString()};
  var marksDefs = ${marksDefs.toString()};
  var marksMarkup = ${marksMarkup.toString()};
  // A page's stickers and drawing, as an SVG layer over everything else on it.
  function renderMarks(pageEl, marks, keep) {
    var old = pageEl.querySelector("svg.marks");
    if (old) old.remove();
    if (!config.markColors || (!keep && (!marks || !marks.length))) return null;
    marks = marks || [];
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "marks");
    svg.setAttribute("viewBox", "0 0 " + size.w + " " + size.h);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = marksDefs(config.stickers || {}, config.markColors) + marksMarkup(marks, config.markColors);
    pageEl.appendChild(svg);
    return svg;
  }
  function picture(pic) {
    var fill = pic.fill && pic.frame && pic.crop;
    var box = el("div", fill && pic.frame.bleed ? "bleed-pic" : "pic");
    var photo = el("span", "photo" + (fill ? " fill" : ""));
    var imgs = [image(pic, "la", pic.alt || "")];
    if (config.look === "riso") {
      var b = image(pic, "lb", "");
      b.setAttribute("aria-hidden", "true");
      imgs.push(b);
    }
    if (fill) {
      var crop = el("span", "crop");
      crop.style.width = pic.frame.w + "px";
      crop.style.height = pic.frame.h + "px";
      var r = cropRect(pic.width || 1, pic.height || 1, pic.frame.w, pic.frame.h, pic.crop.x, pic.crop.y, pic.crop.zoom);
      imgs.forEach(function (img) {
        img.style.left = r.x + "px"; img.style.top = r.y + "px";
        img.style.width = r.w + "px"; img.style.height = r.h + "px";
        crop.appendChild(img);
      });
      photo.appendChild(crop);
    } else {
      imgs.forEach(function (img) { photo.appendChild(img); });
    }
    box.appendChild(photo);
    return box;
  }
  var TILTS = [-2.2, 1.8, -1.3, 2.4, -2.7, 1.5, -1.7, 2.1];

  // Riso: the two ink filters (each turns a picture into one ink, by how dark it is).
  function risoFilters() {
    var old = document.getElementById("riso-filters");
    if (old) old.remove();
    var ink = config.ink;
    var html = document.documentElement;
    if (config.look !== "riso" || !ink) return;
    html.style.setProperty("--paper", ink.paper);
    html.style.setProperty("--ink", ink.text);
    html.style.setProperty("--soft", ink.text);
    html.style.setProperty("--ink-b", ink.b);
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.id = "riso-filters";
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    function filter(id, color, table) {
      var f = document.createElementNS(NS, "filter");
      f.id = id;
      f.setAttribute("color-interpolation-filters", "sRGB");
      // Exactly the picture's own box (filters otherwise reach 10% beyond it).
      f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", "1"); f.setAttribute("height", "1");
      // Coverage = how dark the picture is there (1 - brightness), shaped by the curve.
      var m = document.createElementNS(NS, "feColorMatrix");
      m.setAttribute("type", "matrix");
      m.setAttribute("values", "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 1");
      var t = document.createElementNS(NS, "feComponentTransfer");
      var a = document.createElementNS(NS, "feFuncA");
      a.setAttribute("type", "table"); a.setAttribute("tableValues", table);
      t.appendChild(a);
      t.setAttribute("result", "cover");
      var fl = document.createElementNS(NS, "feFlood");
      fl.setAttribute("flood-color", color);
      var c = document.createElementNS(NS, "feComposite");
      c.setAttribute("operator", "in"); c.setAttribute("in2", "cover");
      c.setAttribute("result", "inked");
      // Only where the picture is (clear parts of a picture would otherwise read as dark).
      var clip = document.createElementNS(NS, "feComposite");
      clip.setAttribute("in", "inked"); clip.setAttribute("in2", "SourceAlpha"); clip.setAttribute("operator", "in");
      f.appendChild(m); f.appendChild(t); f.appendChild(fl); f.appendChild(c); f.appendChild(clip);
      svg.appendChild(f);
    }
    // How much ink for how dark (0 = white, 1 = black), as in a two-colour separation:
    filter("riso-a", ink.a, RISO_A);  // ink A: the dark parts
    filter("riso-b", ink.b, RISO_B);  // ink B: the middle tones, less in the darks
    document.body.appendChild(svg);
  }

  // The creator's sprite (config.sprite): walks back and forth along the bottom
  // of the pages that have it, with the Sprite Walker's frames and timing
  // (frames 0,1,2,1 every 190 ms; rows: 0 facing you, 1 left, 2 right). At each
  // edge it faces you for a moment, then turns. Tap it: it turns to you and hops,
  // then walks on. With "reduce motion" it stands still facing you.
  var FRAME_MS = 190, STEP = [0, 1, 2, 1], SPEED = 34, ROW_FRONT = 0, ROW_LEFT = 1, ROW_RIGHT = 2, IDLE = 1;
  var walkers = [];
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function makeWalker(pageEl, i) {
    var sp = config.sprite;
    var k = Math.min(1, 56 / sp.frameHeight);
    var w = sp.frameWidth * k, h = sp.frameHeight * k;
    var b = el("button", "walker");
    b.type = "button";
    b.setAttribute("aria-label", (config.handle ? "@" + config.handle + "'s sprite" : "The maker's sprite") + ": tap to wave");
    b.style.width = w + "px"; b.style.height = h + "px";
    b.style.backgroundImage = "url(\"" + sp.src + "\")";
    b.style.backgroundSize = (sp.columns * w) + "px " + (sp.rows * h) + "px";
    var min = 12, max = size.w - 12 - w;
    var wk = { el: b, page: pageEl, w: w, h: h, min: min, max: max, x: min + ((i * 53) % Math.max(1, max - min)), dir: i % 2 ? -1 : 1, mode: "walk", t: 0, row: still ? ROW_FRONT : (i % 2 ? ROW_LEFT : ROW_RIGHT), frame: IDLE };
    b.addEventListener("click", function (e) { e.stopPropagation(); wave(wk); });
    pageEl.appendChild(b);
    draw(wk);
    walkers.push(wk);
  }
  function draw(wk) {
    wk.el.style.backgroundPosition = (-wk.frame * wk.w) + "px " + (-wk.row * wk.h) + "px";
    var hop = wk.mode === "wave" ? Math.max(0, Math.sin(Math.min(1, wk.t / 700) * Math.PI * 2)) * 9 : 0;
    wk.el.style.transform = "translate(" + wk.x + "px," + (-hop) + "px)";
  }
  function wave(wk) {
    if (still) { wk.row = ROW_FRONT; wk.frame = wk.frame === IDLE ? 0 : IDLE; draw(wk); return; }
    wk.mode = "wave"; wk.t = 0; wk.row = ROW_FRONT; wk.frame = IDLE;
  }
  var last = 0;
  function tick(now) {
    var dt = last ? Math.min(100, now - last) : 16;
    last = now;
    for (var n = 0; n < walkers.length; n++) {
      var wk = walkers[n];
      if (!wk.page.classList.contains("shown") || still) continue;
      wk.t += dt;
      if (wk.mode === "walk") {
        wk.x += wk.dir * SPEED * dt / 1000;
        wk.row = wk.dir > 0 ? ROW_RIGHT : ROW_LEFT;
        wk.frame = STEP[Math.floor(wk.t / FRAME_MS) % STEP.length];
        if (wk.x >= wk.max || wk.x <= wk.min) {
          wk.x = Math.max(wk.min, Math.min(wk.max, wk.x));
          wk.mode = "rest"; wk.t = 0; wk.row = ROW_FRONT; wk.frame = IDLE;
        }
      } else if (wk.mode === "rest") {
        if (wk.t > 900) { wk.dir = -wk.dir; wk.mode = "turn"; wk.t = 0; wk.row = wk.dir > 0 ? ROW_RIGHT : ROW_LEFT; }
      } else if (wk.mode === "turn") {
        if (wk.t > 300) { wk.mode = "walk"; wk.t = 0; }
      } else if (wk.mode === "wave") {
        if (wk.t > 1300) { wk.mode = "turn"; wk.t = 0; wk.row = wk.dir > 0 ? ROW_RIGHT : ROW_LEFT; wk.frame = IDLE; }
      }
      draw(wk);
    }
    requestAnimationFrame(tick);
  }
  var ticking = false;
  function startWalkers() {
    if (ticking || !walkers.length || still) return;
    ticking = true;
    requestAnimationFrame(tick);
  }

  // Sounds (stage 3). One player for the whole zine: a clip plays on across
  // page turns until it ends; tapping another stops the first. Download, then
  // play (as the Mixtape does): "Still loading…" after 4 s, Try again after 8 s.
  var audio = null;
  var playing = null; // { id, src, title, state: "loading" | "playing" | "failed", slow, error }
  var soundTimers = [];
  var nowEl = null;
  var readyNote = {}; // page id -> true when a clip is downloaded but the browser wouldn't start it
  function clock(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2);
  }
  function soundBand(p) {
    var s = p.sound;
    var band = el("div", "sound");
    band.setAttribute("data-sound", p.id);
    var btn = el("button", "snd-play", "▶");
    btn.type = "button";
    var text = el("span", "snd-text");
    text.appendChild(el("span", "snd-title", s.title));
    text.appendChild(el("span", "snd-details", ""));
    var retry = el("button", "snd-retry", "Try again");
    retry.type = "button";
    retry.hidden = true;
    band.appendChild(btn); band.appendChild(text); band.appendChild(retry);
    if (s.url) {
      var a = el("a", null, "plyr.fm ↗");
      a.href = s.url; a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", "Hear all of “" + s.title + "” on plyr.fm (opens a new tab)");
      band.appendChild(a);
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (playing && playing.id === p.id && playing.state !== "failed") stopSound();
      else playSound(p);
    });
    retry.addEventListener("click", function (e) { e.stopPropagation(); retrySound(p); });
    return band;
  }
  function clearSoundTimers() { soundTimers.forEach(clearTimeout); soundTimers = []; }
  function playSound(p) {
    stopSound(true);
    var s = p.sound;
    var me = { id: p.id, src: s.src, title: s.title, state: "loading", slow: 0 };
    playing = me;
    delete readyNote[p.id];
    soundTimers = [
      setTimeout(function () { if (playing === me && me.state === "loading") { me.slow = 1; drawSound(); } }, STILL_MS),
      setTimeout(function () { if (playing === me && me.state === "loading") { me.slow = 2; drawSound(); } }, RETRY_MS),
    ];
    drawSound();
    fileUrl(s.src, true).then(function (url) {
      if (playing !== me) return;
      clearSoundTimers();
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.addEventListener("ended", function () { if (playing && playing.state === "playing") { playing = null; drawSound(); } });
      }
      audio.src = url;
      me.state = "playing";
      drawSound();
      var started = audio.play();
      if (started && started.catch) started.catch(function (err) {
        if (playing !== me) return;
        if (err && err.name === "NotAllowedError") {
          // The browser wants a fresh tap: the clip is here now, so the next tap plays at once.
          playing = null;
          readyNote[me.id] = true;
        } else {
          me.state = "failed";
          me.error = (err && err.message) || "it couldn't start";
        }
        drawSound();
      });
    }, function (err) {
      if (playing !== me) return;
      clearSoundTimers();
      me.state = "failed";
      me.error = (err && err.message) || "unknown problem";
      drawSound();
    });
  }
  function stopSound(quiet) {
    if (audio) { try { audio.pause(); } catch (e) {} }
    playing = null;
    clearSoundTimers();
    if (!quiet) drawSound();
  }
  function retrySound(p) {
    var me = playing;
    if (me && me.id === p.id && me.state === "loading" && !config.preview) {
      // The download is still on its way (the host may be stuck): start the
      // zine afresh on this page, as reloading the page would.
      restart(p.id);
      return;
    }
    if (kept[p.sound.src] && !kept[p.sound.src].job) delete kept[p.sound.src];
    playSound(p);
  }
  function makeNow() {
    nowEl = el("div", "now");
    nowEl.hidden = true;
    nowEl.setAttribute("aria-live", "polite");
    var label = el("span");
    var stop = el("button", null, "■");
    stop.type = "button";
    stop.setAttribute("aria-label", "Stop the sound");
    stop.addEventListener("click", function (e) { e.stopPropagation(); stopSound(); });
    nowEl.appendChild(label); nowEl.appendChild(stop);
    return nowEl;
  }
  function drawSound() {
    Array.prototype.forEach.call(root.querySelectorAll(".sound"), function (band) {
      var id = band.getAttribute("data-sound");
      var page = config.pages.filter(function (p) { return p.id === id; })[0];
      if (!page || !page.sound) return;
      var mine = playing && playing.id === id ? playing : null;
      var btn = band.querySelector(".snd-play"), det = band.querySelector(".snd-details"), retry = band.querySelector(".snd-retry");
      var on = mine && mine.state !== "failed";
      btn.textContent = on ? (mine.state === "loading" ? "…" : "■") : "▶";
      btn.setAttribute("aria-label", (on ? "Stop " : "Play ") + "“" + page.sound.title + "”");
      var busy = true, words;
      if (mine && mine.state === "loading") words = mine.slow ? "Still loading…" : "Loading…";
      else if (mine && mine.state === "failed") words = "Couldn't load it (" + mine.error + ")";
      else if (mine) words = "Playing · " + clock(page.sound.seconds);
      else if (readyNote[id]) words = "Ready: tap ▶ to play";
      else { busy = false; words = (page.sound.details ? page.sound.details + " · " : "") + clock(page.sound.seconds); }
      det.textContent = words;
      det.classList.toggle("busy", busy);
      retry.hidden = !(mine && (mine.state === "failed" || mine.slow === 2));
    });
    if (nowEl) {
      var show = playing && playing.state !== "failed";
      nowEl.hidden = !show;
      if (show) nowEl.firstChild.textContent = "♪ " + (playing.state === "loading" ? "Loading " : "") + playing.title;
    }
  }

  function applyLook() {
    var html = document.documentElement;
    ["--paper", "--ink", "--soft", "--ink-b"].forEach(function (v) { html.style.removeProperty(v); });
    html.setAttribute("data-look", config.look || "clean");
    if (config.ink && config.ink.light) html.setAttribute("data-ink-light", ""); else html.removeAttribute("data-ink-light");
    risoFilters();
  }
  function has(list, x) { return list && list.indexOf(x) >= 0; }

  function makePage(page, i) {
    var shows = page.shows || [];
    var hasPic = has(shows, "picture") && page.picture;
    var hasWords = has(shows, "words") && String(page.words || "").trim();
    var kind = page.kind === "cover" ? "cover" : page.kind === "back" ? "back" : "page";
    var bleed = hasPic && page.picture.fill && page.picture.frame && page.picture.frame.bleed;
    var e = el("section", "zp " + kind + (hasPic && hasWords ? " both" : hasPic ? " picture" : " words-only") + (bleed ? " bleed" : ""));
    e.setAttribute("aria-label", page.label || page.id);
    e.style.setProperty("--tilt", TILTS[i % TILTS.length] + "deg");
    if (kind === "cover") {
      if (bleed) e.appendChild(picture(page.picture));
      e.appendChild(el("h1", null, config.title || ""));
      if (hasPic && !bleed) e.appendChild(picture(page.picture)); else e.appendChild(el("div", "pic"));
      if (has(shows, "subtitle") && String(page.subtitle || "").trim()) e.appendChild(el("p", "sub", page.subtitle));
      if (config.handle) e.appendChild(el("p", "by", "by @" + config.handle));
      return e;
    }
    var heading = has(shows, "heading") && String(page.heading || "").trim();
    if (page.layout === "overlay" && bleed) {
      // Words over picture: the picture behind, the heading and words on a band.
      e.classList.add("overlay");
      e.appendChild(picture(page.picture));
      e.appendChild(el("div", "spacer"));
      if (heading || hasWords) {
        var band = el("div", "band");
        if (heading) band.appendChild(el("h2", null, page.heading));
        if (hasWords) band.appendChild(wordsBlock(page.words));
        e.appendChild(band);
      }
    } else if (page.layout === "tile") {
      // A tile: the creator's own tile, live on the page once tapped.
      e.classList.add("tile-page");
      if (heading) e.appendChild(el("h2", null, page.heading));
      e.appendChild(tileBox(page));
      if (hasWords) { e.classList.add("has-words"); e.appendChild(wordsBlock(page.words)); }
    } else if (page.layout === "tape") {
      // A tape: its J-card, with a link out to the whole tape.
      e.classList.add("tape-page");
      tapeCard(page).forEach(function (n) { e.appendChild(n); });
    } else if (page.layout === "book") {
      // A book: its cover, title, author, stars and status, then a line from the review.
      e.classList.add("book-page");
      bookBlock(page).forEach(function (n) { e.appendChild(n); });
      if (hasWords) { e.classList.add("has-words"); var rv = wordsBlock(page.words); rv.classList.add("review"); e.appendChild(rv); }
    } else if (page.layout === "activity") {
      // An activity: the route, the elevation profile, the stats, then words of the creator's own.
      e.classList.add("activity-page");
      activityBlock(page).forEach(function (n) { e.appendChild(n); });
      if (hasWords) { e.classList.add("has-words"); var aw = wordsBlock(page.words); aw.classList.add("act-words"); e.appendChild(aw); }
    } else if (page.layout === "quote") {
      // Big quote: the words set large (shrunk to fit if long), who said it below.
      e.classList.add("quote");
      var box = el("div", "quote-box");
      var q = wordsBlock(page.words);
      q.className = "big";
      box.appendChild(q);
      if (has(shows, "subtitle") && String(page.subtitle || "").trim()) box.appendChild(el("p", "who", "— " + page.subtitle));
      e.appendChild(box);
    } else {
      if (heading) e.appendChild(el("h2", null, page.heading));
      if (hasPic) e.appendChild(picture(page.picture));
      if (hasWords && !bleed) e.appendChild(wordsBlock(page.words));
      if (!hasPic && !hasWords) e.appendChild(el("div", "words"));
    }
    if (kind === "back") {
      var foot = el("div", "foot");
      foot.appendChild(el("span", null, "Made by " + (config.handle ? "@" + config.handle : "its maker") + (config.made ? " · " + config.made : "")));
      var links = el("span", "links");
      // Credits, like the last page of a printed zine: one button opens the
      // whole list as a sheet, so the footer stays two lines however many apps a zine uses.
      if (config.credits && config.credits.length) {
        var cb = el("button", "credits-open", "Credits");
        cb.type = "button";
        cb.setAttribute("aria-haspopup", "dialog");
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); openCredits(cb); });
        links.appendChild(cb);
      }
      if (config.makeUrl) {
        var mk = el("a", null, "Make your own zine ↗");
        mk.href = config.makeUrl; mk.target = "_blank"; mk.rel = "noopener";
        links.appendChild(mk);
      }
      if (links.firstChild) foot.appendChild(links);
      e.appendChild(foot);
    } else {
      e.appendChild(el("span", "num", String(i)));
    }
    return e;
  }

  // An activity page's top part: what and when, the title, the route (its shape
  // only, drawn in the look), the elevation profile (an honest scale, made in
  // the Foundry), and the stats in the creator's units.
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  // The map (drawn once the page is laid out, so it knows its box): map paper,
  // a faint grid whose squares match the scale bar, the route, a compass rose
  // and a true scale bar, each in a corner the route leaves free (mapLayout).
  var mapLayout = ${mapLayout.toString()};
  var routeOf = new WeakMap();
  function drawMap(pageEl) {
    var box = pageEl.querySelector(".act-route");
    var r = box && routeOf.get(box);
    if (!r) return;
    var old = box.querySelector("svg");
    if (old) old.remove();
    var inset = (config.look === "collage") ? 8 : 0;
    var W = box.clientWidth - 2 * inset, H = box.clientHeight - 2 * inset;
    if (!(W > 20 && H > 20)) return;
    var L = mapLayout(r, W, H, r.unit || "mi");
    var s = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "aria-hidden": "true" });
    s.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, "class": "m-paper" }));
    if (L.grid > 6) {
      var g = "", gx = L.x % L.grid, gy = L.y % L.grid, k;
      for (k = gx; k <= W; k += L.grid) g += "M" + k.toFixed(1) + " 0V" + H;
      for (k = gy; k <= H; k += L.grid) g += "M0 " + k.toFixed(1) + "H" + W;
      s.appendChild(svgEl("path", { d: g, "class": "m-grid" }));
    }
    var t = "translate(" + L.x.toFixed(2) + " " + L.y.toFixed(2) + ") scale(" + L.s.toFixed(5) + ")";
    var route = svgEl("g", { transform: t });
    route.appendChild(svgEl("path", { d: r.d, "class": "r-halo", "vector-effect": "non-scaling-stroke" }));
    route.appendChild(svgEl("path", { d: r.d, "class": "r-line", "vector-effect": "non-scaling-stroke" }));
    if (r.start) route.appendChild(svgEl("circle", { cx: r.start[0], cy: r.start[1], r: 4.5 / L.s, "class": "r-start", "vector-effect": "non-scaling-stroke" }));
    if (r.end) route.appendChild(svgEl("circle", { cx: r.end[0], cy: r.end[1], r: 4 / L.s, "class": "r-end", "vector-effect": "non-scaling-stroke" }));
    s.appendChild(route);
    // The compass rose: a ring, a needle (north filled), "N" below.
    var ro = L.rose, cx = ro.x + ro.w / 2, cy = ro.y + 16;
    var rose = svgEl("g", {});
    rose.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 15, "class": "m-plate" }));
    rose.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 14, "class": "m-line", "stroke-opacity": ".4" }));
    rose.appendChild(svgEl("path", { d: "M" + (cx - 13) + " " + cy + "L" + cx + " " + (cy - 2.5) + "L" + (cx + 13) + " " + cy + "L" + cx + " " + (cy + 2.5) + "Z", "class": "m-line", "stroke-opacity": ".55" }));
    rose.appendChild(svgEl("path", { d: "M" + cx + " " + (cy - 13) + "L" + (cx + 3.5) + " " + cy + "L" + cx + " " + (cy + 13) + "L" + (cx - 3.5) + " " + cy + "Z", "class": "m-line" }));
    rose.appendChild(svgEl("path", { d: "M" + cx + " " + (cy - 13) + "L" + (cx + 3.5) + " " + cy + "L" + (cx - 3.5) + " " + cy + "Z", "class": "m-ink" }));
    var n = svgEl("text", { x: cx, y: cy + 26, "text-anchor": "middle", "class": "m-text" });
    n.textContent = "N";
    rose.appendChild(svgEl("rect", { x: cx - 6, y: cy + 17, width: 12, height: 12, rx: 2, "class": "m-plate" }));
    rose.appendChild(n);
    s.appendChild(rose);
    if (L.scale) {
      var sc = L.scale, sg = svgEl("g", {});
      sg.appendChild(svgEl("rect", { x: sc.x, y: sc.y, width: sc.w, height: sc.h, rx: 2, "class": "m-plate" }));
      var bx = sc.x + 5, by = sc.y + 4;
      sg.appendChild(svgEl("rect", { x: bx, y: by, width: sc.bar / 2, height: 5, "class": "m-ink" }));
      sg.appendChild(svgEl("rect", { x: bx + 0.5, y: by + 0.5, width: sc.bar - 1, height: 4, "class": "m-line" }));
      var lt = svgEl("text", { x: bx, y: by + 15, "class": "m-text" });
      lt.textContent = sc.label;
      sg.appendChild(lt);
      s.appendChild(sg);
    }
    box.appendChild(s);
  }

  function activityBlock(p) {
    var a = p.activity;
    if (!a) return [el("div", "act-empty", "Your activity goes here")];
    var out = [];
    var head = el("p", "act-head");
    head.appendChild(el("span", "act-kind", [a.sport, a.date].filter(Boolean).join(" · ")));
    if (a.url) {
      var link = el("a", null, "Treeline ↗");
      link.href = a.url; link.target = "_blank"; link.rel = "noopener";
      link.setAttribute("aria-label", "See " + a.title + " on Treeline (opens a new tab)");
      head.appendChild(link);
    }
    out.push(head);
    var h = el("h2", "act-title");
    h.appendChild(el("span", "t", a.title));
    out.push(h);
    var box = el("div", "act-route");
    if (a.route && a.route.d) {
      box.setAttribute("role", "img");
      box.setAttribute("aria-label", "A map of the route of " + a.title);
      routeOf.set(box, a.route);
    } else {
      box.appendChild(el("span", "r-none", "No route recorded"));
    }
    out.push(box);
    if (a.profile) {
      var pr = el("div", "act-profile");
      var ps = svgEl("svg", { viewBox: "0 0 1000 200", preserveAspectRatio: "none", role: "img", "aria-label": "Elevation from " + a.profile.low + " to " + a.profile.high });
      ps.appendChild(svgEl("path", { d: a.profile.area, "class": "p-area" }));
      ps.appendChild(svgEl("path", { d: a.profile.line, "class": "p-line", "vector-effect": "non-scaling-stroke" }));
      pr.appendChild(ps);
      var range = el("p", "p-range");
      range.appendChild(el("span", null, "Low " + a.profile.low));
      range.appendChild(el("span", null, "High " + a.profile.high));
      pr.appendChild(range);
      out.push(pr);
    }
    if (a.stats && a.stats.length) {
      var dl = el("dl", "act-stats");
      dl.style.setProperty("--cols", String(a.stats.length));
      a.stats.forEach(function (st) {
        var d = el("div");
        d.appendChild(el("dt", null, st.label));
        d.appendChild(el("dd", null, st.value));
        dl.appendChild(d);
      });
      out.push(dl);
    }
    return out;
  }

  // A book page's top part (stage 5): the cover (the book's own, framed in the
  // look like a picture, or one drawn in the look's colours), then the details.
  function bookBlock(p) {
    var b = p.book;
    if (!b) return [el("div", "book-empty", "Your book goes here")];
    var out = [];
    if (b.cover) {
      out.push(picture({ src: b.cover.src, width: b.cover.width, height: b.cover.height, alt: "Cover of " + b.title }));
    } else {
      var box = el("div", "pic");
      var photo = el("span", "photo drawn");
      var dc = el("span", "dcover");
      dc.setAttribute("role", "img");
      dc.setAttribute("aria-label", "Cover of " + b.title);
      dc.appendChild(el("b", null, b.title));
      if (b.authors) dc.appendChild(el("i", null, b.authors));
      photo.appendChild(dc);
      box.appendChild(photo);
      out.push(box);
    }
    var info = el("div", "book-info");
    info.appendChild(el("h2", "book-title", b.title));
    if (b.authors) info.appendChild(el("p", "book-by", b.authors));
    if (b.stars) {
      var st = el("p", "book-stars");
      st.setAttribute("role", "img");
      st.setAttribute("aria-label", b.starsLabel || "");
      st.appendChild(document.createTextNode("★★★★★"));
      var on = el("span", "on", "★★★★★");
      on.style.width = Math.max(0, Math.min(100, b.stars * 10)) + "%";
      on.setAttribute("aria-hidden", "true");
      st.appendChild(on);
      info.appendChild(st);
    }
    if (b.status) info.appendChild(el("p", "book-status", b.status));
    out.push(info);
    return out;
  }

  // The credits sheet (stage 5): what came from which app, and where it is in the zine.
  var creditsOpen = null; // { veil, opener } while the sheet is shown
  function openCredits(opener) {
    if (creditsOpen) return;
    var veil = el("div", "credits-veil");
    var sheet = el("div", "credits-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "credits-title");
    var h = el("h2", null, "Credits");
    h.id = "credits-title";
    sheet.appendChild(h);
    var list = el("ul");
    (config.credits || []).forEach(function (c) {
      if (!c || !c.app) return;
      var li = el("li");
      li.appendChild(el("b", null, (c.what || "From") + ": "));
      if (/^https:\/\//.test(c.href || "")) {
        var a = el("a", null, c.app + " ↗");
        a.href = c.href; a.target = "_blank"; a.rel = "noopener";
        a.setAttribute("aria-label", c.app + " (opens a new tab)");
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(c.app));
      }
      if (c.pages) li.appendChild(el("span", "where-on", "On " + c.pages));
      list.appendChild(li);
    });
    sheet.appendChild(list);
    var close = el("button", "credits-close", "Close");
    close.type = "button";
    sheet.appendChild(close);
    veil.appendChild(sheet);
    function shut() {
      if (!creditsOpen) return;
      veil.remove();
      creditsOpen = null;
      if (opener && opener.isConnected) opener.focus();
    }
    close.addEventListener("click", function (ev) { ev.stopPropagation(); shut(); });
    veil.addEventListener("click", function (ev) { if (ev.target === veil) shut(); });
    // Keys stay in the sheet: Escape closes it, Tab goes round its links and Close.
    veil.addEventListener("keydown", function (ev) {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); shut(); return; }
      if (ev.key === "Tab") {
        var f = Array.prototype.slice.call(sheet.querySelectorAll("a, button"));
        var at = f.indexOf(document.activeElement);
        if (ev.shiftKey && at <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && at === f.length - 1) { ev.preventDefault(); f[0].focus(); }
      }
    });
    veil.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
    veil.addEventListener("pointerup", function (ev) { ev.stopPropagation(); });
    root.appendChild(veil);
    creditsOpen = { veil: veil, shut: shut };
    close.focus();
  }

  // Tiles on a page (stage 4). One running frame per page; it stops when the page goes.
  var tilesOn = {}; // page id -> { frame, urls, timers, state, slow, error }
  // The tile starts by itself when its page is shown (v0.28.0); its picture
  // shows meanwhile. The caption line under the frame (never on the tile, whose
  // own controls are its business) says Loading… / Still loading… / Try again
  // and credits the app it came from. No Stop: turning the page stops it.
  function tileBox(p) {
    var t = p.tile;
    var box = el("div", "tilebox");
    var frame = el("div", "tileframe");
    box.appendChild(frame);
    if (!t) { frame.appendChild(el("span", "tile-empty", "Your tile goes here")); return box; }
    frame.setAttribute("data-tile", p.id);
    frame.setAttribute("data-state", tilesOn[p.id] ? tilesOn[p.id].state : "idle");
    if (t.poster) frame.appendChild(image({ src: t.poster }, "poster", ""));
    else frame.appendChild(el("span", "tile-plain", t.name));
    frame.addEventListener("click", function (e) {
      // Running or on its way: taps go to the tile. Failed (or not started yet): start it.
      var me = tilesOn[p.id];
      if (me && me.state !== "failed") return;
      e.stopPropagation();
      startTile(p);
    });
    var cap = el("div", "tcap");
    cap.setAttribute("data-cap", p.id);
    var note = el("span", "tile-note");
    note.setAttribute("aria-live", "polite");
    note.hidden = true;
    var again = el("button", "tile-again", "Try again");
    again.type = "button";
    again.hidden = true;
    again.addEventListener("click", function (e) { e.stopPropagation(); retryTile(p); });
    cap.appendChild(el("b", null, t.name));
    // The maker shows only when it isn't the zine's own author (today, never).
    if (t.by && t.by !== "@" + config.handle) cap.appendChild(el("span", "tile-by", "by " + t.by));
    cap.appendChild(note);
    cap.appendChild(again);
    if (t.pair) {
      // Tiles that talk: where a message went, or where one came from (drawTalk).
      var talkLine = el("span", "tile-talk");
      talkLine.setAttribute("aria-live", "polite");
      talkLine.hidden = true;
      cap.appendChild(talkLine);
    }
    if (t.app && t.made && /^https:\/\//.test(t.madeUrl || "")) {
      // A known app (ATMOSYNTH: the patch; Treeline: the activity): the credit links there.
      var m = el("a", "tile-made", "made with " + t.made + " ↗");
      m.href = t.madeUrl; m.target = "_blank"; m.rel = "noopener";
      m.setAttribute("aria-label", "“" + t.name + "”, made with " + t.made + ": open it on " + t.made + " (opens a new tab)");
      cap.appendChild(m);
    } else {
      // Another app that names itself: credited by name; then the tile's own page.
      if (t.app && t.made) cap.appendChild(el("span", "tile-made", "made with " + t.made));
      if (t.url) {
        var a = el("a", null, "Open it ↗");
        a.href = t.url; a.target = "_blank"; a.rel = "noopener";
        a.setAttribute("aria-label", "Open “" + t.name + "” on its own page (opens a new tab)");
        cap.appendChild(a);
      }
    }
    box.appendChild(cap);
    return box;
  }
  // A tile's files, to fetch a page ahead (v0.28.0): its page, and the files it uses.
  var tilesWanted = {};
  function wantTile(i) {
    var p = config.pages[i];
    if (!p || p.layout !== "tile" || !p.tile || tilesWanted[p.id] === p.tile) return;
    tilesWanted[p.id] = p.tile;
    var t = p.tile;
    var srcs = [t.page].concat((t.app ? t.files : t.refs || []).map(function (f) { return f.src; }));
    srcs.forEach(function (src) { if (src) fileUrl(src, false).catch(function () {}); });
  }
  // Starting the tiles on the pages being shown, once the reader settles there
  // (flipping quickly past a page doesn't start its tile; the Foundry's preview,
  // rebuilt as the creator types, doesn't restart it at every letter).
  var START_MS = 350, PREVIEW_START_MS = 900, startTimer = null;
  function startShownTiles() {
    clearTimeout(startTimer);
    if (mode === "card") return;
    startTimer = setTimeout(function () {
      shownNow.forEach(function (i) {
        var p = i != null && config.pages[i];
        if (p && p.layout === "tile" && p.tile && !tilesOn[p.id]) startTile(p);
        // Its partner starts with it (tiles that talk, v0.29.0), wherever it is.
        var q = p && p.tile && p.tile.pair ? tilePage(p.tile.pair) : null;
        if (q && q.layout === "tile" && q.tile && !tilesOn[q.id]) startTile(q);
      });
    }, config.preview ? PREVIEW_START_MS : START_MS);
  }
  // A tape's J-card (stage 4, part 2): its banner (which also opens the tape),
  // title, songs by side, dedication, the creator's own line, and a link out.
  function tapeCard(p) {
    var t = p.tape;
    if (!t) {
      var empty = el("div", "tapeframe");
      empty.appendChild(el("span", "tile-empty", "Your tape goes here"));
      return [empty];
    }
    var cover = el("a", "tapeframe");
    if (t.url) { cover.href = t.url; cover.target = "_blank"; cover.rel = "noopener"; cover.setAttribute("aria-label", "Play “" + t.title + "” on its own page (opens a new tab)"); }
    if (t.poster) cover.appendChild(image({ src: t.poster }, "poster", ""));
    else cover.appendChild(el("span", "tape-plain", t.title));
    var card = el("div", "jcard");
    card.appendChild(el("h2", "tape-title", t.title));
    var sides = el("div", "tape-sides");
    t.sides.forEach(function (s) {
      var line = el("p", "tape-side");
      line.setAttribute("data-side", s.name);
      sides.appendChild(line);
    });
    card.appendChild(sides);
    if (t.dedication) card.appendChild(el("p", "tape-ded", t.dedication));
    if (has(p.shows || [], "subtitle") && String(p.subtitle || "").trim()) card.appendChild(el("p", "tape-own", p.subtitle));
    card.__tape = t;
    var out = [cover, card];
    if (t.url) {
      var cap = el("div", "tcap");
      var a = el("a", "tape-link", "▶ Play this tape ↗");
      a.href = t.url; a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", "Play “" + t.title + "” on its own page (opens a new tab)");
      cap.appendChild(a);
      out.push(cap);
    }
    return out;
  }
  // The J-card fits the page, step by step, until nothing overflows: smaller
  // words; songs trimmed from the end of the longest side ("and 6 more", at least
  // one song a side); the dedication and the creator's line kept to two lines;
  // a shorter cassette picture; and last, a side as just its count ("22 songs").
  function fitTape(pageEl) {
    var card = pageEl.querySelector(".jcard");
    if (!card || !card.__tape) return;
    var t = card.__tape;
    var cover = pageEl.querySelector(".tapeframe");
    var keep = t.sides.map(function (s) { return s.songs.length; });
    function fill() {
      Array.prototype.forEach.call(card.querySelectorAll(".tape-side"), function (line, k) {
        var s = t.sides[k], n = keep[k], all = s.songs.length;
        line.textContent = "";
        line.appendChild(el("b", null, "Side " + s.name + ": "));
        var text = n ? s.songs.slice(0, n).join(", ") + (n < all ? ", and " + (all - n) + " more" : "") : all + (all === 1 ? " song" : " songs");
        line.appendChild(document.createTextNode(text));
      });
    }
    var over = function () { return card.scrollHeight > card.clientHeight + 1; };
    var size = 12.5;
    card.style.setProperty("--js", size + "px");
    card.classList.remove("tight");
    if (cover) { cover.style.height = ""; cover.style.aspectRatio = ""; }
    fill();
    var guard = 0;
    while (over() && size > 10.5 && guard++ < 10) { size = Math.max(10.5, size - 0.5); card.style.setProperty("--js", size + "px"); }
    function trim(min) {
      while (over() && guard++ < 400) {
        var most = -1, k = -1;
        keep.forEach(function (n, i) { if (n > most) { most = n; k = i; } });
        if (most <= min) return;
        keep[k]--;
        fill();
      }
    }
    trim(1);
    if (over()) card.classList.add("tight"); // two lines for the dedication and the creator's line
    if (over() && cover) {
      var h = cover.offsetHeight, low = h * 0.45;
      cover.style.height = h + "px"; // keep its size while its shape is let go
      cover.style.aspectRatio = "auto";
      while (over() && h > low && guard++ < 400) { h = Math.max(low, h - 6); cover.style.height = h + "px"; }
    }
    trim(0);
  }
  function tilePage(id) { return config.pages.filter(function (q) { return q.id === id; })[0]; }
  function drawTile(id) {
    var frame = root.querySelector('.tileframe[data-tile="' + id + '"]');
    var cap = root.querySelector('.tcap[data-cap="' + id + '"]');
    if (!frame || !cap) return;
    var me = tilesOn[id];
    var state = me ? me.state : "idle";
    frame.setAttribute("data-state", state);
    var note = cap.querySelector(".tile-note"), again = cap.querySelector(".tile-again");
    var words = "";
    if (state === "loading") words = me.slow ? "Still loading…" : "Loading…";
    else if (state === "failed") words = "Couldn't load it (" + me.error + ")";
    note.textContent = words;
    note.hidden = !words;
    again.hidden = !(me && (state === "failed" || me.slow === 2));
  }
  function swapRefs(html, map) {
    Object.keys(map).forEach(function (ref) {
      html = html.split('"' + ref + '"').join('"' + map[ref] + '"').split("'" + ref + "'").join("'" + map[ref] + "'");
    });
    return html;
  }
  // In a sealed frame (the Foundry's own preview, origin "null") a frame can't be
  // opened at a blob: address, so the tile's page gets its files written into it:
  // scripts inline, everything else as data: addresses (way D of the host test).
  var SEALED = location.origin === "null";
  var END_TAG = "<" + "/script";
  function textOfUrl(u) { return fetch(u).then(function (res) { return res.text(); }); }
  function dataOfUrl(u) {
    return fetch(u).then(function (res) { return res.blob(); }).then(function (b) {
      return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = no; r.readAsDataURL(b); });
    });
  }
  function inlinePage(html, refs, map) {
    return Promise.all(refs.map(function (r) {
      var u = map[r.ref];
      if (/\.js$/i.test(r.ref)) return textOfUrl(u).then(function (js) { return { ref: r.ref, js: js.split(END_TAG).join("<\\/script") }; });
      return dataOfUrl(u).then(function (d) { return { ref: r.ref, data: d }; });
    })).then(function (parts) {
      var data = {};
      parts.forEach(function (x) {
        if (x.js != null) {
          html = html.split('<script src="' + x.ref + '">' + END_TAG + ">").join("<script>" + x.js + END_TAG + ">")
                     .split("<script src='" + x.ref + "'>" + END_TAG + ">").join("<script>" + x.js + END_TAG + ">");
        } else data[x.ref] = x.data;
      });
      return swapRefs(html, data);
    });
  }
  // Tiles from other apps (ATMOSYNTH's since v0.24.0; any of your own since
  // v0.28.0: Treeline's activity replays, hand-made tiles) run through makeAtmo.
  // ATMOSYNTH tiles (v0.24.0; v0.27.0). Their page asks for "./tile.js" and
  // "./tile.css"; the player fetches its own files (./patch.json, ./tile.json,
  // and in the older export ./samples.json; in the direct publish from
  // atmosynth.at each sample as its own file, ./samples/<cid>.flac); the
  // stylesheet loads fonts with url(./fonts/…); the script names
  // "/assets/mark.svg" from the tile's root. So: every file is fetched through
  // the zine's queue; root addresses inside the script and stylesheet, and every
  // url(…) in the stylesheet that names one of the tile's files, are swapped for
  // the copies; a small helper written into the page before the player answers
  // its fetches for ANY of the tile's other files from the copies. Normally the
  // frame gets blob: copies (way C of the host test). Walled off (a patch with
  // other people's modules, or the Foundry's sealed preview) everything is
  // written into the page itself: the script and stylesheet inline, the rest as
  // data: addresses, and the frame sealed (way D).
  var BACKTICK = String.fromCharCode(96);
  function atmoHelper(map) {
    return "(function(){var M=" + JSON.stringify(map).split("<").join("\\u003c") + ";var F=window.fetch;var H=Object.prototype.hasOwnProperty;" +
      "function K(u){u=String(u||\"\").split(\"#\")[0].split(\"?\")[0];" +
      "if(/^[a-z][a-z0-9+.-]*:/i.test(u)){if(/^(blob|data):/i.test(u))return \"\";try{u=new URL(u).pathname;}catch(e){return \"\";}try{u=decodeURI(u);}catch(e){}" +
      "for(var k in M){if(H.call(M,k)&&u.length>=k.length&&u.slice(u.length-k.length)===k)return k;}return \"\";}" +
      "u=u.replace(/^(\\.\\/)+/,\"/\");if(u.charAt(0)!==\"/\")u=\"/\"+u;try{u=decodeURI(u);}catch(e){}return u;}" +
      "window.fetch=function(i,o){var k=K(i&&typeof i===\"object\"?(i.url||i.href||\"\"):i);" +
      "if(k&&H.call(M,k))return F.call(window,M[k],o);return F.apply(window,arguments);};})();";
  }
  function swapRoots(text, addr) {
    Object.keys(addr).forEach(function (path) {
      ['"', "'", BACKTICK].forEach(function (q) { text = text.split(q + path + q).join(q + addr[path] + q); });
    });
    return text;
  }
  // A file's address as the tile names it ("./fonts/a.woff2", "fonts/a.woff2",
  // "/fonts/a.woff2", "../x"), read from the folder dir ("/"), as the tile's own
  // path ("/fonts/a.woff2"); "" for anything outside the tile (https:, data:, #id).
  function tilePathOf(dir, ref) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.charAt(0) === "#" || ref.slice(0, 2) === "//") return "";
    var p = (ref.charAt(0) === "/" ? ref : dir + ref).split("#")[0].split("?")[0];
    var out = [];
    p.split("/").forEach(function (part) { if (part === "..") out.pop(); else if (part !== "." && part !== "") out.push(part); });
    var path = "/" + out.join("/");
    try { path = decodeURI(path); } catch (e) {}
    return path;
  }
  // Every url(…) in a stylesheet that names one of the tile's files, quoted or
  // not, swapped for its copy (a stylesheet's own addresses count from its folder).
  function swapCssUrls(text, cssPath, addr) {
    var dir = cssPath.slice(0, cssPath.lastIndexOf("/") + 1) || "/";
    return text.replace(/url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi, function (all, q, ref) {
      var path = tilePathOf(dir, ref);
      return path && Object.prototype.hasOwnProperty.call(addr, path) ? 'url("' + addr[path] + '")' : all;
    });
  }
  function headInsert(html, extra) {
    var m = /<head[^>]*>/i.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + extra + html.slice(m.index + m[0].length);
    return extra + html;
  }
  function escRe(s) { return s.replace(/[.*+?^$(){}|[\]\\\/]/g, "\\$&"); }
  function blobText(u) { return fetch(u).then(function (res) { return res.text(); }); }
  function makeAtmo(t, walled, me) {
    var isCode = function (f) { return /\.(js|css)$/i.test(f.path); };
    var got = {}; // path -> blob: address of the zine's own kept copy
    return Promise.all(t.files.map(function (f) { return fileUrl(f.src, true).then(function (u) { got[f.path] = u; }); }))
      .then(function () { return fileUrl(t.page, true).then(blobText); })
      .then(function (html) {
        var addr = {}, code = {};
        function address(text, type) {
          if (walled) return Promise.resolve("data:" + type + ";charset=utf-8," + encodeURIComponent(text));
          var u = URL.createObjectURL(new Blob([text], { type: type }));
          me.urls.push(u);
          return Promise.resolve(u);
        }
        // The plain files first (pictures, JSON), then the script and stylesheet with their root addresses swapped.
        return Promise.all(t.files.filter(function (f) { return !isCode(f); }).map(function (f) {
          if (!walled) {
            // A blob: copy in the file's own type (the kept copy may carry the host's type).
            return fetch(got[f.path]).then(function (r) { return r.blob(); }).then(function (b) {
              var u = URL.createObjectURL(new Blob([b], { type: f.type || b.type }));
              me.urls.push(u);
              addr[f.path] = u;
            });
          }
          return dataOfUrl(got[f.path]).then(function (d) {
            // data: addresses carry the file's own type.
            addr[f.path] = f.type ? d.replace(/^data:[^;,]*/, "data:" + f.type) : d;
          });
        })).then(function () {
          var plain = {}; Object.keys(addr).forEach(function (k) { plain[k] = addr[k]; });
          return Promise.all(t.files.filter(isCode).map(function (f) {
            return blobText(got[f.path]).then(function (text) {
              code[f.path] = swapRoots(text, plain);
              if (/\.css$/i.test(f.path)) code[f.path] = swapCssUrls(code[f.path], f.path, plain);
              return address(code[f.path], f.type || (/\.css$/i.test(f.path) ? "text/css" : "text/javascript")).then(function (a) { addr[f.path] = a; });
            });
          }));
        }).then(function () {
          var map = {};
          t.fetched.forEach(function (path) { if (addr[path]) map[path] = addr[path]; });
          var helper = "<script>" + atmoHelper(map) + END_TAG + ">";
          if (!walled) {
            t.refs.forEach(function (r) { if (addr[r.path]) html = html.split('"' + r.ref + '"').join('"' + addr[r.path] + '"').split("'" + r.ref + "'").join("'" + addr[r.path] + "'"); });
            return { html: headInsert(html, helper) };
          }
          t.refs.forEach(function (r) {
            var q = "[\"']" + escRe(r.ref) + "[\"']";
            if (/\.js$/i.test(r.path) && code[r.path] != null) {
              html = html.replace(new RegExp("<script([^>]*?)\\s+src=" + q + "([^>]*)>\\s*" + END_TAG + ">", "i"), function (all, a, b) {
                var attrs = (a + b).replace(/\s+crossorigin(=["'][^"']*["'])?/i, "");
                return "<script" + attrs + ">" + code[r.path].split(END_TAG).join("<\\/script") + END_TAG + ">";
              });
            } else if (/\.css$/i.test(r.path) && code[r.path] != null) {
              html = html.replace(new RegExp("<link[^>]*href=" + q + "[^>]*>", "i"), function () { return "<style>" + code[r.path].split("</style").join("<\\/style") + "</style>"; });
            } else if (addr[r.path]) {
              html = html.split('"' + r.ref + '"').join('"' + addr[r.path] + '"').split("'" + r.ref + "'").join("'" + addr[r.path] + "'");
            }
          });
          return { srcdoc: headInsert(html, helper), sealed: Boolean(t.sealed) };
        });
      });
  }
  // Tiles from other apps are fitted the same way (their manifest's sizing).
  // The ATMOSYNTH player lays itself out for its own size (its export asks for
  // about 720 x 520) and doesn't shrink to a short box: its knobs would fall off
  // the bottom. So its frame gets at least the player's height (and a minimum
  // width) and is scaled down to fit the box, like a picture set to Fit; taps
  // and drags still reach it. Fitted again whenever the box changes size.
  var ATMO_MIN_W = 360;
  function fitAtmo(box, f, size) {
    var bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    var s = Math.min(1, bh / size.h, bw / ATMO_MIN_W);
    f.style.width = (bw / s) + "px";
    f.style.height = (bh / s) + "px";
    f.style.transformOrigin = "0 0";
    f.style.transform = s < 1 ? "scale(" + s + ")" : "";
  }
  function startTile(p) {
    var t = p.tile;
    stopTile(p.id, true);
    // hello: it has said hello (so it hears presence); open: it listens, so
    // messages for it go straight in rather than wait in its inbox.
    var me = { state: "loading", slow: 0, urls: [], frame: null, hello: false, open: false, bucket: TALK_BURST, filled: Date.now() };
    tilesOn[p.id] = me;
    me.timers = [
      setTimeout(function () { if (tilesOn[p.id] === me && me.state === "loading") { me.slow = 1; drawTile(p.id); } }, STILL_MS),
      setTimeout(function () { if (tilesOn[p.id] === me && me.state === "loading") { me.slow = 2; drawTile(p.id); } }, RETRY_MS),
    ];
    drawTile(p.id);
    var map = {};
    // The tile's files come through the zine's queue (kept, each asked for once),
    // then go to the tile's frame as its own blob: copies.
    // Tiles from other apps (ATMOSYNTH's, Treeline's, any of your own) take the app path.
    var making = t.app ? makeAtmo(t, SEALED || Boolean(t.sealed), me) :
      Promise.all(t.refs.map(function (r) { return fileUrl(r.src, true).then(function (u) { map[r.ref] = u; }); }))
      .then(function () { return fileUrl(t.page, true); })
      .then(textOfUrl)
      .then(function (html) { return SEALED ? inlinePage(html, t.refs, map).then(function (h) { return { srcdoc: h }; }) : { html: swapRefs(html, map) }; });
    making
      .then(function (made) {
        if (tilesOn[p.id] !== me) return;
        var box = root.querySelector('.tileframe[data-tile="' + p.id + '"]');
        if (!box) { stopTile(p.id, true); return; }
        var f = document.createElement("iframe");
        f.title = t.name;
        // Walled off: scripts only, plus new tabs for its own links (owner's decision, Oct 10).
        if (made.sealed) f.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
        if (made.srcdoc != null) {
          f.srcdoc = made.srcdoc;
        } else {
          var u = URL.createObjectURL(new Blob([made.html], { type: "text/html" }));
          me.urls.push(u);
          f.src = u;
        }
        // A paired tile may not say anything before it listens: what waits for
        // it goes in a moment after its page has loaded (or as soon as it speaks).
        if (t.pair) f.addEventListener("load", function () {
          setTimeout(function () { if (tilesOn[p.id] === me) openTalk(p.id); }, TALK_SETTLE_MS);
        });
        box.appendChild(f);
        me.frame = f;
        if (t.app) {
          var size = t.size || { w: 720, h: 520 };
          fitAtmo(box, f, size);
          if (window.ResizeObserver) { me.ro = new ResizeObserver(function () { fitAtmo(box, f, size); }); me.ro.observe(box); }
        }
        me.state = "running";
        me.timers.forEach(clearTimeout);
        drawTile(p.id);
      }, function (err) {
        if (tilesOn[p.id] !== me) return;
        me.timers.forEach(clearTimeout);
        me.state = "failed";
        me.error = (err && err.message) || "unknown problem";
        drawTile(p.id);
      });
  }
  function stopTile(id, quiet) {
    var me = tilesOn[id];
    if (!me) return;
    delete tilesOn[id];
    // Its partner, if it listens for presence, hears it has gone.
    if (me.hello) tellPresence(partnerId(id));
    (me.timers || []).forEach(clearTimeout);
    if (me.ro) me.ro.disconnect();
    if (me.frame) me.frame.remove();
    me.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    if (!quiet) drawTile(id);
  }
  function retryTile(p) {
    var me = tilesOn[p.id];
    // Still downloading (the host may be stuck): start the zine afresh on this page.
    if (me && me.state === "loading" && !config.preview) return restart(p.id);
    startTile(p);
  }
  function stopTilesOffPage() {
    var ids = shownNow.filter(function (i) { return i != null; }).map(function (i) { return config.pages[i].id; });
    // Paired tiles keep running, hidden, while the zine is open (v0.29.0).
    Object.keys(tilesOn).forEach(function (id) { if (ids.indexOf(id) < 0 && !partnerId(id)) stopTile(id); });
  }

  // Tiles that talk (v0.29.0). A paired tile's messages to its parent (this
  // reader) go to its partner's frame: any plain object, as it is, within size
  // and rate limits. A message for a partner that hasn't started, or isn't
  // listening yet, waits in its inbox (the newest TALK_INBOX). The reader stands
  // in for a host: a tile's hello (it has just started) is answered with its
  // partner's presence and a round trip of 0, and never passed on; its partner
  // hears "present" again then (so it sends what it has), and "gone" when it
  // stops. Only tiles that said hello hear presence. Messages carrying the
  // zine's own "zine" key are the reader's business and never passed on.
  var TALK_MAX_CHARS = 65536, TALK_INBOX = 64, TALK_BURST = 240, TALK_RATE = 120, TALK_SETTLE_MS = 1500;
  var inbox = {}; // page id -> messages waiting for its tile
  var talkNotes = {}; // page id -> { sent, from, seen }
  function partnerId(id) {
    var p = tilePage(id), to = p && p.tile && p.tile.pair;
    var q = to && tilePage(to);
    return q && q.tile && q.tile.pair === id ? to : null;
  }
  function plainObject(d) { return d !== null && typeof d === "object" && Object.prototype.toString.call(d) === "[object Object]"; }
  function frameOwner(win) {
    if (!win) return null;
    var ids = Object.keys(tilesOn);
    for (var k = 0; k < ids.length; k++) {
      var me = tilesOn[ids[k]];
      if (me.frame && me.frame.contentWindow === win) return ids[k];
    }
    return null;
  }
  function post(id, d) {
    var me = tilesOn[id];
    try { me.frame.contentWindow.postMessage(d, "*"); } catch (e) {}
  }
  function listening(id) {
    var me = tilesOn[id];
    return Boolean(me && me.state === "running" && me.frame && me.open);
  }
  function deliver(id, d) {
    if (listening(id)) { post(id, d); return; }
    var box = inbox[id] || (inbox[id] = []);
    box.push(d);
    if (box.length > TALK_INBOX) box.shift();
  }
  function openTalk(id) {
    var me = tilesOn[id];
    if (!me || me.open || me.state !== "running") return;
    me.open = true;
    var box = inbox[id] || [];
    delete inbox[id];
    box.forEach(function (d) { post(id, d); });
  }
  function present(id) { var me = id && tilesOn[id]; return Boolean(me && me.state === "running" && me.hello); }
  function tellPresence(id) {
    // Tells tile id whether its partner is there (only if it said hello).
    if (!present(id)) return;
    post(id, { kind: "presence", state: present(partnerId(id)) ? "present" : "gone" });
  }
  function withinRate(me) {
    var now = Date.now();
    me.bucket = Math.min(TALK_BURST, me.bucket + (now - me.filled) * TALK_RATE / 1000);
    me.filled = now;
    if (me.bucket < 1) return false;
    me.bucket -= 1;
    return true;
  }
  function smallEnough(d) {
    try { var j = JSON.stringify(d); return typeof j === "string" && j.length <= TALK_MAX_CHARS; } catch (e) { return false; }
  }
  function onScreen(id) {
    return shownNow.some(function (i) { return i != null && config.pages[i] && config.pages[i].id === id; });
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!plainObject(d)) return;
    var id = frameOwner(e.source), to = id && partnerId(id);
    if (!to) return;
    var me = tilesOn[id];
    if (me.state !== "running") return;
    openTalk(id); // it speaks, so it listens
    if (d.kind === "hello") {
      me.hello = true;
      tellPresence(id);
      post(id, { kind: "rtt", ms: 0 });
      tellPresence(to);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(d, "zine")) return;
    if (!withinRate(me) || !smallEnough(d)) return;
    deliver(to, d);
    // The caption: when the reader can see the sender but not its partner.
    if (onScreen(id) && !onScreen(to)) {
      var a = talkNotes[id] || (talkNotes[id] = {}), b = talkNotes[to] || (talkNotes[to] = {});
      var changed = !a.sent || !b.from;
      a.sent = true;
      b.from = true; b.seen = false;
      if (changed) { drawTalk(id); drawTalk(to); }
    }
  });
  // "p. 2", or "the back".
  function pageWords(id) {
    var p = tilePage(id);
    if (!p) return "";
    return p.kind === "back" ? "the back" : "p. " + indexName(p);
  }
  function tileWords(id) {
    var p = tilePage(id), short = p && p.tile && p.tile.short;
    return short ? short + "'s tile (" + pageWords(id) + ")" : "the tile on " + pageWords(id);
  }
  function drawTalk(id) {
    var cap = root.querySelector('.tcap[data-cap="' + id + '"]');
    var line = cap && cap.querySelector(".tile-talk");
    if (!line) return;
    var n = talkNotes[id] || {}, to = partnerId(id);
    line.textContent = "";
    if (to && n.sent) {
      line.appendChild(document.createTextNode("Message sent"));
      line.appendChild(el("span", null, "·"));
      var go = el("button", "tile-go", "Go to " + tileWords(to) + " →");
      go.type = "button";
      go.addEventListener("click", function (ev) { ev.stopPropagation(); goto(to); });
      line.appendChild(go);
    } else if (to && n.from) {
      line.appendChild(document.createTextNode("From " + tileWords(to)));
    }
    line.hidden = !line.firstChild;
  }
  // After each turn: a sender's button goes once its partner's page has been
  // shown; a "From …" note goes once it has been seen and its page turned away.
  function updateTalkNotes() {
    Object.keys(talkNotes).forEach(function (id) {
      var n = talkNotes[id], to = partnerId(id), was = Boolean(n.sent || n.from);
      if (n.sent && to && onScreen(to)) n.sent = false;
      if (n.from) {
        if (onScreen(id)) n.seen = true;
        else if (n.seen) { n.from = false; n.seen = false; }
      }
      if (was !== Boolean(n.sent || n.from)) drawTalk(id);
    });
  }

  // A big quote starts large and shrinks until it fits (never below 18px).
  function fitQuote(pageEl) {
    var box = pageEl.querySelector(".quote-box"), q = pageEl.querySelector(".big");
    if (!box || !q) return;
    var qs = 30;
    q.style.setProperty("--qs", qs + "px");
    while (box.scrollHeight > box.clientHeight + 1 && qs > 18) {
      qs -= 1;
      q.style.setProperty("--qs", qs + "px");
    }
  }

  // Long words shrink a little to fit their page (never below MIN_SCALE).
  // A book page fits step by step: its words shrink first (fitWords); if the page
  // is still too full (a long title, the sprite's lane, a sound), the cover gets smaller.
  var COVER_STEPS = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
  function fitBook(pageEl) {
    if (!pageEl.classList.contains("book-page")) return;
    var w = pageEl.querySelector(".words.review");
    for (var k = 0; k < COVER_STEPS.length; k++) {
      pageEl.style.setProperty("--cover-scale", String(COVER_STEPS[k]));
      fitWords(pageEl);
      var full = (w && w.scrollHeight > w.clientHeight + 1) || pageEl.scrollHeight > pageEl.clientHeight + 1;
      if (!full) return;
    }
  }

  // An activity page fits the same way: its words shrink first; if the page is
  // still too full (a long title, the sprite's lane, a sound and the profile on
  // a small page), the route gives up some of its height, step by step.
  var ROUTE_STEPS = [${ACT_ROUTE_MIN}, 64, 48, 32];
  function fitActivity(pageEl) {
    if (!pageEl.classList.contains("activity-page")) return;
    var w = pageEl.querySelector(".words.act-words");
    for (var k = 0; k < ROUTE_STEPS.length; k++) {
      pageEl.style.setProperty("--route-min", ROUTE_STEPS[k] + "px");
      fitWords(pageEl);
      var full = (w && w.scrollHeight > w.clientHeight + 1) || pageEl.scrollHeight > pageEl.clientHeight + 1;
      if (!full) break;
    }
    drawMap(pageEl);
  }

  function fitWords(pageEl) {
    var w = pageEl.querySelector(".words");
    if (!w || !w.firstChild) return;
    var base = 14, fs = base;
    w.style.setProperty("--fs", fs + "px");
    var guard = 0;
    while (w.scrollHeight > w.clientHeight + 1 && fs > base * MIN_SCALE && guard++ < 40) {
      fs = Math.max(base * MIN_SCALE, fs - 0.25);
      w.style.setProperty("--fs", fs + "px");
    }
  }

  function build() {
    clearTimeout(startTimer);
    Object.keys(tilesOn).forEach(function (id) { stopTile(id, true); });
    inbox = {};
    talkNotes = {};
    if (creditsOpen) creditsOpen.shut();
    root.textContent = "";
    applyLook();
    size = SIZES[config.paper] || SIZES.letter;
    stage = el("div", "stage");
    deck = el("div", "deck");
    stage.appendChild(deck);
    walkers = [];
    pageEls = config.pages.map(function (p, i) {
      var e = makePage(p, i);
      if (p.sprite && config.sprite) { e.classList.add("has-sprite"); makeWalker(e, i); }
      if (p.sound) {
        // The sound's row goes last in the page's flow, before the back page's footer.
        var row = el("div", "snd-row");
        row.appendChild(soundBand(p, i));
        e.classList.add("has-sound");
        e.insertBefore(row, e.querySelector(":scope > .foot"));
      }
      e.style.width = size.w + "px";
      e.style.height = size.h + "px";
      e.style.setProperty("--ph", size.h + "px");
      deck.appendChild(e);
      if (p.marks) renderMarks(e, p.marks);
      // A picture takes its room only once it has loaded: fit the words again then.
      // (Pictures arrive as their page comes near: see wantPage.)
      Array.prototype.forEach.call(e.querySelectorAll("img.la"), function (img) {
        img.addEventListener("load", function () { fitWords(e); fitBook(e); fitActivity(e); });
      });
      return e;
    });
    nav = el("div", "nav");
    prevBtn = el("button", null, "‹"); prevBtn.type = "button"; prevBtn.setAttribute("aria-label", "Previous page");
    nextBtn = el("button", null, "›"); nextBtn.type = "button"; nextBtn.setAttribute("aria-label", "Next page");
    where = el("span", "where"); where.setAttribute("aria-live", "polite");
    nav.appendChild(prevBtn); nav.appendChild(where); nav.appendChild(nextBtn);
    stage.appendChild(makeNow());
    stage.appendChild(makeLoadNote());
    root.appendChild(stage); root.appendChild(nav);
    prevBtn.addEventListener("click", function () { turn(-1); });
    nextBtn.addEventListener("click", function () { turn(1); });
    pageEls.forEach(fitWords);
    pageEls.forEach(fitBook);
    pageEls.forEach(fitActivity);
    pageEls.forEach(fitQuote);
    pageEls.forEach(fitTape);
    drawSound();
    if (config.preview && window.__zineAfterBuild) setTimeout(window.__zineAfterBuild, 0);
    layout();
    startWalkers();
  }

  function choose(width, height) {
    var pad = 16, gap = 14, w = size.w, h = size.h;
    if (width < 260 || height < 230) return { mode: "card", scale: Math.min(width / w, height / h) };
    var room = height - NAV - pad;
    var single = Math.min((width - pad * 2) / w, room / h, 2.4);
    var spread = Math.min((width - pad * 2 - gap) / (2 * w), room / h, 2.4);
    // A 2-page zine flips like a card: one side at a time, never a spread.
    if (pageEls.length > 2 && spread * h >= 300 && spread >= 0.85 * single) return { mode: "spread", scale: spread };
    if (single * h < 200) return { mode: "card", scale: Math.min(width / w, height / h) };
    return { mode: "single", scale: single };
  }

  function views() {
    var n = pageEls.length;
    if (mode !== "spread") return pageEls.map(function (_, i) { return [i]; });
    var out = [[null, 0]];
    for (var i = 1; i < n - 1; i += 2) out.push(i + 1 < n - 1 ? [i, i + 1] : [i, null]);
    out.push([n - 1, null]);
    return out;
  }
  function viewIndex() {
    var v = views();
    for (var k = 0; k < v.length; k++) if (v[k].indexOf(current) >= 0) return k;
    return 0;
  }

  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    if (!W || !H) return;
    var pick = choose(W, H);
    if (pick.mode === "card" && forced) {
      pick = { mode: "single", scale: Math.max(0.2, Math.min((W - 8) / size.w, (H - NAV - 4) / size.h)) };
    }
    mode = pick.mode;
    document.documentElement.className = mode;
    var s = pick.scale;
    scaleNow = s;
    var cols = mode === "spread" ? 2 : 1, gap = mode === "spread" ? 14 : 0;
    var deckW = cols * size.w + (cols - 1) * gap / s;
    deck.style.width = deckW + "px";
    deck.style.height = size.h + "px";
    deck.style.transform = "scale(" + s + ") translate(" + (-deckW / 2) + "px," + (-size.h / 2) + "px)";
    if (mode === "card") {
      if (!openBtn) {
        openBtn = el("button", "open");
        openBtn.type = "button";
        openBtn.setAttribute("aria-label", "Open the zine: " + (config.title || ""));
        openBtn.appendChild(el("span", null, "Tap to read"));
        openBtn.addEventListener("click", function () { forced = true; current = 0; layout(); });
        stage.appendChild(openBtn);
      }
      current = 0;
    } else if (openBtn) { openBtn.remove(); openBtn = null; }
    show();
  }

  function show() {
    var v = views()[viewIndex()];
    shownNow = v.slice();
    stopTilesOffPage();
    updateTalkNotes();
    var cols = mode === "spread" ? 2 : 1;
    pageEls.forEach(function (e, i) {
      var slot = v.indexOf(i);
      if (slot >= 0) {
        e.classList.add("shown");
        e.removeAttribute("aria-hidden");
        e.style.left = (cols === 2 ? slot * (size.w + 14 / scaleNow) : 0) + "px";
      } else {
        e.classList.remove("shown");
        e.setAttribute("aria-hidden", "true");
      }
    });
    var k = viewIndex(), all = views(), total = all.length;
    // The tiles shown start by themselves (after a moment); the pictures shown still come first.
    startShownTiles();
    // Load what's shown first, then the pages either side (a small card loads only its cover).
    v.forEach(function (i) { if (i != null) wantPage(i, true); });
    if (mode !== "card") [k + 1, k - 1].forEach(function (n) { if (all[n]) all[n].forEach(function (i) { if (i != null) wantPage(i, false); }); });
    drawLoadNote();
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === total - 1;
    where.textContent = nameOf(v);
    if (config.preview) {
      try { window.parent.postMessage({ zine: "page", ids: v.filter(function (i) { return i != null; }).map(function (i) { return config.pages[i].id; }) }, "*"); } catch (e) {}
    }
  }
  function nameOf(v) {
    var names = v.filter(function (i) { return i != null; }).map(function (i) { return config.pages[i]; });
    if (names.length === 2 && names[0].kind === "page" && names[1].kind === "page") return "Pages " + indexName(names[0]) + "–" + indexName(names[1]);
    return names.map(function (p) { return p.kind === "page" ? "Page " + indexName(p) : (p.label || p.id); }).join(", ");
  }
  function indexName(p) { return String(config.pages.indexOf(p)); }

  function turn(dir) {
    if (window.__zineLock || creditsOpen) return;
    var v = views(), k = viewIndex() + dir;
    if (k < 0 || k >= v.length) return;
    var first = v[k].filter(function (i) { return i != null; })[0];
    current = first;
    show();
  }
  function goto(id) {
    var i = config.pages.findIndex ? config.pages.findIndex(function (p) { return p.id === id; }) : -1;
    if (i < 0) return;
    if (mode === "card") forced = true;
    current = i;
    layout();
  }

  window.addEventListener("resize", layout);
  document.addEventListener("keydown", function (e) {
    if (mode === "card" || window.__zineLock || creditsOpen) return;
    var t = e.target;
    if ((e.key === " " || e.key === "Enter") && t && t.closest && t.closest("button, a")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { turn(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { turn(-1); e.preventDefault(); }
    else if (e.key === "Home") { current = 0; show(); }
    else if (e.key === "End") { current = pageEls.length - 1; show(); }
  });
  // Swipe: a mostly sideways drag of 40 px or more turns the page.
  var startX = null, startY = 0;
  document.addEventListener("pointerdown", function (e) { if (e.isPrimary) { startX = e.clientX; startY = e.clientY; } });
  document.addEventListener("pointerup", function (e) {
    if (startX == null || mode === "card" || window.__zineLock || creditsOpen) { startX = null; return; }
    var dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
  });

  if (config.preview) {
    // For the Foundry's decorating tools (runtime/editor.js, preview only).
    window.__zine = {
      config: function () { return config; },
      size: function () { return size; },
      pageEl: function (id) { var i = config.pages.findIndex(function (p) { return p.id === id; }); return i < 0 ? null : pageEls[i]; },
      current: function () { var p = config.pages[current]; return p ? p.id : null; },
      goto: function (id) { goto(id); },
      renderMarks: function (id, marks, keep) { var el = this.pageEl(id); return el ? renderMarks(el, marks, keep) : null; },
    };
    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || !e.data) return;
      if (e.data.zine === "config" && e.data.config) {
        var keep = config.pages[current] && config.pages[current].id;
        config = e.data.config;
        build();
        if (keep) goto(keep);
      } else if (e.data.zine === "goto") {
        goto(e.data.id);
      } else if ((e.data.zine === "clip" || e.data.zine === "piece") && clipAsks[e.data.src]) {
        var ask = clipAsks[e.data.src];
        delete clipAsks[e.data.src];
        if (e.data.bytes) ask.resolve(new Blob([e.data.bytes], { type: e.data.type || (e.data.zine === "clip" ? "audio/mpeg" : "") }));
        else ask.reject(new Error(e.data.error || (e.data.zine === "clip" ? "the sound isn't ready" : "the tile isn't ready")));
      }
    });
    try { window.parent.postMessage({ zine: "ready" }, "*"); } catch (e) {}
  }
  // Keep-alive: the tile's files come through a service worker that the browser
  // stops after a quiet spell, and a restarted worker can forget which tile it
  // serves (claude/tile-loading-findings.md). While the zine is on screen, a tiny
  // message every 20 s keeps it awake. No download; hosts without a worker ignore it.
  if (!config.preview) {
    var nudge = function () {
      try {
        var c = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (c && document.visibilityState !== "hidden") c.postMessage({ action: "tiles-keepalive" });
      } catch (e) {}
    };
    setInterval(nudge, ${LOAD_TIMES.keepAlive});
    document.addEventListener("visibilitychange", nudge);
  }
  build();
  // A restart (Try again on a stuck download) reopens the page it was on.
  var cue = /^#page=([A-Za-z0-9_-]+)$/.exec(location.hash || "");
  if (cue) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    goto(cue[1]);
  }
})();
`;
