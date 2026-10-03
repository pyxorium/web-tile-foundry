import { CLASSIC_DICE, classicDie } from "./dice.js";
import { chestahedron } from "./chestahedron.js";
import { gem, GEM_FACETS, randomSeed } from "./gem.js";

// Every shape Glass Lantern offers, in three groups.
// getShape(choice) returns finished geometry (see polyhedron.js for the format).
//
//   { group: "classic", id: "d20" }
//   { group: "special", id: "chestahedron" }
//   { group: "gem", id: "gem", seed: 123456, facets: 14 }

export const SHAPE_GROUPS = Object.freeze([
  { id: "classic", label: "Classic dice", shapes: CLASSIC_DICE },
  { id: "special", label: "Special", shapes: Object.freeze([{ id: "chestahedron", label: "Chestahedron", faces: 7 }]) },
  { id: "gem", label: "Gem", shapes: Object.freeze([{ id: "gem", label: "Gem", faces: null }]) },
]);

export { GEM_FACETS, randomSeed };

export function getShape(choice) {
  const { group, id } = choice || {};
  if (group === "classic") return classicDie(id);
  if (group === "special" && id === "chestahedron") return chestahedron();
  if (group === "gem" && id === "gem") return gem({ seed: choice.seed, facets: choice.facets ?? GEM_FACETS.default });
  throw new Error(`Unknown shape ${JSON.stringify(choice)}.`);
}

/** Just what a tile needs to draw the shape: corners and face loops. */
export function shapeForTile(shape) {
  return { vertices: shape.vertices, faces: shape.faces };
}
