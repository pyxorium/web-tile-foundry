import { makeFile } from "../../core/fileset.js";
import { shapeForTile } from "./geometry/index.js";
import { lanternConfig, renderLanternHtml, cleanLook } from "./runtime/template.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Puts a Glass Lantern tile together from finished parts. Kept apart from the
// tile type (index.js) so the tests can run it in Node: the program text
// (`runtime`) and the card pictures (`art`) are handed in.
//
//   parts    { choice, shape, look, colors, slowTurn }, from resolvePanel (panel.js)
//   recipe   the panel's choices for /foundry.json (panelRecipe in panel.js)
//   runtime  the text of /lantern.js (see runtime/bundle.js)
//   art      { icon, banner }: PNG bytes

export function makeLanternTile({ name, description = "", parts, recipe = {}, runtime, art }) {
  if (typeof runtime !== "string" || !runtime) throw new Error("The lantern's program (/lantern.js) is missing.");
  const title = String(name || "").trim();
  const look = cleanLook(parts.look);
  const colors = parts.colors.length === parts.shape.faces.length ? parts.colors : null;
  const config = lanternConfig({ shape: shapeForTile(parts.shape), colors, look, slowTurn: parts.slowTurn });
  const html = renderLanternHtml({ title, config });
  const files = [makeFile("/", html), makeFile(RUNTIME_PATH, runtime)];
  if (art) files.push(makeFile("/icon.png", art.icon), makeFile("/banner.png", art.banner));
  return {
    name: title,
    description: String(description || "").trim(),
    files,
    icons: art ? [{ src: "/icon.png" }] : [],
    screenshots: art ? [{ src: "/banner.png" }] : [],
    recipeInputs: {
      panel: recipe,
      shape: { ...parts.choice, fingerprint: parts.shape.fingerprint },
      colors: config.colors,
      look,
      slowTurn: Boolean(parts.slowTurn),
    },
  };
}
