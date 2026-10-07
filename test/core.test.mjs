// Core tests. Run with:  npm test   (or: node --test test/)
// No packages needed: uses Node's built-in test runner and WebCrypto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { rawCid, base32Lower } from "../src/core/cid.js";
import { contentTypeFor, makeFile } from "../src/core/fileset.js";
import { TILE_CSP, readCspMeta } from "../src/core/policy.js";
import { checkTileType, checkInputs } from "../src/core/contract.js";
import { buildTile, TileBuildError } from "../src/core/build.js";
import { makeRecipeFile } from "../src/core/recipe.js";
import { spriteFromBytes, geometryFromRecord, checkGeometry, SpriteError } from "../src/core/sprite-source.js";
import { pngSize } from "../src/core/bytes.js";
import { toMemoryTile } from "../src/core/loader-tile.js";
import { renderTileHtml, functionSource } from "../src/tile-types/sprite-walker/template.js";
import { SCENES, getScene } from "../src/tile-types/sprite-walker/scenes/index.js";
import { paintShadow } from "../src/tile-types/sprite-walker/shadow.js";
import { runSpriteWalker } from "../src/tile-types/sprite-walker/walker-runtime.js";
import { spriteWalker } from "../src/tile-types/sprite-walker/index.js";

const SAMPLE = readFileSync(new URL("./fixtures/sample-sprite.png", import.meta.url));

// The real actor.rpg.sprite record this sample came from (thunderbirdwine.bsky.social).
const SAMPLE_RECORD = {
  rows: 4, $type: "actor.rpg.sprite", width: 144, frames: 12, height: 192,
  source: "at://did:plc:joer5rzmwgec3dkr4srfmq45/actor.rpg.generator/self",
  columns: 3, frameWidth: 48, frameHeight: 48,
  spriteSheet: { ref: { $link: "bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy" }, size: 12297, $type: "blob", mimeType: "image/png" },
};

test("file address matches the address in the live sprite record", async () => {
  assert.equal(await rawCid(SAMPLE), SAMPLE_RECORD.spriteSheet.ref.$link);
});

test("base32 matches RFC 4648 test vectors (lowercase, unpadded)", () => {
  const enc = (s) => base32Lower(new TextEncoder().encode(s));
  assert.equal(enc("f"), "my");
  assert.equal(enc("foobar"), "mzxw6ytboi");
});

test("content types are fixed by extension, never chosen case by case", () => {
  assert.equal(contentTypeFor("/"), "text/html");
  assert.equal(contentTypeFor("/icon.png"), "image/png");
  assert.equal(contentTypeFor("/foundry.json"), "application/json");
  assert.equal(contentTypeFor("/model.glb"), "model/gltf-binary");
  assert.throws(() => contentTypeFor("/notes.txt"));
  assert.throws(() => makeFile("relative.png", new Uint8Array(1)));
});

test("sprite from the sample PNG: geometry inferred as 3 x 4 of 48 px", async () => {
  const sprite = await spriteFromBytes(SAMPLE, { kind: "local-file", name: "sprite.png" });
  assert.deepEqual(pngSize(sprite.bytes), { width: 144, height: 192 });
  assert.deepEqual(sprite.geometry, { columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 });
});

test("sprite geometry from the real record agrees with the image", async () => {
  assert.deepEqual(geometryFromRecord(SAMPLE_RECORD), { columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 });
  const sprite = await spriteFromBytes(SAMPLE, { kind: "record", uri: "at://x/actor.rpg.sprite/self" }, SAMPLE_RECORD);
  assert.equal(sprite.cid, SAMPLE_RECORD.spriteSheet.ref.$link);
});

test("mismatched or non-PNG sheets are refused with a readable message", async () => {
  assert.equal(checkGeometry({ columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 }, 144, 190).length, 1);
  await assert.rejects(spriteFromBytes(new TextEncoder().encode("not a png at all, really"), { kind: "local-file" }), SpriteError);
  await assert.rejects(
    spriteFromBytes(SAMPLE, { kind: "record" }, { ...SAMPLE_RECORD, frameWidth: 50 }),
    /doesn't match its own record/
  );
});

