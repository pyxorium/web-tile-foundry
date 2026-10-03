import { checkInputs } from "./contract.js";
import { readCspMeta, TILE_CSP } from "./policy.js";
import { makeRecipeFile, RECIPE_PATH } from "./recipe.js";
import { rawCid } from "./cid.js";

// Turns a tile type plus the user's inputs into a finished, checked set of tile
// files. This is the type-agnostic middle of the Foundry: every tile, of any
// type, passes through here before preview and (later) publishing.

const MAX_TILE_BYTES = 5 * 1024 * 1024; // well under any PDS blob limit seen so far

export class TileBuildError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = "TileBuildError";
    this.problems = problems;
  }
}

function checkCardImages(list, kind, byPath) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new TileBuildError(`${kind} must be a list.`);
  for (const entry of list) {
    const file = entry && byPath.get(entry.src);
    if (!file) throw new TileBuildError(`${kind} points to "${entry && entry.src}", which is not one of the tile's files.`);
    if (!file.contentType.startsWith("image/")) throw new TileBuildError(`${kind} entry "${entry.src}" is not an image.`);
  }
  return list.map((e) => ({ src: e.src }));
}

/**
 * Builds a tile. Returns:
 *   { typeId, typeVersion, name, description, icons, screenshots,
 *     files: [{ path, bytes, contentType, cid }], html, totalBytes }
 */
export async function buildTile(type, inputs, { final = true } = {}) {
  const problems = checkInputs(type, inputs);
  if (problems.length) throw new TileBuildError("Some inputs need attention.", problems);

  const out = await type.build(inputs, { final });

  const name = typeof out.name === "string" ? out.name.trim() : "";
  if (!name) throw new TileBuildError("The tile needs a name.");
  const description = typeof out.description === "string" ? out.description.trim() : "";

  const byPath = new Map();
  for (const file of out.files || []) {
    if (file.path === RECIPE_PATH) throw new TileBuildError(`${RECIPE_PATH} is written by the Foundry itself.`);
    if (byPath.has(file.path)) throw new TileBuildError(`Two files share the path "${file.path}".`);
    byPath.set(file.path, file);
  }
  const root = byPath.get("/");
  if (!root) throw new TileBuildError('The tile has no "/" page.');
  const html = new TextDecoder().decode(root.bytes);
  if (readCspMeta(html) !== TILE_CSP) throw new TileBuildError("The tile's page is missing the standard security policy.");

  const icons = checkCardImages(out.icons, "icons", byPath);
  const screenshots = checkCardImages(out.screenshots, "screenshots", byPath);

  byPath.set(RECIPE_PATH, makeRecipeFile(type, out.recipeInputs ?? {}));

  const files = [];
  let totalBytes = 0;
  for (const file of byPath.values()) {
    totalBytes += file.bytes.length;
    files.push({ ...file, cid: await rawCid(file.bytes) });
  }
  if (totalBytes > MAX_TILE_BYTES) throw new TileBuildError("The tile is larger than the Foundry allows (5 MB).");

  return { typeId: type.id, typeVersion: type.version, name, description, icons, screenshots, files, html, totalBytes, final };
}
