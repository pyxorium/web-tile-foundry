import { makeLanternTile } from "./tile.js";
import {
  SHAPE_OPTIONS, KIT_OPTIONS, GLASS_COLORS, COLOR_MODE_OPTIONS, SPREAD_OPTIONS, METAL_OPTIONS, BACKGROUND_OPTIONS, LAMP_OPTIONS,
  panelDefaults, applyPanelChange, resolvePanel, panelRecipe, isHandPainted, hasStylePalette,
} from "./panel.js";
import { GEM_FACETS } from "./geometry/index.js";
import { pictureUrl, shapePictureFile, stylePictureFile } from "./pictures.js";

// Tile type: Glass Lantern.
// A stained glass die, lit from inside, that the viewer can turn, roll and
// zoom. The panel's rules live in panel.js, the tile's files in tile.js, the
// live preview in preview.js, and the tile's own program in runtime/.

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;
const isGem = (v) => v.shape === "gem";
const isEasy = (v) => v.colorMode !== "handson";
const isHandsOn = (v) => v.colorMode === "handson";

/** The program every lantern tile carries (/lantern.js), bundled by the Foundry's build (vite.config.js). */
async function loadRuntime() {
  const mod = await import("virtual:glass-lantern-runtime");
  return mod.default;
}

// Card pictures take a moment to draw, so the last ones are kept: changing only
// the title or the brush does not redraw them.
let artCache = { key: null, art: null };
async function cardArt(parts) {
  const key = JSON.stringify([parts.shape.fingerprint, parts.colors, parts.look]);
  if (artCache.key !== key) {
    const { makeCardArt } = await import("./art.js");
    artCache = { key, art: await makeCardArt(parts) };
  }
  return artCache.art;
}

export const glassLantern = {
  id: "glass-lantern",
  version: 1,
  title: "Glass Lantern",
  summary: "A stained glass die, lit from inside, to turn and roll.",
  // Published tiles of this type can be copied onto a Zine Scene page and run there.
  zinePage: "live",

  inputs: [
    {
      key: "shape",
      kind: "choice",
      display: "swatches",
      smooth: true,
      label: "Shape",
      required: true,
      // Saved pictures (pictures.js), so the panel draws nothing but the live preview.
      options: SHAPE_OPTIONS.map((o) => ({ ...o, image: pictureUrl(shapePictureFile(o.value)) })),
    },
    { key: "gemFacets", kind: "range", label: "Facets", min: GEM_FACETS.min, max: GEM_FACETS.max, showIf: isGem },
    { key: "gemSeed", kind: "seed", button: "New gem", showIf: isGem },
    {
      key: "kit",
      kind: "choice",
      display: "swatches",
      smooth: true,
      label: "Style",
      help: "A style sets the glass colors, metal, lamp and background in one go.",
      required: true,
      options: KIT_OPTIONS.map((o) => ({ ...o, image: pictureUrl(stylePictureFile(o.value)) })),
    },
    { key: "colorMode", kind: "choice", label: "Glass colors", required: true, options: COLOR_MODE_OPTIONS },
    { key: "palette", kind: "palette", label: "Pick your colors", help: "The style's five default colors start ticked.", colors: GLASS_COLORS, showIf: isEasy },
    { key: "resetPalette", kind: "action", button: "Reset to style default colors", showIf: isEasy, disabledIf: hasStylePalette },
    { key: "spread", kind: "choice", label: "Spread your colors (Easy)", required: true, options: SPREAD_OPTIONS, showIf: isEasy },
    {
      key: "brush",
      kind: "brush",
      label: "Pick a color, then tap facets in the preview to paint them.",
      help: "Select any color.",
      colors: GLASS_COLORS,
      showIf: isHandsOn,
    },
    { key: "startOver", kind: "action", button: "Start over", showIf: isHandsOn, disabledIf: (v) => !isHandPainted(v) },
    { key: "metal", kind: "choice", label: "Metal", options: METAL_OPTIONS, group: "more" },
    { key: "background", kind: "choice", label: "Background", options: BACKGROUND_OPTIONS, group: "more" },
    { key: "tabletop", kind: "toggle", label: "Tabletop", group: "more" },
    { key: "lamp", kind: "choice", label: "Lamp", options: LAMP_OPTIONS, group: "more" },
    { key: "filament", kind: "toggle", label: "Show the filament", help: "Hides only the glowing spot in the center.", group: "more" },
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX, group: "card" },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
  ],

  groups: [
    { id: "more", title: "Metal, light and background", collapsed: true },
    { id: "card", title: "For display in the link preview card" },
  ],

  defaults(context = {}) {
    return panelDefaults(context);
  },

  applyChange(key, value, values) {
    return applyPanelChange(key, value, values);
  },

  preview: {
    mount: async (element, options) => (await import("./preview.js")).mountPreview(element, options),
    caption: () => "Live preview. Drag to turn, tap to roll, pinch or scroll to zoom.",
  },

  buildDelayMs: 400,

  // Card pictures take real graphics work, so they are drawn only for the
  // final build, when the creator presses Publish (see build() in contract.js).
  async build(values, { final = true } = {}) {
    const runtime = await loadRuntime();
    const parts = resolvePanel(values);
    const art = final ? await cardArt(parts) : null;
    return makeLanternTile({ name: values.name, description: values.description, parts, recipe: panelRecipe(values), runtime, art });
  },
};
