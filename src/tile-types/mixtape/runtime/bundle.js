// Bundles the tile's player (tile-main.js and player.js) into one file:
// /mixtape.js in every Mixtape tile (made the same way as Coaster Carnival's
// /coaster.js).
//
// The Foundry does this while it is built or run (see the "mixtape-
// runtime" plugin in vite.config.js), using esbuild, which comes with Vite.
// The options are fixed, so the same source always gives the same bytes: every
// tile made by one version of the Foundry carries an identical /mixtape.js,
// and a person's repo stores it once however many tapes they publish.
//
// Node only (used by vite.config.js and the tests, never in the browser).

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export { RUNTIME_PATH } from "./paths.js";

export const RUNTIME_ENTRY = fileURLToPath(new URL("./tile-main.js", import.meta.url));

/** Returns { code, inputs }: the bundle's text and the source files it read. */
export async function bundleRuntime(esbuild) {
  const result = await esbuild.build({
    entryPoints: [RUNTIME_ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "eof",
    charset: "utf8",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const inputs = Object.keys(result.metafile.inputs).map((p) => resolve(p)); // esbuild lists them relative to the working folder
  return { code, inputs };
}
