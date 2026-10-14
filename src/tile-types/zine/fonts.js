// Zine fonts (Foundry v0.30.0): a "Heading font" and a "Words font" for the
// whole zine, each "Default" (the look's own) unless chosen. Six open (OFL) fonts, cut
// down to Latin and saved as WOFF2 by scripts/make-zine-fonts.py into
// public/zine-fonts/. Only the fonts a zine uses go into it (under /fonts/),
// each with its licence. Plan and decisions: claude/zine-v030-plan.md.
//
// Words keep the room the word gauge measures (pages.js WORD_LIMITS): each
// font is scaled (size-adjust) so a line of it is about as wide as the look's
// own words, or a little narrower (measured in Chromium, Oct 14: Fraunces 1.03,
// Courier Prime 0.81, Nunito 1.06, Caveat 1.42, Bebas Neue 1.42, Pirata One 1.35;
// a few % kept spare). Headings use the same scale, so they wrap the same way.

export const FROM_LOOK = "";

// faces: the font's files. weight: a single weight or a range (variable).
// headWeight / strongWeight: the weight headings use, and their **bold** parts.
// italic: false when the font has none (Caveat slants; Bebas Neue and Pirata One
// set *italic* parts of headings in the look's own font instead).
export const ZINE_FONTS = Object.freeze([
  {
    id: "fraunces", label: "Fraunces", kind: "serif", words: true, italic: true, licence: "fraunces-OFL.txt",
    faces: [{ file: "fraunces.woff2", weight: "400 900", style: "normal" }, { file: "fraunces-italic.woff2", weight: "400 900", style: "italic" }],
    headWeight: 700, strongWeight: 900, wordsAdjust: 1, headAdjust: 1, fallback: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "courier-prime", label: "Courier Prime", kind: "typewriter", words: true, italic: true, licence: "courier-prime-OFL.txt",
    faces: [
      { file: "courier-prime.woff2", weight: "400", style: "normal" },
      { file: "courier-prime-bold.woff2", weight: "700", style: "normal" },
      { file: "courier-prime-italic.woff2", weight: "400", style: "italic" },
      { file: "courier-prime-bold-italic.woff2", weight: "700", style: "italic" },
    ],
    // Scaled to 90% (owner, Oct 14: 80% printed too small, about 10.4 pt): its lines run
    // about 11% wider than the look's words, so its words get that much less room.
    headWeight: 700, strongWeight: 700, wordsAdjust: 0.9, headAdjust: 0.9, wordsWidth: 1.11, fallback: '"Courier New", Courier, monospace',
  },
  {
    id: "nunito", label: "Nunito", kind: "rounded", words: true, italic: true, licence: "nunito-OFL.txt",
    faces: [{ file: "nunito.woff2", weight: "400 900", style: "normal" }, { file: "nunito-italic.woff2", weight: "400 900", style: "italic" }],
    headWeight: 800, strongWeight: 900, wordsAdjust: 1.03, headAdjust: 1, fallback: "system-ui, sans-serif",
  },
  {
    id: "caveat", label: "Caveat", kind: "handwritten", words: true, italic: false, licence: "caveat-OFL.txt",
    faces: [{ file: "caveat.woff2", weight: "400 700", style: "normal" }],
    headWeight: 700, strongWeight: 700, wordsAdjust: 1.38, headAdjust: 1.38, fallback: "cursive",
  },
  {
    id: "bebas-neue", label: "Bebas Neue", kind: "poster", words: false, italic: false, licence: "bebas-neue-OFL.txt",
    faces: [{ file: "bebas-neue.woff2", weight: "400", style: "normal" }],
    headWeight: 400, strongWeight: 400, headAdjust: 1.38, fallback: "Impact, sans-serif",
  },
  {
    id: "pirata-one", label: "Pirata One", kind: "blackletter", words: false, italic: false, licence: "pirata-one-OFL.txt",
    faces: [{ file: "pirata-one.woff2", weight: "400", style: "normal" }],
    headWeight: 400, strongWeight: 400, headAdjust: 1.3, fallback: "serif",
  },
]);

export const FONT_LOOK = FROM_LOOK;

export function fontOf(id) {
  return ZINE_FONTS.find((f) => f.id === id) || null;
}
/** A font choice made safe for its role: one of the fonts offered there, or "" (from the look). */
export function cleanFont(role, id) {
  const f = fontOf(id);
  if (!f) return FROM_LOOK;
  return role === "words" && !f.words ? FROM_LOOK : id;
}

// The panel's choices: "Default" (the look's own fonts) first, then each font by name.
export const HEADING_FONT_OPTIONS = Object.freeze([{ value: FROM_LOOK, label: "Default" }, ...ZINE_FONTS.map((f) => ({ value: f.id, label: f.label, font: f.id }))]);
export const WORDS_FONT_OPTIONS = Object.freeze([{ value: FROM_LOOK, label: "Default" }, ...ZINE_FONTS.filter((f) => f.words).map((f) => ({ value: f.id, label: f.label, font: f.id }))]);

/** The fonts a zine uses: [{ font, role: "heading" | "words" }]. */
export function fontsUsed({ headingFont, wordsFont } = {}) {
  const out = [];
  const h = fontOf(cleanFont("heading", headingFont));
  const w = fontOf(cleanFont("words", wordsFont));
  if (h) out.push({ font: h, role: "heading" });
  if (w) out.push({ font: w, role: "words" });
  return out;
}

/** Where a font file goes in the tile. */
export function fontPath(file) {
  return `/fonts/${file}`;
}

/** Every file a zine's fonts need, each once: [{ file, path }] (the font files and their licences). */
export function fontFiles(choice) {
  const seen = new Set();
  const out = [];
  for (const { font } of fontsUsed(choice)) {
    for (const name of [...font.faces.map((f) => f.file), font.licence]) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ file: name, path: fontPath(name) });
    }
  }
  return out;
}

/**
 * How much wider than the look's own words a words font sets them (for the
 * word gauge). Every words font is scaled to set a line no wider (see above).
 */
export function wordsWidth(values) {
  const f = fontOf(cleanFont("words", values && values.wordsFont));
  return (f && f.wordsWidth) || 1;
}

/**
 * The reader's font config, or null when both are the look's own: { heading?, words? }, each
 *   { id, family, faces: [{ src, weight, style }], adjust, weight, strong, italic, fallback }
 * `src(file)` gives each file's address (its tile path, or in the preview a font: address).
 */
export function fontsForReader(choice, src = fontPath) {
  const out = {};
  for (const { font, role } of fontsUsed(choice)) {
    out[role] = {
      id: font.id,
      family: `zine-${role}-${font.id}`,
      faces: font.faces.map((f) => ({ src: src(f.file), weight: f.weight, style: f.style })),
      adjust: role === "words" ? font.wordsAdjust : font.headAdjust,
      weight: font.headWeight,
      strong: font.strongWeight,
      italic: font.italic,
      fallback: font.fallback,
    };
  }
  return out.heading || out.words ? out : null;
}
