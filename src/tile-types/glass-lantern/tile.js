import { makeFile } from "../../core/fileset.js";
import { getShape, shapeForTile } from "./geometry/index.js";
import { kitLook, getKit } from "./lantern/kits.js";
import { alternateColours } from "./lantern/settings.js";
import { lanternConfig, renderLanternHtml, cleanLook } from "./runtime/template.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Puts a Glass Lantern tile together from finished parts. Kept apart from the
// tile type (index.js) so the tests can run it in Node: the program text
// (`runtime`) and the card pictures (`art`) are handed in.
//
//   shape    a shape choice, e.g. { group: "classic", id: "d12" } (see geometry/index.js)
//   kit      "tiffany", "victorian" or "steampunk"
//   look     optional: the full look, instead of the kit's own
//   colours  optional: one colour per face; otherwise the palette repeats
//   runtime  the text of /lantern.js (see runtime/bundle.js)
//   art      { icon, banner }: PNG bytes

export function lanternTileParts({ shape: choice, kit = "tiffany", look, colours, slowTurn = true }) {
  const shape = getShape(choice);
  const finalLook = cleanLook({ ...kitLook(kit), ...(look || {}) }); // a partial look keeps the kit for the rest
  const faceColours = colours && colours.length === shape.faces.length ? colours : alternateColours(shape.faces.length, finalLook.palette);
  return { shape, look: finalLook, colours: faceColours, slowTurn };
}

export function makeLanternTile({ name, description = "", shape: choice, kit = "tiffany", look, colours, slowTurn = true, runtime, art }) {
  if (typeof runtime !== "string" || !runtime) throw new Error("The lantern's program (/lantern.js) is missing.");
  const parts = lanternTileParts({ shape: choice, kit, look, colours, slowTurn });
  const title = String(name || "").trim();
  const config = lanternConfig({ shape: shapeForTile(parts.shape), colours: parts.colours, look: parts.look, slowTurn });
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
      shape: { ...choice, fingerprint: parts.shape.fingerprint },
      kit: getKit(kit).id,
      colours: parts.colours,
      look: parts.look,
      slowTurn: Boolean(slowTurn),
    },
  };
}
