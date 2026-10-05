// Coaster Carnival stage 6: the Foundry panel (its inputs, starting values and rules).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { coasterCarnival } from "../src/tile-types/coaster-carnival/index.js";
import {
  panelDefaults, trackInput, trackFor, cachedTrack, choicesOf, usableSprite, riderRecipe, panelRecipe, describeTrack, SEED_MAX,
  leftOutLine, leftOutReason,
} from "../src/tile-types/coaster-carnival/panel.js";
import { cleanChoices } from "../src/tile-types/coaster-carnival/runtime/template.js";
import { checkTileType, checkInputs } from "../src/core/contract.js";
import { RANGES } from "../src/tile-types/coaster-carnival/track/index.js";

test("Coaster Carnival follows the tile-type contract, and its starting values pass its own checks", () => {
  checkTileType(coasterCarnival);
  const values = coasterCarnival.defaults({});
  assert.deepEqual(checkInputs(coasterCarnival, values), []);
  assert.equal(coasterCarnival.defaults({ handle: "alice.test" }).name, "@alice.test's coaster");
  assert.equal(coasterCarnival.defaults({ handle: "alice.test" }).handle, "alice.test");
  assert.equal(values.handle, null);
  assert.ok(Number.isInteger(values.seed) && values.seed >= 0 && values.seed <= SEED_MAX);
  // The rider is optional: no sprite still passes.
  assert.equal(values.sprite, null);
  // The switch and the tunnel start on, as agreed.
  assert.equal(values.trackSwitch, true);
  assert.equal(values.tunnel, true);
});

test("the Shape number can be typed and has a New track shape button; the colors follow the track style", () => {
  const seed = coasterCarnival.inputs.find((i) => i.key === "seed");
  assert.equal(seed.button, "New track shape");
  assert.equal(seed.editable, true);
  assert.equal(seed.label, "Shape");
  const shown = (key, v) => {
    const input = coasterCarnival.inputs.find((i) => i.key === key);
    return !input.showIf || input.showIf(v);
  };
  const steel = { ...panelDefaults(), style: "steel" };
  const wood = { ...panelDefaults(), style: "wood" };
  assert.ok(shown("steelColors", steel) && !shown("woodColors", steel));
  assert.ok(shown("woodColors", wood) && !shown("steelColors", wood));
  const theme = coasterCarnival.inputs.find((i) => i.key === "theme");
  assert.deepEqual(theme.options.map((o) => o.value), ["day", "night", "spooky"]);
  assert.ok(theme.options.every((o) => /theme-(day|night|spooky)\.png$/.test(o.image)), "saved pictures");
});

test("the track's inputs are always in range, and a track is made once and kept", () => {
  const input = trackInput({ drops: 9, loops: -2, corkscrews: 1.6, intensity: "x", seed: -5, trackSwitch: undefined });
  assert.deepEqual(input, { drops: RANGES.drops.max, loops: RANGES.loops.min, corkscrews: 2, intensity: RANGES.intensity.default, seed: 0, trackSwitch: true });
  const values = { ...panelDefaults(), seed: 7 };
  assert.equal(cachedTrack(values), null);
  const a = trackFor(values);
  assert.equal(trackFor({ ...values, name: "another title" }), a, "only the track's own inputs matter");
  assert.equal(cachedTrack(values), a);
  assert.equal(a.input.seed, 7);
});

test("the panel's choices pass the tile's own checks unchanged; the recipe records the panel", () => {
  const values = { ...panelDefaults({ handle: "alice.example" }), theme: "night", style: "wood", woodColors: "barn-red", cartColors: "silver", tunnel: false };
  const choices = choicesOf(values);
  assert.deepEqual(cleanChoices(choices), choices);
  const recipe = panelRecipe(values);
  assert.equal(recipe.theme, "night");
  assert.equal(recipe.tunnel, false);
  assert.equal(recipe.seed, values.seed);
  assert.ok(!("sprite" in recipe) && !("handle" in recipe));
});

test("the rider: the creator's standard 3 x 4 sprite, otherwise the default", () => {
  const sprite = (columns, rows) => ({ bytes: new Uint8Array([1]), cid: "bafy", width: 144, height: 192, origin: { kind: "record", uri: "at://did:plc:x/actor.rpg.sprite/self" }, geometry: { columns, rows, frameWidth: 48, frameHeight: 48 } });
  assert.equal(usableSprite({ sprite: null }), null);
  assert.equal(usableSprite({ sprite: sprite(4, 4) }), null);
  assert.ok(usableSprite({ sprite: sprite(3, 4) }));
  assert.deepEqual(riderRecipe({ sprite: null }), { kind: "default" });
  assert.equal(riderRecipe({ sprite: sprite(3, 4) }).origin.uri, "at://did:plc:x/actor.rpg.sprite/self");
  assert.ok(describeTrack({ ...panelDefaults(), seed: 7, sprite: sprite(4, 4) }).includes("default rider"));
});

test("the line under the preview names the shape, the ride's length and what fitted", () => {
  const values = { ...panelDefaults(), seed: 7 };
  const text = describeTrack(values, trackFor(values));
  assert.match(text, /^Shape 7 · \d+ s ride/);
  assert.equal(describeTrack({ ...values, seed: 123456 }), "Making the track…");
  const small = { ...panelDefaults(), seed: 7, drops: 3, loops: 2, corkscrews: 2, intensity: 1 };
  const t = trackFor(small);
  const left = Object.entries(t.leftOut).some(([k, n]) => k !== "trackSwitch" && n > 0);
  if (left) assert.match(describeTrack(small, t), /left out/);
});

test("what was left out is explained in plain words, by its real reason, with a nudge where one helps", () => {
  const made = (notes, leftOut) => ({ notes, leftOut: { drops: 0, loops: 0, corkscrews: 0, trackSwitch: false, ...leftOut } });
  assert.equal(leftOutLine(made([], {})), "");
  assert.equal(leftOutReason(made(["ride too long"], { corkscrews: 1 })), "time");
  assert.equal(leftOutLine(made(["ride too long"], { corkscrews: 1 })), "1 corkscrew left out to keep the ride under 40 seconds");
  assert.equal(leftOutLine(made(["too wide (312 m)"], { corkscrews: 1 })), "1 corkscrew left out: it didn't fit in the park. Try a new track shape");
  assert.equal(leftOutLine(made(["could not close the circuit compactly", "too wide"], { loops: 1, corkscrews: 1 })), "1 loop and 1 corkscrew left out: they didn't fit in the park. Try a new track shape");
  assert.equal(leftOutLine(made(["not enough speed for a loop"], { loops: 1 }), 2), "1 loop left out: the cart ran out of speed for it. Try more intensity");
  assert.equal(leftOutLine(made(["not enough speed for a loop", "not enough speed for a loop"], { loops: 2 }), 5), "2 loops left out: the cart ran out of speed for them");
  // A switch with no room is told apart, not counted as a left-out piece.
  assert.equal(leftOutReason(made(["switch left out: no turn had room for the thrill route", "ride too long"], { drops: 1 })), "time");
});