test("the sprite-walker type follows the contract", () => {
  checkTileType(spriteWalker);
  const d = spriteWalker.defaults({ handle: "alice.test" });
  assert.equal(d.name, "@alice.test's sprite");
  assert.deepEqual(checkInputs(spriteWalker, { ...d, sprite: {} }), []);
  assert.equal(checkInputs(spriteWalker, { ...d, sprite: {}, name: "x".repeat(65) }).length, 1);
  assert.deepEqual(checkInputs(spriteWalker, { ...d, sprite: {}, description: "" }), [], "the description is optional");
  assert.equal(checkInputs(spriteWalker, { ...d, sprite: null }).length, 1);
});

test("tile HTML carries the exact policy, the gear menu and the creator's start motion", () => {
  const html = renderTileHtml({ title: 'Bob\'s "best" <sprite>', sheetDataUri: "data:image/png;base64,AAAA", frameWidth: 48, frameHeight: 48, startMotion: "forward", scene: getScene("twilight") });
  assert.equal(readCspMeta(html), TILE_CSP);
  assert.match(html, /<title>Bob&#39;s &quot;best&quot; &lt;sprite&gt;<\/title>/);
  assert.match(html, /id="gear"/);
  for (const v of ["none", "forward", "backforth"]) assert.match(html, new RegExp(`value="${v}"`));
  assert.match(html, /"startMotion":"forward"/);
  assert.doesNotMatch(html, /https?:\/\//, "the tile must not reference any outside address");
});

test("a title cannot break out of the page's script", () => {
  const html = renderTileHtml({ title: "</script><script>alert(1)</script>", sheetDataUri: "data:,", frameWidth: 1, frameHeight: 1, startMotion: "none", scene: getScene("plain") });
  assert.equal(html.split("<script>").length, 2, "only the tile's own script element");
});

// A tiny stand-in type so the build step can be tested without a canvas.
const fakeType = {
  id: "fake-tile", version: 1, title: "Fake", summary: "For tests.",
  inputs: [{ key: "name", kind: "text", required: true }],
  defaults: () => ({ name: "x" }),
  build: async (inputs) => ({
    name: inputs.name,
    description: "",
    files: [makeFile("/", `<html><head><meta http-equiv="Content-Security-Policy" content="${TILE_CSP}" /></head></html>`), makeFile("/icon.png", SAMPLE)],
    icons: [{ src: "/icon.png" }],
    recipeInputs: { hello: "world" },
  }),
};

test("buildTile adds the recipe and the address of every file", async () => {
  const out = await buildTile(fakeType, { name: "Test tile" });
  assert.deepEqual(out.files.map((f) => f.path), ["/", "/icon.png", "/foundry.json"]);
  assert.equal(out.files[1].cid, SAMPLE_RECORD.spriteSheet.ref.$link);
  const recipe = JSON.parse(new TextDecoder().decode(out.files[2].bytes));
  assert.deepEqual(recipe, { madeWith: "Web Tile Foundry", foundryVersion: "0.9.3", type: "fake-tile", typeVersion: 1, inputs: { hello: "world" } });
});

test("the recipe is deterministic, so identical inputs give identical bytes", () => {
  const a = makeRecipeFile(fakeType, { a: 1, b: [true, null, "x"] });
  const b = makeRecipeFile(fakeType, { a: 1, b: [true, null, "x"] });
  assert.deepEqual(a.bytes, b.bytes);
  assert.throws(() => makeRecipeFile(fakeType, { when: new Date() }), /plain JSON/);
});

test("buildTile refuses a page without the policy, and broken card images", async () => {
  const noPolicy = { ...fakeType, build: async () => ({ name: "x", files: [makeFile("/", "<html></html>")] }) };
  await assert.rejects(buildTile(noPolicy, { name: "x" }), /security policy/);
  const badIcon = { ...fakeType, build: async (i) => ({ ...(await fakeType.build(i)), icons: [{ src: "/missing.png" }] }) };
  await assert.rejects(buildTile(badIcon, { name: "x" }), TileBuildError);
  await assert.rejects(buildTile(fakeType, { name: "  " }), /inputs need attention/);
});

// A stand-in 2D canvas context that accepts every call the scenes make.
function fakeContext() {
  const gradient = { addColorStop() {} };
  const calls = { fillRect: 0 };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === "calls") return calls;
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "measureText") return (text) => ({ width: text.length * 6 });
      if (prop === "fillRect") return () => { calls.fillRect++; };
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return ctx;
}

