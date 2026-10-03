import { makeLanternTile, lanternTileParts } from "./tile.js";

// Tile type: Glass Lantern.
// A stained glass die, lit from inside, that the viewer can turn, roll and
// zoom. Stage 5: the tile itself. The Foundry's panel for choosing the shape,
// kit and colours comes in stage 6; until then those arrive as plain values
// (the tile test page, lab/tile-test.html, passes them from the look lab).

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;

/** The program every lantern tile carries (/lantern.js), bundled by the Foundry's build (vite.config.js). */
async function loadRuntime() {
  const mod = await import("virtual:glass-lantern-runtime");
  return mod.default;
}

export const glassLantern = {
  id: "glass-lantern",
  version: 1,
  title: "Glass Lantern",
  summary: "A stained glass die, lit from inside, to turn and roll.",

  inputs: [
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX, group: "card" },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
  ],

  groups: [{ id: "card", title: "For display in the link preview card" }],

  defaults() {
    return {
      name: "My glass lantern",
      description: "A stained glass die. Drag to turn it, tap to roll it.",
      shape: { group: "classic", id: "d12" },
      kit: "tiffany",
      look: null,
      colours: null,
      slowTurn: true,
    };
  },

  async build(inputs) {
    const runtime = await loadRuntime();
    const parts = lanternTileParts(inputs);
    // Card pictures need graphics, so that code loads only when a tile is built.
    const { makeCardArt } = await import("./art.js");
    const art = await makeCardArt(parts);
    return makeLanternTile({ ...inputs, runtime, art });
  },
};
