// The Publish step's review: which inputs move there, and each type's few words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewInputs, checkTileType } from "../src/core/contract.js";
import { zine } from "../src/tile-types/zine/index.js";
import { mixtape } from "../src/tile-types/mixtape/index.js";
import { spriteWalker } from "../src/tile-types/sprite-walker/index.js";

test("the card's words and the confirmations move to the review; what's drawn in the tile stays", () => {
  assert.deepEqual([...reviewInputs(spriteWalker)].sort(), ["description", "name"]);
  assert.deepEqual([...reviewInputs(zine)].sort(), ["description", "soundRights"], "the zine's title is on its cover");
  assert.deepEqual([...reviewInputs(mixtape)].sort(), ["confirm", "description"], "the tape's title is on the cassette");
  assert.equal(mixtape.inputs.find((i) => i.key === "name").group, "tape");
  for (const t of [zine, mixtape, spriteWalker]) checkTileType(t);
  assert.throws(() => checkTileType({ ...spriteWalker, reviewSummary: "no" }), /reviewSummary/);
});

test("a zine's summary counts what's on its pages", () => {
  const pages = zine.defaults({}).pages.map((p) => ({ ...p }));
  assert.equal(zine.reviewSummary({ pages }), "8 pages");
  pages[0].picture = { bytes: new Uint8Array(1) };
  pages[1] = { ...pages[1], layout: "tile", piece: { kind: "tile" } };
  pages[2] = { ...pages[2], layout: "tape", piece: { kind: "tape" }, sound: true, clip: {} };
  pages[3] = { ...pages[3], layout: "words", picture: { bytes: new Uint8Array(1) }, sound: true, clip: {} };
  assert.equal(zine.reviewSummary({ pages }), "8 pages · 1 picture · 1 web tile · 1 mixtape · 2 sounds", "a picture on a words page isn't shown, so isn't counted");
  assert.equal(zine.summary, "Make a little zine: eight pages of pictures, words, and more.");
});

test("a tape's summary: songs and each side's length", () => {
  assert.equal(mixtape.reviewSummary({ tracks: [] }), "0 songs");
  const tracks = [{ side: "A", seconds: 100 }, { side: "A", seconds: 50 }, { side: "B", seconds: 61 }];
  assert.equal(mixtape.reviewSummary({ tracks }), "3 songs · Side A 2:30 · Side B 1:01");
});