test("there are eight backgrounds, each with a unique id and a label", () => {
  assert.deepEqual(SCENES.map((s) => s.id), ["twilight", "glitter", "blockworld", "dungeon", "cafe", "snow", "beach", "plain"]);
  for (const s of SCENES) {
    assert.ok(s.label && Number.isInteger(s.version) && s.groundRatio > 0.5 && s.groundRatio < 0.9, s.id);
  }
});

test("every background's paint() is self-contained and returns a sensible ground line", () => {
  for (const scene of SCENES) {
    // Rebuilt from its source text alone, exactly as it runs inside a tile.
    const paint = new Function(`"use strict"; return ${functionSource(scene.paint)};`)();
    for (const [w, h, px] of [[480, 320, 3], [1200, 630, 6], [192, 120, 1], [2400, 1500, 12]]) {
      for (const t of [0, 16, 12345.6, 9e6]) {
        const ctx = fakeContext();
        const groundY = paint(ctx, w, h, px, t);
        assert.ok(groundY > h * 0.5 && groundY < h, `${scene.id} ground ${groundY} for ${w}x${h}`);
        assert.ok(ctx.calls.fillRect > 0, `${scene.id} drew nothing`);
      }
    }
  }
});

test("the walker runtime and shadow are self-contained too", () => {
  for (const fn of [runSpriteWalker, paintShadow]) {
    assert.doesNotThrow(() => new Function(`"use strict"; return ${functionSource(fn)};`)());
  }
});

test("a tile carries only the background its creator chose", () => {
  const html = renderTileHtml({ title: "t", sheetDataUri: "data:,", frameWidth: 48, frameHeight: 48, startMotion: "none", scene: getScene("dungeon") });
  assert.match(html, /background: dungeon v1/);
  assert.match(html, /"background":"dungeon"/);
  assert.doesNotMatch(html, /online now/, "the glitter scene must not be included");
  const glitterHtml = renderTileHtml({ title: "t", sheetDataUri: "data:,", frameWidth: 48, frameHeight: 48, startMotion: "none", scene: getScene("glitter") });
  assert.match(glitterHtml, /online now/);
  assert.ok(glitterHtml.length < html.length * 1.5, "one scene's code is small");
});

test("functionSource handles minified method shorthand", () => {
  const obj = { paint(a) { return a + 1; } };
  const fn = new Function(`return ${functionSource(obj.paint)};`)();
  assert.equal(fn(1), 2);
});

test("the background choice is validated like any other choice", () => {
  const d = spriteWalker.defaults({});
  assert.equal(d.background, "twilight");
  assert.equal(checkInputs(spriteWalker, { ...d, sprite: {}, background: "moon-base" }).length, 1);
});

test("Sprite Walker asks only for sprite, background, title and description", () => {
  assert.deepEqual(spriteWalker.inputs.map((i) => i.key), ["sprite", "background", "name", "description"]);
  const cardFields = spriteWalker.inputs.filter((i) => i.group === "card").map((i) => i.key);
  assert.deepEqual(cardFields, ["name", "description"]);
  assert.equal(spriteWalker.groups[0].title, "For display in the link preview card");
});

test("an input naming an unknown group is refused", () => {
  const bad = { ...spriteWalker, id: "bad-groups", groups: [] };
  assert.throws(() => checkTileType(bad), /unknown group/);
});

test("a built tile converts to the real loader's in-memory shape", async () => {
  const out = await buildTile(fakeType, { name: "Loader tile" });
  const mem = toMemoryTile(out);
  assert.equal(mem.name, "Loader tile");
  assert.deepEqual(Object.keys(mem.resources), ["/", "/icon.png", "/foundry.json"]);
  const root = mem.resources["/"];
  assert.equal(typeof root.src, "string", "HTML goes to the loader as text");
  assert.equal(root["content-type"], "text/html");
  assert.equal(root["content-security-policy"], TILE_CSP, "the page's policy is also given as a header");
  assert.ok(mem.resources["/icon.png"].src instanceof Uint8Array, "images go as bytes");
  assert.equal(mem.resources["/icon.png"]["content-security-policy"], undefined);
  assert.equal(mem.resources["/foundry.json"]["content-type"], "application/json");
});
