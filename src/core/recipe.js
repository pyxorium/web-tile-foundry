import { FOUNDRY_NAME, FOUNDRY_VERSION } from "./version.js";
import { makeFile } from "./fileset.js";

// The recipe: a small JSON file, /foundry.json, shipped inside every tile.
// It records which tile type (and version) made the tile and with what inputs,
// so a later Foundry can reopen a tile for editing, rebuild it with a newer
// template, or recognise its own tiles in a user's repo.
//
// It is public like the rest of the tile. It is deterministic (no timestamps),
// so the same inputs always give the same bytes.

export const RECIPE_PATH = "/foundry.json";
const MAX_RECIPE_BYTES = 16 * 1024;

function assertJsonSafe(value, path = "recipeInputs") {
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} is not a finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
    return;
  }
  if (t === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) assertJsonSafe(v, `${path}.${k}`);
    return;
  }
  throw new Error(`${path} cannot go in a recipe (only plain JSON values can).`);
}

export function makeRecipeFile(type, recipeInputs) {
  assertJsonSafe(recipeInputs);
  const recipe = {
    madeWith: FOUNDRY_NAME,
    foundryVersion: FOUNDRY_VERSION,
    type: type.id,
    typeVersion: type.version,
    inputs: recipeInputs,
  };
  const text = JSON.stringify(recipe, null, 2) + "\n";
  const file = makeFile(RECIPE_PATH, text);
  if (file.bytes.length > MAX_RECIPE_BYTES) throw new Error("The recipe is unexpectedly large.");
  return file;
}
