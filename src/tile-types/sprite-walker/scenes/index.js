// Backgrounds ("scenes") for the Sprite Walker, chosen in the Foundry.
// Only the chosen scene's code goes into a tile.
//
// Each scene is { id, version, label, groundRatio, paint }.
//   paint(ctx, w, h, px, t) draws the whole background and returns the ground
//   line (y, in canvas pixels) where the sprite's feet go.
//     w, h  canvas size in device pixels
//     px    the sprite's pixel size, so scene details match the sprite's pixels
//     t     time in ms for gentle animation; 0 for still images (card art,
//           reduced motion)
//
// IMPORTANT: paint() is copied into the tile as text, so it must be fully
// self-contained: no imports, no outside variables, no helpers defined
// elsewhere. Anything it needs is defined inside it. A test runs every
// paint() in isolation to make sure.

import { twilight } from "./twilight.js";
import { glitter } from "./glitter.js";
import { blockworld } from "./blockworld.js";
import { dungeon } from "./dungeon.js";
import { cafe } from "./cafe.js";
import { snow } from "./snow.js";
import { beach } from "./beach.js";
import { plain } from "./plain.js";

export const SCENES = Object.freeze([twilight, glitter, blockworld, dungeon, cafe, snow, beach, plain]);

export const DEFAULT_SCENE = "twilight";

export function getScene(id) {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown background "${id}".`);
  return scene;
}
