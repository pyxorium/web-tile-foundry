import { makeFile } from "../../core/fileset.js";
import { renderZineHtml } from "./runtime/template.js";
import { lookOf, inkOf } from "./looks.js";
import { zineConfig, zinePages, picturePath, showsOf, usesSprite, SPRITE_PATH, PAGES, TITLE_MAX, DESCRIPTION_MAX, cleanText } from "./pages.js";
import { soundReady, soundPath, soundRecipe } from "./sound.js";
import { pieceFiles, pieceRecipe } from "./piece.js";

// Puts a zine tile together from the creator's pages. Kept apart from the tile
// type (index.js) so the tests can run it in Node: the card pictures (`art`)
// are handed in, drawn in the browser by art.js.
//
// Files: "/" (the page with the reader and the zine), one file per picture
// (/pictures/<page id>.webp or .jpg), one per sound (/sounds/<page id>.mp3),
// a page's tile under /tiles/<page id>/ (its files exactly as published),
// /icon.png and /banner.png when `art` is given.

/** The card description when the creator leaves it empty. */
export function defaultDescription(title, handle) {
  const t = cleanText(title, TITLE_MAX).replace(/\n+/g, " ");
  const h = String(handle || "").replace(/^@/, "").trim();
  return `${t ? `“${t}”, a` : "A"} little zine${h ? ` by @${h}` : ""}, eight pages to flip through.`;
}

/** The recipe (public): the choices and words, and where each picture went. Never file names. */
export function zineRecipe({ paper, look, ink, pages, sprite = null }) {
  const withSprite = usesSprite(pages, sprite);
  const shown = zinePages(pages, undefined, { paper, look, sprite: withSprite });
  const byId = new Map((pages || []).map((p, i) => [PAGES[i] && PAGES[i].id, p]));
  const l = lookOf(look);
  return {
    paper,
    look: l,
    ...(l === "riso" ? { ink: inkOf(ink).value } : {}),
    ...(withSprite ? { sprite: spriteRecipe(sprite) } : {}),
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
      }
      if (z.sound) out.sound = soundRecipe({ ...byId.get(z.id), id: z.id });
      if (z.tile) out.tile = pieceRecipe(byId.get(z.id), z.id);
      if (z.tape) out.tape = pieceRecipe(byId.get(z.id), z.id);
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

export function makeZineTile({ name, description = "", handle = "", paper = "letter", look = "clean", ink = "", pages, sprite = null, made = "", art = null }) {
  const title = cleanText(name, TITLE_MAX).replace(/\n+/g, " ");
  if (!title) throw new Error("The zine needs a title.");
  if (!Array.isArray(pages) || pages.length !== PAGES.length) throw new Error("The zine's pages are missing.");
  const config = zineConfig({ title, handle, paper, look, ink, pages, made, sprite });
  const files = [makeFile("/", renderZineHtml({ title, config }))];
  if (config.sprite) files.push(makeFile(SPRITE_PATH, sprite.bytes));
  PAGES.forEach((spec, i) => {
    const p = pages[i];
    if (p && p.picture && showsOf(spec, p).includes("picture")) files.push(makeFile(picturePath({ ...p, id: spec.id }), p.picture.bytes));
    if (soundReady(p)) files.push(makeFile(soundPath(spec.id), p.clip.bytes));
    if (showsOf(spec, p).includes("piece")) for (const f of pieceFiles(p, spec.id)) files.push(makeFile(f.path, f.bytes));
  });
  if (art) files.push(makeFile("/icon.png", art.icon), makeFile("/banner.png", art.banner));
  const desc = cleanText(description, DESCRIPTION_MAX).replace(/\n+/g, " ") || defaultDescription(title, handle);
  return {
    name: title,
    description: desc,
    files,
    icons: art ? [{ src: "/icon.png" }] : [],
    screenshots: art ? [{ src: "/banner.png" }] : [],
    recipeInputs: zineRecipe({ paper: config.paper, look: config.look, ink, pages, sprite }),
  };
}
