import { makeFile } from "../../core/fileset.js";
import { bytesToDataUri, isPng } from "../../core/bytes.js";
import { coasterConfig, renderCoasterHtml, cleanChoices } from "./runtime/template.js";
import { packTrack } from "./runtime/track-data.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Puts a Coaster Carnival tile together from finished parts. Kept apart from
// the tile type (index.js, stage 6) so the tests can run it in Node: the
// finished track, the program text (`runtime`) and the card pictures (`art`)
// are handed in.
//
//   choices  { theme, style, colors: { steel, wood, cart }, tunnel, handle }
//   track    the generator's result (generateTrack in track/index.js)
//   sprite   PNG bytes of the rider (the creator's, or the default sprite)
//   rider    what to say about the rider in /foundry.json (where it came from)
//   recipe   the panel's choices for /foundry.json
//   runtime  the text of /coaster.js (see runtime/bundle.js)
//   art      { icon, banner }: PNG bytes

export function makeCoasterTile({ name, description = "", choices = {}, track, sprite, rider = null, recipe = {}, runtime, art }) {
  if (typeof runtime !== "string" || !runtime) throw new Error("The coaster's program (/coaster.js) is missing.");
  if (!track || !Array.isArray(track.points)) throw new Error("The coaster's track is missing.");
  if (!sprite || !isPng(sprite)) throw new Error("The rider must be a PNG picture.");
  const title = String(name || "").trim();
  const clean = cleanChoices(choices);
  const config = coasterConfig({ choices: clean, track: packTrack(track), sprite: bytesToDataUri(sprite, "image/png") });
  const html = renderCoasterHtml({ title, config });
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
      track: {
        ...track.input,
        generator: track.version,
        fingerprint: track.fingerprint,
        built: track.built,
        leftOut: track.leftOut,
      },
      choices: clean,
      rider,
    },
  };
}
