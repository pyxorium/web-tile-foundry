import { cleanPictureSource } from "../../core/app-pictures.js";
import { makeFile } from "../../core/fileset.js";
import { renderZineHtml } from "./runtime/template.js";
import { lookOf, inkOf } from "./looks.js";
import { zineConfig, zinePages, picturePath, stillPath, isAnimated, showsOf, usesSprite, SPRITE_PATH, PAGES, TITLE_MAX, DESCRIPTION_MAX, cleanText, pageCountOf, pagesFor, pagesInUse } from "./pages.js";
import { mdPlain } from "./markdown.js";
import { fontFiles, cleanFont, FONT_LOOK } from "./fonts.js";
import { soundReady, soundPath, soundRecipe } from "./sound.js";
import { pieceFiles, pieceRecipe } from "./piece.js";

// Puts a zine tile together from the creator's pages. Kept apart from the tile
// type (index.js) so the tests can run it in Node: the card pictures (`art`)
// are handed in, drawn in the browser by art.js.
//
// Only the pages in use (the page count: 8, 4 or 2) go in; put-aside pages stay
// in the Foundry. Files: "/" (the page with the reader and the zine), one file per picture
// (/pictures/<page id>.webp or .jpg), one per sound (/sounds/<page id>.mp3),
// a page's tile under /tiles/<page id>/ (its files exactly as published),
// /icon.png and /banner.png when `art` is given.

// The end of the default description, by page count (owner, Oct 11).
const COUNT_WORDS = Object.freeze({ 8: "eight pages to flip through", 4: "four pages to flip through", 2: "front and back" });

/** The card description when the creator leaves it empty. */
export function defaultDescription(title, handle, pageCount) {
  const t = plainTitle(title);
  const h = String(handle || "").replace(/^@/, "").trim();
  return `${t ? `“${t}”, a` : "A"} little zine${h ? ` by @${h}` : ""}, ${COUNT_WORDS[pageCountOf(pageCount)]}.`;
}

/**
 * The title as feeds show it (v0.30.0): the cover may set it in **bold** or
 * *italic*, but the tile's name and the card's words are plain text.
 */
export function plainTitle(title) {
  return mdPlain(cleanText(title, TITLE_MAX).replace(/\n+/g, " "), false).trim();
}

/** The recipe (public): the choices and words, and where each picture went. Never file names. */
export function zineRecipe({ paper, look, ink, pages, pageCount, sprite = null, headingFont, wordsFont }) {
  const count = pageCountOf(pageCount);
  const withSprite = usesSprite(pages, sprite, count);
  const shown = zinePages(pages, undefined, { paper, look, count, sprite: withSprite });
  // Only the pages in use: put-aside pages stay in the Foundry, never in the recipe.
  const used = pagesInUse(pages, count);
  const byId = new Map(pagesFor(count).map((spec, i) => [spec.id, used[i]]));
  const l = lookOf(look);
  return {
    pageCount: count,
    paper,
    look: l,
    ...(l === "riso" ? { ink: inkOf(ink).value } : {}),
    ...(withSprite ? { sprite: spriteRecipe(sprite) } : {}),
    // Zine fonts (v0.30.0), when not the look's own.
    ...(cleanFont("heading", headingFont) !== FONT_LOOK ? { headingFont } : {}),
    ...(cleanFont("words", wordsFont) !== FONT_LOOK ? { wordsFont } : {}),
    pages: shown.map((z) => {
      const out = { id: z.id };
      if (z.layout) out.layout = z.layout;
      if (z.sprite) out.sprite = true;
      if (z.marks) out.marks = z.marks;
      if (z.heading) out.heading = z.heading;
      if (z.subtitle) out.subtitle = z.subtitle;
      if (z.words) out.words = z.words;
      if (z.picture) {
        out.picture = { path: z.picture.src, width: z.picture.width, height: z.picture.height };
        if (z.picture.alt) out.picture.alt = z.picture.alt;
        if (z.picture.fill) { out.picture.fill = true; out.picture.crop = z.picture.crop; }
        if (z.picture.still) { out.picture.animated = true; out.picture.still = z.picture.still; }
        const from = cleanPictureSource((byId.get(z.id) || {}).picture && byId.get(z.id).picture.source);
        if (from) out.picture.source = from;
      }
      if (z.sound) out.sound = soundRecipe({ ...byId.get(z.id), id: z.id });
      if (z.tile) {
        out.tile = pieceRecipe(byId.get(z.id), z.id);
        // Tiles that talk (v0.29.0): the page it talks to, and its short name.
        if (out.tile && z.tile.pair) {
          out.tile.talksTo = z.tile.pair;
          if (z.tile.short) out.tile.shortName = z.tile.short;
        }
      }
      if (z.tape) out.tape = pieceRecipe(byId.get(z.id), z.id);
      if (z.book) out.book = pieceRecipe(byId.get(z.id), z.id);
      if (z.activity) out.activity = pieceRecipe(byId.get(z.id), z.id);
      return out;
    }),
  };
}

