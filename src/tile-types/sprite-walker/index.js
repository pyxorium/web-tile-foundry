import { makeFile } from "../../core/fileset.js";
import { bytesToDataUri } from "../../core/bytes.js";
import { renderTileHtml } from "./template.js";
import { SCENES, DEFAULT_SCENE, getScene } from "./scenes/index.js";

// Tile type: Sprite Walker.
// A tile that shows the user's own rpg.actor sprite walking in a background of
// their choosing, with a gear menu (top right) to switch between no motion,
// walking forward, and back and forth. The creator picks the background (fixed
// for the tile). Every tile starts walking forward; viewers can change the
// motion with the gear for their visit.

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;
const START_MOTION = "forward";

export const spriteWalker = {
  id: "sprite-walker",
  version: 1,
  title: "Sprite Walker",
  summary: "Your rpg.actor sprite, out for a walk.",

  inputs: [
    { key: "sprite", kind: "sprite", label: "Sprite", required: true },
    {
      key: "background",
      kind: "choice",
      display: "swatches",
      label: "Background",
      required: true,
      options: SCENES.map((s) => ({ value: s.id, label: s.label })),
    },
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX, group: "card" },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
  ],

  groups: [{ id: "card", title: "For display in the link preview card" }],

  defaults(context = {}) {
    return {
      sprite: null,
      background: DEFAULT_SCENE,
      name: context.handle ? `@${context.handle}'s sprite` : "My sprite",
      description: "An rpg.actor sprite, out for a walk.",
    };
  },

  // Picture for one option of a "swatches" input: the background with the
  // user's sprite standing in it (or empty, before a sprite is chosen).
  async optionPreview(key, value, inputs) {
    if (key !== "background") return null;
    const { makeSwatch } = await import("./art.js");
    const sprite = inputs.sprite;
    return makeSwatch(getScene(value), sprite ? sprite.bytes : null, sprite ? sprite.geometry : null);
  },

  async build(inputs) {
    const { sprite } = inputs;
    const { columns, rows, frameWidth, frameHeight } = sprite.geometry;
    if (columns < 3 || rows < 3) {
      throw new Error("The walker needs at least 3 columns and 3 rows (front, left and right).");
    }
    const scene = getScene(inputs.background);
    const name = inputs.name.trim();
    const html = renderTileHtml({
      title: name,
      sheetDataUri: bytesToDataUri(sprite.bytes, "image/png"),
      frameWidth,
      frameHeight,
      startMotion: START_MOTION,
      scene,
    });

    // Card art needs a canvas, so it is loaded only when a tile is actually built.
    const { makeCardArt } = await import("./art.js");
    const art = await makeCardArt(sprite.bytes, sprite.geometry, scene);

    const origin =
      sprite.origin.kind === "record"
        ? { kind: "record", uri: sprite.origin.uri, generator: sprite.origin.generator ?? null }
        : { kind: "local-file" };

    return {
      name,
      description: (inputs.description || "").trim(),
      files: [makeFile("/", html), makeFile("/icon.png", art.icon), makeFile("/banner.png", art.banner)],
      icons: [{ src: "/icon.png" }],
      screenshots: [{ src: "/banner.png" }],
      recipeInputs: {
        sprite: { cid: sprite.cid, origin, width: sprite.width, height: sprite.height, ...sprite.geometry },
        startMotion: START_MOTION,
        background: { id: scene.id, version: scene.version },
      },
    };
  },
};
