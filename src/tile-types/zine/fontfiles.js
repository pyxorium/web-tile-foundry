import { fontFiles, fontOf, ZINE_FONTS } from "./fonts.js";

// The zine fonts' files in the Foundry (v0.30.0): fetched once from the
// Foundry's own public/zine-fonts/ and kept, for the tile (tile.js puts the
// chosen ones in), the preview (the reader asks for them by "font:<file>"),
// the card art and the font menus (each name written in its own font).

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
const kept = new Map(); // file -> Promise<Uint8Array>
// Only the zine fonts' own files can be asked for (the preview's reader names them).
const KNOWN = new Set(ZINE_FONTS.flatMap((f) => [...f.faces.map((x) => x.file), f.licence]));

/** One font file's bytes (or its licence). */
export function fontFileBytes(file) {
  if (!KNOWN.has(file)) return Promise.reject(new Error(`${file} isn't one of the zine fonts.`));
  if (!kept.has(file)) {
    const p = fetch(`${BASE}zine-fonts/${file}`).then((res) => {
      if (!res.ok) throw new Error(`The font file ${file} couldn't be loaded (${res.status}).`);
      return res.arrayBuffer();
    }).then((b) => new Uint8Array(b));
    p.catch(() => kept.delete(file)); // try again next time
    kept.set(file, p);
  }
  return kept.get(file);
}

/** { [file]: bytes } for every file the zine's fonts need. */
export async function loadFontBytes(choice) {
  const out = {};
  await Promise.all(fontFiles(choice).map(async ({ file }) => { out[file] = await fontFileBytes(file); }));
  return out;
}

const faces = new Map(); // family -> Promise
/**
 * Adds a font to this page (the Foundry), as `family`, scaled by `adjust`:
 * for the font menus and the card art. Resolves when it can be drawn.
 */
export function useFontHere(id, family = `zine-menu-${id}`, adjust = 1) {
  const font = fontOf(id);
  if (!font || typeof FontFace === "undefined" || typeof document === "undefined") return Promise.resolve(false);
  const key = `${family}|${adjust}`;
  if (!faces.has(key)) {
    faces.set(key, Promise.all(font.faces.map(async (f) => {
      const bytes = await fontFileBytes(f.file);
      const face = new FontFace(family, bytes.slice().buffer, { weight: f.weight, style: f.style, sizeAdjust: `${Math.round(adjust * 100)}%` });
      await face.load();
      document.fonts.add(face);
    })).then(() => true, () => { faces.delete(key); return false; }));
  }
  return faces.get(key);
}

/** How much a font's name is scaled in the font menus: as its headings are. */
export function menuScale(id) {
  const f = fontOf(id);
  return f ? f.headAdjust || 1 : 1;
}