/** Where the sprite came from (public): its address, and the rpg.actor record it was read from. */
function spriteRecipe(sprite) {
  const o = sprite.origin || {};
  const origin = o.kind === "record" ? { kind: "record", uri: o.uri, generator: o.generator ?? null } : { kind: "local-file" };
  return { cid: sprite.cid, origin, width: sprite.width, height: sprite.height, ...sprite.geometry };
}

// fontBytes: { [file]: Uint8Array }, the chosen fonts' files (src/tile-types/zine/fonts.js),
// loaded by the Foundry from public/zine-fonts/.
export function makeZineTile({ name, description = "", handle = "", paper = "letter", look = "clean", ink = "", pages, pageCount, sprite = null, made = "", art = null, headingFont = FONT_LOOK, wordsFont = FONT_LOOK, fontBytes = {} }) {
  const title = cleanText(name, TITLE_MAX).replace(/\n+/g, " ");
  const plain = plainTitle(name);
  if (!title || !plain) throw new Error("The zine needs a title.");
  if (!Array.isArray(pages) || pages.length !== PAGES.length) throw new Error("The zine's pages are missing.");
  const count = pageCountOf(pageCount);
  const config = zineConfig({ title, handle, paper, look, ink, pages, pageCount: count, made, sprite, headingFont, wordsFont });
  const files = [makeFile("/", renderZineHtml({ title: plain, config }))];
  if (config.sprite) files.push(makeFile(SPRITE_PATH, sprite.bytes));
  const used = pagesInUse(pages, count);
  pagesFor(count).forEach((spec, i) => {
    const p = used[i];
    if (p && p.picture && showsOf(spec, p).includes("picture")) {
      files.push(makeFile(picturePath({ ...p, id: spec.id }), p.picture.bytes));
      if (isAnimated(p.picture)) files.push(makeFile(stillPath({ ...p, id: spec.id }), p.picture.still.bytes));
    }
    if (soundReady(p)) files.push(makeFile(soundPath(spec.id), p.clip.bytes));
    // A copied tile's file keeps the type its account's server already holds its
    // bytes under (ATMOSYNTH tiles published through appmosphe.re store their text
    // files as application/octet-stream): uploading the same bytes under another
    // type to that account is refused (src/core/publish.js, fileset.js).
    if (showsOf(spec, p).includes("piece")) {
      for (const f of pieceFiles(p, spec.id)) files.push(f.storedType ? { ...makeFile(f.path, f.bytes), storedType: f.storedType } : makeFile(f.path, f.bytes));
    }
  });
  // The chosen fonts and their licences (v0.30.0).
  for (const f of fontFiles({ headingFont, wordsFont })) {
    const bytes = fontBytes[f.file];
    if (!bytes || !bytes.length) throw new Error("The zine's fonts haven't loaded yet. Try again in a moment.");
    files.push(makeFile(f.path, bytes));
  }
  if (art) files.push(makeFile("/icon.png", art.icon), makeFile("/banner.png", art.banner));
  const desc = cleanText(description, DESCRIPTION_MAX).replace(/\n+/g, " ") || defaultDescription(title, handle, count);
  return {
    name: plain,
    description: desc,
    files,
    icons: art ? [{ src: "/icon.png" }] : [],
    screenshots: art ? [{ src: "/banner.png" }] : [],
    recipeInputs: zineRecipe({ paper: config.paper, look: config.look, ink, pages, pageCount: count, sprite, headingFont, wordsFont }),
  };
}
