import { checkTileType } from "./contract.js";

// The list of tile types the Foundry offers. Each type registers itself once
// (see src/tile-types/index.js); the UI and the build step look types up here.

const types = new Map();

export function registerTileType(type) {
  checkTileType(type);
  if (types.has(type.id)) throw new Error(`Tile type "${type.id}" is already registered.`);
  types.set(type.id, type);
  return type;
}

export function getTileType(id) {
  const type = types.get(id);
  if (!type) throw new Error(`Unknown tile type "${id}".`);
  return type;
}

export function listTileTypes() {
  return [...types.values()];
}
