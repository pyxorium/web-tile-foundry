// Glass Lantern stage 5: the tile itself (page, program, files, recipe).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { bundleRuntime, RUNTIME_PATH } from "../src/tile-types/glass-lantern/runtime/bundle.js";
import { makeLanternTile } from "../src/tile-types/glass-lantern/tile.js";
import { cleanLook } from "../src/tile-types/glass-lantern/runtime/template.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";
import { checkTileType } from "../src/core/contract.js";
import { readCspMeta, TILE_CSP } from "../src/core/policy.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { getShape, deriveShape } from "../src/tile-types/glass-lantern/geometry/index.js";

// esbuild comes with Vite, so it is there after `npm install`.
const esbuild = await import("esbuild");
const runtime = (await bundleRuntime(esbuild)).code;
const art = { icon: new Uint8Array([1]), banner: new Uint8Array([2]) };

function configOf(html) {
  const m = /<script type="application\/json" id="lantern-config">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m[1]);
}

test("the lantern program bundles the same bytes every time, and stays well under the size limit", async () => {
  const again = (await bundleRuntime(esbuild)).code;
  assert.equal(again, runtime);
  assert.ok(runtime.length < 1.5 * 1024 * 1024, `lantern.js is ${runtime.length} bytes`);
});

test("Glass Lantern follows the tile-type contract", () => {
  checkTileType(glassLantern);
});

test("a tile has its page, the shared program, and card pictures; .js files are served as JavaScript", () => {
  const tile = makeLanternTile({ name: "  My lantern ", shape: { group: "classic", id: "d20" }, kit: "victorian", runtime, art });
  assert.equal(tile.name, "My lantern");
  assert.deepEqual(tile.files.map((f) => f.path), ["/", RUNTIME_PATH, "/icon.png", "/banner.png"]);
  assert.equal(contentTypeFor("/lantern.js"), "text/javascript");
  const html = new TextDecoder().decode(tile.files[0].bytes);
  assert.equal(readCspMeta(html), TILE_CSP);
  assert.ok(html.includes(`<script src="${RUNTIME_PATH}"></script>`));
  assert.ok(html.length < 12000, `page is ${html.length} bytes`);
});

test("every lantern tile carries byte-identical /lantern.js, whatever its shape and look", () => {
  const a = makeLanternTile({ name: "A", shape: { group: "classic", id: "d6" }, kit: "tiffany", runtime, art });
  const b = makeLanternTile({ name: "B", shape: { group: "gem", id: "gem", seed: 9, facets: 20 }, kit: "steampunk", runtime, art });
  assert.deepEqual(a.files[1].bytes, b.files[1].bytes);
});

test("the page's config rebuilds the exact shape, colours and look", () => {
  const choice = { group: "special", id: "chestahedron" };
  const tile = makeLanternTile({ name: "C", shape: choice, kit: "steampunk", runtime, art, slowTurn: false });
  const config = configOf(new TextDecoder().decode(tile.files[0].bytes));
  assert.equal(config.version, 1);
  const shape = getShape(choice);
  assert.equal(deriveShape(config.shape).fingerprint, shape.fingerprint);
  assert.equal(config.colours.length, shape.faces.length);
  assert.equal(config.slowTurn, false);
  assert.equal(config.look.metal, tile.recipeInputs.look.metal);
  assert.equal(tile.recipeInputs.shape.fingerprint, shape.fingerprint);
  assert.equal(tile.recipeInputs.kit, "steampunk");
});

test("the same inputs always make the same page", () => {
  const make = () => makeLanternTile({ name: "Same", shape: { group: "classic", id: "d12" }, kit: "tiffany", runtime, art }).files[0].bytes;
  assert.deepEqual(make(), make());
});

test("only known look settings of the right kind reach a tile", () => {
  const look = cleanLook({ ior: 1.4, metal: "copper", palette: ["#112233"], evil: "<script>", glow: "lots", thickness: NaN });
  assert.deepEqual(look, { ior: 1.4, metal: "copper", palette: ["#112233"] });
  const tile = makeLanternTile({ name: "</script><b>", shape: { group: "classic", id: "d4" }, look: { bgBottom: "</style>" }, runtime, art });
  const html = new TextDecoder().decode(tile.files[0].bytes);
  assert.ok(!html.includes("</script><b>"));
  assert.ok(!html.includes("</style>\""));
  assert.ok(html.includes("background: #0e0907"));
});
