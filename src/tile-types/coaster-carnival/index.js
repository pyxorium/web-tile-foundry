import { makeCoasterTile } from "./tile.js";
import {
  THEME_OPTIONS, STYLE_OPTIONS, STEEL_OPTIONS, WOOD_OPTIONS, CART_OPTIONS, TRACK_RANGES, SEED_MAX,
  panelDefaults, trackFor, choicesOf, usableSprite, riderRecipe, panelRecipe, describeTrack,
} from "./panel.js";
import { pictureUrl, themePictureFile, DEFAULT_SPRITE_FILE } from "./pictures.js";

// Tile type: Coaster Carnival.
// A rideable roller coaster, made from a few sliders, with the creator's
// rpg.actor sprite in the front row. The panel's rules live in panel.js, the
// tile's files in tile.js, the live preview in preview.js, the card pictures
// in art.js, and the tile's own program in runtime/.

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;
const isSteel = (v) => v.style !== "wood";
const isWood = (v) => v.style === "wood";
const r = TRACK_RANGES;

/** The program every coaster tile carries (/coaster.js), bundled by the Foundry's build (vite.config.js). */
async function loadRuntime() {
  const mod = await import("virtual:coaster-carnival-runtime");
  return mod.default;
}

/** The default rider's picture, from the Foundry's own site. */
let defaultSprite = null;
async function loadDefaultSprite() {
  if (!defaultSprite) {
    const response = await fetch(pictureUrl(DEFAULT_SPRITE_FILE));
    if (!response.ok) throw new Error("The default rider's picture could not be loaded.");
    defaultSprite = new Uint8Array(await response.arrayBuffer());
  }
  return defaultSprite;
}

// Card pictures take a moment to draw, so the last ones are kept: changing only
// the title does not redraw them.
let artCache = { key: null, art: null };
async function cardArt(track, choices, sprite, riderKey) {
  const key = JSON.stringify([track.fingerprint, choices, riderKey]);
  if (artCache.key !== key) {
    const { makeCardArt } = await import("./art.js");
    artCache = { key, art: await makeCardArt({ track, choices, sprite }) };
  }
  return artCache.art;
}

export const coasterCarnival = {
  id: "coaster-carnival",
  version: 1,
  title: "Coaster Carnival",
  summary: "A roller coaster to ride, with your rpg.actor sprite in the front row.",

  inputs: [
    { key: "sprite", kind: "sprite", label: "Your rider", help: "Your rpg.actor sprite rides in the front row. Without one, the default rider takes your seat." },
    {
      key: "theme",
      kind: "choice",
      display: "swatches",
      smooth: true,
      label: "Starting theme",
      help: "Viewers can switch themes; this is the one they see first.",
      required: true,
      // Saved pictures (pictures.js), so the panel draws nothing but the live preview.
      options: THEME_OPTIONS.map((o) => ({ ...o, image: pictureUrl(themePictureFile(o.value)) })),
    },
    { key: "drops", kind: "range", label: "Drops", min: r.drops.min, max: r.drops.max },
    { key: "loops", kind: "range", label: "Loops", min: r.loops.min, max: r.loops.max },
    { key: "corkscrews", kind: "range", label: "Corkscrews", min: r.corkscrews.min, max: r.corkscrews.max },
    { key: "intensity", kind: "range", label: "Intensity", min: r.intensity.min, max: r.intensity.max, help: "Taller lift, steeper drops and stronger turns." },
    {
      key: "seed",
      kind: "seed",
      label: "Shape",
      button: "New track shape",
      editable: true,
      max: SEED_MAX,
      help: "Each number is a different shape. Write one down to make it again.",
    },
    { key: "trackSwitch", kind: "toggle", label: "Add a switch", help: "Viewers choose Frolic (the long way) or Detour at a fork." },
    { key: "tunnel", kind: "toggle", label: "Add a tunnel" },
    { key: "cartColors", kind: "choice", label: "Cart color", required: true, options: CART_OPTIONS, group: "look" },
    { key: "style", kind: "choice", label: "Track style", required: true, options: STYLE_OPTIONS, group: "look" },
    { key: "steelColors", kind: "choice", label: "Steel colors", required: true, options: STEEL_OPTIONS, showIf: isSteel, group: "look" },
    { key: "woodColors", kind: "choice", label: "Wood finish", required: true, options: WOOD_OPTIONS, showIf: isWood, group: "look" },
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX, group: "card" },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
  ],

  groups: [
    { id: "look", title: "Colors and style", collapsed: true },
    { id: "card", title: "For display in the link preview card" },
  ],

  defaults(context = {}) {
    return panelDefaults(context);
  },

  preview: {
    mount: async (element, options) => (await import("./preview.js")).mountPreview(element, options),
    caption: (values) => `Tap the preview to take a test ride. ${describeTrack(values)}`,
  },

  buildDelayMs: 600,

  // Card pictures take real graphics work, so they are drawn only for the
  // final build, when the creator presses Publish (see build() in contract.js).
  async build(values, { final = true } = {}) {
    const runtime = await loadRuntime();
    const track = trackFor(values);
    const own = usableSprite(values);
    const sprite = own ? own.bytes : await loadDefaultSprite();
    const choices = choicesOf(values);
    const art = final ? await cardArt(track, choices, sprite, own ? own.cid : "default") : null;
    return makeCoasterTile({
      name: values.name,
      description: values.description,
      choices,
      track,
      sprite,
      rider: riderRecipe(values),
      recipe: panelRecipe(values),
      runtime,
      art,
    });
  },
};
